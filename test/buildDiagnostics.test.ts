import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { parseGradleDiagnostics, normalizeFilePath } from '../src/buildDiagnostics';

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

    it('handles colon-separated message (modern Kotlin format)', () => {
        const out = parseGradleDiagnostics(
            "e: file:///ws/app/src/main/kotlin/Foo.kt:20:13: Unresolved reference: bar\n" +
            "w: file:///ws/app/src/main/kotlin/Foo.kt:21:1: Variable 'x' is never used\n"
        );
        expect(out).toEqual([
            {
                file: '/ws/app/src/main/kotlin/Foo.kt',
                line: 19,
                column: 12,
                severity: 'error',
                message: 'Unresolved reference: bar',
            },
            {
                file: '/ws/app/src/main/kotlin/Foo.kt',
                line: 20,
                column: 0,
                severity: 'warning',
                message: "Variable 'x' is never used",
            },
        ]);
    });

    it('handles legacy Kotlin 1.x bare-path format', () => {
        const out = parseGradleDiagnostics(
            "e: /ws/app/src/main/kotlin/Foo.kt: (15, 9): Unresolved reference: baz\n"
        );
        expect(out).toEqual([
            {
                file: '/ws/app/src/main/kotlin/Foo.kt',
                line: 14,
                column: 8,
                severity: 'error',
                message: 'Unresolved reference: baz',
            },
        ]);
    });

    it('does not duplicate legacy entry already covered by URI format', () => {
        // Both formats pointing to same file+line — only the URI one should survive.
        const out = parseGradleDiagnostics(
            "e: file:///ws/Foo.kt:10:5 error from URI\n" +
            "e: /ws/Foo.kt: (10, 5): error from bare path\n"
        );
        expect(out).toHaveLength(1);
        expect(out[0].message).toBe('error from URI');
    });

    it('extracts KSP processor errors with file and line references', () => {
        const out = parseGradleDiagnostics(
            'e: [ksp] C:/Users/Administrator/srv/cloudstack-server/modules/user/src/main/kotlin/ink/cloudstack/server/user/entity/UserAccount.kt:21: Illegal type "ink.cloudstack.server.user.entity.UserAccount", it is decorated by "@org.babyfish.jimmer.sql.Entity" but there is no id property\n'
        );
        expect(out).toEqual([
            {
                file: 'C:/Users/Administrator/srv/cloudstack-server/modules/user/src/main/kotlin/ink/cloudstack/server/user/entity/UserAccount.kt',
                line: 20,
                column: 0,
                severity: 'error',
                message: '[ksp] Illegal type "ink.cloudstack.server.user.entity.UserAccount", it is decorated by "@org.babyfish.jimmer.sql.Entity" but there is no id property',
            },
        ]);
    });
});

describe('normalizeFilePath', () => {
    it('returns absolute paths unchanged (Unix)', () => {
        const result = normalizeFilePath('/home/user/project/file.kt', '/home/user/project');
        expect(result).toBe(path.normalize('/home/user/project/file.kt'));
    });

    it('resolves relative paths against workspaceRoot', () => {
        const result = normalizeFilePath('app/src/Foo.kt', '/home/user/project');
        expect(result).toBe(path.normalize('/home/user/project/app/src/Foo.kt'));
    });

    it('strips leading slash from Windows drive paths (/C:/... → C:/...)', () => {
        const result = normalizeFilePath('/C:/Users/project/file.kt', 'C:/Users/project');
        expect(result).toBe(path.normalize('C:/Users/project/file.kt'));
    });
});
