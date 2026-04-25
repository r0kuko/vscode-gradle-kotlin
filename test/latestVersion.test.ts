import { describe, it, expect } from 'vitest';
import { isPrerelease, parseLatestFromMetadata } from '../src/latestVersion';

describe('parseLatestFromMetadata', () => {
    it('prefers <latest>', () => {
        const xml = '<metadata><versioning><latest>1.5.2</latest><release>1.5.1</release></versioning></metadata>';
        expect(parseLatestFromMetadata(xml)).toBe('1.5.2');
    });

    it('falls back to <release>', () => {
        const xml = '<metadata><versioning><release>2.0.0</release></versioning></metadata>';
        expect(parseLatestFromMetadata(xml)).toBe('2.0.0');
    });

    it('falls back to last <version>', () => {
        const xml = '<version>0.9.0</version><version>1.0.0</version>';
        expect(parseLatestFromMetadata(xml)).toBe('1.0.0');
    });

    it('skips prerelease <latest> when allowPrerelease=false', () => {
        const xml =
            '<metadata><versioning><latest>2.0.0-RC1</latest>' +
            '<versions><version>1.9.0</version><version>2.0.0-RC1</version></versions>' +
            '</versioning></metadata>';
        expect(parseLatestFromMetadata(xml)).toBe('1.9.0');
    });

    it('returns the prerelease when explicitly allowed', () => {
        const xml = '<metadata><versioning><latest>2.0.0-RC1</latest></versioning></metadata>';
        expect(parseLatestFromMetadata(xml, true)).toBe('2.0.0-RC1');
    });
});

describe('isPrerelease', () => {
    it.each([
        ['1.0.0-alpha01', true],
        ['1.0.0-Beta', true],
        ['2.0.0-RC1', true],
        ['1.0.0-SNAPSHOT', true],
        ['1.0.0-eap-3', true],
        ['1.5.2', false],
        ['1.0', false],
    ])('classifies %s', (v, expected) => {
        expect(isPrerelease(v)).toBe(expected);
    });
});
