import * as vscode from 'vscode';
import * as path from 'path';
import { GradleDaemon } from './daemon';
import { GradleModule } from './gradle';
import { qualifyTask } from './tasks';

/**
 * Input schema declared in package.json under `languageModelTools`.
 */
export interface GradleRunToolInput {
    task: string;
    projectPath?: string;
    args?: string[];
}

/**
 * Implementation of the `gradle_run` Copilot tool.  Always reuses the
 * extension's singleton {@link GradleDaemon} so that repeated tool calls
 * share one Gradle daemon JVM instead of forking a fresh one each time.
 */
export class GradleRunTool implements vscode.LanguageModelTool<GradleRunToolInput> {
    constructor(
        private readonly daemon: GradleDaemon,
        private readonly resolveDefaultWorkspace: () => GradleModule[]
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GradleRunToolInput>
    ): Promise<vscode.PreparedToolInvocation> {
        const fullTask = this.fullyQualifyTask(options.input);
        return {
            invocationMessage: `Running \`gradle ${fullTask}\``,
            confirmationMessages: {
                title: 'Run Gradle task',
                message: new vscode.MarkdownString(
                    `Allow Copilot to invoke \`gradle ${fullTask}${formatArgs(options.input.args)}\` in your workspace?`
                ),
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GradleRunToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const modules = this.resolveDefaultWorkspace();
        if (modules.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    'No Gradle project detected in the current workspace.'
                ),
            ]);
        }
        const workspaceRoot = modules[0].workspaceRoot;
        const fullTask = this.fullyQualifyTask(options.input);
        const args = [fullTask, ...(options.input.args ?? [])];

        const result = await this.daemon.run({ workspaceRoot, args, token });

        const summary =
            `Gradle exit code: ${result.exitCode ?? 'unknown'} (in ${result.durationMs} ms)\n\n` +
            '```\n' +
            tail(result.combined, 16_000) +
            '\n```';
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(summary),
        ]);
    }

    private fullyQualifyTask(input: GradleRunToolInput): string {
        const t = input.task.trim();
        if (t.startsWith(':')) return t;
        if (input.projectPath) return qualifyTask(input.projectPath, t);
        return ':' + t;
    }
}

function formatArgs(args: string[] | undefined): string {
    if (!args || args.length === 0) return '';
    return ' ' + args.join(' ');
}

function tail(s: string, max: number): string {
    if (s.length <= max) return s;
    return '…\n' + s.slice(s.length - max);
}

/**
 * Convenience helper: register the tool with VS Code if the
 * `languageModelTools` API is available (it is on VS Code 1.95+).
 */
export function registerGradleRunTool(
    context: vscode.ExtensionContext,
    daemon: GradleDaemon,
    modulesProvider: () => GradleModule[]
): void {
    const lm = (vscode as unknown as { lm?: { registerTool?: typeof vscode.lm.registerTool } }).lm;
    if (!lm?.registerTool) return;
    const disposable = lm.registerTool('gradle_run', new GradleRunTool(daemon, modulesProvider));
    context.subscriptions.push(disposable);
}

/** Used by tests / fallbacks where there's no workspace context available. */
export function workspaceRootForUri(uri: vscode.Uri): string {
    return path.dirname(uri.fsPath);
}
