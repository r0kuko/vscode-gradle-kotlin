import * as vscode from 'vscode';
import * as cp from 'child_process';
import { resolveGradleCommand } from './gradle';

/**
 * Long-lived Gradle "daemon" wrapper.
 *
 * Gradle itself already runs as a daemon (we just rely on `--daemon`). Our
 * job is to:
 *   - serialize task invocations per workspace folder so we don't fork
 *     dozens of competing JVMs (what Copilot used to do when calling
 *     `./gradlew xxx` from a terminal),
 *   - share one OutputChannel for all invocations,
 *   - surface a `runTask` API to BOTH the sidebar UI and the language-model
 *     tool registered with `vscode.lm`.
 */
export interface DaemonRunRequest {
    workspaceRoot: string;
    /** Already-qualified task expression (e.g. ":app:test") OR bare task name. */
    args: string[];
    /** Optional cancellation. */
    token?: vscode.CancellationToken;
}

export interface DaemonRunResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    /** Combined output as the user/AI saw it. */
    combined: string;
    durationMs: number;
}

const MAX_BUFFER = 8 * 1024 * 1024;

export class GradleDaemon implements vscode.Disposable {
    private queue = new Map<string, Promise<unknown>>();
    private readonly output: vscode.OutputChannel;
    private disposed = false;

    constructor(output: vscode.OutputChannel) {
        this.output = output;
    }

    /**
     * Serialize calls per workspace root so that two simultaneous Copilot
     * tool calls don't spawn two competing Gradle invocations.
     */
    async run(req: DaemonRunRequest): Promise<DaemonRunResult> {
        if (this.disposed) {
            throw new Error('Gradle daemon is disposed.');
        }
        const key = req.workspaceRoot;
        const previous = this.queue.get(key) ?? Promise.resolve();
        const next = previous.then(() => this.runImmediate(req));
        // Swallow rejections so the chain keeps going.
        this.queue.set(key, next.catch(() => undefined));
        return next as Promise<DaemonRunResult>;
    }

    private async runImmediate(req: DaemonRunRequest): Promise<DaemonRunResult> {
        const config = vscode.workspace.getConfiguration(
            'gradleKotlin',
            vscode.Uri.file(req.workspaceRoot)
        );
        const override = config.get<string>('gradleCommand') ?? '';
        const { command, cwd } = resolveGradleCommand(req.workspaceRoot, override);
        const args = [...req.args, '--daemon', '--console=plain'];
        const start = Date.now();

        this.output.appendLine(`\n> ${command} ${args.join(' ')}`);
        this.output.show(true);

        return new Promise<DaemonRunResult>(resolve => {
            const child = cp.spawn(command, args, {
                cwd,
                shell: process.platform === 'win32',
                env: process.env,
            });

            let stdout = '';
            let stderr = '';
            let combined = '';

            const cancel = req.token?.onCancellationRequested(() => {
                try {
                    child.kill('SIGTERM');
                } catch {
                    /* ignore */
                }
            });

            child.stdout.on('data', (b: Buffer) => {
                const s = b.toString();
                if (stdout.length < MAX_BUFFER) stdout += s;
                if (combined.length < MAX_BUFFER) combined += s;
                this.output.append(s);
            });
            child.stderr.on('data', (b: Buffer) => {
                const s = b.toString();
                if (stderr.length < MAX_BUFFER) stderr += s;
                if (combined.length < MAX_BUFFER) combined += s;
                this.output.append(s);
            });
            child.on('error', err => {
                cancel?.dispose();
                this.output.appendLine(`\n[ERROR] Failed to spawn ${command}: ${err.message}`);
                resolve({
                    exitCode: -1,
                    stdout,
                    stderr: stderr + err.message,
                    combined: combined + err.message,
                    durationMs: Date.now() - start,
                });
            });
            child.on('close', code => {
                cancel?.dispose();
                this.output.appendLine(`\n[exit ${code}] ${command} ${args.join(' ')}`);
                resolve({
                    exitCode: code,
                    stdout,
                    stderr,
                    combined,
                    durationMs: Date.now() - start,
                });
            });
        });
    }

    /**
     * Ask Gradle to politely stop its daemons. Best-effort.
     */
    async stopAll(workspaceRoot: string): Promise<void> {
        await this.run({ workspaceRoot, args: ['--stop'] }).catch(() => undefined);
    }

    dispose(): void {
        this.disposed = true;
    }
}

let singleton: GradleDaemon | undefined;

export function getDaemon(output: vscode.OutputChannel): GradleDaemon {
    if (!singleton) singleton = new GradleDaemon(output);
    return singleton;
}

export function disposeDaemon(): void {
    singleton?.dispose();
    singleton = undefined;
}
