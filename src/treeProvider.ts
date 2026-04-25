import * as vscode from 'vscode';
import * as path from 'path';
import { GradleModule, ModuleTreeNode, buildModuleTreeShape } from './gradle';
import { GradleTask, discoverModuleTasksStatically } from './tasks';
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
    | 'task'
    | 'recentFolder'
    | 'recentRun';

export interface ModuleTreeItemData {
    kind: TreeNodeKind;
    workspaceRoot: string;
    module?: GradleModule;
    task?: GradleTask;
    /** Recent run payload for kind === 'recentRun'. */
    recent?: RecentRun;
    /** For "group" nodes that are not real modules. */
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
    private recentByWorkspace = new Map<string, RecentRun[]>();
    private taskResolver: (module: GradleModule) => GradleTask[] = m =>
        discoverModuleTasksStatically(m);

    constructor(private readonly extensionPath: string) {}

    setModules(workspaceRoot: string, modules: GradleModule[]): void {
        this.modulesByWorkspace.set(workspaceRoot, modules);
        this._onDidChangeTreeData.fire(undefined);
    }

    setRecent(workspaceRoot: string, runs: RecentRun[]): void {
        this.recentByWorkspace.set(workspaceRoot, runs);
        this._onDidChangeTreeData.fire(undefined);
    }

    clear(): void {
        this.modulesByWorkspace.clear();
        this.recentByWorkspace.clear();
        this._onDidChangeTreeData.fire(undefined);
    }

    setTaskResolver(resolver: (module: GradleModule) => GradleTask[]): void {
        this.taskResolver = resolver;
        this._onDidChangeTreeData.fire(undefined);
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
            case 'recentFolder':
                item.iconPath = new vscode.ThemeIcon('history');
                item.tooltip = 'Recently run Gradle tasks';
                break;
            case 'recentRun':
                item.iconPath = new vscode.ThemeIcon('debug-rerun');
                item.description = element.recent
                    ? new Date(element.recent.timestamp).toLocaleTimeString()
                    : '';
                item.tooltip =
                    element.recent &&
                    `${recentLabel(element.recent)}\nlast exit: ${element.recent.exitCode ?? '?'}`;
                if (element.recent) {
                    item.command = {
                        command: 'gradleKotlin.rerunRecent',
                        title: 'Re-run',
                        arguments: [element.recent],
                    };
                }
                break;
            case 'task':
                item.iconPath = new vscode.ThemeIcon('play');
                item.description = element.task?.group;
                item.tooltip = element.task?.description ?? element.task?.name;
                item.command = {
                    command: 'gradleKotlin.runTask',
                    title: 'Run Task',
                    arguments: [element],
                };
                break;
        }
        return item;
    }

    getChildren(element?: ModuleTreeItemData): ModuleTreeItemData[] {
        if (!element) {
            // Top level: one workspace node per workspace folder, with the root module's tasks under it.
            const out: ModuleTreeItemData[] = [];
            for (const [workspaceRoot, modules] of this.modulesByWorkspace) {
                const recent = this.recentByWorkspace.get(workspaceRoot) ?? [];
                if (recent.length > 0) {
                    out.push({
                        kind: 'recentFolder',
                        workspaceRoot,
                        id: `${workspaceRoot}::recent`,
                    });
                }
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
                return tasks.map(t => ({
                    kind: 'task',
                    workspaceRoot: element.workspaceRoot,
                    module: element.module,
                    task: t,
                    id: `${element.id}::${t.name}`,
                }));
            }
            case 'recentFolder': {
                const recent = this.recentByWorkspace.get(element.workspaceRoot) ?? [];
                return recent.map((r, idx) => ({
                    kind: 'recentRun',
                    workspaceRoot: element.workspaceRoot,
                    recent: r,
                    id: `${element.id}::${idx}::${r.task}`,
                }));
            }
            case 'recentRun':
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
            case 'recentFolder':
                return 'Recent';
            case 'recentRun':
                return d.recent ? recentLabel(d.recent) : '';
            case 'task':
                return d.task?.name ?? '';
        }
    }

    private collapsibleFor(d: ModuleTreeItemData): vscode.TreeItemCollapsibleState {
        switch (d.kind) {
            case 'task':
            case 'recentRun':
                return vscode.TreeItemCollapsibleState.None;
            case 'workspace':
            case 'recentFolder':
                return vscode.TreeItemCollapsibleState.Expanded;
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
                return 'gradleTask';
            case 'tasksFolder':
                return 'gradleTasksFolder';
            case 'recentFolder':
                return 'gradleRecentFolder';
            case 'recentRun':
                return 'gradleRecentRun';
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
