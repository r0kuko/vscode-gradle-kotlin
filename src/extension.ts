import * as vscode from 'vscode';
import * as path from 'path';
import { GradleModule, discoverGradleModules } from './gradle';
import {
    GradleTask,
    discoverModuleTasksStatically,
    findOwningModule,
    parseTasksAllOutput,
    qualifyTask,
} from './tasks';
import { VersionCatalog, findCatalogFile, parseCatalogFile } from './libs';
import { GradleModulesProvider, ModuleTreeItemData } from './treeProvider';
import { GradleCodeLensProvider } from './codelens';
import { LibsInlayHintsProvider } from './inlayHints';
import { LibsCompletionProvider } from './completion';
import { LibsDefinitionProvider } from './definition';
import { LibsHoverProvider } from './hover';
import { SettingsCodeActionProvider, addSubprojectCommand } from './codeActions';
import { disposeDaemon, getDaemon, setDefaultInitScriptPath } from './daemon';
import { createDaemonStatusItem } from './statusBar';
import { createTestController } from './testController';
import { registerGradleRunTool } from './aiTool';
import { RecentRun, pushRecent } from './history';

const HISTORY_KEY = 'gradleKotlin.recentRuns';

let output: vscode.OutputChannel;

interface WorkspaceState {
    folder: vscode.WorkspaceFolder;
    modules: GradleModule[];
    catalog?: VersionCatalog;
}

const workspaces = new Map<string, WorkspaceState>();
const dynamicTasksByModule = new Map<string, GradleTask[]>();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    output = vscode.window.createOutputChannel('Gradle Kotlin');
    context.subscriptions.push(output);

    setDefaultInitScriptPath(
        context.asAbsolutePath(path.join('resources', 'gradle-kotlin.init.gradle.kts'))
    );
    const daemon = getDaemon(output);
    context.subscriptions.push({ dispose: () => disposeDaemon() });
    context.subscriptions.push(createDaemonStatusItem(daemon));

    const testController = createTestController(context, daemon, () => {
        const out: GradleModule[] = [];
        for (const ws of workspaces.values()) out.push(...ws.modules);
        return out;
    });

    const modulesProvider = new GradleModulesProvider(context.extensionPath);
    modulesProvider.setTaskResolver(module => mergedTasks(module));
    const treeView = vscode.window.createTreeView('gradleKotlin.modulesView', {
        treeDataProvider: modulesProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    const codeLensProvider = new GradleCodeLensProvider();
    const inlayProvider = new LibsInlayHintsProvider(() => activeCatalog());
    const completionProvider = new LibsCompletionProvider(() => activeCatalog());
    const definitionProvider = new LibsDefinitionProvider(() => activeCatalog());
    const hoverProvider = new LibsHoverProvider(() => activeCatalog());
    const settingsCodeActionProvider = new SettingsCodeActionProvider();

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { scheme: 'file', pattern: '**/*.gradle{,.kts}' },
            codeLensProvider
        ),
        vscode.languages.registerInlayHintsProvider(
            { scheme: 'file', pattern: '**/*.gradle{,.kts}' },
            inlayProvider
        ),
        vscode.languages.registerCompletionItemProvider(
            { scheme: 'file', pattern: '**/*.gradle{,.kts}' },
            completionProvider,
            '.'
        ),
        vscode.languages.registerDefinitionProvider(
            { scheme: 'file', pattern: '**/*.gradle{,.kts}' },
            definitionProvider
        ),
        vscode.languages.registerHoverProvider(
            { scheme: 'file', pattern: '**/*.gradle{,.kts}' },
            hoverProvider
        ),
        vscode.languages.registerCodeActionsProvider(
            { scheme: 'file', pattern: '**/settings.gradle{,.kts}' },
            settingsCodeActionProvider
        )
    );

    // Commands ----------------------------------------------------------------
    const recentByWorkspace = new Map<string, RecentRun[]>();
    const loadRecent = (): RecentRun[] =>
        context.workspaceState.get<RecentRun[]>(HISTORY_KEY, []) ?? [];
    for (const r of loadRecent()) {
        const list = recentByWorkspace.get(r.workspaceRoot) ?? [];
        list.push(r);
        recentByWorkspace.set(r.workspaceRoot, list);
    }
    for (const [ws, list] of recentByWorkspace) modulesProvider.setRecent(ws, list);

    const recordRun = async (run: RecentRun) => {
        const merged = pushRecent(loadRecent(), run);
        await context.workspaceState.update(HISTORY_KEY, merged);
        const grouped = new Map<string, RecentRun[]>();
        for (const r of merged) {
            const list = grouped.get(r.workspaceRoot) ?? [];
            list.push(r);
            grouped.set(r.workspaceRoot, list);
        }
        for (const [ws, list] of grouped) modulesProvider.setRecent(ws, list);
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('gradleKotlin.refresh', () => refreshAll(modulesProvider, codeLensProvider, inlayProvider)),
        vscode.commands.registerCommand('gradleKotlin.reloadProject', async () => {
            await reloadProject(daemon);
            await refreshAll(modulesProvider, codeLensProvider, inlayProvider);
        }),
        vscode.commands.registerCommand('gradleKotlin.runTask', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            await runTaskCommand(daemon, target, recordRun);
        }),
        vscode.commands.registerCommand('gradleKotlin.runTaskWithArgs', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            await runTaskCommand(daemon, target, recordRun, { promptForArgs: true });
        }),
        vscode.commands.registerCommand('gradleKotlin.runTestsForTask', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            await runTestsForTask(daemon, target, recordRun);
        }),
        vscode.commands.registerCommand('gradleKotlin.rerunRecent', async (run: RecentRun) => {
            if (!run) return;
            output.show(true);
            const result = await runWithProgress(
                daemon,
                `Gradle: ${run.task}`,
                { workspaceRoot: run.workspaceRoot, args: [run.task, ...run.args] }
            );
            await recordRun({
                ...run,
                timestamp: Date.now(),
                exitCode: result.exitCode,
                durationMs: result.durationMs,
            });
        }),
        vscode.commands.registerCommand('gradleKotlin.clearRecent', async () => {
            await context.workspaceState.update(HISTORY_KEY, []);
            for (const ws of recentByWorkspace.keys()) modulesProvider.setRecent(ws, []);
        }),
        vscode.commands.registerCommand('gradleKotlin.runDependencies', async (uri?: vscode.Uri) => {
            await runDependencies(daemon, uri);
        }),
        vscode.commands.registerCommand('gradleKotlin.addSubproject', async (uri?: vscode.Uri) => {
            await addSubprojectCommand(uri);
            await refreshAll(modulesProvider, codeLensProvider, inlayProvider);
            await hydrateAllTasks(daemon, modulesProvider);
        }),
        vscode.commands.registerCommand('gradleKotlin.openModule', async (target: ModuleTreeItemData) => {
            if (target?.module?.buildScript) {
                const doc = await vscode.workspace.openTextDocument(target.module.buildScript);
                await vscode.window.showTextDocument(doc);
            }
        }),
        vscode.commands.registerCommand('gradleKotlin.stopDaemon', async () => {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (folder) await daemon.stopAll(folder.uri.fsPath);
        })
    );

    // Filesystem watchers — refresh on build script / catalog changes.
    const watcher = vscode.workspace.createFileSystemWatcher(
        '**/{build,settings}.gradle{,.kts}'
    );
    const catalogWatcher = vscode.workspace.createFileSystemWatcher(
        '**/libs.versions.toml'
    );
    context.subscriptions.push(watcher, catalogWatcher);
    const fire = async () => {
        await refreshAll(modulesProvider, codeLensProvider, inlayProvider);
        refreshTestController(testController);
    };
    watcher.onDidChange(fire);
    watcher.onDidCreate(fire);
    watcher.onDidDelete(fire);
    catalogWatcher.onDidChange(fire);
    catalogWatcher.onDidCreate(fire);
    catalogWatcher.onDidDelete(fire);

    const testWatcher = vscode.workspace.createFileSystemWatcher('**/src/test/**/*.kt');
    context.subscriptions.push(testWatcher);
    const refreshTests = () => refreshTestController(testController);
    testWatcher.onDidChange(refreshTests);
    testWatcher.onDidCreate(refreshTests);
    testWatcher.onDidDelete(refreshTests);

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(fire),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gradleKotlin')) {
                codeLensProvider.refresh();
                inlayProvider.refresh();
            }
        })
    );

    // AI tool registration (no-op on older VS Code versions).
    registerGradleRunTool(context, daemon, () => {
        const out: GradleModule[] = [];
        for (const ws of workspaces.values()) out.push(...ws.modules);
        return out;
    });

    await refreshAll(modulesProvider, codeLensProvider, inlayProvider);
    await hydrateAllTasks(daemon, modulesProvider);
    refreshTestController(testController);
}

export function deactivate(): void {
    disposeDaemon();
}

function activeCatalog(): VersionCatalog | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (folder) {
            const ws = workspaces.get(folder.uri.fsPath);
            if (ws?.catalog) return ws.catalog;
        }
    }
    for (const ws of workspaces.values()) {
        if (ws.catalog) return ws.catalog;
    }
    return undefined;
}

async function refreshAll(
    treeProvider: GradleModulesProvider,
    codeLensProvider: GradleCodeLensProvider,
    inlayProvider: LibsInlayHintsProvider
): Promise<void> {
    workspaces.clear();
    dynamicTasksByModule.clear();
    treeProvider.clear();
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
        const root = folder.uri.fsPath;
        const modules = discoverGradleModules(root);
        if (modules.length === 0) continue;
        const catalogFile = findCatalogFile(root);
        const catalog = catalogFile ? parseCatalogFile(catalogFile) : undefined;
        workspaces.set(root, { folder, modules, catalog });
        treeProvider.setModules(root, modules);
    }
    codeLensProvider.refresh();
    inlayProvider.refresh();
}

/** Re-discover Kotlin tests under each module so the Test Explorer stays in sync. */
function refreshTestController(controller: vscode.TestController | undefined): void {
    controller?.resolveHandler?.(undefined);
}

function moduleKey(module: GradleModule): string {
    return `${module.workspaceRoot}::${module.projectPath}`;
}

function mergedTasks(module: GradleModule): GradleTask[] {
    const staticTasks = discoverModuleTasksStatically(module);
    const dynamicTasks = dynamicTasksByModule.get(moduleKey(module)) ?? [];
    const byName = new Map<string, GradleTask>();
    for (const t of staticTasks) byName.set(t.name, t);
    for (const t of dynamicTasks) byName.set(t.name, t);
    return Array.from(byName.values()).sort((a, b) => {
        const ag = a.group ?? 'zzz';
        const bg = b.group ?? 'zzz';
        if (ag !== bg) return ag.localeCompare(bg);
        return a.name.localeCompare(b.name);
    });
}

async function hydrateAllTasks(
    daemon: ReturnType<typeof getDaemon>,
    treeProvider: GradleModulesProvider
): Promise<void> {
    for (const ws of workspaces.values()) {
        for (const module of ws.modules) {
            try {
                const result = await daemon.run({
                    workspaceRoot: ws.folder.uri.fsPath,
                    args: [qualifyTask(module.projectPath, 'tasks'), '--all', '--quiet'],
                });
                const parsed = parseTasksAllOutput(result.combined, module.projectPath);
                if (parsed.length > 0) {
                    dynamicTasksByModule.set(moduleKey(module), parsed);
                }
            } catch {
                // Best-effort only: static tasks remain available.
            }
        }
        treeProvider.refresh();
    }
}

async function reloadProject(daemon: ReturnType<typeof getDaemon>): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        vscode.window.showInformationMessage('No Gradle workspace detected.');
        return;
    }
    output.show(true);
    output.appendLine(`\n=== Reloading Gradle project at ${folder.uri.fsPath} ===`);
    await runWithProgress(
        daemon,
        'Gradle: Reload Project',
        { workspaceRoot: folder.uri.fsPath, args: ['help', '--quiet'] }
    );
}

/**
 * Run a Gradle invocation through the shared daemon while showing a
 * cancellable notification. Cancelling the notification SIGTERMs the child.
 */
function runWithProgress(
    daemon: ReturnType<typeof getDaemon>,
    title: string,
    request: { workspaceRoot: string; args: string[] }
): Thenable<import('./daemon').DaemonRunResult> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: true,
        },
        (_progress, token) =>
            daemon.run({ ...request, token })
    );
}

async function runTaskCommand(
    daemon: ReturnType<typeof getDaemon>,
    target: ModuleTreeItemData | GradleTask | undefined,
    recordRun: (r: RecentRun) => Promise<void>,
    options: { promptForArgs?: boolean } = {}
): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    let qualified: string | undefined;
    if (target && 'kind' in target && target.kind === 'task' && target.task) {
        qualified = qualifyTask(target.task.projectPath, target.task.name);
    } else if (target && 'name' in target && (target as GradleTask).name) {
        const t = target as GradleTask;
        qualified = qualifyTask(t.projectPath, t.name);
    }

    if (!qualified) {
        const taskName = await vscode.window.showInputBox({
            prompt: 'Gradle task to run (e.g. :app:test, build, dependencies)',
            placeHolder: ':app:test',
        });
        if (!taskName) return;
        qualified = taskName.startsWith(':') ? taskName : ':' + taskName;
    }

    let extraArgs: string[] = [];
    if (options.promptForArgs) {
        const input = await vscode.window.showInputBox({
            prompt: `Extra arguments for ${qualified}`,
            placeHolder: '--info --tests "*MyTest*" -Pfoo=bar',
        });
        if (input === undefined) return;
        extraArgs = input.trim().length > 0 ? splitArgs(input) : [];
    }

    output.show(true);
    const result = await runWithProgress(
        daemon,
        `Gradle: ${qualified}`,
        { workspaceRoot: folder.uri.fsPath, args: [qualified, ...extraArgs] }
    );
    await recordRun({
        task: qualified,
        args: extraArgs,
        workspaceRoot: folder.uri.fsPath,
        timestamp: Date.now(),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
    });
}

/**
 * Split a CLI argument string while respecting double quotes.  Good
 * enough for the gradle args the user types in the input box.
 */
function splitArgs(input: string): string[] {
    const out: string[] = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) out.push(m[1] ?? m[2]);
    return out;
}

async function runTestsForTask(
    daemon: ReturnType<typeof getDaemon>,
    target: ModuleTreeItemData | GradleTask | undefined,
    recordRun: (r: RecentRun) => Promise<void>
): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    let task: GradleTask | undefined;
    if (target && 'kind' in target && target.kind === 'task' && target.task) {
        task = target.task;
    } else if (target && 'name' in target && (target as GradleTask).name) {
        task = target as GradleTask;
    }
    if (!task) {
        vscode.window.showInformationMessage('Select a Gradle test task first.');
        return;
    }
    if (!/(^|:)(test|check)$/i.test(task.name)) {
        vscode.window.showInformationMessage('This action is intended for test/check tasks.');
        return;
    }

    const pattern = await vscode.window.showInputBox({
        prompt: `Test filter pattern for ${task.name}`,
        placeHolder: '*MyTest* or com.example.MyTest',
    });
    if (pattern === undefined || !pattern.trim()) return;

    const qualified = qualifyTask(task.projectPath, task.name);
    const args = [qualified, '--tests', pattern.trim()];
    output.show(true);
    const result = await runWithProgress(
        daemon,
        `Gradle: ${qualified} --tests ${pattern.trim()}`,
        { workspaceRoot: folder.uri.fsPath, args }
    );
    await recordRun({
        task: qualified,
        args: ['--tests', pattern.trim()],
        workspaceRoot: folder.uri.fsPath,
        timestamp: Date.now(),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
    });
}

async function runDependencies(
    daemon: ReturnType<typeof getDaemon>,
    uri: vscode.Uri | undefined
): Promise<void> {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) return;
    const folder = vscode.workspace.getWorkspaceFolder(targetUri);
    if (!folder) return;
    const ws = workspaces.get(folder.uri.fsPath);
    if (!ws) return;
    const owning = findOwningModule(ws.modules, path.dirname(targetUri.fsPath));
    const module = owning ?? ws.modules[0];
    const qualified = qualifyTask(module.projectPath, 'dependencies');
    output.show(true);
    await runWithProgress(
        daemon,
        `Gradle: ${qualified}`,
        { workspaceRoot: folder.uri.fsPath, args: [qualified] }
    );
}

/** Re-export discovered module tasks for completion / quickpick reuse. */
export function listModuleTasks(module: GradleModule): GradleTask[] {
    return discoverModuleTasksStatically(module);
}
