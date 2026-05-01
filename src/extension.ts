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
import { GradleModulesProvider, ModuleTreeItemData, RecentTasksProvider, PinnedTasksProvider } from './treeProvider';
import { DaemonsProvider } from './daemonsProvider';
import { GradleCodeLensProvider } from './codelens';
import { LibsInlayHintsProvider } from './inlayHints';
import { LatestVersionResolver } from './latestVersion';
import { LibsCompletionProvider } from './completion';
import { LibsDefinitionProvider } from './definition';
import { LibsHoverProvider } from './hover';
import { SettingsCodeActionProvider, addSubprojectCommand } from './codeActions';
import {
    DependencyCodeActionProvider,
    cycleDependencyConfigurationCommand,
    moveLiteralToCatalogCommand,
} from './extraCodeActions';
import {
    GradlePropertiesCompletionProvider,
    GradlePropertiesHoverProvider,
    buildPropertiesDiagnostics,
} from './propertiesProvider';
import { findDuplicateDependencies, findUnusedPlugins } from './extraDiagnostics';
import { disposeDaemon, getDaemon, setDefaultInitScriptPath } from './daemon';
import { createDaemonStatusItem, createWrapperUpgradeItem } from './statusBar';
import { createTestController } from './testController';
import { registerGradleRunTool } from './aiTool';
import { RecentRun, pushRecent } from './history';
import { splitArgs } from './argSplit';
import {
    parseGradleDiagnostics,
    normalizeFilePath,
} from './buildDiagnostics';
import {
    compareVersions,
    distributionUrlFor,
    parseWrapperProperties,
    rewriteDistributionUrl,
} from './wrapper';
import { extractBuildScanUrls } from './buildScan';

const PINNED_KEY = 'gradleKotlin.pinnedTasks';

const HISTORY_KEY = 'gradleKotlin.recentRuns';

const GRADLE_FOR_JAVA_EXTENSION_ID = 'vscjava.vscode-gradle';

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

    // Wrapper upgrade badge — check in the background after activation.
    const upgradeItem = createWrapperUpgradeItem();
    context.subscriptions.push(upgradeItem);
    void checkWrapperUpgradeBadge(upgradeItem);
    // Re-check when any wrapper properties file changes.
    const wrapperWatcher = vscode.workspace.createFileSystemWatcher(
        '**/gradle/wrapper/gradle-wrapper.properties'
    );
    context.subscriptions.push(wrapperWatcher);
    wrapperWatcher.onDidChange(() => { upgradeItem.hide(); void checkWrapperUpgradeBadge(upgradeItem); });
    wrapperWatcher.onDidCreate(() => { upgradeItem.hide(); void checkWrapperUpgradeBadge(upgradeItem); });

    const buildDiagnostics = vscode.languages.createDiagnosticCollection('gradleKotlin');
    context.subscriptions.push(buildDiagnostics);
    context.subscriptions.push(
        daemon.onEvent(event => {
            if (event.kind !== 'finish' || !event.result) return;
            updateBuildDiagnostics(buildDiagnostics, event.workspaceRoot, event.result.combined);
            // On failure, surface a notification so the user knows to check output.
            if (event.result.exitCode !== 0 && event.result.exitCode !== null) {
                vscode.window
                    .showErrorMessage(
                        `Gradle task failed (exit ${event.result.exitCode}). Check the output for details.`,
                        'Show Output'
                    )
                    .then(choice => {
                        if (choice === 'Show Output') daemon.channel.show(false);
                    });
            }
        })
    );

    const testController = createTestController(context, daemon, () => {
        const out: GradleModule[] = [];
        for (const ws of workspaces.values()) out.push(...ws.modules);
        return out;
    });

    const modulesProvider = new GradleModulesProvider(context.extensionPath);
    modulesProvider.setTaskResolver(module => mergedTasks(module));
    const treeView = vscode.window.createTreeView('gradleKotlin.projectsView', {
        treeDataProvider: modulesProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    const recentTasksProvider = new RecentTasksProvider();
    const recentView = vscode.window.createTreeView('gradleKotlin.recentTasksView', {
        treeDataProvider: recentTasksProvider,
    });
    context.subscriptions.push(recentView);

    const daemonsProvider = new DaemonsProvider(daemon, () => {
        const folders = vscode.workspace.workspaceFolders ?? [];
        return folders[0]?.uri.fsPath;
    });
    const daemonsView = vscode.window.createTreeView('gradleKotlin.daemonsView', {
        treeDataProvider: daemonsProvider,
    });
    context.subscriptions.push(daemonsView);

    const pinnedTasksProvider = new PinnedTasksProvider();
    const pinnedView = vscode.window.createTreeView('gradleKotlin.pinnedTasksView', {
        treeDataProvider: pinnedTasksProvider,
    });
    context.subscriptions.push(pinnedView);

    /** CancellationTokenSources for tasks currently running from the sidebar. */
    const runningTaskCancels = new Map<string, vscode.CancellationTokenSource>();

    const codeLensProvider = new GradleCodeLensProvider();
    const latestResolver = new LatestVersionResolver();
    const inlayProvider = new LibsInlayHintsProvider(() => activeCatalog(), latestResolver);
    const completionProvider = new LibsCompletionProvider(
        () => activeCatalog(),
        () => {
            const out: GradleModule[] = [];
            for (const ws of workspaces.values()) out.push(...ws.modules);
            return out;
        }
    );
    const definitionProvider = new LibsDefinitionProvider(() => activeCatalog());
    const hoverProvider = new LibsHoverProvider(() => activeCatalog());
    const settingsCodeActionProvider = new SettingsCodeActionProvider();

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { scheme: 'file', pattern: '**/*.gradle{,.kts}' },
            codeLensProvider
        ),
        vscode.languages.registerCodeLensProvider(
            { scheme: 'file', pattern: '**/gradle/wrapper/gradle-wrapper.properties' },
            codeLensProvider
        ),
        vscode.languages.registerInlayHintsProvider(
            { scheme: 'file', pattern: '**/*.gradle{,.kts}' },
            inlayProvider
        ),
        vscode.languages.registerCompletionItemProvider(
            { scheme: 'file', pattern: '**/*.gradle{,.kts}' },
            completionProvider,
            '.', '"', "'"
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
        ),
        vscode.languages.registerCodeActionsProvider(
            { scheme: 'file', pattern: '**/*.gradle{,.kts}' },
            new DependencyCodeActionProvider(),
            { providedCodeActionKinds: DependencyCodeActionProvider.providedKinds }
        ),
        vscode.languages.registerHoverProvider(
            { scheme: 'file', pattern: '**/gradle.properties' },
            new GradlePropertiesHoverProvider()
        ),
        vscode.languages.registerCompletionItemProvider(
            { scheme: 'file', pattern: '**/gradle.properties' },
            new GradlePropertiesCompletionProvider(),
            '.', 'o', 'k', 'a'
        )
    );

    // Static (synchronous) diagnostics for build scripts and gradle.properties.
    const staticDiagnostics = vscode.languages.createDiagnosticCollection('gradleKotlin-static');
    context.subscriptions.push(staticDiagnostics);
    const refreshStaticDiagnostics = (doc: vscode.TextDocument) => {
        if (doc.uri.path.endsWith('/gradle.properties')) {
            staticDiagnostics.set(doc.uri, buildPropertiesDiagnostics(doc));
            return;
        }
        if (!/\.gradle(\.kts)?$/.test(doc.uri.path)) {
            return;
        }
        const text = doc.getText();
        const items: vscode.Diagnostic[] = [];
        for (const u of findUnusedPlugins(text)) {
            const range = new vscode.Range(u.line, u.column, u.line, u.column + u.length);
            const d = new vscode.Diagnostic(range, u.message, vscode.DiagnosticSeverity.Hint);
            d.tags = [vscode.DiagnosticTag.Unnecessary];
            d.source = 'gradleKotlin';
            items.push(d);
        }
        for (const dup of findDuplicateDependencies(text)) {
            const range = new vscode.Range(dup.line, dup.column, dup.line, dup.column + dup.length);
            const d = new vscode.Diagnostic(range, dup.message, vscode.DiagnosticSeverity.Warning);
            d.source = 'gradleKotlin';
            items.push(d);
        }
        staticDiagnostics.set(doc.uri, items);
    };
    for (const doc of vscode.workspace.textDocuments) refreshStaticDiagnostics(doc);
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(refreshStaticDiagnostics),
        vscode.workspace.onDidChangeTextDocument(e => refreshStaticDiagnostics(e.document)),
        vscode.workspace.onDidCloseTextDocument(doc => staticDiagnostics.delete(doc.uri))
    );

    // Commands ----------------------------------------------------------------
    const loadRecent = (): RecentRun[] =>
        context.workspaceState.get<RecentRun[]>(HISTORY_KEY, []) ?? [];
    recentTasksProvider.setRecent(loadRecent());

    const loadPinned = (): string[] =>
        context.workspaceState.get<string[]>(PINNED_KEY, []) ?? [];
    pinnedTasksProvider.setPinned(loadPinned());

    const recordRun = async (run: RecentRun) => {
        const merged = pushRecent(loadRecent(), run);
        await context.workspaceState.update(HISTORY_KEY, merged);
        recentTasksProvider.setRecent(merged);
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('gradleKotlin.refresh', async () => {
            await refreshAll(modulesProvider, codeLensProvider, inlayProvider);
            await hydrateAllTasks(daemon, modulesProvider);
        }),
        vscode.commands.registerCommand('gradleKotlin.cycleDependencyConfiguration', cycleDependencyConfigurationCommand),
        vscode.commands.registerCommand('gradleKotlin.moveLiteralToCatalog', moveLiteralToCatalogCommand),
        vscode.commands.registerCommand('gradleKotlin.reloadProject', async () => {
            await reloadProject(daemon);
            await refreshAll(modulesProvider, codeLensProvider, inlayProvider);
        }),
        vscode.commands.registerCommand('gradleKotlin.upgradeWrapper', async (uri?: vscode.Uri) => {
            await upgradeWrapper(daemon, uri);
            await refreshAll(modulesProvider, codeLensProvider, inlayProvider);
        }),
        vscode.commands.registerCommand('gradleKotlin.runTask', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            await runTaskCommand(daemon, target, recordRun, {}, modulesProvider, runningTaskCancels);
        }),
        vscode.commands.registerCommand('gradleKotlin.runTaskWithArgs', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            await runTaskCommand(daemon, target, recordRun, { promptForArgs: true }, modulesProvider, runningTaskCancels);
        }),
        vscode.commands.registerCommand('gradleKotlin.runTestsForTask', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            await runTestsForTask(daemon, target, recordRun);
        }),
        vscode.commands.registerCommand('gradleKotlin.rerunRecent', async (run: RecentRun) => {
            if (!run) return;
            const cts = new vscode.CancellationTokenSource();
            const cancelKey = `${run.workspaceRoot}::${run.task}`;
            runningTaskCancels.set(cancelKey, cts);
            modulesProvider.setTaskRunning(run.workspaceRoot, run.task, true);
            try {
                const result = await runWithProgress(
                    daemon,
                    `Gradle: ${run.task}`,
                    { workspaceRoot: run.workspaceRoot, args: [run.task, ...run.args] },
                    cts
                );
                await recordRun({
                    ...run,
                    timestamp: Date.now(),
                    exitCode: result.exitCode,
                    durationMs: result.durationMs,
                });
            } finally {
                cts.dispose();
                runningTaskCancels.delete(cancelKey);
                modulesProvider.setTaskRunning(run.workspaceRoot, run.task, false);
            }
        }),
        vscode.commands.registerCommand('gradleKotlin.clearRecent', async () => {
            await context.workspaceState.update(HISTORY_KEY, []);
            recentTasksProvider.clear();
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
            const folder = pickWorkspaceFolder();
            if (folder) {
                await daemonsProvider.stopAllDaemons(folder.uri.fsPath);
            }
        }),
        vscode.commands.registerCommand('gradleKotlin.pinTask', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            const qualified = qualifiedFromTarget(target);
            if (!qualified) return;
            const list = loadPinned();
            if (!list.includes(qualified)) {
                const next = [qualified, ...list];
                await context.workspaceState.update(PINNED_KEY, next);
                pinnedTasksProvider.setPinned(next);
                vscode.window.setStatusBarMessage(`Pinned ${qualified}`, 3000);
            }
        }),
        vscode.commands.registerCommand('gradleKotlin.unpinTask', async (target: ModuleTreeItemData | GradleTask | string | undefined) => {
            const qualified = typeof target === 'string' ? target : qualifiedFromTarget(target as ModuleTreeItemData | GradleTask | undefined);
            if (!qualified) return;
            const next = loadPinned().filter(t => t !== qualified);
            await context.workspaceState.update(PINNED_KEY, next);
            pinnedTasksProvider.setPinned(next);
        }),
        vscode.commands.registerCommand('gradleKotlin.runPinned', async () => {
            const list = context.workspaceState.get<string[]>(PINNED_KEY, []) ?? [];
            if (list.length === 0) {
                vscode.window.showInformationMessage('No pinned Gradle tasks yet. Right-click a task in the tree to pin it.');
                return;
            }
            const pick = await vscode.window.showQuickPick(list, { placeHolder: 'Run pinned task' });
            if (!pick) return;
            const folder = await pickWorkspaceFolderInteractive(undefined);
            if (!folder) return;
            modulesProvider.setTaskRunning(folder.uri.fsPath, pick, true);
            try {
                const result = await runWithProgress(daemon, `Gradle: ${pick}`, {
                    workspaceRoot: folder.uri.fsPath,
                    args: [pick],
                });
                await recordRun({ task: pick, args: [], workspaceRoot: folder.uri.fsPath, timestamp: Date.now(), exitCode: result.exitCode, durationMs: result.durationMs });
            } finally {
                modulesProvider.setTaskRunning(folder.uri.fsPath, pick, false);
            }
        }),
        vscode.commands.registerCommand('gradleKotlin.runAlias', async () => {
            const aliases = vscode.workspace.getConfiguration('gradleKotlin').get<Record<string, { task: string; args?: string[] }>>('aliases') ?? {};
            const names = Object.keys(aliases);
            if (names.length === 0) {
                vscode.window.showInformationMessage(
                    'Define `gradleKotlin.aliases` in settings, e.g. { "ci": { "task": "build", "args": ["--info"] } }.'
                );
                return;
            }
            const pick = await vscode.window.showQuickPick(names, { placeHolder: 'Run Gradle alias' });
            if (!pick) return;
            const alias = aliases[pick];
            const folder = await pickWorkspaceFolderInteractive(undefined);
            if (!folder) return;
            const result = await runWithProgress(daemon, `Gradle: ${pick} (${alias.task})`, {
                workspaceRoot: folder.uri.fsPath,
                args: [alias.task, ...(alias.args ?? [])],
            });
            await recordRun({ task: alias.task, args: alias.args ?? [], workspaceRoot: folder.uri.fsPath, timestamp: Date.now(), exitCode: result.exitCode, durationMs: result.durationMs });
        }),
        vscode.commands.registerCommand('gradleKotlin.runMany', async () => {
            const folder = await pickWorkspaceFolderInteractive(undefined);
            if (!folder) return;
            const allTasks: { label: string; description?: string }[] = [];
            for (const ws of workspaces.values()) {
                if (ws.folder.uri.fsPath !== folder.uri.fsPath) continue;
                for (const m of ws.modules) {
                    for (const t of mergedTasks(m)) {
                        allTasks.push({ label: qualifyTask(m.projectPath, t.name), description: t.group ?? '' });
                    }
                }
            }
            const picks = await vscode.window.showQuickPick(allTasks, { canPickMany: true, placeHolder: 'Pick one or more tasks to run sequentially' });
            if (!picks || picks.length === 0) return;
            const args = picks.map(p => p.label);
            const result = await runWithProgress(daemon, `Gradle: ${args.join(' ')}`, {
                workspaceRoot: folder.uri.fsPath,
                args,
            });
            await recordRun({ task: args.join(' '), args: [], workspaceRoot: folder.uri.fsPath, timestamp: Date.now(), exitCode: result.exitCode, durationMs: result.durationMs });
        }),
        vscode.commands.registerCommand('gradleKotlin.runTaskContinuous', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            const folder = await pickWorkspaceFolderInteractive(target);
            if (!folder) return;
            const qualified = qualifiedFromTarget(target);
            if (!qualified) return;
            const cts = new vscode.CancellationTokenSource();
            const cancelKey = `${folder.uri.fsPath}::${qualified}`;
            runningTaskCancels.set(cancelKey, cts);
            modulesProvider.setTaskRunning(folder.uri.fsPath, qualified, true);
            try {
                await runWithProgress(daemon, `Gradle: ${qualified} (continuous)`, {
                    workspaceRoot: folder.uri.fsPath,
                    args: [qualified, '-t'],
                }, cts);
            } finally {
                cts.dispose();
                runningTaskCancels.delete(cancelKey);
                modulesProvider.setTaskRunning(folder.uri.fsPath, qualified, false);
            }
        }),
        vscode.commands.registerCommand('gradleKotlin.toggleWrapperDistribution', async (uri?: vscode.Uri) => {
            const target = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!target) return;
            const text = (await vscode.workspace.fs.readFile(target)).toString();
            const parsed = parseWrapperProperties(text);
            if (!parsed) return;
            const flipped = parsed.flavor === 'all' ? 'bin' : 'all';
            const newText = rewriteDistributionUrl(text, distributionUrlFor(parsed.version, flipped));
            await vscode.workspace.fs.writeFile(target, Buffer.from(newText, 'utf8'));
            vscode.window.setStatusBarMessage(`Wrapper distribution → ${flipped}`, 3000);
        }),
        vscode.commands.registerCommand('gradleKotlin.refreshDaemons', () => daemonsProvider.reload()),
        vscode.commands.registerCommand('gradleKotlin.stopSingleDaemon', async (info: import('./daemonsProvider').GradleDaemonInfo) => {
            if (!info?.pid) return;
            await daemonsProvider.stopDaemon(info);
        }),
        vscode.commands.registerCommand('gradleKotlin.stopAllDaemons', async () => {
            const folder = pickWorkspaceFolder();
            if (!folder) return;
            const choice = await vscode.window.showWarningMessage(
                'Stop all Gradle daemons for this workspace?',
                { modal: true },
                'Stop All'
            );
            if (choice !== 'Stop All') return;
            await daemonsProvider.stopAllDaemons(folder.uri.fsPath);
        }),

        // Feature 1: Cancel a running task from the sidebar tree.
        vscode.commands.registerCommand('gradleKotlin.cancelTask', (target: ModuleTreeItemData) => {
            const qualified = qualifiedFromTarget(target);
            if (!qualified || !target.workspaceRoot) return;
            runningTaskCancels.get(`${target.workspaceRoot}::${qualified}`)?.cancel();
        }),

        // Feature 2: Run a task from the Pinned Tasks panel.
        vscode.commands.registerCommand('gradleKotlin.runPinnedTask', async (qualified: string) => {
            if (!qualified) return;
            const folder = await pickWorkspaceFolderInteractive(undefined);
            if (!folder) return;
            const cts = new vscode.CancellationTokenSource();
            const cancelKey = `${folder.uri.fsPath}::${qualified}`;
            runningTaskCancels.set(cancelKey, cts);
            modulesProvider.setTaskRunning(folder.uri.fsPath, qualified, true);
            try {
                const result = await runWithProgress(
                    daemon, `Gradle: ${qualified}`,
                    { workspaceRoot: folder.uri.fsPath, args: [qualified] },
                    cts
                );
                await recordRun({ task: qualified, args: [], workspaceRoot: folder.uri.fsPath, timestamp: Date.now(), exitCode: result.exitCode, durationMs: result.durationMs });
            } finally {
                cts.dispose();
                runningTaskCancels.delete(cancelKey);
                modulesProvider.setTaskRunning(folder.uri.fsPath, qualified, false);
            }
        }),

        // Feature 3: Filter tasks in the Gradle Projects tree.
        vscode.commands.registerCommand('gradleKotlin.filterTasks', async () => {
            const current = modulesProvider.hasFilter ? '(currently filtered)' : '';
            const input = await vscode.window.showInputBox({
                prompt: `Filter Gradle tasks by name ${current}`,
                placeHolder: 'e.g. test, assemble, boot',
                value: '',
            });
            if (input === undefined) return; // cancelled
            if (input.trim() === '') {
                modulesProvider.clearFilter();
            } else {
                modulesProvider.setFilter(input.trim());
            }
        }),
        vscode.commands.registerCommand('gradleKotlin.clearFilter', () => {
            modulesProvider.clearFilter();
        }),

        // Feature 4: Run a task with JDWP debug and auto-attach the Java debugger.
        vscode.commands.registerCommand('gradleKotlin.runTaskDebug', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            const folder = await pickWorkspaceFolderInteractive(target);
            if (!folder) return;
            let qualified = qualifiedFromTarget(target);
            if (!qualified) {
                const taskName = await vscode.window.showInputBox({
                    prompt: 'Gradle task to debug (e.g. :app:test, bootRun)',
                    placeHolder: ':app:bootRun',
                });
                if (!taskName) return;
                qualified = taskName.startsWith(':') ? taskName : ':' + taskName;
            }
            const debugPort = vscode.workspace.getConfiguration('gradleKotlin').get<number>('debugPort', 5005);
            let debugAttached = false;
            const cts = new vscode.CancellationTokenSource();
            const cancelKey = `${folder.uri.fsPath}::${qualified}`;
            runningTaskCancels.set(cancelKey, cts);
            modulesProvider.setTaskRunning(folder.uri.fsPath, qualified, true);
            try {
                await runWithProgress(
                    daemon,
                    `Gradle: ${qualified} (debug on port ${debugPort})`,
                    {
                        workspaceRoot: folder.uri.fsPath,
                        args: [qualified, '--debug-jvm'],
                        onOutput: (chunk: string) => {
                            if (!debugAttached && chunk.includes('Listening for transport dt_socket')) {
                                debugAttached = true;
                                void vscode.debug.startDebugging(folder, {
                                    type: 'java',
                                    request: 'attach',
                                    name: `Attach Gradle: ${qualified}`,
                                    hostName: 'localhost',
                                    port: debugPort,
                                }).then(started => {
                                    if (!started) {
                                        vscode.window.showWarningMessage(
                                            'Could not attach Java debugger. Is the Java Debugger extension installed?'
                                        );
                                    }
                                });
                            }
                        },
                    },
                    cts
                );
            } finally {
                cts.dispose();
                runningTaskCancels.delete(cancelKey);
                modulesProvider.setTaskRunning(folder.uri.fsPath, qualified, false);
            }
        }),

        // Feature 5: Run a task with custom JVM args and environment variables.
        vscode.commands.registerCommand('gradleKotlin.runTaskWithEnv', async (target: ModuleTreeItemData | GradleTask | undefined) => {
            const folder = await pickWorkspaceFolderInteractive(target);
            if (!folder) return;
            let qualified = qualifiedFromTarget(target);
            if (!qualified) {
                const taskName = await vscode.window.showInputBox({
                    prompt: 'Gradle task to run',
                    placeHolder: ':app:test',
                });
                if (!taskName) return;
                qualified = taskName.startsWith(':') ? taskName : ':' + taskName;
            }
            const jvmArgsInput = await vscode.window.showInputBox({
                prompt: `JVM args for ${qualified}`,
                placeHolder: '-Xmx2g -Dfoo=bar',
                ignoreFocusOut: true,
            });
            if (jvmArgsInput === undefined) return;
            const envInput = await vscode.window.showInputBox({
                prompt: 'Extra environment variables (KEY=VALUE, space-separated)',
                placeHolder: 'SPRING_PROFILES_ACTIVE=test DEBUG=true',
                ignoreFocusOut: true,
            });
            if (envInput === undefined) return;
            const env: Record<string, string> = {};
            for (const pair of envInput.trim().split(/\s+/).filter(Boolean)) {
                const eq = pair.indexOf('=');
                if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
            }
            const cts = new vscode.CancellationTokenSource();
            const cancelKey = `${folder.uri.fsPath}::${qualified}`;
            runningTaskCancels.set(cancelKey, cts);
            modulesProvider.setTaskRunning(folder.uri.fsPath, qualified, true);
            try {
                const result = await runWithProgress(
                    daemon,
                    `Gradle: ${qualified} (custom env)`,
                    {
                        workspaceRoot: folder.uri.fsPath,
                        args: [qualified],
                        jvmArgs: jvmArgsInput.trim() || undefined,
                        env: Object.keys(env).length > 0 ? env : undefined,
                    },
                    cts
                );
                await recordRun({ task: qualified, args: [], workspaceRoot: folder.uri.fsPath, timestamp: Date.now(), exitCode: result.exitCode, durationMs: result.durationMs });
            } finally {
                cts.dispose();
                runningTaskCancels.delete(cancelKey);
                modulesProvider.setTaskRunning(folder.uri.fsPath, qualified, false);
            }
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
                if (
                    e.affectsConfiguration('gradleKotlin.versionInlayHints.checkLatest') ||
                    e.affectsConfiguration('gradleKotlin.versionInlayHints.enabled')
                ) {
                    latestResolver.clearCache();
                }
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

    const gradleForJavaInstalled = isGradleForJavaInstalled();
    await coordinateGradleForJava(gradleForJavaInstalled);
    await refreshAll(modulesProvider, codeLensProvider, inlayProvider);
    if (shouldHydrateTasksOnActivation()) {
        await hydrateAllTasks(daemon, modulesProvider);
    }
    refreshTestController(testController);
    void daemonsProvider.reload();
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
    void vscode.commands.executeCommand(
        'setContext',
        'gradleKotlin.isGradleProject',
        workspaces.size > 0
    );
    codeLensProvider.refresh();
    inlayProvider.refresh();
}

/** Re-discover Kotlin tests under each module so the Test Explorer stays in sync. */
function refreshTestController(controller: vscode.TestController | undefined): void {
    controller?.resolveHandler?.(undefined);
}

function isGradleForJavaInstalled(): boolean {
    return !!vscode.extensions.getExtension(GRADLE_FOR_JAVA_EXTENSION_ID);
}

async function coordinateGradleForJava(installed: boolean): Promise<void> {
    if (!installed) return;
    const config = vscode.workspace.getConfiguration('gradleKotlin');
    const mode = config.get<string>('gradleForJava.integrationMode', 'takeover');
    if (mode === 'off') return;

    const gradleConfig = vscode.workspace.getConfiguration('gradle');
    if (gradleConfig.get<string>('autoDetect') !== 'off') {
        await gradleConfig.update('autoDetect', 'off', vscode.ConfigurationTarget.Workspace);
        output.appendLine(
            'Gradle for Java detected; set workspace gradle.autoDetect=off so Gradle Kotlin Companion owns Gradle task discovery.'
        );
    }

    if (mode === 'takeover') {
        const javaGradleConfig = vscode.workspace.getConfiguration('java.gradle');
        if (javaGradleConfig.get<string>('buildServer.enabled') !== 'off') {
            await javaGradleConfig.update('buildServer.enabled', 'off', vscode.ConfigurationTarget.Workspace);
            output.appendLine(
                'Gradle for Java detected; set workspace java.gradle.buildServer.enabled=off so Gradle Kotlin Companion is the primary Gradle integration.'
            );
        }
    }
}

function shouldHydrateTasksOnActivation(): boolean {
    const config = vscode.workspace.getConfiguration('gradleKotlin');
    const mode = config.get<string>('taskDiscovery.autoHydrateOnActivation', 'auto');
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return true;
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
    // Run a single root-level :tasks --all per workspace instead of one
    // invocation per subproject. The root output lists ALL tasks for ALL
    // subprojects as "sub:taskName - description", which parseTasksAllOutput
    // can parse by normalizing the relative project paths.
    await Promise.all(
        Array.from(workspaces.values()).map(async ws => {
            try {
                const result = await daemon.run({
                    workspaceRoot: ws.folder.uri.fsPath,
                    args: ['tasks', '--all', '--quiet'],
                });
                for (const module of ws.modules) {
                    const parsed = parseTasksAllOutput(result.combined, module.projectPath);
                    if (parsed.length > 0) {
                        dynamicTasksByModule.set(moduleKey(module), parsed);
                    }
                }
            } catch {
                // Best-effort only: static tasks remain available.
            }
            treeProvider.refresh();
        })
    );
}

async function reloadProject(daemon: ReturnType<typeof getDaemon>): Promise<void> {
    const folder = pickWorkspaceFolder();
    if (!folder) {
        vscode.window.showInformationMessage('No Gradle workspace detected.');
        return;
    }
    output.appendLine(`\n=== Reloading Gradle project at ${folder.uri.fsPath} ===`);
    await runWithProgress(
        daemon,
        'Gradle: Reload Project',
        { workspaceRoot: folder.uri.fsPath, args: ['help', '--quiet'] }
    );
}

/**
 * Implements the "Upgrade wrapper" CodeLens.  Fetches
 * https://services.gradle.org/versions/current, compares the version
 * field with the pinned distributionUrl, and if a newer release is
 * available offers to rewrite the wrapper-properties + run
 * `:wrapper --gradle-version <next>` so the wrapper jar matches.
 */
async function upgradeWrapper(
    daemon: ReturnType<typeof getDaemon>,
    uri?: vscode.Uri
): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
        vscode.window.showInformationMessage('Open gradle-wrapper.properties first.');
        return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(target);
    if (!folder) return;

    let text: string;
    try {
        text = (await vscode.workspace.fs.readFile(target)).toString();
    } catch {
        vscode.window.showErrorMessage(`Cannot read ${target.fsPath}.`);
        return;
    }
    const parsed = parseWrapperProperties(text);
    if (!parsed) {
        vscode.window.showInformationMessage('No distributionUrl found in this wrapper file.');
        return;
    }

    const latest = await fetchLatestGradleVersion();
    if (!latest) {
        vscode.window.showWarningMessage('Could not fetch latest Gradle version (network issue?).');
        return;
    }

    if (compareVersions(latest, parsed.version) <= 0) {
        vscode.window.showInformationMessage(`Gradle wrapper is already up to date (${parsed.version}).`);
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        `A newer Gradle is available: ${parsed.version} → ${latest}. Upgrade now?`,
        { modal: false },
        'Upgrade',
        'Show release notes'
    );
    if (choice === 'Show release notes') {
        vscode.env.openExternal(vscode.Uri.parse(`https://docs.gradle.org/${latest}/release-notes.html`));
        return;
    }
    if (choice !== 'Upgrade') return;

    const newText = rewriteDistributionUrl(text, distributionUrlFor(latest, parsed.flavor));
    await vscode.workspace.fs.writeFile(target, Buffer.from(newText, 'utf8'));
    await runWithProgress(
        daemon,
        `Gradle: wrapper --gradle-version ${latest}`,
        { workspaceRoot: folder.uri.fsPath, args: ['wrapper', '--gradle-version', latest] }
    );
}

async function fetchLatestGradleVersion(): Promise<string | undefined> {
    try {
        const res = await fetch('https://services.gradle.org/versions/current');
        if (!res.ok) return undefined;
        const data = (await res.json()) as { version?: string };
        return typeof data.version === 'string' ? data.version : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Fetch the latest Gradle release and, if any workspace wrapper is outdated,
 * show the upgrade badge in the status bar.
 */
async function checkWrapperUpgradeBadge(item: vscode.StatusBarItem): Promise<void> {
    const latest = await fetchLatestGradleVersion();
    if (!latest) return;
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/gradle/wrapper/gradle-wrapper.properties'),
            null,
            1
        );
        if (files.length === 0) continue;
        try {
            const text = (await vscode.workspace.fs.readFile(files[0])).toString();
            const parsed = parseWrapperProperties(text);
            if (parsed && compareVersions(latest, parsed.version) > 0) {
                item.text = `$(arrow-up) Gradle ${parsed.version} → ${latest}`;
                item.tooltip = `A newer Gradle is available. Click to upgrade to ${latest}.`;
                item.show();
                return; // show once for the first outdated workspace
            }
        } catch {
            /* ignore unreadable files */
        }
    }
}
/**
 * Pick the most relevant workspace folder for a command:
 *  1. The folder owning the explicit `target` (tree node / task), when given.
 *  2. The folder owning the active editor.
 *  3. If we only have one workspace, use it.
 *  4. Otherwise prompt with a quick pick.
 */
async function pickWorkspaceFolderInteractive(
    target?: ModuleTreeItemData | GradleTask
): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return undefined;

    const fromTarget = workspaceRootForTarget(target);
    if (fromTarget) {
        const match = folders.find(f => f.uri.fsPath === fromTarget);
        if (match) return match;
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
        const match = vscode.workspace.getWorkspaceFolder(activeUri);
        if (match) return match;
    }

    if (folders.length === 1) return folders[0];

    const pick = await vscode.window.showQuickPick(
        folders.map(f => ({ label: f.name, description: f.uri.fsPath, folder: f })),
        { placeHolder: 'Select the Gradle workspace to run against' }
    );
    return (pick as { folder: vscode.WorkspaceFolder } | undefined)?.folder;
}

/** Synchronous fallback used when no target context is available. */
function pickWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return undefined;    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
        const match = vscode.workspace.getWorkspaceFolder(activeUri);
        if (match) return match;
    }
    return folders[0];
}

function workspaceRootForTarget(
    target?: ModuleTreeItemData | GradleTask
): string | undefined {
    if (!target) return undefined;
    if ('workspaceRoot' in target && typeof target.workspaceRoot === 'string') {
        return target.workspaceRoot;
    }
    if ('module' in target && target.module?.workspaceRoot) {
        return target.module.workspaceRoot;
    }
    return undefined;
}

function qualifiedFromTarget(target?: ModuleTreeItemData | GradleTask): string | undefined {
    if (!target) return undefined;
    if ('kind' in target && target.kind === 'task' && target.task) {
        return qualifyTask(target.task.projectPath, target.task.name);
    }
    if ('name' in target && (target as GradleTask).name) {
        const t = target as GradleTask;
        return qualifyTask(t.projectPath, t.name);
    }
    return undefined;
}

/**
 * Convert parsed Gradle diagnostics into VS Code diagnostics, scoped to
 * files that live under `workspaceRoot`.  We rebuild the collection on
 * every finish — Gradle prints all current errors each time so a stale
 * one disappears as soon as the build is green again.
 */
function updateBuildDiagnostics(
    collection: vscode.DiagnosticCollection,
    workspaceRoot: string,
    combined: string
): void {
    const parsed = parseGradleDiagnostics(combined);
    const normalRoot = path.normalize(workspaceRoot);
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const d of parsed) {
        const absFile = normalizeFilePath(d.file, workspaceRoot);
        // Only surface diagnostics that belong to this workspace.
        if (!absFile.startsWith(normalRoot)) continue;
        const range = new vscode.Range(d.line, d.column, d.line, d.column + 1);
        const diag = new vscode.Diagnostic(
            range,
            d.message,
            d.severity === 'error'
                ? vscode.DiagnosticSeverity.Error
                : vscode.DiagnosticSeverity.Warning
        );
        diag.source = 'gradle';
        const list = byFile.get(absFile) ?? [];
        list.push(diag);
        byFile.set(absFile, list);
    }
    // Clear old diagnostics for this workspace before publishing fresh ones.
    const stale: vscode.Uri[] = [];
    collection.forEach(uri => {
        if (uri.fsPath.startsWith(normalRoot)) stale.push(uri);
    });
    for (const uri of stale) collection.delete(uri);
    for (const [file, diags] of byFile) {
        collection.set(vscode.Uri.file(file), diags);
    }
}

/**
 * Link two cancellation tokens: the combined token is cancelled when EITHER fires.
 */
function createCombinedToken(
    a: vscode.CancellationToken,
    b: vscode.CancellationToken
): vscode.CancellationToken {
    const cts = new vscode.CancellationTokenSource();
    if (a.isCancellationRequested || b.isCancellationRequested) {
        cts.cancel();
    } else {
        a.onCancellationRequested(() => cts.cancel());
        b.onCancellationRequested(() => cts.cancel());
    }
    return cts.token;
}

/**
 * Run a Gradle invocation through the shared daemon while showing a
 * cancellable notification. Cancelling the notification SIGTERMs the child.
 * An optional `externalCts` lets callers (e.g. the tree-view cancel button)
 * also trigger cancellation independently of the notification.
 */
function runWithProgress(
    daemon: ReturnType<typeof getDaemon>,
    title: string,
    request: Parameters<ReturnType<typeof getDaemon>['run']>[0],
    externalCts?: vscode.CancellationTokenSource
): Thenable<import('./daemon').DaemonRunResult> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: true,
        },
        async (progress, progressToken) => {
            // If the user clicks cancel on the progress notification, also cancel the external CTS.
            progressToken.onCancellationRequested(() => externalCts?.cancel());
            const token = externalCts
                ? createCombinedToken(externalCts.token, progressToken)
                : progressToken;
            let buf = '';
            const callerOnOutput = request.onOutput;
            const result = await daemon.run({
                ...request,
                token,
                onOutput: (chunk, source) => {
                    buf += chunk;
                    // Keep only the trailing tail — we just want the most
                    // recent non-empty line as a progress message.
                    if (buf.length > 4096) buf = buf.slice(-4096);
                    const lines = buf.split(/\r?\n/);
                    for (let i = lines.length - 1; i >= 0; i--) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        progress.report({ message: line.length > 120 ? line.slice(0, 117) + '…' : line });
                        break;
                    }
                    callerOnOutput?.(chunk, source);
                },
            });
            const scanUrls = extractBuildScanUrls(result.combined);
            if (scanUrls.length > 0) {
                vscode.window
                    .showInformationMessage(`Gradle Build Scan published: ${scanUrls[0]}`, 'Open')
                    .then(choice => {
                        if (choice === 'Open') {
                            vscode.env.openExternal(vscode.Uri.parse(scanUrls[0]));
                        }
                    });
            }
            return result;
        }
    );
}

async function runTaskCommand(
    daemon: ReturnType<typeof getDaemon>,
    target: ModuleTreeItemData | GradleTask | undefined,
    recordRun: (r: RecentRun) => Promise<void>,
    options: { promptForArgs?: boolean } = {},
    modulesProvider?: GradleModulesProvider,
    runningTaskCancels?: Map<string, vscode.CancellationTokenSource>
): Promise<void> {
    const folder = await pickWorkspaceFolderInteractive(target);
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

    const cts = new vscode.CancellationTokenSource();
    const cancelKey = `${folder.uri.fsPath}::${qualified}`;
    runningTaskCancels?.set(cancelKey, cts);
    modulesProvider?.setTaskRunning(folder.uri.fsPath, qualified, true);
    try {
        const result = await runWithProgress(
            daemon,
            `Gradle: ${qualified}`,
            { workspaceRoot: folder.uri.fsPath, args: [qualified, ...extraArgs] },
            cts
        );
        await recordRun({
            task: qualified,
            args: extraArgs,
            workspaceRoot: folder.uri.fsPath,
            timestamp: Date.now(),
            exitCode: result.exitCode,
            durationMs: result.durationMs,
        });
    } finally {
        cts.dispose();
        runningTaskCancels?.delete(cancelKey);
        modulesProvider?.setTaskRunning(folder.uri.fsPath, qualified, false);
    }
}

async function runTestsForTask(
    daemon: ReturnType<typeof getDaemon>,
    target: ModuleTreeItemData | GradleTask | undefined,
    recordRun: (r: RecentRun) => Promise<void>
): Promise<void> {
    const folder = await pickWorkspaceFolderInteractive(target);
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
