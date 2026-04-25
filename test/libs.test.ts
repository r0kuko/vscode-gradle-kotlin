import { describe, it, expect } from 'vitest';
import {
    parseCatalog,
    libsRefToAlias,
    aliasToLibsRef,
    resolveLibsRef,
    findLibsReferences,
} from '../src/libs';

const TOML = `
[versions]
kotlin = "2.0.21"
coroutines = "1.9.0"
junit = "5.11.3"

[libraries]
kotlinx-coroutines-core = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-core", version.ref = "coroutines" }
guava = { module = "com.google.guava:guava", version = "33.3.1-jre" }
shorthand = "io.ktor:ktor-client-core:3.0.1"
junit-jupiter = { group = "org.junit.jupiter", name = "junit-jupiter", version.ref = "junit" }

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }

[bundles]
testing = ["junit-jupiter", "kotlinx-coroutines-core"]
`;

describe('parseCatalog', () => {
    const cat = parseCatalog(TOML);

    it('parses versions', () => {
        expect(cat.versions.get('kotlin')).toBe('2.0.21');
        expect(cat.versions.get('coroutines')).toBe('1.9.0');
    });

    it('parses libraries with version.ref', () => {
        const lib = cat.libraries.get('kotlinx-coroutines-core')!;
        expect(lib.coordinate).toBe('org.jetbrains.kotlinx:kotlinx-coroutines-core');
        expect(lib.versionRef).toBe('coroutines');
        expect(lib.version).toBe('1.9.0');
    });

    it('parses libraries with inline version', () => {
        const lib = cat.libraries.get('guava')!;
        expect(lib.coordinate).toBe('com.google.guava:guava');
        expect(lib.version).toBe('33.3.1-jre');
    });

    it('parses shorthand "g:n:v" libraries', () => {
        const lib = cat.libraries.get('shorthand')!;
        expect(lib.coordinate).toBe('io.ktor:ktor-client-core');
        expect(lib.version).toBe('3.0.1');
    });

    it('parses plugins with version.ref', () => {
        const pl = cat.plugins.get('kotlin-jvm')!;
        expect(pl.id).toBe('org.jetbrains.kotlin.jvm');
        expect(pl.version).toBe('2.0.21');
    });

    it('parses bundles', () => {
        expect(cat.bundles.get('testing')).toEqual(['junit-jupiter', 'kotlinx-coroutines-core']);
    });
});

describe('alias <-> libs ref conversion', () => {
    it('round-trips simple aliases', () => {
        expect(libsRefToAlias('libs.kotlinx.coroutines.core')).toBe('kotlinx-coroutines-core');
        expect(aliasToLibsRef('kotlinx-coroutines-core')).toBe('libs.kotlinx.coroutines.core');
    });
});

describe('resolveLibsRef', () => {
    const cat = parseCatalog(TOML);

    it('resolves a library reference to its version', () => {
        const r = resolveLibsRef(cat, 'libs.kotlinx.coroutines.core')!;
        expect(r.kind).toBe('library');
        expect(r.inlayLabel).toBe('1.9.0');
    });

    it('resolves a plugin via libs.plugins.x', () => {
        const r = resolveLibsRef(cat, 'libs.plugins.kotlin.jvm')!;
        expect(r.kind).toBe('plugin');
        expect(r.inlayLabel).toContain('org.jetbrains.kotlin.jvm');
        expect(r.inlayLabel).toContain('2.0.21');
    });

    it('resolves a bundle via libs.bundles.x', () => {
        const r = resolveLibsRef(cat, 'libs.bundles.testing')!;
        expect(r.kind).toBe('bundle');
        expect(r.inlayLabel).toBe('bundle(2)');
    });

    it('resolves a version via libs.versions.x', () => {
        const r = resolveLibsRef(cat, 'libs.versions.kotlin')!;
        expect(r.kind).toBe('version');
        expect(r.inlayLabel).toBe('2.0.21');
    });

    it('returns undefined for unknown refs', () => {
        expect(resolveLibsRef(cat, 'libs.unknown.thing')).toBeUndefined();
    });
});

describe('findLibsReferences', () => {
    it('locates references with line + character offsets', () => {
        const text = [
            'dependencies {',
            '    implementation(libs.kotlinx.coroutines.core)',
            '    testImplementation(libs.junit.jupiter)',
            '}',
        ].join('\n');
        const refs = findLibsReferences(text);
        expect(refs).toHaveLength(2);
        expect(refs[0].ref).toBe('libs.kotlinx.coroutines.core');
        expect(refs[0].line).toBe(1);
        expect(refs[0].character).toBe(text.split('\n')[1].indexOf('libs.'));
        expect(refs[1].ref).toBe('libs.junit.jupiter');
    });

    it('does not match identifiers ending in libs', () => {
        // "mylibs.foo" should NOT match — \blibs\. requires a word boundary just before `libs`.
        const refs = findLibsReferences('val x = mylibs.foo');
        expect(refs).toHaveLength(0);
    });
});
