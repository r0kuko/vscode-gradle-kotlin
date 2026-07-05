import { afterEach, describe, it, expect, vi } from 'vitest';
import { DaemonsProvider, parseDaemonStatusOutput } from '../src/daemonsProvider';

const result = (combined: string) => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
    combined,
    durationMs: 12,
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('parseDaemonStatusOutput', () => {
    it('parses daemon status lines', () => {
        const result = parseDaemonStatusOutput(`\n  99392 IDLE      8.5-bin\n  99400 BUSY      8.7\n`);
        expect(result).toEqual([
            { pid: '99392', status: 'IDLE', version: '8.5-bin' },
            { pid: '99400', status: 'BUSY', version: '8.7' },
        ]);
    });
});

describe('DaemonsProvider', () => {
    it('reloads daemon status through the shared daemon runner', async () => {
        const run = vi.fn(async () => result('  99392 IDLE      8.5-bin\n  99400 STOPPED  (stop command received)\n'));
        const stopAll = vi.fn(async () => undefined);
        const provider = new DaemonsProvider({ run, stopAll }, () => '/workspace');

        await provider.reload();

        expect(run).toHaveBeenCalledWith({
            workspaceRoot: '/workspace',
            args: ['--status'],
            useInitScript: false,
            showOutput: false,
            queue: false,
            appendDaemonFlag: false,
        });
        expect(provider.getChildren()).toEqual([
            { pid: '99392', status: 'IDLE', version: '8.5-bin' },
        ]);
    });

    it('politely stops daemons and force-kills any still alive', async () => {
        const run = vi
            .fn()
            .mockResolvedValueOnce(result('  99392 BUSY      8.5-bin\n  99400 STOPPED  (stop command received)\n'))
            .mockResolvedValueOnce(result('  99392 STOPPED  (by user or operating system)\n'));
        const stopAll = vi.fn(async () => undefined);
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
        const provider = new DaemonsProvider({ run, stopAll }, () => '/workspace');

        await provider.stopAllDaemons('/selected');

        expect(stopAll).toHaveBeenCalledWith('/selected');
        if (process.platform === 'win32') {
            expect(kill).not.toHaveBeenCalled();
        } else {
            expect(kill).toHaveBeenCalledWith(99392, 'SIGKILL');
        }
        expect(provider.getChildren()).toEqual(['empty']);
    });
});