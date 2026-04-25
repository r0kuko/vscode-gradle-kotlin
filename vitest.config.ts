import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        // The pure modules under src/ are CPU-bound and don't share state;
        // forks parallelise across cores cleanly while keeping the vscode
        // alias isolated per worker.
        pool: 'forks',
        alias: {
            vscode: path.resolve(__dirname, 'test/__mocks__/vscode.ts'),
        },
    },
});
