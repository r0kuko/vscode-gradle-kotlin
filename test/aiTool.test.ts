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
            truncated: false,
            bytes: 'BUILD SUCCESSFUL'.length,
            tail: 'BUILD SUCCESSFUL',
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
});
