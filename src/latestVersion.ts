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
        const p = fetchLatestVersion(lib.group, lib.name).catch(() => undefined);
        this.cache.set(key, p);
        return p;
    }
}

export async function fetchLatestVersion(
    group: string,
    artifact: string
): Promise<string | undefined> {
    const groupPath = group.replace(/\./g, '/');
    const url = `${MAVEN_CENTRAL}/${groupPath}/${artifact}/maven-metadata.xml`;
    const xml = await fetchText(url, 4000);
    return parseLatestFromMetadata(xml);
}

export function parseLatestFromMetadata(xml: string): string | undefined {
    const latest = xml.match(/<latest>([^<]+)<\/latest>/)?.[1]?.trim();
    if (latest) return latest;
    const release = xml.match(/<release>([^<]+)<\/release>/)?.[1]?.trim();
    if (release) return release;

    const versions = Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g)).map(m =>
        m[1].trim()
    );
    return versions.length > 0 ? versions[versions.length - 1] : undefined;
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
