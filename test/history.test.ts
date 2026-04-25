import { describe, it, expect } from 'vitest';
import { HISTORY_LIMIT, pushRecent, recentKey, recentLabel } from '../src/history';

const base = {
    workspaceRoot: '/ws',
    timestamp: 0,
};

describe('history', () => {
    it('deduplicates by task + args + workspaceRoot', () => {
        const a = { ...base, task: ':app:test', args: [], timestamp: 1 };
        const b = { ...base, task: ':app:test', args: [], timestamp: 2 };
        const list = pushRecent(pushRecent([], a), b);
        expect(list.length).toBe(1);
        expect(list[0].timestamp).toBe(2);
    });

    it('treats different args as different runs', () => {
        const a = { ...base, task: ':app:test', args: [], timestamp: 1 };
        const b = { ...base, task: ':app:test', args: ['--info'], timestamp: 2 };
        const list = pushRecent(pushRecent([], a), b);
        expect(list.length).toBe(2);
        // Most recent first.
        expect(list[0].args).toEqual(['--info']);
    });

    it('caps at HISTORY_LIMIT', () => {
        let list: ReturnType<typeof pushRecent> = [];
        for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
            list = pushRecent(list, { ...base, task: `:t${i}`, args: [], timestamp: i });
        }
        expect(list.length).toBe(HISTORY_LIMIT);
    });

    it('formats labels', () => {
        expect(recentLabel({ ...base, task: ':app:test', args: [] })).toBe(':app:test');
        expect(recentLabel({ ...base, task: ':app:test', args: ['--info', '-Px=1'] })).toBe(
            ':app:test --info -Px=1'
        );
    });

    it('builds a stable key', () => {
        expect(
            recentKey({ ...base, task: ':a', args: ['--x'] }) ===
                recentKey({ ...base, task: ':a', args: ['--x'] })
        ).toBe(true);
    });
});
