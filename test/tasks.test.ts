import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    discoverModuleTasksStatically,
    parseTasksAllOutput,
    qualifyTask,
    findDependenciesBlock,
    findOwningModule,
} from '../src/tasks';
import { GradleModule } from '../src/gradle';

function tmpFile(name: string, contents: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-tasks-'));
    const p = path.join(dir, name);
    fs.writeFileSync(p, contents);
    return p;
}

const baseModule = (override: Partial<GradleModule> = {}): GradleModule => ({
    rootPath: '/r',
    projectPath: ':app',
    name: 'app',
    workspaceRoot: '/r',
    kotlinDsl: true,
    ...override,
});

describe('discoverModuleTasksStatically', () => {
    it('always includes the standard built-ins', () => {
        const tasks = discoverModuleTasksStatically(baseModule());
        const names = tasks.map(t => t.name);
        for (const must of ['build', 'assemble', 'clean', 'test', 'check', 'tasks', 'dependencies']) {
            expect(names).toContain(must);
        }
    });

    it('parses tasks.register/named from a Kotlin DSL build script', () => {
        const file = tmpFile(
            'build.gradle.kts',
            `tasks.register("integrationTest") { }\n` +
                `tasks.named<Jar>("jar") { }\n` +
                `tasks.create("customZip") { }\n`
        );
        const m = baseModule({ buildScript: file });
        const names = discoverModuleTasksStatically(m).map(t => t.name);
        expect(names).toContain('integrationTest');
        expect(names).toContain('jar');
        expect(names).toContain('customZip');
    });

    it('parses top-level task("foo") syntax', () => {
        const file = tmpFile('build.gradle.kts', `task("hello") { }\n`);
        const m = baseModule({ buildScript: file });
        const names = discoverModuleTasksStatically(m).map(t => t.name);
        expect(names).toContain('hello');
    });
});

describe('parseTasksAllOutput', () => {
    it('extracts tasks for the requested project path with descriptions', () => {
        const text = `
> Task :app:tasks

Build tasks
-----------
:app:assemble - Assembles the outputs of this project.
:app:build - Assembles and tests this project.
:app:clean - Deletes the build directory.

Verification tasks
------------------
:app:test - Runs the unit tests.

Other tasks
-----------
:other:foo - Should be filtered out.
`.trim();

        const tasks = parseTasksAllOutput(text, ':app');
        const names = tasks.map(t => t.name).sort();
        expect(names).toEqual(['assemble', 'build', 'clean', 'test']);
        const build = tasks.find(t => t.name === 'build')!;
        expect(build.description).toBe('Assembles and tests this project.');
        expect(build.group).toBe('build');
    });
});

describe('qualifyTask', () => {
    it('passes through already-qualified tasks', () => {
        expect(qualifyTask(':app', ':root:test')).toBe(':root:test');
    });
    it('prefixes with project path otherwise', () => {
        expect(qualifyTask(':app', 'test')).toBe(':app:test');
        expect(qualifyTask(':', 'build')).toBe(':build');
    });
});

describe('findDependenciesBlock', () => {
    it('returns the line of the dependencies opening brace', () => {
        const text = [
            'plugins { kotlin("jvm") }',
            '',
            'dependencies {',
            '    implementation("foo:bar:1.0")',
            '}',
        ].join('\n');
        expect(findDependenciesBlock(text)).toBe(2);
    });

    it('returns -1 when not found', () => {
        expect(findDependenciesBlock('plugins { }')).toBe(-1);
    });
});

describe('findOwningModule', () => {
    it('returns the deepest matching module', () => {
        const modules: GradleModule[] = [
            { projectPath: ':', name: 'root', rootPath: '/r', workspaceRoot: '/r', kotlinDsl: true },
            { projectPath: ':app', name: 'app', rootPath: '/r/app', workspaceRoot: '/r', kotlinDsl: true },
            { projectPath: ':app:nested', name: 'nested', rootPath: '/r/app/nested', workspaceRoot: '/r', kotlinDsl: true },
        ];
        expect(findOwningModule(modules, '/r/app/nested/src/main/kotlin/A.kt')?.projectPath).toBe(':app:nested');
        expect(findOwningModule(modules, '/r/app/build.gradle.kts')?.projectPath).toBe(':app');
        expect(findOwningModule(modules, '/r/README.md')?.projectPath).toBe(':');
        expect(findOwningModule(modules, '/elsewhere/file')).toBeUndefined();
    });
});
