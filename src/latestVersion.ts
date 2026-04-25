import * as https from 'https';
import { LibraryEntry } from './libs';

const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2';

/**
 * Resolves latest versions from Maven Central with in-memory caching.
 */
export class LatestVersionResolver {
    private cache = new Map<string, Promise<string | undefined>>();

    latestForLibrary(lib: LibraryEntry): Promise<string | undefined> {
        const key = `${lib.group}:${lib.name}`;
        const existing = this.cache.get(key);
        if (existing) return existing;
        const allowPrerelease = !!lib.version && isPrerelease(lib.version);
        const p = fetchLatestVersion(lib.group, lib.name, allowPrerelease).catch(
            () => undefined
        );
        this.cache.set(key, p);
        return p;
    }

    /** Drop the in-memory cache so the next inlay-hint pass re-fetches. */
    clearCache(): void {
        this.cache.clear();
    }
}

export async function fetchLatestVersion(
    group: string,
    artifact: string,
    allowPrerelease = false
): Promise<string | undefined> {
    const groupPath = group.replace(/\./g, '/');
    const url = `${MAVEN_CENTRAL}/${groupPath}/${artifact}/maven-metadata.xml`;
    const xml = await fetchText(url, 4000);
    return parseLatestFromMetadata(xml, allowPrerelease);
}

/**
 * Heuristic: anything containing a `-` followed by alpha/beta/rc/m/snapshot,
 * `+`, or a non-numeric suffix is treated as a prerelease.
 */
export function isPrerelease(version: string): boolean {
    return /-(?:alpha|beta|rc|m|snapshot|preview|dev|eap)(?:[\d._-]|$)/i.test(version) ||
        /\bSNAPSHOT$/i.test(version);
}

export function parseLatestFromMetadata(
    xml: string,
    allowPrerelease = false
): string | undefined {
    const candidates: string[] = [];
    const latest = xml.match(/<latest>([^<]+)<\/latest>/)?.[1]?.trim();
    if (latest) candidates.push(latest);
    const release = xml.match(/<release>([^<]+)<\/release>/)?.[1]?.trim();
    if (release) candidates.push(release);
    const versions = Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g)).map(m =>
        m[1].trim()
    );

    if (allowPrerelease) {
        return candidates[0] ?? versions[versions.length - 1];
    }

    for (const c of candidates) {
        if (!isPrerelease(c)) return c;
    }
    for (let i = versions.length - 1; i >= 0; i--) {
        if (!isPrerelease(versions[i])) return versions[i];
    }
    // Nothing stable available — fall back so we at least surface something.
    return candidates[0] ?? versions[versions.length - 1];
}

function fetchText(url: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, res => {
            if ((res.statusCode ?? 500) >= 400) {
                reject(new Error(`HTTP ${res.statusCode}`));
                res.resume();
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => (body += chunk));
            res.on('end', () => resolve(body));
        });
        req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}
