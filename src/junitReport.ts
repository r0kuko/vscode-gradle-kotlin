import * as fs from 'fs';
import * as path from 'path';

/**
 * Minimal JUnit-XML reader for Gradle's `build/test-results/<task>/*.xml`
 * output.  Pure; safe to import from tests.
 */
export type JUnitStatus = 'passed' | 'failed' | 'skipped' | 'errored';

export interface JUnitCaseResult {
    className: string;
    name: string;
    status: JUnitStatus;
    durationSec: number;
    /** Failure / error message when present. */
    message?: string;
}

/**
 * Recursively gather every JUnit XML report under the given Gradle
 * module's `build/test-results/<task>` folder.  Returns [] if the
 * folder doesn't exist (e.g. tests haven't been run yet).
 */
export function readJUnitReports(taskResultsDir: string): JUnitCaseResult[] {
    if (!fs.existsSync(taskResultsDir)) return [];
    const out: JUnitCaseResult[] = [];
    for (const entry of fs.readdirSync(taskResultsDir)) {
        if (!entry.endsWith('.xml')) continue;
        const file = path.join(taskResultsDir, entry);
        const text = safeRead(file);
        if (text === undefined) continue;
        out.push(...parseJUnitXml(text));
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

const TESTCASE_RE = /<testcase\b([^>]*?)(?:\s*\/>|>([\s\S]*?)<\/testcase>)/g;

/** Parse a JUnit-style report XML. Exported for tests. */
export function parseJUnitXml(xml: string): JUnitCaseResult[] {
    const out: JUnitCaseResult[] = [];
    TESTCASE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TESTCASE_RE.exec(xml)) !== null) {
        const attrs = parseAttrs(m[1]);
        const body = m[2] ?? '';
        const className = attrs.classname ?? attrs['class'] ?? '';
        const name = attrs.name ?? '';
        if (!name) continue;
        const durationSec = Number.parseFloat(attrs.time ?? '0') || 0;

        let status: JUnitStatus = 'passed';
        let message: string | undefined;
        if (/<skipped\b/.test(body)) {
            status = 'skipped';
        } else if (/<failure\b/.test(body)) {
            status = 'failed';
            message = extractMessage(body, 'failure');
        } else if (/<error\b/.test(body)) {
            status = 'errored';
            message = extractMessage(body, 'error');
        }
        out.push({ className, name, status, durationSec, message });
    }
    return out;
}

function parseAttrs(s: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) out[m[1]] = decodeXml(m[2]);
    return out;
}

function extractMessage(body: string, tag: 'failure' | 'error'): string | undefined {
    const re = new RegExp(`<${tag}\\b([^>]*?)(?:\\s*/>|>([\\s\\S]*?)</${tag}>)`);
    const m = re.exec(body);
    if (!m) return undefined;
    const attrs = parseAttrs(m[1]);
    if (attrs.message) return attrs.message;
    const inner = (m[2] ?? '').trim();
    return inner ? decodeXml(inner) : undefined;
}

function decodeXml(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#10;/g, '\n')
        .replace(/&amp;/g, '&');
}
