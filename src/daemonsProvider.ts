import * as vscode from 'vscode';
import * as cp from 'child_process';
import type { GradleDaemon } from './daemon';

export interface GradleDaemonInfo {
    pid: string;
    /** e.g. "8.5" or "8.5-bin" */
    version: string;
    /** "IDLE" | "BUSY" | "STOPPED" | "CANCELED" */
    status: string;
}

/**
 * Parse `./gradlew --status` output.
 *
 * Gradle prints lines like:
 *   "  99392 IDLE     8.5"        (older format)
 *   "  99392 IDLE      8.5-bin"   (newer format)
 */
export function parseDaemonStatusOutput(output: string): GradleDaemonInfo[] {
    const results: GradleDaemonInfo[] = [];
    // Each daemon line: optional spaces, digits (PID), spaces, STATUS, spaces, version string
    const lineRe = /^\s*(\d+)\s+(IDLE|BUSY|STOPPED|CANCELED)\s+(\S.*?)\s*$/;
    for (const line of output.split('\n')) {
        const m = lineRe.exec(line);
        if (m) {
            results.push({ pid: m[1], status: m[2], version: m[3] });
        }
    }
    return results;
}

type DaemonEntry = GradleDaemonInfo | 'loading' | 'empty';

function isAliveDaemon(info: GradleDaemonInfo): boolean {
    return info.status === 'IDLE' || info.status === 'BUSY';
}

export class DaemonsProvider implements vscode.TreeDataProvider<DaemonEntry> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DaemonEntry | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private daemons: GradleDaemonInfo[] = [];
    private loading = false;

    constructor(
        private readonly daemon: Pick<GradleDaemon, 'run' | 'stopAll'>,
        private readonly getWorkspaceRoot: () => string | undefined
    ) {}

    /**
     * Re-run `gradlew --status` and refresh the view.
     * Safe to call concurrently — overlapping calls are de-bounced.
     */
    async reload(): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        this._onDidChangeTreeData.fire(undefined);
        try {
            const root = this.getWorkspaceRoot();
            if (!root) {
                this.daemons = [];
                return;
            }
            const result = await this.daemon.run({
                workspaceRoot: root,
                args: ['--status'],
                useInitScript: false,
                showOutput: false,
                queue: false,
                appendDaemonFlag: false,
            });
            this.daemons = parseDaemonStatusOutput(result.combined);
        } finally {
            this.loading = false;
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    getTreeItem(element: DaemonEntry): vscode.TreeItem {
        if (element === 'loading') {
            const item = new vscode.TreeItem('Checking daemons…');
            item.iconPath = new vscode.ThemeIcon('loading~spin');
            return item;
        }
        if (element === 'empty') {
            const item = new vscode.TreeItem('No Gradle daemons running');
            item.iconPath = new vscode.ThemeIcon('info');
            return item;
        }

        const item = new vscode.TreeItem(
            `PID ${element.pid}`,
            vscode.TreeItemCollapsibleState.None
        );
        item.description = element.version;
        item.tooltip = new vscode.MarkdownString(
            `**PID:** ${element.pid}  \n**Version:** ${element.version}  \n**Status:** ${element.status}`
        );
        // Only alive daemons can be stopped individually.
        item.contextValue = (element.status === 'IDLE' || element.status === 'BUSY')
            ? 'gradleDaemonAlive'
            : 'gradleDaemon';

        if (element.status === 'IDLE') {
            item.iconPath = new vscode.ThemeIcon(
                'circle-filled',
                new vscode.ThemeColor('testing.iconPassed')
            );
        } else if (element.status === 'BUSY') {
            item.iconPath = new vscode.ThemeIcon('loading~spin');
        } else {
            // STOPPED / CANCELED
            item.iconPath = new vscode.ThemeIcon(
                'circle-filled',
                new vscode.ThemeColor('disabledForeground')
            );
        }

        return item;
    }

    getChildren(): DaemonEntry[] {
        const alive = this.daemons.filter(isAliveDaemon);
        if (this.loading) return ['loading'];
        if (alive.length === 0) return ['empty'];
        return alive;
    }

    /**
     * Kill a specific daemon process by PID.
     * On Unix: SIGTERM. On Windows: taskkill.
     */
    async stopDaemon(info: GradleDaemonInfo, reload = true): Promise<void> {
        try {
            const pid = parseInt(info.pid, 10);
            if (process.platform === 'win32') {
                await new Promise<void>(resolve =>
                    cp.exec(`taskkill /PID ${pid} /T /F`, () => resolve())
                );
            } else {
                process.kill(pid, 'SIGKILL');
            }
        } catch {
            // already dead, ignore
        }
        if (reload) {
            await this.reload();
        }
    }

    /**
     * Stop Gradle daemons even when one is stuck BUSY: first ask Gradle to stop
     * politely, then force-kill any still-alive PIDs reported by --status.
     */
    async stopAllDaemons(workspaceRoot?: string): Promise<void> {
        const root = workspaceRoot ?? this.getWorkspaceRoot();
        if (!root) return;
        await this.daemon.stopAll(root);
        await this.reload();
        const stillAlive = this.daemons.filter(isAliveDaemon);
        for (const info of stillAlive) {
            await this.stopDaemon(info, false);
        }
        await this.reload();
    }
}
