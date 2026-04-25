/**
 * Recent Gradle task invocations. Pure-Node so it can be unit tested
 * without VS Code; the extension persists/loads via a Memento.
 */
export interface RecentRun {
    /** Fully-qualified task expression, e.g. ":app:test". */
    task: string;
    /** Extra CLI arguments (without the task name itself). */
    args: string[];
    /** Workspace root (used to refire under the right folder). */
    workspaceRoot: string;
    /** Last-run timestamp in epoch ms. */
    timestamp: number;
    /** Last exit code, if known. */
    exitCode?: number | null;
    /** Last duration in ms, if known. */
    durationMs?: number;
}

export const HISTORY_LIMIT = 20;

/**
 * Insert/refresh a run at the top of the list, deduplicated by
 * `task + args + workspaceRoot`. Returns the new array.
 */
export function pushRecent(list: readonly RecentRun[], run: RecentRun): RecentRun[] {
    const key = recentKey(run);
    const filtered = list.filter(r => recentKey(r) !== key);
    return [run, ...filtered].slice(0, HISTORY_LIMIT);
}

export function recentKey(r: RecentRun): string {
    return `${r.workspaceRoot}::${r.task}::${r.args.join(' ')}`;
}

export function recentLabel(r: RecentRun): string {
    return r.args.length > 0 ? `${r.task} ${r.args.join(' ')}` : r.task;
}
