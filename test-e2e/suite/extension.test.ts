import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'r0kuko.vscode-gradle-kotlin';

const EXPECTED_COMMANDS = [
    'gradleKotlin.refresh',
    'gradleKotlin.reloadProject',
    'gradleKotlin.runTask',
    'gradleKotlin.runTaskWithArgs',
    'gradleKotlin.runTestsForTask',
    'gradleKotlin.rerunRecent',
    'gradleKotlin.clearRecent',
    'gradleKotlin.runDependencies',
    'gradleKotlin.addSubproject',
    'gradleKotlin.openModule',
    'gradleKotlin.stopDaemon',
];

suite('Extension smoke', () => {
    test('activates and registers expected commands', async () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(ext, `Extension ${EXTENSION_ID} not found`);
        await ext!.activate();
        assert.strictEqual(ext!.isActive, true, 'Extension failed to activate');

        const commands = await vscode.commands.getCommands(true);
        for (const cmd of EXPECTED_COMMANDS) {
            assert.ok(commands.includes(cmd), `Missing command: ${cmd}`);
        }
    });

    test('discovers sample modules', async () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        await ext!.activate();
        // Refresh + give the tree a moment to populate.
        await vscode.commands.executeCommand('gradleKotlin.refresh');
        // No public API to inspect tree state directly; we just assert
        // the sample's settings.gradle(.kts) is visible to the workspace.
        const settings = await vscode.workspace.findFiles(
            '**/settings.gradle{,.kts}',
            '**/build/**'
        );
        assert.ok(settings.length > 0, 'No settings.gradle found in sample workspace');
    });
});
