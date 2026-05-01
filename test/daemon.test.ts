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

import { GradleDaemon, setDefaultInitScriptPath } from '../src/daemon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

afterEach(() => {
    vi.useRealTimers();
    spawnMock.mockClear();
    vi.restoreAllMocks();
    queue.length = 0;
    setDefaultInitScriptPath(undefined);
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

    it('uses --no-daemon automatically when Gradle for Java is installed', async () => {
        const fake = new FakeChild();
        queue.push(fake);
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({ id: 'vscjava.vscode-gradle' } as never);

        const daemon = new GradleDaemon(makeChannel());
        const p = daemon.run({ workspaceRoot: '/ws', args: [':help'] });
        await Promise.resolve();

        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--no-daemon');
        expect(args).not.toContain('--daemon');

        fake.emit('close', 0);
        await p;
    });

    it('can force --daemon even when Gradle for Java is installed', async () => {
        const fake = new FakeChild();
        queue.push(fake);
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({ id: 'vscjava.vscode-gradle' } as never);
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: <T>(key: string, defaultValue?: T) => key === 'daemon.mode' ? 'always' as T : defaultValue,
        } as unknown as vscode.WorkspaceConfiguration);

        const daemon = new GradleDaemon(makeChannel());
        const p = daemon.run({ workspaceRoot: '/ws', args: [':help'] });
        await Promise.resolve();

        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('--daemon');
        expect(args).not.toContain('--no-daemon');

        fake.emit('close', 0);
        await p;
    });

    it('injects default init script with -I when enabled', async () => {
        const fake = new FakeChild();
        queue.push(fake);

        const initScript = path.join(os.tmpdir(), `gradle-kotlin-${Date.now()}.init.gradle.kts`);
        fs.writeFileSync(initScript, '// test init script\n', 'utf8');
        setDefaultInitScriptPath(initScript);
        const configSpy = vi
            .spyOn(vscode.workspace, 'getConfiguration')
            .mockReturnValue({
                get: <T>(_k: string, d?: T) => d,
            } as unknown as vscode.WorkspaceConfiguration);

        const daemon = new GradleDaemon(makeChannel());
        const p = daemon.run({ workspaceRoot: '/ws', args: [':help'] });
        await Promise.resolve();
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain('-I');
        expect(args).toContain(initScript);

        fake.emit('close', 0);
        await p;
        configSpy.mockRestore();
        fs.unlinkSync(initScript);
    });

    it('settles when the child exits but close is not observed', async () => {
        vi.useFakeTimers();
        const fake = new FakeChild();
        queue.push(fake);

        const daemon = new GradleDaemon(makeChannel());
        const p = daemon.run({ workspaceRoot: '/ws', args: [':broken'] });
        await Promise.resolve();

        fake.stderr.emit('data', Buffer.from('failure\n'));
        fake.emit('exit', 1);
        await vi.advanceTimersByTimeAsync(1_500);

        const result = await p;
        expect(result.exitCode).toBe(1);
        expect(result.combined).toContain('failure');
        expect(result.combined).toContain('stdio did not close');
        expect(daemon.running).toBe(0);
    });
});
