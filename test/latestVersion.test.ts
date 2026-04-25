import { describe, it, expect } from 'vitest';
import { parseLatestFromMetadata } from '../src/latestVersion';

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
});
