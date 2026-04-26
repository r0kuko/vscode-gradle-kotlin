import * as vscode from 'vscode';
import * as cp from 'child_process';
import { resolveGradleCommand } from './gradle';

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

export class DaemonsProvider implements vscode.TreeDataProvider<DaemonEntry> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DaemonEntry | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private daemons: GradleDaemonInfo[] = [];
    private loading = false;

    constructor(private readonly getWorkspaceRoot: () => string | undefined) {}

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
            const config = vscode.workspace.getConfiguration('gradleKotlin', vscode.Uri.file(root));
            const override = config.get<string>('gradleCommand') ?? '';
            const { command, cwd } = resolveGradleCommand(root, override);

            const out = await new Promise<string>(resolve => {
                let buf = '';
                const child = cp.spawn(command, ['--status'], {
                    cwd,
                    shell: process.platform === 'win32',
                    env: process.env,
                });
                child.stdout.on('data', (b: Buffer) => (buf += b.toString()));
                child.stderr.on('data', (b: Buffer) => (buf += b.toString()));
                child.on('close', () => resolve(buf));
                child.on('error', () => resolve(''));
            });
            this.daemons = parseDaemonStatusOutput(out);
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
        if (this.loading) return ['loading'];
        if (this.daemons.length === 0) return ['empty'];
        return this.daemons;
    }

    /**
     * Kill a specific daemon process by PID.
     * On Unix: SIGTERM. On Windows: taskkill.
     */
    async stopDaemon(info: GradleDaemonInfo): Promise<void> {
        try {
            const pid = parseInt(info.pid, 10);
            if (process.platform === 'win32') {
                await new Promise<void>(resolve =>
                    cp.exec(`taskkill /PID ${pid} /F`, () => resolve())
                );
            } else {
                process.kill(pid, 'SIGTERM');
            }
        } catch {
            // already dead, ignore
        }
        await this.reload();
    }
}
