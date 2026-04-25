import { describe, expect, it } from 'vitest';
import { buildCacheHitPercent, extractBuildScanUrls } from '../src/buildScan';

describe('extractBuildScanUrls', () => {
    it('finds the canonical scans URL', () => {
        const out = 'Publishing build scan...\nhttps://gradle.com/s/abcd1234\nDone.';
        expect(extractBuildScanUrls(out)).toEqual(['https://gradle.com/s/abcd1234']);
    });

    it('deduplicates repeated URLs', () => {
        const out = 'https://gradle.com/s/aa https://gradle.com/s/aa';
        expect(extractBuildScanUrls(out)).toEqual(['https://gradle.com/s/aa']);
    });

    it('returns [] when no scan was published', () => {
        expect(extractBuildScanUrls('BUILD SUCCESSFUL')).toEqual([]);
    });
});

describe('buildCacheHitPercent', () => {
    it('computes from cache / total', () => {
        const summary = '7 actionable tasks: 2 executed, 1 from cache, 4 up-to-date';
        expect(buildCacheHitPercent(summary)).toBe(14); // 1/7 ≈ 14%
    });

    it('returns 0 when nothing came from cache', () => {
        expect(buildCacheHitPercent('5 actionable tasks: 5 executed')).toBe(0);
    });

    it('returns undefined when no summary line is present', () => {
        expect(buildCacheHitPercent('boring output')).toBeUndefined();
    });
});
