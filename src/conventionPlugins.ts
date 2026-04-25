/**
 * Helpers for "convention plugin" cross-navigation: build files use
 *   `id("my.kotlin.library")`
 * and the implementing source lives at
 *   `build-logic/src/main/kotlin/my.kotlin.library.gradle.kts`
 * (or `buildSrc/...`).  Pure-Node so tests can use a temp tree.
 */

import * as fs from 'fs';
import * as path from 'path';

const CANDIDATE_ROOTS = ['build-logic', 'buildSrc'];
const CANDIDATE_SOURCE_DIRS = [
    path.join('src', 'main', 'kotlin'),
    path.join('src', 'main', 'groovy'),
];

export interface ConventionPluginHit {
    /** Plugin id, e.g. `my.kotlin.library`. */
    id: string;
    /** Absolute path to the precompiled script file. */
    file: string;
}

/**
 * Look up the source file backing a precompiled-script convention
 * plugin id under `workspaceRoot`.  Walks both `build-logic` and
 * `buildSrc` and matches files whose basename minus `.gradle.kts` (or
 * `.gradle`) equals the requested id.
 */
export function findConventionPlugin(workspaceRoot: string, id: string): string | undefined {
    for (const root of CANDIDATE_ROOTS) {
        // Conventions can live in any sub-module under build-logic/.
        const subModules = listImmediateChildren(path.join(workspaceRoot, root));
        for (const sm of [path.join(workspaceRoot, root), ...subModules]) {
            for (const dir of CANDIDATE_SOURCE_DIRS) {
                const candidate = path.join(sm, dir, `${id}.gradle.kts`);
                if (fileExists(candidate)) return candidate;
                const groovy = path.join(sm, dir, `${id}.gradle`);
                if (fileExists(groovy)) return groovy;
            }
        }
    }
    return undefined;
}

/**
 * Enumerate every convention plugin discovered under the workspace
 * root — useful for completion + the modules sidebar.
 */
export function listConventionPlugins(workspaceRoot: string): ConventionPluginHit[] {
    const out: ConventionPluginHit[] = [];
    for (const root of CANDIDATE_ROOTS) {
        const subModules = listImmediateChildren(path.join(workspaceRoot, root));
        for (const sm of [path.join(workspaceRoot, root), ...subModules]) {
            for (const dir of CANDIDATE_SOURCE_DIRS) {
                const target = path.join(sm, dir);
                if (!fileExists(target)) continue;
                let entries: string[] = [];
                try {
                    entries = fs.readdirSync(target);
                } catch {
                    continue;
                }
                for (const name of entries) {
                    if (name.endsWith('.gradle.kts')) {
                        out.push({ id: name.slice(0, -'.gradle.kts'.length), file: path.join(target, name) });
                    } else if (name.endsWith('.gradle')) {
                        out.push({ id: name.slice(0, -'.gradle'.length), file: path.join(target, name) });
                    }
                }
            }
        }
    }
    return out;
}

function listImmediateChildren(dir: string): string[] {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => path.join(dir, e.name));
    } catch {
        return [];
    }
}

function fileExists(p: string): boolean {
    try {
        return fs.statSync(p).isFile() || fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}
