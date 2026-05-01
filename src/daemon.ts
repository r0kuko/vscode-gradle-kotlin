import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { resolveGradleCommand } from './gradle';

/**
 * Long-lived Gradle "daemon" wrapper.
 *
 * Gradle itself can run as a daemon. Our
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
    /** Called for every stdout/stderr chunk while the child is running. */
    onOutput?: (chunk: string, source: 'stdout' | 'stderr') => void;
    /** Extra environment variables merged on top of process.env for this invocation. */
    env?: Record<string, string>;
    /**
     * JVM arguments for the forked Gradle worker / task JVM.  Passed as
     * `-Dorg.gradle.jvmargs=<jvmArgs>` so that, e.g., test tasks pick them up.
     */
    jvmArgs?: string;
}

export interface DaemonRunResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    /** Combined output as the user/AI saw it. */
    combined: string;
    durationMs: number;
}

/** Lifecycle event fired by {@link GradleDaemon} for UI consumers. */
export interface DaemonEvent {
    kind: 'start' | 'finish';
    workspaceRoot: string;
    /** The args we passed to gradle (without the appended daemon / console flags). */
    args: string[];
    /** Set on `finish` only. */
    result?: DaemonRunResult;
}

const MAX_BUFFER = 8 * 1024 * 1024;
const GRADLE_FOR_JAVA_EXTENSION_ID = 'vscjava.vscode-gradle';

export class GradleDaemon implements vscode.Disposable {
    private queue = new Map<string, Promise<unknown>>();
    private readonly output: vscode.OutputChannel;
    private readonly _onEvent = new vscode.EventEmitter<DaemonEvent>();
    /** Public event stream (used by status bar / task-history view). */
    readonly onEvent = this._onEvent.event;
    /** Expose the shared output channel so callers can call show(). */
    get channel(): vscode.OutputChannel { return this.output; }
    private activeCount = 0;
    private disposed = false;

    constructor(output: vscode.OutputChannel) {
        this.output = output;
    }

    /** Number of currently-running gradle invocations across all workspaces. */
    get running(): number {
        return this.activeCount;
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
        const args = [...req.args];
        const enableInitScript = config.get<boolean>('initScript.enabled', true);
        const configuredInit = (config.get<string>('initScriptPath') ?? '').trim();
        const initScript = configuredInit || defaultInitScriptPath;
        if (enableInitScript && initScript && fs.existsSync(initScript)) {
            args.push('-I', initScript);
        }
        if (req.jvmArgs) {
            args.push(`-Dorg.gradle.jvmargs=${req.jvmArgs}`);
        }
        args.push(resolveDaemonFlag(config), '--console=plain');
        const start = Date.now();

        const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
        this.output.appendLine(`\n[${ ts }] > ${command} ${args.join(' ')}`);
        this.output.show(true);
        this.activeCount++;
        this._onEvent.fire({ kind: 'start', workspaceRoot: req.workspaceRoot, args: req.args });

        return new Promise<DaemonRunResult>(resolve => {
            const child = cp.spawn(command, args, {
                cwd,
                shell: process.platform === 'win32',
                env: req.env ? { ...process.env, ...req.env } : process.env,
            });

            let stdout = '';
            let stderr = '';
            let combined = '';
            let settled = false;
            let exitFallback: NodeJS.Timeout | undefined;
            let forceKill: NodeJS.Timeout | undefined;
            let cancel: vscode.Disposable | undefined;

            const settle = (exitCode: number | null, extraStderr = '', extraCombined = '') => {
                if (settled) return;
                settled = true;
                if (exitFallback) clearTimeout(exitFallback);
                if (forceKill) clearTimeout(forceKill);
                cancel?.dispose();
                if (extraStderr) stderr += extraStderr;
                if (extraCombined) combined += extraCombined;
                this.output.appendLine(`\n[exit ${exitCode}] ${command} ${args.join(' ')}`);
                const result: DaemonRunResult = {
                    exitCode,
                    stdout,
                    stderr,
                    combined,
                    durationMs: Date.now() - start,
                };
                this.activeCount = Math.max(0, this.activeCount - 1);
                this._onEvent.fire({ kind: 'finish', workspaceRoot: req.workspaceRoot, args: req.args, result });
                resolve(result);
            };

            cancel = req.token?.onCancellationRequested(() => {
                this.output.appendLine('\n[cancelled] Gradle invocation cancelled.');
                try {
                    killChild(child, false);
                } catch {
                    /* ignore */
                }
                forceKill = setTimeout(() => {
                    try {
                        killChild(child, true);
                    } catch {
                        /* ignore */
                    }
                }, 5_000);
            });

            child.stdout.on('data', (b: Buffer) => {
                const s = b.toString();
                if (stdout.length < MAX_BUFFER) stdout += s;
                if (combined.length < MAX_BUFFER) combined += s;
                this.output.append(s);
                req.onOutput?.(s, 'stdout');
            });
            child.stderr.on('data', (b: Buffer) => {
                const s = b.toString();
                if (stderr.length < MAX_BUFFER) stderr += s;
                if (combined.length < MAX_BUFFER) combined += s;
                this.output.append(s);
                req.onOutput?.(s, 'stderr');
            });
            child.on('error', err => {
                this.output.appendLine(`\n[ERROR] Failed to spawn ${command}: ${err.message}`);
                settle(-1, err.message, err.message);
            });
            child.on('exit', code => {
                exitFallback = setTimeout(() => {
                    const msg = '\n[WARN] Gradle process exited but stdio did not close; returning collected output.\n';
                    this.output.append(msg);
                    settle(code, msg, msg);
                }, 1_500);
            });
            child.on('close', code => {
                settle(code);
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
        this._onEvent.dispose();
    }
}

let singleton: GradleDaemon | undefined;
let defaultInitScriptPath: string | undefined;

export function setDefaultInitScriptPath(file: string | undefined): void {
    defaultInitScriptPath = file;
}

export function getDaemon(output: vscode.OutputChannel): GradleDaemon {
    if (!singleton) singleton = new GradleDaemon(output);
    return singleton;
}

export function disposeDaemon(): void {
    singleton?.dispose();
    singleton = undefined;
}

function killChild(child: cp.ChildProcess, force: boolean): void {
    if (process.platform === 'win32' && child.pid) {
        cp.exec(`taskkill /PID ${child.pid} /T ${force ? '/F' : ''}`, () => undefined);
        return;
    }
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
}

function resolveDaemonFlag(config: vscode.WorkspaceConfiguration): '--daemon' | '--no-daemon' {
    const daemonEnabled = config.get<boolean>('daemon.enabled', true);
    if (!daemonEnabled) return '--no-daemon';

    const mode = config.get<string>('daemon.mode', 'auto');
    if (mode === 'always') return '--daemon';
    if (mode === 'never') return '--no-daemon';

    const gradleForJavaInstalled = !!vscode.extensions.getExtension(GRADLE_FOR_JAVA_EXTENSION_ID);
    return gradleForJavaInstalled ? '--no-daemon' : '--daemon';
}
