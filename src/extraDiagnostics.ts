/**
 * Pure analyzers for ad-hoc build-script diagnostics that don't come
 * from Gradle itself: unused plugin ids and duplicated dependency
 * coordinates within a single build file.
 */

export interface ExtraDiagnostic {
    /** 0-based line. */
    line: number;
    /** 0-based column. */
    column: number;
    /** Length of the highlighted text. */
    length: number;
    severity: 'warning' | 'hint';
    /** Marks the diagnostic as "Unnecessary" so VS Code grays it out. */
    unused?: boolean;
    message: string;
}

const PLUGIN_BLOCK_RE = /^\s*plugins\s*\{/;

/**
 * Detect `id("foo.bar")` / `kotlin("jvm")` / `alias(libs.plugins.foo)`
 * declarations inside `plugins {}` whose plugin id is never referenced
 * elsewhere in the file (e.g. via `apply(plugin = ...)`, conventions,
 * etc).  This is intentionally a heuristic — Gradle DSL is too dynamic
 * to be 100% accurate — so emissions are `hint` severity.
 */
export function findUnusedPlugins(text: string): ExtraDiagnostic[] {
    const lines = text.split(/\r?\n/);
    const out: ExtraDiagnostic[] = [];

    let inBlock = false;
    let depth = 0;
    const declarations: { line: number; column: number; length: number; id: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (!inBlock && PLUGIN_BLOCK_RE.test(raw)) {
            inBlock = true;
            depth = 0;
        }
        if (!inBlock) continue;
        for (const ch of raw) {
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    inBlock = false;
                    break;
                }
            }
        }
        if (!inBlock) continue;

        const idMatch = /\bid\s*\(\s*["']([\w.-]+)["']\s*\)/.exec(raw);
        if (idMatch) {
            declarations.push({
                line: i,
                column: idMatch.index,
                length: idMatch[0].length,
                id: idMatch[1],
            });
            continue;
        }
        const kotlinMatch = /\bkotlin\s*\(\s*["']([\w.-]+)["']\s*\)/.exec(raw);
        if (kotlinMatch) {
            declarations.push({
                line: i,
                column: kotlinMatch.index,
                length: kotlinMatch[0].length,
                id: 'org.jetbrains.kotlin.' + kotlinMatch[1],
            });
        }
    }

    for (const d of declarations) {
        if (isPluginReferenced(text, d.id, d.line)) continue;
        out.push({
            line: d.line,
            column: d.column,
            length: d.length,
            severity: 'hint',
            unused: true,
            message: `Plugin '${d.id}' appears unused in this file.`,
        });
    }
    return out;
}

function isPluginReferenced(text: string, id: string, declLine: number): boolean {
    const lines = text.split(/\r?\n/);
    const shortId = id.startsWith('org.jetbrains.kotlin.')
        ? id.slice('org.jetbrains.kotlin.'.length)
        : undefined;
    const tail = id.split('.').pop() ?? id;
    for (let i = 0; i < lines.length; i++) {
        if (i === declLine) continue;
        const line = lines[i];
        if (line.includes(`"${id}"`) || line.includes(`'${id}'`)) return true;
        // Common typed extension blocks created by well-known plugins.
        if (id === 'application' && /\bapplication\s*\{/.test(line)) return true;
        if (id === 'java-library' && /\bjava\s*\{/.test(line)) return true;
        if (id.startsWith('com.android') && /\bandroid\s*\{/.test(line)) return true;
        if (shortId && new RegExp(`\\b${shortId}\\s*\\{`).test(line)) return true;
        if (id === 'org.jetbrains.dokka' && /\bdokka/.test(line)) return true;
        if (id === 'maven-publish' && /\bpublishing\s*\{/.test(line)) return true;
        if (id === 'signing' && /\bsigning\s*\{/.test(line)) return true;
        if (tail.length >= 3 && new RegExp(`\\b${tail}\\b`).test(line)) return true;
    }
    return false;
}

const DEP_LINE_RE =
    /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|androidTestImplementation|kapt|ksp)\s*\(\s*["']([^"']+)["']\s*\)/;

/**
 * Find duplicated `<config>("group:name:...")` declarations within the
 * same build file.  Two declarations are duplicates when their
 * `group:name` matches (configuration may differ).
 */
export function findDuplicateDependencies(text: string): ExtraDiagnostic[] {
    const lines = text.split(/\r?\n/);
    const seen = new Map<string, { line: number; column: number; length: number; config: string }[]>();

    for (let i = 0; i < lines.length; i++) {
        const m = DEP_LINE_RE.exec(lines[i]);
        if (!m) continue;
        const coordinate = m[2];
        const parts = coordinate.split(':');
        if (parts.length < 2) continue;
        const key = `${parts[0]}:${parts[1]}`;
        const list = seen.get(key) ?? [];
        list.push({ line: i, column: m.index, length: m[0].length, config: m[1] });
        seen.set(key, list);
    }

    const out: ExtraDiagnostic[] = [];
    for (const [key, hits] of seen) {
        if (hits.length < 2) continue;
        for (const h of hits) {
            out.push({
                line: h.line,
                column: h.column,
                length: h.length,
                severity: 'warning',
                message: `Duplicate dependency '${key}' (also declared at line ${
                    hits.filter(x => x !== h).map(x => x.line + 1).join(', ')
                }).`,
            });
        }
    }
    return out;
}

/**
 * Inline literal version detector — finds `<config>("g:n:v")` strings
 * with an explicit version triple, used by the "Move to libs.versions.toml"
 * code action to know where to act.
 */
export function findLiteralVersionDeps(text: string): {
    line: number;
    column: number;
    length: number;
    coordinate: string;
    group: string;
    name: string;
    version: string;
}[] {
    const lines = text.split(/\r?\n/);
    const out: ReturnType<typeof findLiteralVersionDeps> = [];
    for (let i = 0; i < lines.length; i++) {
        const m = DEP_LINE_RE.exec(lines[i]);
        if (!m) continue;
        const parts = m[2].split(':');
        if (parts.length !== 3) continue;
        out.push({
            line: i,
            column: m.index,
            length: m[0].length,
            coordinate: m[2],
            group: parts[0],
            name: parts[1],
            version: parts[2],
        });
    }
    return out;
}
