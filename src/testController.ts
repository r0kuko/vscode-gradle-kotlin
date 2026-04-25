import * as path from 'path';
import * as vscode from 'vscode';
import { GradleModule } from './gradle';
import { qualifyTask } from './tasks';
import { GradleDaemon } from './daemon';
import { discoverTestsInRoot, DiscoveredTestClass } from './testDiscovery';
import { JUnitCaseResult, readJUnitReports } from './junitReport';

/**
 * Wires Kotlin test discovery + the shared Gradle daemon into VS Code's
 * Test Explorer.  Each `:module` with a `src/test/kotlin` folder becomes
 * a top-level node; classes / test methods sit underneath.
 *
 * Running an item invokes `:module:test --tests <pattern>` through the
 * shared daemon, then JUnit XML reports under
 * `build/test-results/test/*.xml` are parsed to mark each case
 * passed / failed / skipped.
 */
export function createTestController(
    context: vscode.ExtensionContext,
    daemon: GradleDaemon,
    listModules: () => GradleModule[]
): vscode.TestController {
    const controller = vscode.tests.createTestController('gradleKotlin', 'Gradle Tests');
    context.subscriptions.push(controller);

    controller.resolveHandler = async item => {
        if (!item) {
            populateRoot(controller, listModules());
        }
    };

    controller.createRunProfile(
        'Run Gradle Tests',
        vscode.TestRunProfileKind.Run,
        async (request, token) => {
            await runHandler(controller, daemon, listModules(), request, token);
        },
        true
    );

    return controller;
}

function moduleId(module: GradleModule): string {
    return `module::${module.workspaceRoot}::${module.projectPath}`;
}

function classId(module: GradleModule, fqcn: string): string {
    return `${moduleId(module)}::${fqcn}`;
}

function methodId(module: GradleModule, fqcn: string, method: string): string {
    return `${classId(module, fqcn)}#${method}`;
}

function populateRoot(controller: vscode.TestController, modules: GradleModule[]): void {
    controller.items.replace([]);
    for (const module of modules) {
        const testRoot = path.join(module.rootPath, 'src', 'test', 'kotlin');
        const classes = discoverTestsInRoot(testRoot);
        if (classes.length === 0) continue;

        const moduleItem = controller.createTestItem(
            moduleId(module),
            module.name,
            vscode.Uri.file(module.rootPath)
        );
        moduleItem.canResolveChildren = false;
        for (const cls of classes) {
            moduleItem.children.add(buildClassItem(controller, module, cls));
        }
        controller.items.add(moduleItem);
    }
}

function buildClassItem(
    controller: vscode.TestController,
    module: GradleModule,
    cls: DiscoveredTestClass
): vscode.TestItem {
    const classItem = controller.createTestItem(
        classId(module, cls.fqcn),
        cls.simpleName,
        vscode.Uri.file(cls.file)
    );
    classItem.range = new vscode.Range(cls.line, 0, cls.line, 0);
    for (const m of cls.methods) {
        const methodItem = controller.createTestItem(
            methodId(module, cls.fqcn, m.name),
            m.name,
            vscode.Uri.file(cls.file)
        );
        methodItem.range = new vscode.Range(m.line, 0, m.line, 0);
        classItem.children.add(methodItem);
    }
    return classItem;
}

interface ResolvedItem {
    module: GradleModule;
    fqcn?: string;
    method?: string;
    item: vscode.TestItem;
}

function resolveItem(
    item: vscode.TestItem,
    modules: GradleModule[]
): ResolvedItem | undefined {
    const id = item.id;
    const m = /^module::([^:]+(?::[^:]+)*)::(:[^:]*(?::[^:]+)*|:)(?:::([^#]+)(?:#(.+))?)?$/.exec(
        id
    );
    if (!m) return undefined;
    const [, workspaceRoot, projectPath, fqcn, method] = m;
    const module = modules.find(
        x => x.workspaceRoot === workspaceRoot && x.projectPath === projectPath
    );
    if (!module) return undefined;
    return { module, fqcn, method, item };
}

async function runHandler(
    controller: vscode.TestController,
    daemon: GradleDaemon,
    modules: GradleModule[],
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken
): Promise<void> {
    const run = controller.createTestRun(request);

    // Collect requested leaves grouped by module.
    const byModule = new Map<string, { module: GradleModule; patterns: Set<string>; items: vscode.TestItem[] }>();
    const queue: vscode.TestItem[] = [];
    if (request.include && request.include.length > 0) {
        queue.push(...request.include);
    } else {
        controller.items.forEach(i => queue.push(i));
    }
    const excluded = new Set(request.exclude?.map(e => e.id) ?? []);

    const visit = (item: vscode.TestItem) => {
        if (excluded.has(item.id)) return;
        const resolved = resolveItem(item, modules);
        if (!resolved) return;
        const key = moduleId(resolved.module);
        let group = byModule.get(key);
        if (!group) {
            group = { module: resolved.module, patterns: new Set(), items: [] };
            byModule.set(key, group);
        }
        if (resolved.method && resolved.fqcn) {
            group.patterns.add(`${resolved.fqcn}.${resolved.method}`);
            group.items.push(item);
            run.enqueued(item);
        } else if (resolved.fqcn) {
            group.patterns.add(resolved.fqcn);
            // expand for visual feedback
            item.children.forEach(child => {
                run.enqueued(child);
                group!.items.push(child);
            });
            if (item.children.size === 0) {
                group.items.push(item);
                run.enqueued(item);
            }
        } else {
            // module: run everything under it
            item.children.forEach(child => visit(child));
        }
    };
    for (const item of queue) visit(item);

    if (byModule.size === 0) {
        run.end();
        return;
    }

    for (const group of byModule.values()) {
        if (token.isCancellationRequested) break;
        for (const item of group.items) run.started(item);

        const args: string[] = [qualifyTask(group.module.projectPath, 'test')];
        for (const pattern of group.patterns) {
            args.push('--tests', pattern);
        }
        const before = Date.now();
        const result = await daemon.run({
            workspaceRoot: group.module.workspaceRoot,
            args,
            token,
        });
        const fallbackDuration = Math.max(1, Date.now() - before);

        const reportsDir = path.join(group.module.rootPath, 'build', 'test-results', 'test');
        const reports = readJUnitReports(reportsDir);
        const byKey = new Map<string, JUnitCaseResult>();
        for (const r of reports) byKey.set(`${r.className}.${r.name}`, r);

        for (const item of group.items) {
            const resolved = resolveItem(item, modules);
            if (!resolved?.fqcn) continue;
            const key = resolved.method
                ? `${resolved.fqcn}.${resolved.method}`
                : resolved.fqcn;
            const report = byKey.get(key);
            if (report) {
                applyReport(run, item, report);
            } else if (result.exitCode === 0) {
                run.passed(item, fallbackDuration);
            } else {
                run.failed(
                    item,
                    new vscode.TestMessage(`Gradle exited with ${result.exitCode}`),
                    fallbackDuration
                );
            }
        }
    }

    run.end();
}

function applyReport(
    run: vscode.TestRun,
    item: vscode.TestItem,
    report: JUnitCaseResult
): void {
    const ms = Math.max(1, Math.round(report.durationSec * 1000));
    switch (report.status) {
        case 'passed':
            run.passed(item, ms);
            break;
        case 'skipped':
            run.skipped(item);
            break;
        case 'failed':
        case 'errored':
            run.failed(item, new vscode.TestMessage(report.message ?? report.status), ms);
            break;
    }
}
