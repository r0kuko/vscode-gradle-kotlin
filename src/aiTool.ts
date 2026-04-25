import * as vscode from 'vscode';
import * as path from 'path';
import { GradleDaemon } from './daemon';
import { GradleModule } from './gradle';
import { qualifyTask, parseTasksAllOutput } from './tasks';
import { findCatalogFile, parseCatalogFile } from './libs';

/**
 * Input schema declared in package.json under `languageModelTools`.
 */
export interface GradleRunToolInput {
    task: string;
    projectPath?: string;
    args?: string[];
}

export interface GradleTasksToolInput {
    projectPath?: string;
}

export interface GradleDependenciesToolInput {
    projectPath?: string;
    args?: string[];
}

export interface LibsCatalogReadToolInput {}

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

export class GradleTasksTool implements vscode.LanguageModelTool<GradleTasksToolInput> {
    constructor(
        private readonly daemon: GradleDaemon,
        private readonly resolveDefaultWorkspace: () => GradleModule[]
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GradleTasksToolInput>
    ): Promise<vscode.PreparedToolInvocation> {
        const projectPath = options.input.projectPath ?? ':';
        return {
            invocationMessage: `Listing tasks for ${projectPath}`,
            confirmationMessages: {
                title: 'List Gradle tasks',
                message: new vscode.MarkdownString(
                    `Allow Copilot to run \`${qualifyTask(projectPath, 'tasks')} --all --quiet\`?`
                ),
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GradleTasksToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const modules = this.resolveDefaultWorkspace();
        if (modules.length === 0) return noWorkspaceResult();
        const workspaceRoot = modules[0].workspaceRoot;
        const projectPath = options.input.projectPath ?? ':';
        const result = await this.daemon.run({
            workspaceRoot,
            args: [qualifyTask(projectPath, 'tasks'), '--all', '--quiet'],
            token,
        });
        const tasks = parseTasksAllOutput(result.combined, projectPath);
        const lines = tasks.map(t => `- ${t.name}${t.group ? ` [${t.group}]` : ''}`);
        const body =
            `Gradle exit code: ${result.exitCode ?? 'unknown'}\n` +
            `Project path: ${projectPath}\n\n` +
            (lines.length > 0 ? lines.join('\n') : 'No tasks parsed from output.');
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(body)]);
    }
}

export class GradleDependenciesTool
    implements vscode.LanguageModelTool<GradleDependenciesToolInput>
{
    constructor(
        private readonly daemon: GradleDaemon,
        private readonly resolveDefaultWorkspace: () => GradleModule[]
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GradleDependenciesToolInput>
    ): Promise<vscode.PreparedToolInvocation> {
        const projectPath = options.input.projectPath ?? ':';
        return {
            invocationMessage: `Running dependencies for ${projectPath}`,
            confirmationMessages: {
                title: 'Run Gradle dependencies',
                message: new vscode.MarkdownString(
                    `Allow Copilot to run \`${qualifyTask(projectPath, 'dependencies')}${formatArgs(options.input.args)}\`?`
                ),
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GradleDependenciesToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const modules = this.resolveDefaultWorkspace();
        if (modules.length === 0) return noWorkspaceResult();
        const workspaceRoot = modules[0].workspaceRoot;
        const projectPath = options.input.projectPath ?? ':';
        const args = [qualifyTask(projectPath, 'dependencies'), ...(options.input.args ?? [])];
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
}

export class LibsCatalogReadTool
    implements vscode.LanguageModelTool<LibsCatalogReadToolInput>
{
    constructor(private readonly resolveDefaultWorkspace: () => GradleModule[]) {}

    async prepareInvocation(): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: 'Reading libs.versions.toml',
            confirmationMessages: {
                title: 'Read version catalog',
                message: new vscode.MarkdownString(
                    'Allow Copilot to read your `libs.versions.toml` file?'
                ),
            },
        };
    }

    async invoke(): Promise<vscode.LanguageModelToolResult> {
        const modules = this.resolveDefaultWorkspace();
        if (modules.length === 0) return noWorkspaceResult();
        const workspaceRoot = modules[0].workspaceRoot;
        const catalogFile = findCatalogFile(workspaceRoot);
        if (!catalogFile) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No libs.versions.toml found in workspace.'),
            ]);
        }
        const catalog = parseCatalogFile(catalogFile);
        if (!catalog) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Failed to parse libs.versions.toml.'),
            ]);
        }

        const payload = {
            file: catalog.file,
            versions: Object.fromEntries(catalog.versions),
            libraries: Object.fromEntries(
                Array.from(catalog.libraries).map(([k, v]) => [k, {
                    coordinate: v.coordinate,
                    version: v.version,
                    versionRef: v.versionRef,
                }])
            ),
            plugins: Object.fromEntries(
                Array.from(catalog.plugins).map(([k, v]) => [k, {
                    id: v.id,
                    version: v.version,
                    versionRef: v.versionRef,
                }])
            ),
            bundles: Object.fromEntries(catalog.bundles),
        };

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('```json\n' + JSON.stringify(payload, null, 2) + '\n```'),
        ]);
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
    context.subscriptions.push(
        lm.registerTool('gradle_run', new GradleRunTool(daemon, modulesProvider)),
        lm.registerTool('gradle_tasks', new GradleTasksTool(daemon, modulesProvider)),
        lm.registerTool(
            'gradle_dependencies',
            new GradleDependenciesTool(daemon, modulesProvider)
        ),
        lm.registerTool('libs_catalog_read', new LibsCatalogReadTool(modulesProvider))
    );
}

/** Used by tests / fallbacks where there's no workspace context available. */
export function workspaceRootForUri(uri: vscode.Uri): string {
    return path.dirname(uri.fsPath);
}

function noWorkspaceResult(): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
            'No Gradle project detected in the current workspace.'
        ),
    ]);
}
