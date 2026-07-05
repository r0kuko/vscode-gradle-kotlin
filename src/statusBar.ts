import * as vscode from 'vscode';
import { GradleDaemon } from './daemon';

/**
 * Tiny status-bar item that mirrors the Gradle daemon's activity.
 *
 *  - idle          → `$(gradle-kotlin) Gradle`
 *  - 1 task        → `$(sync~spin) Gradle: <task>` (only if in the focused workspace)
 *  - multi-root    → `$(sync~spin) Gradle (N running)` when active editor is idle workspace
 *
 * Clicking it stops the daemon.
 */
export function createDaemonStatusItem(daemon: GradleDaemon): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    item.command = 'gradleKotlin.stopDaemon';

    // Track per-workspace activity from daemon events.
    const taskByRoot = new Map<string, string>();
    const busyRoots = new Set<string>();

    const getActiveRoot = (): string | undefined => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri) return undefined;
        return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
    };

    const render = () => {
        const total = daemon.running;
        if (total === 0) {
            item.text = '$(gradle-kotlin) Gradle';
            item.tooltip = 'Gradle (idle). Click to stop daemon.';
            return;
        }
        const activeRoot = getActiveRoot();
        const taskForActive = activeRoot ? taskByRoot.get(activeRoot) : undefined;
        if (taskForActive) {
            // Active editor's workspace is running a task — show it.
            item.text = `$(sync~spin) Gradle: ${taskForActive}`;
            item.tooltip = `Running in current workspace. Click to stop.`;
        } else if (total === 1) {
            // One task running somewhere else — show it with context.
            const [otherRoot] = [...busyRoots];
            const task = taskByRoot.get(otherRoot) ?? '';
            const name = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(otherRoot))?.name ?? otherRoot;
            item.text = `$(sync~spin) Gradle: ${task}`;
            item.tooltip = `Running in workspace "${name}". Click to stop.`;
        } else {
            // Multiple roots running simultaneously.
            item.text = `$(sync~spin) Gradle (${total} running)`;
            item.tooltip = `${total} Gradle tasks running. Click to stop daemon.`;
        }
    };

    render();
    item.show();

    daemon.onEvent(e => {
        if (e.kind === 'start') {
            const task = e.args.find(a => !a.startsWith('-')) ?? '';
            taskByRoot.set(e.workspaceRoot, task);
            busyRoots.add(e.workspaceRoot);
        } else {
            busyRoots.delete(e.workspaceRoot);
        }
        render();
    });

    // Re-render when the focused editor changes so the per-workspace view updates.
    vscode.window.onDidChangeActiveTextEditor(() => render());

    return item;
}

/**
 * Status-bar badge shown when a newer Gradle wrapper version is available.
 * Hidden by default; call `checkAndShowWrapperUpgrade` to populate it.
 */
export function createWrapperUpgradeItem(): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    item.command = 'gradleKotlin.upgradeWrapper';
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    item.hide();
    return item;
}
