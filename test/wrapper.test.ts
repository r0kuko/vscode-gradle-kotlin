import { describe, expect, it } from 'vitest';
import {
    compareVersions,
    distributionUrlFor,
    parseWrapperProperties,
    rewriteDistributionUrl,
} from '../src/wrapper';

const SAMPLE = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;

describe('parseWrapperProperties', () => {
    it('parses version + flavor from distributionUrl', () => {
        const p = parseWrapperProperties(SAMPLE);
        expect(p?.version).toBe('8.10.2');
        expect(p?.flavor).toBe('bin');
        expect(p?.url).toBe('https://services.gradle.org/distributions/gradle-8.10.2-bin.zip');
    });

    it('returns undefined when distributionUrl is missing', () => {
        expect(parseWrapperProperties('foo=bar')).toBeUndefined();
    });
});

describe('rewriteDistributionUrl', () => {
    it('keeps surrounding properties intact and escapes colons', () => {
        const out = rewriteDistributionUrl(
            SAMPLE,
            distributionUrlFor('8.11', 'bin')
        );
        expect(out).toContain('distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11-bin.zip');
        expect(out).toContain('zipStorePath=wrapper/dists');
    });
});

describe('compareVersions', () => {
    it('compares semver-ish triples', () => {
        expect(compareVersions('8.11', '8.10.2')).toBe(1);
        expect(compareVersions('8.10.2', '8.10.2')).toBe(0);
        expect(compareVersions('8.10.1', '8.10.2')).toBe(-1);
        expect(compareVersions('8.10', '8.10.0')).toBe(0);
    });
});
