import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { GradleDependenciesTool, GradleRunTool, GradleTestTool, buildRunPayload } from '../src/aiTool';

describe('buildRunPayload', () => {
    it('returns full output when under the cap', () => {
        const payload = buildRunPayload(':app:test', {
            exitCode: 0,
            durationMs: 42,
            combined: 'BUILD SUCCESSFUL',
        });
        expect(payload).toEqual({
            invocation: ':app:test',
            exitCode: 0,
            durationMs: 42,
            failed: false,
            truncated: false,
            bytes: 'BUILD SUCCESSFUL'.length,
            tail: 'BUILD SUCCESSFUL',
            diagnostics: [],
            reportHints: [],
        });
    });

    it('keeps the last 16k bytes and flags truncation', () => {
        const big = 'x'.repeat(20_000);
        const payload = buildRunPayload(':build', {
            exitCode: null,
            durationMs: 100,
            combined: big,
        });
        expect(payload.truncated).toBe(true);
        expect(payload.bytes).toBe(20_000);
        expect(payload.tail.length).toBe(16_000);
        expect(payload.tail.endsWith('x')).toBe(true);
    });

    it('summarizes failed tasks and diagnostics', () => {
        const payload = buildRunPayload(':modules:user:kspKotlin', {
            exitCode: 1,
            durationMs: 1200,
            combined:
                '> Task :modules:user:kspKotlin FAILED\n' +
                'e: [ksp] C:/repo/modules/user/src/main/kotlin/UserAccount.kt:21: Illegal type "UserAccount", it is decorated by "@org.babyfish.jimmer.sql.Entity" but there is no id property\n',
        });

        expect(payload.failed).toBe(true);
        expect(payload.failedTask).toBe(':modules:user:kspKotlin');
        expect(payload.diagnostics).toEqual([
            {
                file: 'C:/repo/modules/user/src/main/kotlin/UserAccount.kt',
                line: 21,
                column: 1,
                severity: 'error',
                message: '[ksp] Illegal type "UserAccount", it is decorated by "@org.babyfish.jimmer.sql.Entity" but there is no id property',
            },
        ]);
    });
});

describe('AI Gradle tools recent history', () => {
    const module = {
        rootPath: '/ws',
        workspaceRoot: '/ws',
        projectPath: ':',
        name: 'root',
        kotlinDsl: true,
    };

    it('records gradle_run invocations as AI recent runs', async () => {
        const daemon = {
            run: vi.fn(async () => ({
                exitCode: 0,
                stdout: '',
                stderr: '',
                combined: 'BUILD SUCCESSFUL',
                durationMs: 25,
            })),
        };
        const recordRun = vi.fn(async () => undefined);
        const tool = new GradleRunTool(daemon as never, () => [module as never], recordRun);

        await tool.invoke({ input: { task: 'test', projectPath: ':app', args: ['--info'] } } as never, {} as never);

        expect(daemon.run).toHaveBeenCalledWith({
            workspaceRoot: '/ws',
            args: [':app:test', '--info'],
            token: {},
        });
        expect(recordRun).toHaveBeenCalledWith({
            task: ':app:test',
            args: ['--info'],
            workspaceRoot: '/ws',
            timestamp: expect.any(Number),
            exitCode: 0,
            durationMs: 25,
            source: 'ai',
        });
    });

    it('passes test filters with spaces as single Gradle arguments', async () => {
        const daemon = {
            run: vi.fn(async () => ({
                exitCode: 0,
                stdout: '',
                stderr: '',
                combined: 'BUILD SUCCESSFUL',
                durationMs: 20,
            })),
        };
        const tool = new GradleRunTool(daemon as never, () => [module as never]);

        await tool.invoke({ input: { task: 'test', projectPath: ':app', tests: 'com.example.SpaceTest > handles spaces in display name' } } as never, {} as never);

        expect(daemon.run).toHaveBeenCalledWith({
            workspaceRoot: '/ws',
            args: [':app:test', '--tests', 'com.example.SpaceTest > handles spaces in display name'],
            token: {},
        });
    });

    it('returns failed gradle_run output as parseable JSON', async () => {
        const daemon = {
            run: vi.fn(async () => ({
                exitCode: 1,
                stdout: '',
                stderr: '',
                combined: '> Task :app:test FAILED\n\nexpected:<1> but was:<2>',
                durationMs: 55,
            })),
        };
        const tool = new GradleRunTool(daemon as never, () => [module as never]);

        const result = await tool.invoke({ input: { task: 'test', projectPath: ':app' } } as never, {} as never);
        const payload = JSON.parse((result.content[0] as { value: string }).value);

        expect(payload).toMatchObject({
            invocation: ':app:test',
            exitCode: 1,
            failed: true,
            failedTask: ':app:test',
            truncated: false,
            tail: '> Task :app:test FAILED\n\nexpected:<1> but was:<2>',
        });
    });

    it('includes Gradle test report hints for test tasks', async () => {
        const daemon = {
            run: vi.fn(async () => ({
                exitCode: 1,
                stdout: '',
                stderr: '',
                combined: '> Task :app:test FAILED',
                durationMs: 55,
            })),
        };
        const tool = new GradleRunTool(daemon as never, () => [{ ...module, rootPath: '/ws/app', projectPath: ':app' } as never]);

        const result = await tool.invoke({ input: { task: 'test', projectPath: ':app' } } as never, {} as never);
        const payload = JSON.parse((result.content[0] as { value: string }).value);

        expect(payload.reportHints).toEqual([
            { kind: 'junitXml', path: '/ws/app/build/test-results/test', exists: false },
            { kind: 'html', path: '/ws/app/build/reports/tests/test/index.html', exists: false },
        ]);
    });

    it('records gradle_dependencies invocations as AI recent runs', async () => {
        const daemon = {
            run: vi.fn(async () => ({
                exitCode: 1,
                stdout: '',
                stderr: '',
                combined: 'dependency failure',
                durationMs: 40,
            })),
        };
        const recordRun = vi.fn(async () => undefined);
        const tool = new GradleDependenciesTool(daemon as never, () => [module as never], recordRun);

        await tool.invoke({ input: { projectPath: ':app', args: ['--configuration', 'runtimeClasspath'] } } as never, {} as never);

        expect(recordRun).toHaveBeenCalledWith({
            task: ':app:dependencies',
            args: ['--configuration', 'runtimeClasspath'],
            workspaceRoot: '/ws',
            timestamp: expect.any(Number),
            exitCode: 1,
            durationMs: 40,
            source: 'ai',
        });
    });

    it('runs gradle_test class and display-name filters as single arguments', async () => {
        const daemon = {
            run: vi.fn(async () => ({
                exitCode: 0,
                stdout: '',
                stderr: '',
                combined: 'BUILD SUCCESSFUL',
                durationMs: 20,
            })),
        };
        const tool = new GradleTestTool(daemon as never, () => [module as never]);

        await tool.invoke({ input: { projectPath: ':app', classes: ['com.example.SpaceTest'], methods: ['handles spaces in display name'] } } as never, {} as never);

        expect(daemon.run).toHaveBeenCalledWith({
            workspaceRoot: '/ws',
            args: [':app:test', '--tests', 'com.example.SpaceTest.handles spaces in display name'],
            token: {},
        });
    });

    it('summarizes gradle_test reports and reruns failed tests', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-test-tool-'));
        const reportDir = path.join(root, 'build', 'test-results', 'test');
        fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
            path.join(reportDir, 'TEST-com.example.SpaceTest.xml'),
            '<testsuite tests="2" failures="1" skipped="0">' +
                '<testcase classname="com.example.SpaceTest" name="passes" time="0.1" />' +
                '<testcase classname="com.example.SpaceTest" name="handles spaces in display name" time="0.2">' +
                '<failure message="expected true" />' +
                '</testcase>' +
                '</testsuite>'
        );
        const daemon = {
            run: vi.fn(async () => ({
                exitCode: 1,
                stdout: '',
                stderr: '',
                combined: '> Task :app:test FAILED',
                durationMs: 50,
            })),
        };
        const tool = new GradleTestTool(daemon as never, () => [{ ...module, rootPath: root, projectPath: ':app' } as never]);

        const result = await tool.invoke({ input: { projectPath: ':app', classes: ['com.example.SpaceTest'] } } as never, {} as never);
        const payload = JSON.parse((result.content[0] as { value: string }).value);
        await tool.invoke({ input: { rerunFailed: true } } as never, {} as never);

        expect(payload.testSummary).toEqual({
            total: 2,
            passed: 1,
            failed: 1,
            errored: 0,
            skipped: 0,
            durationSec: 0.3,
        });
        expect(payload.failedTests).toMatchObject([
            {
                className: 'com.example.SpaceTest',
                name: 'handles spaces in display name',
                filter: 'com.example.SpaceTest.handles spaces in display name',
            },
        ]);
        expect(daemon.run).toHaveBeenLastCalledWith({
            workspaceRoot: '/ws',
            args: [':app:test', '--tests', 'com.example.SpaceTest.handles spaces in display name'],
            token: {},
        });
        fs.rmSync(root, { recursive: true, force: true });
    });
});
