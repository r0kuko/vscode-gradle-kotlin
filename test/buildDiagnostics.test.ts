import { describe, expect, it } from 'vitest';
import { parseGradleDiagnostics } from '../src/buildDiagnostics';

describe('parseGradleDiagnostics', () => {
    it('extracts kotlin compiler errors', () => {
        const out = parseGradleDiagnostics(
            "e: file:///ws/build.gradle.kts:12:5 Unresolved reference: foo\n" +
            "w: file:///ws/build.gradle.kts:13:1 Variable 'x' is never used\n"
        );
        expect(out).toEqual([
            {
                file: '/ws/build.gradle.kts',
                line: 11,
                column: 4,
                severity: 'error',
                message: 'Unresolved reference: foo',
            },
            {
                file: '/ws/build.gradle.kts',
                line: 12,
                column: 0,
                severity: 'warning',
                message: "Variable 'x' is never used",
            },
        ]);
    });

    it('falls back to "* Where:" pointers using the matching "* What went wrong:" message', () => {
        const stderr = `
* What went wrong:
A problem occurred evaluating project ':app'.

* Where:
Build file '/ws/app/build.gradle.kts' line: 7
`;
        const out = parseGradleDiagnostics(stderr);
        expect(out).toEqual([
            {
                file: '/ws/app/build.gradle.kts',
                line: 6,
                column: 0,
                severity: 'error',
                message: "A problem occurred evaluating project ':app'.",
            },
        ]);
    });

    it('prefers a precise kotlin diagnostic over the generic "where" pointer for the same line', () => {
        const out = parseGradleDiagnostics(
            "e: file:///ws/build.gradle.kts:7:3 Type mismatch: expected Int\n" +
            "* What went wrong:\nFailed.\n* Where:\nBuild file '/ws/build.gradle.kts' line: 7\n"
        );
        expect(out).toHaveLength(1);
        expect(out[0].column).toBe(2);
        expect(out[0].message).toBe('Type mismatch: expected Int');
    });
});
