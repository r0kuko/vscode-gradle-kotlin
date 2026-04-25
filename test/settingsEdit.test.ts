import { describe, it, expect } from 'vitest';
import {
    insertIncludeLine,
    normalizeProjectPath,
    projectPathToRelativeDir,
} from '../src/settingsEdit';

describe('settingsEdit', () => {
    it('normalizes project paths', () => {
        expect(normalizeProjectPath('modules:featureA')).toBe(':modules:featureA');
        expect(normalizeProjectPath(':modules:featureA')).toBe(':modules:featureA');
        expect(normalizeProjectPath('')).toBeUndefined();
        expect(normalizeProjectPath('bad path')).toBeUndefined();
    });

    it('inserts include line after existing includes', () => {
        const text = [
            'rootProject.name = "demo"',
            'include(":app")',
            'include(":core")',
        ].join('\n');
        const out = insertIncludeLine(text, ':modules:featureA');
        expect(out).toContain('include(":modules:featureA")');
        expect(out.indexOf('include(":core")')).toBeLessThan(
            out.indexOf('include(":modules:featureA")')
        );
    });

    it('does not duplicate existing include', () => {
        const text = 'include(":app")\n';
        expect(insertIncludeLine(text, ':app')).toBe(text);
    });

    it('maps project path to relative directory', () => {
        expect(projectPathToRelativeDir(':modules:featureB')).toBe('modules/featureB');
    });
});
