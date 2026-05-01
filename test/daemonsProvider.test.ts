import { describe, it, expect, vi } from 'vitest';
import { DaemonsProvider, parseDaemonStatusOutput } from '../src/daemonsProvider';

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
        const run = vi.fn(async () => ({
            exitCode: 0,
            stdout: '',
            stderr: '',
            combined: '  99392 IDLE      8.5-bin\n',
            durationMs: 12,
        }));
        const provider = new DaemonsProvider({ run }, () => '/workspace');

        await provider.reload();

        expect(run).toHaveBeenCalledWith({
            workspaceRoot: '/workspace',
            args: ['--status'],
            useInitScript: false,
            showOutput: false,
        });
        expect(provider.getChildren()).toEqual([
            { pid: '99392', status: 'IDLE', version: '8.5-bin' },
        ]);
    });
});