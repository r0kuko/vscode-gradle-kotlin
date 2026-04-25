import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverGradleModules, buildModuleTreeShape, resolveGradleCommand } from '../src/gradle';

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'gk-test-'));
}

function write(p: string, contents = ''): void {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contents);
}

describe('discoverGradleModules', () => {
    it('returns nothing when no build files exist', () => {
        const root = tmpdir();
        expect(discoverGradleModules(root)).toEqual([]);
    });

    it('discovers root + nested modules and skips build/.gradle', () => {
        const root = tmpdir();
        write(path.join(root, 'settings.gradle.kts'), 'rootProject.name = "x"');
        write(path.join(root, 'build.gradle.kts'));
        write(path.join(root, 'app', 'build.gradle.kts'));
        write(path.join(root, 'modules', 'core', 'build.gradle.kts'));
        write(path.join(root, 'modules', 'featureA', 'build.gradle.kts'));
        // Should be ignored.
        write(path.join(root, 'build', 'leftover', 'build.gradle.kts'));
        write(path.join(root, '.gradle', 'cache', 'build.gradle.kts'));

        const modules = discoverGradleModules(root);
        const paths = modules.map(m => m.projectPath).sort();
        expect(paths).toEqual([':', ':app', ':modules:core', ':modules:featureA']);
        for (const m of modules) {
            expect(m.kotlinDsl).toBe(true);
            expect(m.workspaceRoot).toBe(root);
            expect(m.buildScript).toBeTruthy();
        }
    });

    it('prefers build.gradle.kts over build.gradle in the same dir', () => {
        const root = tmpdir();
        write(path.join(root, 'build.gradle.kts'));
        write(path.join(root, 'build.gradle'));
        const m = discoverGradleModules(root)[0];
        expect(m.kotlinDsl).toBe(true);
        expect(m.buildScript?.endsWith('.kts')).toBe(true);
    });
});

describe('buildModuleTreeShape', () => {
    it('builds groups for intermediate path segments', () => {
        const shape = buildModuleTreeShape([
            { projectPath: ':', name: 'root', rootPath: '/r', workspaceRoot: '/r', kotlinDsl: true },
            { projectPath: ':app', name: 'app', rootPath: '/r/app', workspaceRoot: '/r', kotlinDsl: true },
            { projectPath: ':modules:featureA', name: 'modules:featureA', rootPath: '/r/m/a', workspaceRoot: '/r', kotlinDsl: true },
            { projectPath: ':modules:featureB', name: 'modules:featureB', rootPath: '/r/m/b', workspaceRoot: '/r', kotlinDsl: true },
        ]);
        expect(shape.isModule).toBe(true);
        const names = shape.children.map(c => c.name).sort();
        expect(names).toEqual(['app', 'modules']);
        const modules = shape.children.find(c => c.name === 'modules')!;
        expect(modules.isModule).toBe(false);
        expect(modules.children.map(c => c.name)).toEqual(['featureA', 'featureB']);
        expect(modules.children.every(c => c.isModule)).toBe(true);
    });
});

describe('resolveGradleCommand', () => {
    it('uses gradlew wrapper when present', () => {
        const root = tmpdir();
        const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
        write(path.join(root, wrapper));
        const r = resolveGradleCommand(root);
        if (process.platform === 'win32') {
            expect(r.command).toBe(path.join(root, wrapper));
        } else {
            expect(r.command).toBe('./gradlew');
        }
    });

    it('falls back to plain gradle when no wrapper', () => {
        const root = tmpdir();
        const r = resolveGradleCommand(root);
        expect(r.command).toBe('gradle');
    });

    it('honours an override', () => {
        const root = tmpdir();
        const r = resolveGradleCommand(root, '/opt/gradle/bin/gradle');
        expect(r.command).toBe('/opt/gradle/bin/gradle');
    });
});
