/**
 * Pure parser for Gradle's "where" pointers in stderr.  We support the
 * formats Gradle actually emits when a build script fails to compile:
 *
 *   * Where: Build file '/abs/build.gradle.kts' line: 12
 *   * Where: Script '/abs/foo.gradle.kts' line: 4
 *   * Where: Settings file '/abs/settings.gradle.kts' line: 3
 *
 * And the Kotlin compiler messages — two variants:
 *
 *   Modern (space-separated or colon-separated after column):
 *     e: file:///abs/File.kt:42:7 Unresolved reference: foo
 *     e: file:///abs/File.kt:42:7: Unresolved reference: foo
 *     e: file:///C:/abs/File.kt:42:7: Unresolved reference: foo   (Windows)
 *
 *   Legacy Kotlin 1.x (bare path, parenthesised position):
 *     e: /abs/File.kt: (42, 7): Unresolved reference: foo
 *     w: /abs/File.kt: (42, 7): Variable 'x' is never used
 *
 * Output is grouped by file so callers can populate a single
 * `vscode.DiagnosticCollection` per build.
 */

import * as path from 'path';

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

/**
 * Normalise a file path from a Gradle/Kotlin diagnostic to an absolute
 * OS path, resolving relative paths against `workspaceRoot`.
 *
 * Handles:
 *  - Windows `file:///C:/...` URI → `/C:/...` captured by regex → `C:/...`
 *  - Backslash/forward-slash mixing on Windows
 *  - Relative paths → resolved against workspaceRoot
 */
export function normalizeFilePath(file: string, workspaceRoot: string): string {
    // Strip leading `/` from Windows drive paths (/C:/... → C:/...)
    if (/^\/[A-Za-z]:[\\/]/.test(file)) {
        file = file.slice(1);
    }
    // A Windows absolute path (C:\... or C:/...) is absolute on any host.
    const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(file);
    if (!isWindowsAbsolute && !path.isAbsolute(file)) {
        file = path.resolve(workspaceRoot, file);
    }
    return path.normalize(file);
}

// Modern Kotlin: `e: file:///abs/path:line:col[:]? message`
// The `file://` prefix means the next char is `/` (Unix) or `/C:/` (Windows).
const KOTLIN_URI_RE = /\b([ew]):\s+file:\/\/([^\s:]+):(\d+):(\d+):?\s+(.+)/g;

// Legacy Kotlin 1.x: `e: /abs/path: (line, col): message`
const KOTLIN_PATH_RE = /\b([ew]):\s+((?:[A-Za-z]:[\\/]|\/)\S+\.(kt|kts)):\s*\((\d+),\s*(\d+)\):?\s+(.+)/g;

const WHERE_RE = /\*\s+Where:\s+(?:Build file|Settings file|Script)\s+'([^']+)'\s+line:\s+(\d+)/g;
const WHAT_RE = /\*\s+What went wrong:\s*(.+)/;

/**
 * Parse the combined stdout+stderr of a Gradle invocation into
 * structured diagnostics.  Unknown lines are ignored.
 */
export function parseGradleDiagnostics(combined: string): GradleDiagnostic[] {
    const out: GradleDiagnostic[] = [];

    let m: RegExpExecArray | null;
    KOTLIN_URI_RE.lastIndex = 0;
    while ((m = KOTLIN_URI_RE.exec(combined)) !== null) {
        const [, sev, file, line, col, msg] = m;
        out.push({
            file,
            line: Math.max(0, parseInt(line, 10) - 1),
            column: Math.max(0, parseInt(col, 10) - 1),
            severity: sev === 'e' ? 'error' : 'warning',
            message: msg.trim(),
        });
    }

    // Legacy Kotlin 1.x bare-path format: `e: /abs/File.kt: (42, 7): message`
    KOTLIN_PATH_RE.lastIndex = 0;
    while ((m = KOTLIN_PATH_RE.exec(combined)) !== null) {
        const [, sev, file, , line, col, msg] = m;
        const lineIdx = Math.max(0, parseInt(line, 10) - 1);
        const colIdx = Math.max(0, parseInt(col, 10) - 1);
        // Skip if already covered by KOTLIN_URI_RE (same file+line)
        if (out.some(d => d.file === file && d.line === lineIdx)) continue;
        out.push({
            file,
            line: lineIdx,
            column: colIdx,
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
