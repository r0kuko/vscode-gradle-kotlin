import { describe, it, expect } from 'vitest';
import { buildRunPayload } from '../src/aiTool';

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
