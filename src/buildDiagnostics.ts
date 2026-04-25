/**
 * Pure parser for Gradle's "where" pointers in stderr.  We support the
 * formats Gradle actually emits when a build script fails to compile:
 *
 *   * Where: Build file '/abs/build.gradle.kts' line: 12
 *   * Where: Script '/abs/foo.gradle.kts' line: 4
 *   * Where: Settings file '/abs/settings.gradle.kts' line: 3
 *
 * And the Kotlin DSL compiler messages of the form:
 *
 *   e: file:///abs/build.gradle.kts:42:7 Unresolved reference: foo
 *   w: file:///abs/build.gradle.kts:42:7 ...
 *
 * Output is grouped by file so callers can populate a single
 * `vscode.DiagnosticCollection` per build.
 */

export type GradleDiagSeverity = 'error' | 'warning';

export interface GradleDiagnostic {
    file: string;
    /** 0-based line. */
    line: number;
    /** 0-based column. May be 0 when Gradle does not report one. */
    column: number;
    severity: GradleDiagSeverity;
    message: string;
}

const KOTLIN_RE = /\b([ew]):\s+file:\/\/([^\s:]+):(\d+):(\d+)\s+(.+)/g;
const WHERE_RE = /\*\s+Where:\s+(?:Build file|Settings file|Script)\s+'([^']+)'\s+line:\s+(\d+)/g;
const WHAT_RE = /\*\s+What went wrong:\s*(.+)/;

/**
 * Parse the combined stdout+stderr of a Gradle invocation into
 * structured diagnostics.  Unknown lines are ignored.
 */
export function parseGradleDiagnostics(combined: string): GradleDiagnostic[] {
    const out: GradleDiagnostic[] = [];

    let m: RegExpExecArray | null;
    KOTLIN_RE.lastIndex = 0;
    while ((m = KOTLIN_RE.exec(combined)) !== null) {
        const [, sev, file, line, col, msg] = m;
        out.push({
            file,
            line: Math.max(0, parseInt(line, 10) - 1),
            column: Math.max(0, parseInt(col, 10) - 1),
            severity: sev === 'e' ? 'error' : 'warning',
            message: msg.trim(),
        });
    }

    // For "* Where:" pointers we also want the matching "* What went wrong:"
    // message — Gradle prints them in pairs.
    const wrongMatch = WHAT_RE.exec(combined);
    const whatMessage = wrongMatch ? wrongMatch[1].trim() : 'Gradle build failed';

    WHERE_RE.lastIndex = 0;
    while ((m = WHERE_RE.exec(combined)) !== null) {
        const [, file, line] = m;
        // Skip if we already produced a more precise Kotlin diagnostic
        // for this file/line.
        const lineIdx = Math.max(0, parseInt(line, 10) - 1);
        if (out.some(d => d.file === file && d.line === lineIdx)) continue;
        out.push({
            file,
            line: lineIdx,
            column: 0,
            severity: 'error',
            message: whatMessage,
        });
    }

    return out;
}
