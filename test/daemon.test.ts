import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    kill() {}
}

const queue: FakeChild[] = [];
const spawnMock = vi.fn(() => queue.shift() as unknown);

vi.mock('child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { GradleDaemon } from '../src/daemon';
import * as vscode from 'vscode';

afterEach(() => {
    spawnMock.mockClear();
    queue.length = 0;
});

function makeChannel() {
    return {
        appendLine: vi.fn(),
        append: vi.fn(),
        show: vi.fn(),
        dispose: vi.fn(),
    } as unknown as vscode.OutputChannel;
}

describe('GradleDaemon', () => {
    it('serializes invocations with the same workspace root', async () => {
        const fake1 = new FakeChild();
        const fake2 = new FakeChild();
        queue.push(fake1, fake2);

        const daemon = new GradleDaemon(makeChannel());
        const p1 = daemon.run({ workspaceRoot: '/ws', args: [':build'] });
        const p2 = daemon.run({ workspaceRoot: '/ws', args: [':test'] });

        await Promise.resolve();
        expect(spawnMock).toHaveBeenCalledTimes(1);

        fake1.stdout.emit('data', Buffer.from('first\n'));
        fake1.emit('close', 0);
        const r1 = await p1;
        expect(r1.exitCode).toBe(0);
        expect(r1.combined).toContain('first');

        await Promise.resolve();
        expect(spawnMock).toHaveBeenCalledTimes(2);
        fake2.stderr.emit('data', Buffer.from('boom\n'));
        fake2.emit('close', 1);
        const r2 = await p2;
        expect(r2.exitCode).toBe(1);
        expect(r2.combined).toContain('boom');
    });

    it('passes --daemon and --console=plain by default', async () => {
        const fake = new FakeChild();
        queue.push(fake);

        const daemon = new GradleDaemon(makeChannel());
        const p = daemon.run({ workspaceRoot: '/ws', args: [':help'] });
        await Promise.resolve();
        expect(spawnMock).toHaveBeenCalledTimes(1);
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--daemon');
        expect(args).toContain('--console=plain');
        expect(args[0]).toBe(':help');

        fake.emit('close', 0);
        await p;
    });
});
