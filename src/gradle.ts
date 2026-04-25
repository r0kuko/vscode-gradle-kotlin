import * as path from 'path';
import * as fs from 'fs';

/**
 * A discovered Gradle module (subproject root containing a build script).
 *
 * Pure data — this module must NOT import `vscode` so it stays trivially
 * unit-testable in plain Node.
 */
export interface GradleModule {
    /** Absolute path to the module directory. */
    rootPath: string;
    /** Gradle project path, e.g. ":core" or ":" for the root project. */
    projectPath: string;
    /** Display name for the module. */
    name: string;
    /** Absolute path to the workspace folder this module belongs to. */
    workspaceRoot: string;
    /** Absolute path to the build script that defines this module, when present. */
    buildScript?: string;
    /** True when the build script is a Kotlin DSL (`build.gradle.kts`). */
    kotlinDsl: boolean;
}

const SKIP_DIRS = new Set([
    'build',
    '.gradle',
    'node_modules',
    'out',
    '.git',
    '.idea',
    '.kotlin',
    'dist',
]);

/**
 * Discover Gradle modules under `workspaceRoot`.
 *
 * Heuristic:
 *  - The workspace root is treated as the root project if it contains a build/settings file.
 *  - Subdirectories containing a `build.gradle` or `build.gradle.kts` are considered modules.
 *  - We avoid descending into well-known build/output directories.
 */
export function discoverGradleModules(workspaceRoot: string): GradleModule[] {
    const modules: GradleModule[] = [];

    const rootBuild = pickBuildScript(workspaceRoot);
    const rootSettings =
        fileExists(path.join(workspaceRoot, 'settings.gradle.kts')) ||
        fileExists(path.join(workspaceRoot, 'settings.gradle'));

    if (!rootBuild && !rootSettings) {
        return modules;
    }

    if (rootBuild) {
        modules.push({
            rootPath: workspaceRoot,
            projectPath: ':',
            name: path.basename(workspaceRoot),
            workspaceRoot,
            buildScript: rootBuild,
            kotlinDsl: rootBuild.endsWith('.kts'),
        });
    }

    const stack: string[] = [workspaceRoot];
    while (stack.length) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
            const sub = path.join(dir, e.name);
            const build = pickBuildScript(sub);
            if (build && sub !== workspaceRoot) {
                const rel = path.relative(workspaceRoot, sub).split(path.sep).join(':');
                modules.push({
                    rootPath: sub,
                    projectPath: ':' + rel,
                    name: rel || path.basename(sub),
                    workspaceRoot,
                    buildScript: build,
                    kotlinDsl: build.endsWith('.kts'),
                });
            }
            stack.push(sub);
        }
    }

    return modules;
}

function pickBuildScript(dir: string): string | undefined {
    const kts = path.join(dir, 'build.gradle.kts');
    if (fileExists(kts)) return kts;
    const groovy = path.join(dir, 'build.gradle');
    if (fileExists(groovy)) return groovy;
    return undefined;
}

function fileExists(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/** Resolve the gradle command (and cwd) to use for a workspace folder. */
export function resolveGradleCommand(
    workspaceRoot: string,
    override?: string
): { command: string; cwd: string } {
    const cwd = workspaceRoot;
    const trimmed = (override || '').trim();
    if (trimmed) {
        return { command: trimmed, cwd };
    }
    const isWin = process.platform === 'win32';
    const wrapper = isWin ? 'gradlew.bat' : 'gradlew';
    const wrapperPath = path.join(cwd, wrapper);
    if (fileExists(wrapperPath)) {
        return { command: isWin ? wrapperPath : './' + wrapper, cwd };
    }
    return { command: 'gradle', cwd };
}

/**
 * Tree shape of discovered modules for sidebar rendering.
 * Intermediate path segments without their own build file appear as
 * "group" nodes (e.g. `:modules` between root and `:modules:featureA`).
 */
export interface ModuleTreeNode {
    projectPath: string;
    name: string;
    isModule: boolean;
    module?: GradleModule;
    children: ModuleTreeNode[];
}

export function buildModuleTreeShape(modules: GradleModule[]): ModuleTreeNode {
    const root = modules.find(m => m.projectPath === ':');
    const rootNode: ModuleTreeNode = {
        projectPath: ':',
        name: root ? root.name : '',
        isModule: !!root,
        module: root,
        children: [],
    };
    const byPath = new Map<string, ModuleTreeNode>();
    byPath.set(':', rootNode);

    function ensure(projectPath: string): ModuleTreeNode {
        const existing = byPath.get(projectPath);
        if (existing) return existing;
        const lastColon = projectPath.lastIndexOf(':');
        const parentPath = lastColon === 0 ? ':' : projectPath.slice(0, lastColon);
        const segName = projectPath.slice(lastColon + 1);
        const parent = ensure(parentPath);
        const matching = modules.find(m => m.projectPath === projectPath);
        const node: ModuleTreeNode = {
            projectPath,
            name: segName,
            isModule: !!matching,
            module: matching,
            children: [],
        };
        parent.children.push(node);
        byPath.set(projectPath, node);
        return node;
    }

    const subs = modules
        .filter(m => m.projectPath !== ':')
        .sort((a, b) => a.projectPath.length - b.projectPath.length);
    for (const m of subs) ensure(m.projectPath);

    const sortRec = (n: ModuleTreeNode) => {
        n.children.sort((a, b) => a.name.localeCompare(b.name));
        n.children.forEach(sortRec);
    };
    sortRec(rootNode);
    return rootNode;
}
