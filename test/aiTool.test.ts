import { describe, it, expect, vi } from 'vitest';
import { GradleDependenciesTool, GradleRunTool, buildRunPayload } from '../src/aiTool';

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
});
