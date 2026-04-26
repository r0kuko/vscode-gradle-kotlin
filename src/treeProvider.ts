import * as vscode from 'vscode';
import * as path from 'path';
import { GradleModule, ModuleTreeNode, buildModuleTreeShape } from './gradle';
import { GradleTask, discoverModuleTasksStatically, qualifyTask } from './tasks';
import { RecentRun, recentLabel } from './history';

/**
 * Per-tree-item metadata. Keeping this off the TreeItem itself lets us
 * recreate the visible nodes cheaply on every refresh while still mapping
 * commands back to the underlying module/task.
 */
export type TreeNodeKind =
    | 'workspace'
    | 'module'
    | 'group'
    | 'tasksFolder'
    | 'taskGroup'
    | 'task';

export interface ModuleTreeItemData {
    kind: TreeNodeKind;
    workspaceRoot: string;
    module?: GradleModule;
    task?: GradleTask;
    /** Gradle task group name for kind === 'taskGroup'. Also used for 'group' (module path segment). */
    label?: string;
    /** Stable id for VS Code's TreeView reveal/refresh APIs. */
    id: string;
}

const ICONS = {
    gradle: { light: 'images/icons/gradle.svg', dark: 'images/icons/gradle_dark.svg' },
    gradleKts: {
        light: 'images/icons/kotlinGradleScript.svg',
        dark: 'images/icons/kotlinGradleScript_dark.svg',
    },
    navigate: {
        light: 'images/icons/gradleNavigate.svg',
        dark: 'images/icons/gradleNavigate_dark.svg',
    },
};

export class GradleModulesProvider
    implements vscode.TreeDataProvider<ModuleTreeItemData>
{
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
        ModuleTreeItemData | undefined
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private modulesByWorkspace = new Map<string, GradleModule[]>();
    /** Currently-running task ids, keyed by `${workspaceRoot}::${qualifiedTask}`. */
    private readonly runningTasks = new Set<string>();
    private taskResolver: (module: GradleModule) => GradleTask[] = m =>
        discoverModuleTasksStatically(m);
    /** Lower-cased filter string; empty string means no filter. */
    private filterText = '';

    constructor(private readonly extensionPath: string) {}

    setModules(workspaceRoot: string, modules: GradleModule[]): void {
        this.modulesByWorkspace.set(workspaceRoot, modules);
        this._onDidChangeTreeData.fire(undefined);
    }

    clear(): void {
        this.modulesByWorkspace.clear();
        this._onDidChangeTreeData.fire(undefined);
    }

    setTaskResolver(resolver: (module: GradleModule) => GradleTask[]): void {
        this.taskResolver = resolver;
        this._onDidChangeTreeData.fire(undefined);
    }

    setFilter(text: string): void {
        this.filterText = text.toLowerCase().trim();
        this._onDidChangeTreeData.fire(undefined);
    }

    clearFilter(): void {
        this.filterText = '';
        this._onDidChangeTreeData.fire(undefined);
    }

    get hasFilter(): boolean {
        return this.filterText.length > 0;
    }

    /**
     * Mark a fully-qualified task (`:app:test`) as running so its sidebar
     * row swaps the play icon for a spinner.  Pass `running=false` once
     * the daemon invocation finishes.
     */
    setTaskRunning(workspaceRoot: string, qualifiedTask: string, running: boolean): void {
        const key = `${workspaceRoot}::${qualifiedTask}`;
        const had = this.runningTasks.has(key);
        if (running) this.runningTasks.add(key);
        else this.runningTasks.delete(key);
        if (had !== running) this._onDidChangeTreeData.fire(undefined);
    }

    private isTaskRunning(element: ModuleTreeItemData): boolean {
        if (element.kind !== 'task' || !element.task) return false;
        const qualified = qualifyTask(element.task.projectPath, element.task.name);
        return this.runningTasks.has(`${element.workspaceRoot}::${qualified}`);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getModulesForRoot(workspaceRoot: string): GradleModule[] {
        return this.modulesByWorkspace.get(workspaceRoot) ?? [];
    }

    getTreeItem(element: ModuleTreeItemData): vscode.TreeItem {
        const item = new vscode.TreeItem(this.labelFor(element), this.collapsibleFor(element));
        item.id = element.id;
        item.contextValue = this.contextFor(element);

        switch (element.kind) {
            case 'workspace':
            case 'module': {
                const isKts = element.module?.kotlinDsl ?? true;
                item.iconPath = this.iconUri(isKts ? ICONS.gradleKts : ICONS.gradle);
                if (element.module?.buildScript) {
                    item.resourceUri = vscode.Uri.file(element.module.buildScript);
                    item.tooltip = `${element.module.projectPath}\n${element.module.buildScript}`;
                    item.command = {
                        command: 'vscode.open',
                        title: 'Open Build Script',
                        arguments: [vscode.Uri.file(element.module.buildScript)],
                    };
                }
                break;
            }
            case 'group':
                item.iconPath = new vscode.ThemeIcon('folder');
                item.tooltip = element.label;
                break;
            case 'tasksFolder':
                item.iconPath = new vscode.ThemeIcon('list-tree');
                break;
            case 'taskGroup':
                item.iconPath = new vscode.ThemeIcon('folder');
                item.tooltip = element.label;
                break;
            case 'task': {
                const running = this.isTaskRunning(element);
                item.iconPath = new vscode.ThemeIcon(running ? 'loading~spin' : 'play');
                item.description = running ? 'running…' : undefined;
                item.tooltip = element.task?.description ?? element.task?.name;
                item.command = {
                    command: 'gradleKotlin.runTask',
                    title: 'Run Task',
                    arguments: [element],
                };
                break;
            }
        }
        return item;
    }

    getChildren(element?: ModuleTreeItemData): ModuleTreeItemData[] {
        if (!element) {
            // Top level: one workspace node per workspace folder.
            const out: ModuleTreeItemData[] = [];
            for (const [workspaceRoot, modules] of this.modulesByWorkspace) {
                const shape = buildModuleTreeShape(modules);
                out.push(...this.materializeShape(shape, workspaceRoot, undefined));
            }
            return out;
        }
        switch (element.kind) {
            case 'workspace':
            case 'module': {
                const modules = this.modulesByWorkspace.get(element.workspaceRoot) ?? [];
                const projectPath = element.module?.projectPath ?? ':';
                const shape = buildModuleTreeShape(modules);
                const node = findShapeNode(shape, projectPath);
                const children: ModuleTreeItemData[] = [];

                if (element.module) {
                    children.push({
                        kind: 'tasksFolder',
                        workspaceRoot: element.workspaceRoot,
                        module: element.module,
                        id: `${element.id}::tasks`,
                    });
                }
                if (node) {
                    for (const child of node.children) {
                        children.push(...this.materializeShape(child, element.workspaceRoot, projectPath));
                    }
                }
                return children;
            }
            case 'group': {
                const modules = this.modulesByWorkspace.get(element.workspaceRoot) ?? [];
                const shape = buildModuleTreeShape(modules);
                const node = findShapeNode(shape, element.label!);
                if (!node) return [];
                return node.children.flatMap(c =>
                    this.materializeShape(c, element.workspaceRoot, element.label)
                );
            }
            case 'tasksFolder': {
                if (!element.module) return [];
                const tasks = this.taskResolver(element.module);
                // When a filter is active, show a flat filtered list (skipping groups).
                if (this.filterText) {
                    return tasks
                        .filter(t => t.name.toLowerCase().includes(this.filterText))
                        .map(t => ({
                            kind: 'task' as const,
                            workspaceRoot: element.workspaceRoot,
                            module: element.module,
                            task: t,
                            id: `${element.id}::${t.name}`,
                        }));
                }
                // Normal mode: group tasks.
                const byGroup = new Map<string, GradleTask[]>();
                for (const t of tasks) {
                    const g = t.group ?? 'other';
                    const list = byGroup.get(g) ?? [];
                    list.push(t);
                    byGroup.set(g, list);
                }
                const ORDER = ['build', 'verification', 'application', 'publishing', 'documentation', 'help', 'other'];
                const sorted = [...byGroup.keys()].sort((a, b) => {
                    const ai = ORDER.indexOf(a);
                    const bi = ORDER.indexOf(b);
                    if (ai !== -1 && bi !== -1) return ai - bi;
                    if (ai !== -1) return -1;
                    if (bi !== -1) return 1;
                    return a.localeCompare(b);
                });
                return sorted.map(g => ({
                    kind: 'taskGroup' as const,
                    workspaceRoot: element.workspaceRoot,
                    module: element.module,
                    label: g,
                    id: `${element.id}::group:${g}`,
                }));
            }
            case 'taskGroup': {
                if (!element.module || !element.label) return [];
                const tasks = this.taskResolver(element.module);
                return tasks
                    .filter(t =>
                        (t.group ?? 'other') === element.label &&
                        (!this.filterText || t.name.toLowerCase().includes(this.filterText))
                    )
                    .map(t => ({
                        kind: 'task' as const,
                        workspaceRoot: element.workspaceRoot,
                        module: element.module,
                        task: t,
                        id: `${element.id}::${t.name}`,
                    }));
            }
            case 'task':
                return [];
        }
    }

    private materializeShape(
        node: ModuleTreeNode,
        workspaceRoot: string,
        _parentPath: string | undefined
    ): ModuleTreeItemData[] {
        const id = `${workspaceRoot}::${node.projectPath}`;
        if (node.isModule && node.module) {
            return [
                {
                    kind: node.projectPath === ':' ? 'workspace' : 'module',
                    workspaceRoot,
                    module: node.module,
                    id,
                },
            ];
        }
        return [
            {
                kind: 'group',
                workspaceRoot,
                label: node.projectPath,
                id,
            },
        ];
    }

    private labelFor(d: ModuleTreeItemData): string {
        switch (d.kind) {
            case 'workspace':
                return d.module?.name ?? path.basename(d.workspaceRoot);
            case 'module':
                return d.module?.name ?? d.module?.projectPath ?? '';
            case 'group':
                return d.label?.split(':').filter(Boolean).pop() ?? '';
            case 'tasksFolder':
                return 'Tasks';
            case 'taskGroup':
                return d.label ?? '';
            case 'task':
                return d.task?.name ?? '';
        }
    }

    private collapsibleFor(d: ModuleTreeItemData): vscode.TreeItemCollapsibleState {
        switch (d.kind) {
            case 'task':
                return vscode.TreeItemCollapsibleState.None;
            case 'workspace':
                return vscode.TreeItemCollapsibleState.Expanded;
            case 'tasksFolder':
                // Auto-expand when a filter is active so results are immediately visible.
                return this.filterText
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed;
            case 'taskGroup':
                return vscode.TreeItemCollapsibleState.Collapsed;
            default:
                return vscode.TreeItemCollapsibleState.Collapsed;
        }
    }

    private contextFor(d: ModuleTreeItemData): string {
        switch (d.kind) {
            case 'workspace':
            case 'module':
                return 'gradleModule';
            case 'task':
                return this.isTaskRunning(d) ? 'gradleTaskRunning' : 'gradleTask';
            case 'tasksFolder':
                return 'gradleTasksFolder';
            case 'taskGroup':
                return 'gradleTaskGroup';
            case 'group':
                return 'gradleGroup';
        }
    }

    private iconUri(set: { light: string; dark: string }): { light: vscode.Uri; dark: vscode.Uri } {
        return {
            light: vscode.Uri.file(path.join(this.extensionPath, set.light)),
            dark: vscode.Uri.file(path.join(this.extensionPath, set.dark)),
        };
    }
}

function findShapeNode(root: ModuleTreeNode, projectPath: string): ModuleTreeNode | undefined {
    if (root.projectPath === projectPath) return root;
    for (const c of root.children) {
        const hit = findShapeNode(c, projectPath);
        if (hit) return hit;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Recent Tasks view
// ---------------------------------------------------------------------------

/** Flat list of recent Gradle runs, shown in the "Recent Tasks" sidebar panel. */
export class RecentTasksProvider implements vscode.TreeDataProvider<RecentRun | 'empty'> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
        RecentRun | 'empty' | undefined
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private runs: RecentRun[] = [];

    setRecent(runs: RecentRun[]): void {
        this.runs = runs;
        this._onDidChangeTreeData.fire(undefined);
    }

    clear(): void {
        this.runs = [];
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: RecentRun | 'empty'): vscode.TreeItem {
        if (element === 'empty') {
            const item = new vscode.TreeItem('No recent tasks');
            item.iconPath = new vscode.ThemeIcon('info');
            return item;
        }
        const item = new vscode.TreeItem(
            recentLabel(element),
            vscode.TreeItemCollapsibleState.None
        );
        item.description = new Date(element.timestamp).toLocaleTimeString();
        item.tooltip = `${recentLabel(element)}\nlast exit: ${element.exitCode ?? '?'}`;
        item.contextValue = 'gradleRecentRun';
        item.iconPath = new vscode.ThemeIcon('debug-rerun');
        item.command = {
            command: 'gradleKotlin.rerunRecent',
            title: 'Re-run',
            arguments: [element],
        };
        return item;
    }

    getChildren(): (RecentRun | 'empty')[] {
        if (this.runs.length === 0) return ['empty'];
        return this.runs;
    }
}

// ---------------------------------------------------------------------------
// Pinned Tasks view
// ---------------------------------------------------------------------------

/**
 * Sidebar panel showing all pinned Gradle tasks (stored by their fully-qualified
 * name, e.g. ":app:test").  Each row has a Run button and an Unpin button.
 */
export class PinnedTasksProvider implements vscode.TreeDataProvider<string | 'empty'> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
        string | 'empty' | undefined
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private pinned: string[] = [];

    setPinned(tasks: string[]): void {
        this.pinned = [...tasks];
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: string | 'empty'): vscode.TreeItem {
        if (element === 'empty') {
            const item = new vscode.TreeItem('No pinned tasks');
            item.iconPath = new vscode.ThemeIcon('info');
            return item;
        }
        const item = new vscode.TreeItem(element, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('pin');
        item.contextValue = 'gradlePinnedTask';
        item.tooltip = `Run ${element}`;
        item.command = {
            command: 'gradleKotlin.runPinnedTask',
            title: 'Run',
            arguments: [element],
        };
        return item;
    }

    getChildren(): (string | 'empty')[] {
        return this.pinned.length === 0 ? ['empty'] : this.pinned;
    }
}
