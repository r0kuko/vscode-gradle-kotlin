import { describe, expect, it } from 'vitest';
import {
    appendCatalogEntry,
    nextConfiguration,
    suggestCatalogAlias,
} from '../src/catalogRefactor';

describe('nextConfiguration', () => {
    it('cycles through the main configurations', () => {
        expect(nextConfiguration('implementation')).toBe('api');
        expect(nextConfiguration('api')).toBe('compileOnly');
        expect(nextConfiguration('compileOnly')).toBe('runtimeOnly');
        expect(nextConfiguration('runtimeOnly')).toBe('implementation');
    });

    it('cycles independently within the test configurations', () => {
        expect(nextConfiguration('testImplementation')).toBe('testRuntimeOnly');
    });

    it('passes unknown configurations through untouched', () => {
        expect(nextConfiguration('androidTestImplementation')).toBe('androidTestImplementation');
    });
});

describe('suggestCatalogAlias', () => {
    it('builds dash-joined aliases from group + name', () => {
        const { versionAlias, libraryAlias } = suggestCatalogAlias('io.ktor', 'ktor-server-core');
        expect(libraryAlias).toBe('ktor-ktor-server-core');
        expect(versionAlias).toBe('ktor-ktor');
    });
});

describe('appendCatalogEntry', () => {
    it('adds matching [versions] + [libraries] entries to an empty catalog', () => {
        const { newText, reference } = appendCatalogEntry('', {
            group: 'io.ktor',
            name: 'ktor-server-core',
            version: '2.3.10',
        });
        expect(newText).toContain('ktor-ktor = "2.3.10"');
        expect(newText).toContain('group = "io.ktor"');
        expect(reference).toBe('libs.ktor.ktor.server.core');
    });

    it('appends to existing sections in place', () => {
        const start =
            '[versions]\nfoo = "1.0"\n\n[libraries]\nfoo = { module = "x:y", version.ref = "foo" }\n';
        const { newText } = appendCatalogEntry(start, {
            group: 'io.ktor',
            name: 'ktor-core',
            version: '2.3.10',
        });
        expect(newText.match(/\[versions\]/g)?.length).toBe(1);
        expect(newText.match(/\[libraries\]/g)?.length).toBe(1);
        expect(newText).toContain('foo = "1.0"');
        expect(newText).toContain('ktor-ktor = "2.3.10"');
    });
});
