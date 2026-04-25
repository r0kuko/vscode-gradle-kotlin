/**
 * Tiny wrapper around the Maven Central `solrsearch` API.  Pure-Node so
 * the completion / hover / dep-tree layers can call it without pulling
 * `vscode` in.  All results are lightly cached in-memory for the
 * lifetime of the process.
 */

const SEARCH_URL = 'https://search.maven.org/solrsearch/select';

export interface MavenArtifact {
    group: string;
    name: string;
    /** Latest stable version surfaced by the search index. */
    latestVersion: string;
    /** Best-effort coordinate (`group:name`). */
    coordinate: string;
}

export interface MavenVersionInfo {
    version: string;
    /** Bytes — `null` when the index doesn't expose it. */
    sizeBytes: number | null;
    /** Detected SPDX-ish license identifier, if any. */
    license?: string;
    /** Build time (epoch ms). */
    timestamp?: number;
}

const cacheArtifacts = new Map<string, MavenArtifact[]>();
const cacheVersions = new Map<string, MavenVersionInfo[]>();

/** Free-text search; returns up to `rows` GAV candidates. */
export async function searchArtifacts(query: string, rows = 30): Promise<MavenArtifact[]> {
    const key = `${query}::${rows}`;
    const hit = cacheArtifacts.get(key);
    if (hit) return hit;
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&rows=${rows}&wt=json`;
    const data = await fetchJson<{ response?: { docs?: SolrDoc[] } }>(url);
    const docs = data?.response?.docs ?? [];
    const out: MavenArtifact[] = docs
        .filter(d => d.g && d.a)
        .map(d => ({
            group: d.g,
            name: d.a,
            latestVersion: d.latestVersion ?? d.v ?? '',
            coordinate: `${d.g}:${d.a}`,
        }));
    cacheArtifacts.set(key, out);
    return out;
}

/** All versions for `group:name`, newest first. */
export async function listVersions(
    group: string,
    artifact: string,
    rows = 50
): Promise<MavenVersionInfo[]> {
    const key = `${group}:${artifact}::${rows}`;
    const hit = cacheVersions.get(key);
    if (hit) return hit;
    const q = `g:${group} AND a:${artifact}`;
    const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&core=gav&rows=${rows}&wt=json`;
    const data = await fetchJson<{ response?: { docs?: SolrDoc[] } }>(url);
    const docs = data?.response?.docs ?? [];
    const out: MavenVersionInfo[] = docs
        .filter(d => d.v)
        .map(d => ({
            version: d.v ?? '',
            sizeBytes: typeof d.size === 'number' ? d.size : null,
            timestamp: typeof d.timestamp === 'number' ? d.timestamp : undefined,
        }));
    cacheVersions.set(key, out);
    return out;
}

/**
 * Heuristically guess the GitHub `<owner>/<repo>` for a Maven coordinate
 * by matching against well-known group prefixes.  Returns `undefined`
 * when nothing fits — callers should then just link to the maven
 * central page.
 */
export function guessGitHubRepo(group: string, name: string): string | undefined {
    const known: Record<string, string> = {
        'org.jetbrains.kotlin': `JetBrains/kotlin`,
        'org.jetbrains.kotlinx': `Kotlin/${name}`,
        'com.squareup.okhttp3': `square/okhttp`,
        'com.squareup.retrofit2': `square/retrofit`,
        'com.squareup.moshi': `square/moshi`,
        'io.ktor': `ktorio/ktor`,
        'org.junit.jupiter': `junit-team/junit5`,
        'io.mockk': `mockk/mockk`,
        'androidx.compose.runtime': `androidx/androidx`,
    };
    if (known[group]) return known[group];
    if (group.startsWith('com.github.')) {
        return group.slice('com.github.'.length).replace(/\./g, '/') + '/' + name;
    }
    if (group.startsWith('io.github.')) {
        return group.slice('io.github.'.length).replace(/\./g, '/') + '/' + name;
    }
    return undefined;
}

interface SolrDoc {
    g: string;
    a: string;
    v?: string;
    latestVersion?: string;
    size?: number;
    timestamp?: number;
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
    try {
        const res = await fetch(url);
        if (!res.ok) return undefined;
        return (await res.json()) as T;
    } catch {
        return undefined;
    }
}

/** Test hook. */
export function _resetMavenCache(): void {
    cacheArtifacts.clear();
    cacheVersions.clear();
}
