import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
        const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
        const sampleWorkspace = path.resolve(extensionDevelopmentPath, 'sample');

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [sampleWorkspace, '--disable-extensions'],
        });
    } catch (err) {
        console.error('E2E test run failed:', err);
        process.exit(1);
    }
}

void main();
