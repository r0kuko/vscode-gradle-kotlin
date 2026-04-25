import { describe, expect, it } from 'vitest';
import { lookupProperty, parsePropertyLine } from '../src/propertiesKeys';

describe('lookupProperty', () => {
    it('returns docs for known keys', () => {
        expect(lookupProperty('org.gradle.parallel')?.summary).toMatch(/parallel/i);
        expect(lookupProperty('android.useAndroidX')?.defaultValue).toBe('true');
    });

    it('returns undefined for unknown keys', () => {
        expect(lookupProperty('nonexistent.key')).toBeUndefined();
    });
});

describe('parsePropertyLine', () => {
    it('parses key=value', () => {
        expect(parsePropertyLine('org.gradle.parallel=true')).toEqual({
            key: 'org.gradle.parallel',
            value: 'true',
        });
    });

    it('skips comments and blanks', () => {
        expect(parsePropertyLine('# comment')).toBeUndefined();
        expect(parsePropertyLine('   ')).toBeUndefined();
    });

    it('rejects lines without an assignment', () => {
        expect(parsePropertyLine('justaword')).toBeUndefined();
    });
});

describe('jvmargs validator', () => {
    it('warns when -Xmx is missing', () => {
        const doc = lookupProperty('org.gradle.jvmargs')!;
        expect(doc.validate?.('-XX:+UseG1GC')).toMatch(/Xmx/);
        expect(doc.validate?.('-Xmx2g -XX:+UseG1GC')).toBeUndefined();
    });
});

describe('logging.level validator', () => {
    it('only accepts the documented enum values', () => {
        const doc = lookupProperty('org.gradle.logging.level')!;
        expect(doc.validate?.('debug')).toBeUndefined();
        expect(doc.validate?.('verbose')).toMatch(/Expected/);
    });
});
