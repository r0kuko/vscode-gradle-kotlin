import * as path from 'path';
import * as fs from 'fs';
import { GradleModule } from './gradle';

/**
 * A Gradle task in a module.
 *
 * Tasks are discovered with two strategies:
 *  1. **Static parsing** of the build script for `tasks.register("foo")`,
 *     `tasks.named("foo")`, `task("foo")` and a small built-in fallback list
 *     ("build", "test", "clean", "assemble"). This works without invoking
 *     Gradle and is what shows up in the sidebar before the daemon has
 *     analyzed the project.
 *  2. **Dynamic discovery** by parsing `gradle :module:tasks --all` output,
 *     done lazily by the daemon and merged into the static list.
 */
export interface GradleTask {
    name: string;
    /** Owning module's gradle project path (`:` or `:app`, etc.). */
    projectPath: string;
    /** Optional one-line description for tooltips. */
    description?: string;
    /** Optional group, e.g. "build", "verification". */
    group?: string;
    /** Whether the task came from the static script scan (true) or `tasks --all` (false). */
    fromScript: boolean;
}

const BUILTIN_TASKS: { name: string; description: string; group: string }[] = [
    { name: 'build', description: 'Assembles and tests this project.', group: 'build' },
    { name: 'assemble', description: 'Assembles the outputs of this project.', group: 'build' },
    { name: 'clean', description: 'Deletes the build directory.', group: 'build' },
    { name: 'test', description: 'Runs the unit tests.', group: 'verification' },
    { name: 'check', description: 'Runs all checks.', group: 'verification' },
    { name: 'tasks', description: 'Displays the tasks runnable from the project.', group: 'help' },
    { name: 'dependencies', description: 'Displays all dependencies declared in the project.', group: 'help' },
    { name: 'projects', description: 'Displays the sub-projects of the project.', group: 'help' },
];

const TASK_REGISTER_RE =
    /\btasks\s*\.\s*(?:register|create|named)\s*(?:<[^>]+>\s*)?\(\s*["']([A-Za-z_][\w]*)["']/g;
const TOP_LEVEL_TASK_RE = /\btask\s*(?:<[^>]+>\s*)?\(\s*["']([A-Za-z_][\w]*)["']/g;

/**
 * Look at the first 600 chars after a `tasks.register("foo")` match and
 * extract the closest `description = "..."` and `group = "..."`
 * assignments.  Both Kotlin DSL (`description = "x"`) and Groovy
 * (`description "x"`) forms are accepted.  This is intentionally naive
 * — anything fancier needs the actual Gradle Tooling API.
 */
function extractTaskMeta(text: string, fromIndex: number): { description?: string; group?: string } {
    const window = text.slice(fromIndex, fromIndex + 600);
    // Stop at the matching closing brace of the register-block; if we
    // can't find one, just look in the entire window.
    const braceOpen = window.indexOf('{');
    let scope = window;
    if (braceOpen !== -1) {
        let depth = 0;
        for (let i = braceOpen; i < window.length; i++) {
            const ch = window[i];
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    scope = window.slice(braceOpen, i + 1);
                    break;
                }
            }
        }
    }
    const desc = /\bdescription\s*(?:=|\s)\s*["']([^"']+)["']/.exec(scope)?.[1];
    const group = /\bgroup\s*(?:=|\s)\s*["']([^"']+)["']/.exec(scope)?.[1];
    return { description: desc, group };
}

/**
 * Statically scan a module's build script for declared task names.
 * Adds standard Gradle built-ins so the sidebar always shows something
 * useful even before the daemon has run `tasks --all`.
 */
export function discoverModuleTasksStatically(module: GradleModule): GradleTask[] {
    const seen = new Map<string, GradleTask>();

    for (const t of BUILTIN_TASKS) {
        seen.set(t.name, {
            name: t.name,
            projectPath: module.projectPath,
            description: t.description,
            group: t.group,
            fromScript: false,
        });
    }

    if (module.buildScript) {
        const text = safeRead(module.buildScript) ?? '';
        for (const re of [TASK_REGISTER_RE, TOP_LEVEL_TASK_RE]) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                const name = m[1];
                const meta = extractTaskMeta(text, m.index + m[0].length);
                seen.set(name, {
                    name,
                    projectPath: module.projectPath,
                    description: meta.description,
                    fromScript: true,
                    group: meta.group ?? 'other',
                });
            }
        }
    }

    return Array.from(seen.values()).sort((a, b) => {
        const ag = a.group ?? 'zzz';
        const bg = b.group ?? 'zzz';
        if (ag !== bg) return ag.localeCompare(bg);
        return a.name.localeCompare(b.name);
    });
}

/**
 * Parse the textual output of `gradle :path:tasks --all` and extract tasks
 * for a particular project path.
 *
 * Format excerpt:
 *
 *   Build tasks
 *   -----------
 *   :app:assemble - Assembles the outputs of this project.
 *   :app:build    - Assembles and tests this project.
 */
export function parseTasksAllOutput(text: string, projectPath: string): GradleTask[] {
    const out: GradleTask[] = [];
    const seen = new Set<string>();

    let currentGroup: string | undefined;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const next = lines[i + 1];
        if (next && /^[-]{3,}$/.test(next.trim())) {
            currentGroup = raw.replace(/\s*tasks$/i, '').trim().toLowerCase() || undefined;
            continue;
        }
        if (/^[-]{3,}$/.test(raw.trim())) continue;

        const m = raw.match(/^([:\w][\w:.-]*?)(?:\s+-\s+(.*))?$/);
        if (!m) continue;
        const fullName = m[1];
        const description = m[2]?.trim();

        const lastColon = fullName.lastIndexOf(':');
        let owner: string;
        let taskName: string;
        if (lastColon === -1) {
            // No colon: root-level task (e.g. "help", "tasks")
            owner = ':';
            taskName = fullName;
        } else if (lastColon === 0) {
            owner = ':';
            taskName = fullName.slice(1);
        } else {
            taskName = fullName.slice(lastColon + 1);
            const rawOwner = fullName.slice(0, lastColon);
            // Normalize relative path to absolute (e.g. "app" → ":app",
            // "api:billing" → ":api:billing"). Root output uses relative
            // paths; per-subproject output uses absolute ones already.
            owner = rawOwner.startsWith(':') ? rawOwner : ':' + rawOwner;
        }
        if (owner !== projectPath) continue;
        if (!taskName || seen.has(taskName)) continue;
        seen.add(taskName);
        out.push({
            name: taskName,
            projectPath,
            description,
            group: currentGroup,
            fromScript: false,
        });
    }
    return out;
}

/**
 * Build the Gradle CLI argument for a task in a particular project.
 * `:app:test`, `:test`, etc. Tasks may already be qualified, in which case
 * we pass them through unchanged.
 */
export function qualifyTask(projectPath: string, task: string): string {
    if (task.startsWith(':')) return task;
    if (projectPath === ':' || projectPath === '') return ':' + task;
    return `${projectPath}:${task}`;
}

function safeRead(p: string): string | undefined {
    try {
        return fs.readFileSync(p, 'utf8');
    } catch {
        return undefined;
    }
}

/**
 * Pure helper used by the CodeLens / inlay providers to find the
 * `dependencies { ... }` block in a build script.  Returns the line
 * number of the opening `dependencies` keyword (0-based) or `-1`.
 */
export function findDependenciesBlock(text: string): number {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*dependencies\s*\{/.test(lines[i])) return i;
    }
    return -1;
}

/** Locate which module owns a given file path (deepest-match wins). */
export function findOwningModule(
    modules: readonly GradleModule[],
    fsPath: string
): GradleModule | undefined {
    const target = normalizeForCompare(fsPath);
    let best: GradleModule | undefined;
    for (const m of modules) {
        const root = normalizeForCompare(m.rootPath);
        if (target === root || target.startsWith(root + '/')) {
            if (!best || m.rootPath.length > best.rootPath.length) best = m;
        }
    }
    return best;
}

/**
 * Normalize a filesystem path for prefix comparison: lowercase the
 * Windows drive letter, strip a trailing separator, and convert all
 * back-slashes to forward-slashes so cross-platform call sites that
 * pass POSIX-style paths still match.
 */
function normalizeForCompare(p: string): string {
    let out = p.replace(/\\/g, '/');
    if (out.endsWith('/')) out = out.slice(0, -1);
    if (/^[A-Za-z]:/.test(out)) out = out[0].toLowerCase() + out.slice(1);
    return out;
}
