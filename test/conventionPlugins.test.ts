import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findConventionPlugin, listConventionPlugins } from '../src/conventionPlugins';

function makeTree(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-'));
    const dir = path.join(root, 'build-logic', 'plugins', 'src', 'main', 'kotlin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'my.kotlin.library.gradle.kts'), 'plugins { }\n');
    fs.writeFileSync(path.join(dir, 'my.android.app.gradle.kts'), 'plugins { }\n');
    return root;
}

describe('findConventionPlugin', () => {
    it('locates a precompiled-script convention plugin under build-logic', () => {
        const root = makeTree();
        const file = findConventionPlugin(root, 'my.kotlin.library');
        expect(file).toBeDefined();
        expect(file).toContain('my.kotlin.library.gradle.kts');
    });

    it('returns undefined for unknown ids', () => {
        const root = makeTree();
        expect(findConventionPlugin(root, 'no.such.plugin')).toBeUndefined();
    });
});

describe('listConventionPlugins', () => {
    it('lists every convention plugin file', () => {
        const root = makeTree();
        const ids = listConventionPlugins(root).map(h => h.id).sort();
        expect(ids).toEqual(['my.android.app', 'my.kotlin.library']);
    });
});
