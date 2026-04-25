import * as vscode from 'vscode';
import * as path from 'path';
import { GradleModule, discoverGradleModules } from './gradle';
import {
    GradleTask,
    discoverModuleTasksStatically,
    findOwningModule,
    qualifyTask,
} from './tasks';
import { VersionCatalog, findCatalogFile, parseCatalogFile } from './libs';
import { GradleModulesProvider, ModuleTreeItemData } from './treeProvider';
import { GradleCodeLensProvider } from './codelens';
import { LibsInlayHintsProvider } from './inlayHints';
import { LibsCompletionProvider } from './completion';
import { LibsDefinitionProvider } from './definition';
import { LibsHoverProvider } from './hover';
import { disposeDaemon, getDaemon } from './daemon';
import { createDaemonStatusItem } from './statusBar';
import { registerGradleRunTool } from './aiTool';

let output: vscode.OutputChannel;

interface WorkspaceState {
    folder: vscode.WorkspaceFolder;
    modules: GradleModule[];
    catalog?: VersionCatalog;
}

const workspaces = new Map<string, WorkspaceState>();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    output = vscode.window.createOutputChannel('Gradle Kotlin');
    context.subscriptions.push(output);

    const daemon = getDaemon(output);
    context.subscriptions.push({ dispose: () => disposeDaemon() });
    context.subscriptions.push(createDaemonStatusItem(daemon));

    const modulesProvider = new GradleModulesProvider(context.extensionPath);
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
        )
    );

    // Commands ----------------------------------------------------------------
    context.subscriptions.push(
        vscode.commands.registerCommand('gradleKotlin.refresh', () => refreshAll(modulesProvider, codeLensProvider, inlayProvider)),
        vscode.commands.registerCommand('gradleKotlin.reloadProject', async () => {
            await reloadProject(daemon);
            await refreshAll(modulesProvider, codeLensProvider, inlayProvider);
        }),
        vscode.commands.registerCommand('gradleKotlin.runTask', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            await runTaskCommand(daemon, target);
        }),
        vscode.commands.registerCommand('gradleKotlin.runDependencies', async (uri?: vscode.Uri) => {
            await runDependencies(daemon, uri);
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
    const fire = () => refreshAll(modulesProvider, codeLensProvider, inlayProvider);
    watcher.onDidChange(fire);
    watcher.onDidCreate(fire);
    watcher.onDidDelete(fire);
    catalogWatcher.onDidChange(fire);
    catalogWatcher.onDidCreate(fire);
    catalogWatcher.onDidDelete(fire);

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

async function reloadProject(daemon: ReturnType<typeof getDaemon>): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        vscode.window.showInformationMessage('No Gradle workspace detected.');
        return;
    }
    output.show(true);
    output.appendLine(`\n=== Reloading Gradle project at ${folder.uri.fsPath} ===`);
    await daemon.run({ workspaceRoot: folder.uri.fsPath, args: ['help', '--quiet'] });
}

async function runTaskCommand(
    daemon: ReturnType<typeof getDaemon>,
    target: ModuleTreeItemData | GradleTask | undefined
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

    output.show(true);
    await daemon.run({ workspaceRoot: folder.uri.fsPath, args: [qualified] });
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
    await daemon.run({ workspaceRoot: folder.uri.fsPath, args: [qualified] });
}

/** Re-export discovered module tasks for completion / quickpick reuse. */
export function listModuleTasks(module: GradleModule): GradleTask[] {
    return discoverModuleTasksStatically(module);
}
