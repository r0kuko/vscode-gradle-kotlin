import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GradleDaemon } from './daemon';
import { GradleModule } from './gradle';
import { qualifyTask, parseTasksAllOutput } from './tasks';
import { findCatalogFile, parseCatalogFile } from './libs';
import { searchArtifacts } from './mavenSearch';
import { parseGradleDiagnostics } from './buildDiagnostics';
import { RecentRun } from './history';
import { JUnitCaseResult, readJUnitReports } from './junitReport';

/**
 * Input schema declared in package.json under `languageModelTools`.
 */
export interface GradleRunToolInput {
    task: string;
    projectPath?: string;
    tests?: string | string[];
    args?: string[];
}

export interface GradleTasksToolInput {
    projectPath?: string;
}

export interface GradleTestToolInput {
    projectPath?: string;
    task?: string;
    classes?: string[];
    methods?: string[];
    tests?: string[];
    args?: string[];
    rerunLast?: boolean;
    rerunFailed?: boolean;
}

export interface GradleDependenciesToolInput {
    projectPath?: string;
    args?: string[];
}

export interface LibsCatalogReadToolInput {}

export interface GradleDependencySearchToolInput {
    query: string;
    rows?: number;
}

/**
 * Free-text Maven Central search exposed to Copilot — the model can
 * use it to suggest accurate dependency coordinates without
 * hallucinating versions.
 */
export class GradleDependencySearchTool
    implements vscode.LanguageModelTool<GradleDependencySearchToolInput>
{
    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GradleDependencySearchToolInput>
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Searching Maven Central for "${options.input.query}"`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GradleDependencySearchToolInput>
    ): Promise<vscode.LanguageModelToolResult> {
        const matches = await searchArtifacts(options.input.query, options.input.rows ?? 20);
        if (matches.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`No Maven Central matches for "${options.input.query}".`),
            ]);
        }
        const payload = matches.map(m => ({
            coordinate: m.coordinate,
            latestVersion: m.latestVersion,
            gradleKts: `implementation("${m.coordinate}:${m.latestVersion}")`,
        }));
        return toolResult(payload);
    }
}

/**
 * Implementation of the `gradle_run` Copilot tool.  Always reuses the
 * extension's singleton {@link GradleDaemon} so that repeated tool calls
 * share one Gradle daemon JVM instead of forking a fresh one each time.
 */
export class GradleRunTool implements vscode.LanguageModelTool<GradleRunToolInput> {
    constructor(
        private readonly daemon: GradleDaemon,
        private readonly resolveDefaultWorkspace: () => GradleModule[],
        private readonly recordRun?: (run: RecentRun) => Promise<void>
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GradleRunToolInput>
    ): Promise<vscode.PreparedToolInvocation> {
        const fullTask = this.fullyQualifyTask(options.input);
        const args = [...testFilterArgs(options.input.tests), ...(options.input.args ?? [])];
        return {
            invocationMessage: `Running \`gradle ${fullTask}\``,
            confirmationMessages: {
                title: 'Run Gradle task',
                message: new vscode.MarkdownString(
                    `Allow Copilot to invoke \`gradle ${fullTask}${formatArgs(args)}\` in your workspace?`
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
        const extraArgs = [...testFilterArgs(options.input.tests), ...(options.input.args ?? [])];
        const args = [fullTask, ...extraArgs];

        const result = await this.daemon.run({ workspaceRoot, args, token });
        await this.recordRun?.({
            task: fullTask,
            args: extraArgs,
            workspaceRoot,
            timestamp: Date.now(),
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            source: 'ai',
        });

        return toolResult(buildRunPayload(fullTask, result, { modules, workspaceRoot }));
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

interface NormalizedGradleTestSpec {
    workspaceRoot: string;
    projectPath: string;
    taskName: string;
    fullTask: string;
    filters: string[];
    args: string[];
}

export class GradleTestTool implements vscode.LanguageModelTool<GradleTestToolInput> {
    private lastSpec: NormalizedGradleTestSpec | undefined;
    private lastFailedFilters: string[] = [];

    constructor(
        private readonly daemon: GradleDaemon,
        private readonly resolveDefaultWorkspace: () => GradleModule[],
        private readonly recordRun?: (run: RecentRun) => Promise<void>
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GradleTestToolInput>
    ): Promise<vscode.PreparedToolInvocation> {
        const modules = this.resolveDefaultWorkspace();
        const spec = this.normalizeSpec(options.input, modules);
        const label = spec
            ? `${spec.fullTask}${formatArgs(testFilterArgs(spec.filters))}${formatArgs(spec.args)}`
            : 'Gradle tests';
        return {
            invocationMessage: `Running \`gradle ${label}\``,
            confirmationMessages: {
                title: 'Run Gradle tests',
                message: new vscode.MarkdownString(`Allow Copilot to invoke \`gradle ${label}\` in your workspace?`),
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GradleTestToolInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const modules = this.resolveDefaultWorkspace();
        if (modules.length === 0) return noWorkspaceResult();
        const spec = this.normalizeSpec(options.input, modules);
        if (!spec) {
            return toolResult({
                error: options.input.rerunFailed
                    ? 'No failed Gradle tests are available to rerun.'
                    : 'No previous Gradle test invocation is available to rerun.',
            });
        }

        const runArgs = [spec.fullTask, ...testFilterArgs(spec.filters), ...spec.args];
        const result = await this.daemon.run({ workspaceRoot: spec.workspaceRoot, args: runArgs, token });
        await this.recordRun?.({
            task: spec.fullTask,
            args: runArgs.slice(1),
            workspaceRoot: spec.workspaceRoot,
            timestamp: Date.now(),
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            source: 'ai',
        });

        const basePayload = buildRunPayload(spec.fullTask, result, { modules, workspaceRoot: spec.workspaceRoot });
        const junitHint = basePayload.reportHints.find(h => h.kind === 'junitXml');
        const cases = junitHint ? readJUnitReports(junitHint.path) : [];
        const failedCases = cases.filter(c => c.status === 'failed' || c.status === 'errored');
        this.lastSpec = spec;
        this.lastFailedFilters = failedCases.map(testCaseFilter).filter(Boolean);

        return toolResult({
            ...basePayload,
            normalized: {
                task: spec.fullTask,
                filters: spec.filters,
                args: spec.args,
            },
            testSummary: summarizeTestCases(cases),
            failedTests: failedCases.map(c => ({ ...c, filter: testCaseFilter(c) })),
            executedTests: cases.slice(0, 100),
        });
    }

    private normalizeSpec(input: GradleTestToolInput, modules: GradleModule[]): NormalizedGradleTestSpec | undefined {
        if (input.rerunFailed) {
            if (!this.lastSpec || this.lastFailedFilters.length === 0) return undefined;
            return {
                ...this.lastSpec,
                filters: this.lastFailedFilters,
                args: input.args ?? this.lastSpec.args,
            };
        }
        if (input.rerunLast) return this.lastSpec;

        const workspaceRoot = modules[0].workspaceRoot;
        const rawTask = (input.task ?? 'test').trim() || 'test';
        const parsedTask = rawTask.startsWith(':') ? parseGradleTaskPath(rawTask) : undefined;
        const projectPath = parsedTask?.projectPath ?? input.projectPath ?? ':';
        const taskName = parsedTask?.taskName ?? rawTask;
        const filters = normalizeTestFilters(input);
        return {
            workspaceRoot,
            projectPath,
            taskName,
            fullTask: rawTask.startsWith(':') ? rawTask : qualifyTask(projectPath, taskName),
            filters,
            args: input.args ?? [],
        };
    }
}

export class GradleDependenciesTool
    implements vscode.LanguageModelTool<GradleDependenciesToolInput>
{
    constructor(
        private readonly daemon: GradleDaemon,
        private readonly resolveDefaultWorkspace: () => GradleModule[],
        private readonly recordRun?: (run: RecentRun) => Promise<void>
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
        const task = qualifyTask(projectPath, 'dependencies');
        const args = [task, ...(options.input.args ?? [])];
        const result = await this.daemon.run({ workspaceRoot, args, token });
        await this.recordRun?.({
            task,
            args: options.input.args ?? [],
            workspaceRoot,
            timestamp: Date.now(),
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            source: 'ai',
        });
        return toolResult(buildRunPayload(args.join(' '), result));
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

function testFilterArgs(tests: string | string[] | undefined): string[] {
    if (!tests) return [];
    const patterns = Array.isArray(tests) ? tests : [tests];
    return patterns.flatMap(pattern => {
        const trimmed = pattern.trim();
        return trimmed ? ['--tests', trimmed] : [];
    });
}

function normalizeTestFilters(input: GradleTestToolInput): string[] {
    const explicit = stringArray(input.tests);
    const classes = stringArray(input.classes);
    const methods = stringArray(input.methods);
    const combined: string[] = [...explicit];
    if (classes.length === 0) {
        combined.push(...methods);
    } else if (methods.length === 0) {
        combined.push(...classes);
    } else {
        for (const className of classes) {
            for (const method of methods) combined.push(`${className}.${method}`);
        }
    }
    return [...new Set(combined.map(s => s.trim()).filter(Boolean))];
}

function stringArray(value: string[] | undefined): string[] {
    return Array.isArray(value) ? value : [];
}

function summarizeTestCases(cases: JUnitCaseResult[]): {
    total: number;
    passed: number;
    failed: number;
    errored: number;
    skipped: number;
    durationSec: number;
} {
    return {
        total: cases.length,
        passed: cases.filter(c => c.status === 'passed').length,
        failed: cases.filter(c => c.status === 'failed').length,
        errored: cases.filter(c => c.status === 'errored').length,
        skipped: cases.filter(c => c.status === 'skipped').length,
        durationSec: Number(cases.reduce((sum, c) => sum + c.durationSec, 0).toFixed(3)),
    };
}

function testCaseFilter(testCase: JUnitCaseResult): string {
    return testCase.className ? `${testCase.className}.${testCase.name}` : testCase.name;
}

const MAX_TAIL_BYTES = 16_000;

interface BuildRunPayloadContext {
    modules?: GradleModule[];
    workspaceRoot?: string;
}

/**
 * Build a structured payload for Copilot tools. Always returns the last
 * MAX_TAIL_BYTES of combined output so the model knows when output was
 * truncated and can ask follow-ups.
 */
export function buildRunPayload(
    invocation: string,
    result: { exitCode: number | null; durationMs: number; combined: string },
    context: BuildRunPayloadContext = {}
): {
    invocation: string;
    exitCode: number | null;
    durationMs: number;
    failed: boolean;
    failedTask?: string;
    truncated: boolean;
    bytes: number;
    tail: string;
    diagnostics: Array<{
        file: string;
        line: number;
        column: number;
        severity: 'error' | 'warning';
        message: string;
    }>;
    reportHints: Array<{
        kind: 'junitXml' | 'html';
        path: string;
        exists: boolean;
    }>;
} {
    const truncated = result.combined.length > MAX_TAIL_BYTES;
    const failedTask = /^> Task (.+?) FAILED$/m.exec(result.combined)?.[1];
    const diagnostics = parseGradleDiagnostics(result.combined)
        .slice(0, 20)
        .map(d => ({
            file: d.file,
            line: d.line + 1,
            column: d.column + 1,
            severity: d.severity,
            message: d.message,
        }));
    return {
        invocation,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        failed: result.exitCode !== 0 && result.exitCode !== null,
        ...(failedTask ? { failedTask } : {}),
        truncated,
        bytes: result.combined.length,
        tail: truncated ? result.combined.slice(-MAX_TAIL_BYTES) : result.combined,
        diagnostics,
        reportHints: buildReportHints(invocation, context),
    };
}

function buildReportHints(
    invocation: string,
    context: BuildRunPayloadContext
): Array<{ kind: 'junitXml' | 'html'; path: string; exists: boolean }> {
    const parsed = parseGradleTaskPath(invocation);
    if (!parsed || !isTestTaskName(parsed.taskName)) return [];
    const module = context.modules?.find(m => m.projectPath === parsed.projectPath);
    const moduleRoot = module?.rootPath ?? context.workspaceRoot;
    if (!moduleRoot) return [];
    const taskReportName = parsed.taskName;
    const xmlDir = path.join(moduleRoot, 'build', 'test-results', taskReportName);
    const htmlFile = path.join(moduleRoot, 'build', 'reports', 'tests', taskReportName, 'index.html');
    return [
        { kind: 'junitXml', path: toPortablePath(xmlDir), exists: fs.existsSync(xmlDir) },
        { kind: 'html', path: toPortablePath(htmlFile), exists: fs.existsSync(htmlFile) },
    ];
}

function toPortablePath(file: string): string {
    return file.replace(/\\/g, '/');
}

function parseGradleTaskPath(invocation: string): { projectPath: string; taskName: string } | undefined {
    const taskPath = invocation.trim().split(/\s+/)[0];
    if (!taskPath) return undefined;
    const segments = taskPath.split(':').filter(Boolean);
    if (segments.length === 0) return { projectPath: ':', taskName: taskPath };
    const taskName = segments[segments.length - 1];
    const projectSegments = segments.slice(0, -1);
    return {
        projectPath: projectSegments.length > 0 ? `:${projectSegments.join(':')}` : ':',
        taskName,
    };
}

function isTestTaskName(taskName: string): boolean {
    return /(^|Test)(test|Test)$/.test(taskName) || taskName.toLowerCase().endsWith('test');
}

function toolResult(payload: unknown): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(payload, null, 2)),
    ]);
}

/**
 * Convenience helper: register the tool with VS Code if the
 * `languageModelTools` API is available (it is on VS Code 1.95+).
 */
export function registerGradleRunTool(
    context: vscode.ExtensionContext,
    daemon: GradleDaemon,
    modulesProvider: () => GradleModule[],
    recordRun?: (run: RecentRun) => Promise<void>
): void {
    const lm = (vscode as unknown as { lm?: { registerTool?: typeof vscode.lm.registerTool } }).lm;
    if (!lm?.registerTool) return;
    context.subscriptions.push(
        lm.registerTool('gradle_run', new GradleRunTool(daemon, modulesProvider, recordRun)),
        lm.registerTool('gradle_tasks', new GradleTasksTool(daemon, modulesProvider)),
        lm.registerTool('gradle_test', new GradleTestTool(daemon, modulesProvider, recordRun)),
        lm.registerTool(
            'gradle_dependencies',
            new GradleDependenciesTool(daemon, modulesProvider, recordRun)
        ),
        lm.registerTool('libs_catalog_read', new LibsCatalogReadTool(modulesProvider)),
        lm.registerTool('gradle_dependency_search', new GradleDependencySearchTool())
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
