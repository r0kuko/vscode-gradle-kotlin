import * as path from 'path';
import * as vscode from 'vscode';
import {
    insertIncludeLine,
    normalizeProjectPath,
    projectPathToRelativeDir,
} from './settingsEdit';

export class SettingsCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument): vscode.CodeAction[] | undefined {
        if (!isSettingsScript(document)) return undefined;
        const action = new vscode.CodeAction(
            'Gradle: Add subproject…',
            vscode.CodeActionKind.Refactor
        );
        action.command = {
            command: 'gradleKotlin.addSubproject',
            title: 'Add subproject',
            arguments: [document.uri],
        };
        return [action];
    }
}

export function isSettingsScript(document: vscode.TextDocument): boolean {
    const name = document.uri.path.split('/').pop() ?? '';
    return name === 'settings.gradle.kts' || name === 'settings.gradle';
}

export async function addSubprojectCommand(uri?: vscode.Uri): Promise<void> {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) return;
    const folder = vscode.workspace.getWorkspaceFolder(targetUri);
    if (!folder) return;

    const input = await vscode.window.showInputBox({
        prompt: 'Subproject path (e.g. :modules:featureC)',
        placeHolder: ':modules:featureC',
    });
    if (input === undefined) return;

    const projectPath = normalizeProjectPath(input);
    if (!projectPath) {
        vscode.window.showErrorMessage('Invalid project path. Example: :modules:featureC');
        return;
    }

    const doc = await vscode.workspace.openTextDocument(targetUri);
    const updated = insertIncludeLine(doc.getText(), projectPath);
    if (updated !== doc.getText()) {
        const edit = new vscode.WorkspaceEdit();
        const endLine = doc.lineCount - 1;
        const endChar = doc.lineAt(endLine).text.length;
        edit.replace(targetUri, new vscode.Range(0, 0, endLine, endChar), updated);
        await vscode.workspace.applyEdit(edit);
        await doc.save();
    }

    const rel = projectPathToRelativeDir(projectPath);
    const moduleDir = path.join(folder.uri.fsPath, rel);
    const buildFile = path.join(moduleDir, 'build.gradle.kts');
    const srcDir = path.join(moduleDir, 'src', 'main', 'kotlin');

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(srcDir));
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(buildFile));
    } catch {
        const template =
            'plugins {\n' +
            '    alias(libs.plugins.kotlin.jvm)\n' +
            '}\n\n' +
            'dependencies {\n' +
            '    implementation(kotlin("stdlib"))\n' +
            '}\n';
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(buildFile),
            Buffer.from(template, 'utf8')
        );
    }

    const opened = await vscode.workspace.openTextDocument(vscode.Uri.file(buildFile));
    await vscode.window.showTextDocument(opened);
}
