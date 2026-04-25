import * as vscode from 'vscode';
import { GradleDaemon } from './daemon';

/**
 * Tiny status-bar item that mirrors the Gradle daemon's activity.
 *  - idle      → `$(rocket) Gradle`
 *  - running   → `$(sync~spin) Gradle: <task>`
 * Clicking it stops the daemon.
 */
export function createDaemonStatusItem(daemon: GradleDaemon): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    item.command = 'gradleKotlin.stopDaemon';
    item.tooltip = 'Click to stop the Gradle daemon';
    let lastTask = '';
    const render = () => {
        if (daemon.running > 0) {
            item.text = `$(sync~spin) Gradle${lastTask ? ': ' + lastTask : ''}`;
        } else {
            item.text = '$(rocket) Gradle';
        }
    };
    render();
    item.show();
    daemon.onEvent(e => {
        if (e.kind === 'start') {
            lastTask = e.args.find(a => !a.startsWith('-')) ?? '';
        }
        render();
    });
    return item;
}
