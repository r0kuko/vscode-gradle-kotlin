import { describe, expect, it } from 'vitest';
import {
    findDuplicateDependencies,
    findLiteralVersionDeps,
    findUnusedPlugins,
} from '../src/extraDiagnostics';

describe('findUnusedPlugins', () => {
    it('flags plugin ids that are never referenced again', () => {
        const out = findUnusedPlugins(
            'plugins {\n' +
                '    id("org.jetbrains.dokka")\n' +
                '    id("com.diffplug.spotless")\n' +
                '}\n' +
                'spotless {}\n'
        );
        // dokka is unused, spotless is referenced via spotless { } block.
        expect(out).toHaveLength(1);
        expect(out[0].message).toContain('org.jetbrains.dokka');
    });

    it('treats kotlin("jvm") as org.jetbrains.kotlin.jvm', () => {
        const out = findUnusedPlugins(
            'plugins { kotlin("jvm") }\n' +
                'kotlin {}\n'
        );
        expect(out).toEqual([]);
    });
});

describe('findDuplicateDependencies', () => {
    it('detects same group:name across different configurations', () => {
        const out = findDuplicateDependencies(
            'dependencies {\n' +
                '    implementation("a:b:1.0")\n' +
                '    api("a:b:1.0")\n' +
                '    testImplementation("c:d:2.0")\n' +
                '}\n'
        );
        expect(out).toHaveLength(2);
        expect(out[0].message).toContain("Duplicate dependency 'a:b'");
    });
});

describe('findLiteralVersionDeps', () => {
    it('returns inline GAV triples for the move-to-catalog refactor', () => {
        const out = findLiteralVersionDeps(
            'dependencies {\n    implementation("io.ktor:ktor-server-core:2.3.10")\n}\n'
        );
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            group: 'io.ktor',
            name: 'ktor-server-core',
            version: '2.3.10',
        });
    });

    it('skips short-form coordinates without a version triple', () => {
        const out = findLiteralVersionDeps(
            'dependencies { implementation("io.ktor:ktor-server-core") }\n'
        );
        expect(out).toEqual([]);
    });
});
