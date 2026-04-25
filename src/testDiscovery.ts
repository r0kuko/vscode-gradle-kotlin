import * as fs from 'fs';
import * as path from 'path';

/**
 * Lightweight Kotlin test discovery — scans `src/test/**` for classes
 * containing `@Test` annotations (JUnit4 / JUnit5 / kotlinx.test).
 *
 * We do NOT try to be a Kotlin parser; for the sidebar / test-explorer
 * UX a regex pass is enough. Anything we miss can still be run via the
 * `--tests` filter or the plain "Run task" button.
 */
export interface DiscoveredTestMethod {
    name: string;
    /** 0-based line offset in the source file. */
    line: number;
}

export interface DiscoveredTestClass {
    /** Fully-qualified class name, e.g. `com.example.FooTest`. */
    fqcn: string;
    /** Simple class name. */
    simpleName: string;
    /** Package name (may be empty for default package). */
    packageName: string;
    /** Absolute path to the .kt source file. */
    file: string;
    /** 0-based line of the class declaration. */
    line: number;
    methods: DiscoveredTestMethod[];
}

const TEST_ANNOTATION_RE = /@(?:org\.junit(?:\.jupiter\.api)?\.)?Test\b/;

/**
 * Recursively scan `srcTestRoot` for `*.kt` files and extract test
 * classes + methods. Returns an empty array when the directory does
 * not exist.
 */
export function discoverTestsInRoot(srcTestRoot: string): DiscoveredTestClass[] {
    if (!fs.existsSync(srcTestRoot)) return [];
    const out: DiscoveredTestClass[] = [];
    const stack: string[] = [srcTestRoot];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                stack.push(p);
            } else if (e.isFile() && p.endsWith('.kt')) {
                const text = safeRead(p);
                if (text === undefined) continue;
                out.push(...parseKotlinTestFile(p, text));
            }
        }
    }
    return out;
}

function safeRead(file: string): string | undefined {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
}

/**
 * Pure parser, exported for unit tests.  Extracts every class that has
 * at least one `@Test`-annotated method and lists those methods.
 */
export function parseKotlinTestFile(file: string, text: string): DiscoveredTestClass[] {
    const lines = text.split(/\r?\n/);
    let pkg = '';
    const classes: Array<{ name: string; line: number; bodyStart: number; bodyEnd: number }> = [];

    // package + class boundaries
    let depth = 0;
    let currentClassIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();
        if (line.startsWith('package ')) {
            pkg = line.replace(/^package\s+/, '').replace(/[;{].*$/, '').trim();
        }
        const classMatch = /^(?:internal\s+|public\s+|open\s+|abstract\s+|sealed\s+|data\s+)*class\s+([A-Z][\w]*)/.exec(
            line
        );
        if (classMatch && depth === 0) {
            classes.push({ name: classMatch[1], line: i, bodyStart: i, bodyEnd: lines.length });
            currentClassIdx = classes.length - 1;
        }
        // very rough brace depth tracking; comments / strings ignored on purpose
        for (const ch of raw) {
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0 && currentClassIdx >= 0) {
                    classes[currentClassIdx].bodyEnd = i;
                    currentClassIdx = -1;
                }
            }
        }
    }

    if (classes.length === 0) return [];

    // collect @Test methods inside each class
    const out: DiscoveredTestClass[] = [];
    for (const c of classes) {
        const methods: DiscoveredTestMethod[] = [];
        for (let i = c.bodyStart; i <= c.bodyEnd && i < lines.length; i++) {
            if (!TEST_ANNOTATION_RE.test(lines[i])) continue;
            // walk forward (including same line) to the next `fun <name>(`
            for (let j = i; j < Math.min(i + 8, lines.length); j++) {
                const fn = /\bfun\s+(?:`([^`]+)`|([A-Za-z_][\w]*))\s*\(/.exec(lines[j]);
                if (fn) {
                    methods.push({ name: fn[1] ?? fn[2], line: j });
                    break;
                }
            }
        }
        if (methods.length === 0) continue;
        out.push({
            fqcn: pkg ? `${pkg}.${c.name}` : c.name,
            simpleName: c.name,
            packageName: pkg,
            file,
            line: c.line,
            methods,
        });
    }
    return out;
}
