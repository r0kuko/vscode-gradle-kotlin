/**
 * Pure helpers used by the build-scan / build-cache UX.  We only inspect
 * Gradle stdout/stderr text so the module is trivially unit-testable.
 */

const SCAN_RE = /https?:\/\/(?:gradle\.com|scans\.gradle\.com)\/s\/[\w-]+/g;

/** Extract every Build Scan URL printed during a Gradle invocation. */
export function extractBuildScanUrls(output: string): string[] {
    const set = new Set<string>();
    for (const m of output.matchAll(SCAN_RE)) set.add(m[0]);
    return [...set];
}

/**
 * Parse the well-known Gradle build summary line, e.g.:
 *   `7 actionable tasks: 2 executed, 1 from cache, 4 up-to-date`
 * Returns the cache-hit percentage (0-100) or undefined when the
 * summary line is missing.
 */
export function buildCacheHitPercent(output: string): number | undefined {
    const m = /(\d+)\s+actionable tasks?:\s*([^\n]+)/.exec(output);
    if (!m) return undefined;
    const total = Number.parseInt(m[1], 10);
    if (!total) return undefined;
    const fromCache = /(\d+)\s+from cache/.exec(m[2]);
    if (!fromCache) return 0;
    return Math.round((Number.parseInt(fromCache[1], 10) / total) * 100);
}
