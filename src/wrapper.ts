/**
 * Pure helpers around `gradle/wrapper/gradle-wrapper.properties` so the
 * CodeLens layer can compare the pinned Gradle version with the latest
 * upstream release without depending on `vscode`.
 */

export interface ParsedDistribution {
    /** Raw distributionUrl property as it appears in the file. */
    url: string;
    /** Pinned Gradle version (e.g. "8.10.2") parsed from the URL. */
    version: string;
    /** "bin" or "all" depending on the URL flavour. */
    flavor: 'bin' | 'all';
}

const URL_RE = /^\s*distributionUrl\s*=\s*(.+?)\s*$/m;
const VERSION_RE = /gradle-(\d+(?:\.\d+){1,2})-(bin|all)\.zip/;

export function parseWrapperProperties(text: string): ParsedDistribution | undefined {
    const m = URL_RE.exec(text);
    if (!m) return undefined;
    // Properties files allow `\:` — restore it.
    const url = m[1].replace(/\\:/g, ':').replace(/\\=/g, '=').trim();
    const v = VERSION_RE.exec(url);
    if (!v) return undefined;
    return { url, version: v[1], flavor: v[2] as 'bin' | 'all' };
}

/**
 * Build a fresh distributionUrl pointing at `nextVersion` while keeping
 * the existing flavor (bin/all).
 */
export function distributionUrlFor(nextVersion: string, flavor: 'bin' | 'all'): string {
    return `https://services.gradle.org/distributions/gradle-${nextVersion}-${flavor}.zip`;
}

/**
 * Replace the distributionUrl line in the original wrapper-properties
 * text in-place so we don't drop other properties or comments.
 */
export function rewriteDistributionUrl(text: string, url: string): string {
    if (!URL_RE.test(text)) return text;
    // Properties: backslash-escape the colons.
    const escaped = url.replace(/:/g, '\\:');
    return text.replace(URL_RE, `distributionUrl=${escaped}`);
}

/** Numerical "is `a` strictly newer than `b`" — returns 0/1/-1. */
export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(n => parseInt(n, 10));
    const pb = b.split('.').map(n => parseInt(n, 10));
    const max = Math.max(pa.length, pb.length);
    for (let i = 0; i < max; i++) {
        const ai = pa[i] ?? 0;
        const bi = pb[i] ?? 0;
        if (ai !== bi) return ai > bi ? 1 : -1;
    }
    return 0;
}
