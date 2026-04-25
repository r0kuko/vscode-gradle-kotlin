import * as path from 'path';
import * as vscode from 'vscode';
import { isBuildScript } from './codelens';
import { findLiteralVersionDeps } from './extraDiagnostics';
import { findCatalogFile } from './libs';
import { appendCatalogEntry, nextConfiguration } from './catalogRefactor';

const TOGGLE_RE =
    /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|testCompileOnly)\b/;

/**
 * Code-action provider that surfaces two refactorings on dependency
 * lines inside `build.gradle.kts` / `build.gradle`:
 *
 * 1. **Move version to libs.versions.toml** — for inline GAV literals
 *    such as `implementation("io.ktor:ktor-server-core:2.3.10")`, write
 *    matching `[versions]` + `[libraries]` entries to the catalog and
 *    rewrite the call site to `implementation(libs.ktor.ktor.server.core)`.
 * 2. **Cycle dependency configuration** — quickly bounce between
 *    `implementation` ↔ `api` ↔ `compileOnly` ↔ `runtimeOnly` (and the
 *    test analogues).  Saves the user a manual rename when refactoring
 *    public APIs.
 */
export class DependencyCodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedKinds = [
        vscode.CodeActionKind.RefactorRewrite,
        vscode.CodeActionKind.QuickFix,
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.CodeAction[] {
        if (!isBuildScript(document)) return [];
        const lineText = document.lineAt(range.start.line).text;
        const out: vscode.CodeAction[] = [];

        // 1) Move literal version to catalog.
        const literal = findLiteralVersionDeps(lineText)[0];
        if (literal) {
            const action = new vscode.CodeAction(
                `Move "${literal.coordinate}" to libs.versions.toml`,
                vscode.CodeActionKind.RefactorRewrite
            );
            action.command = {
                command: 'gradleKotlin.moveLiteralToCatalog',
                title: 'Move to catalog',
                arguments: [document.uri, range.start.line],
            };
            out.push(action);
        }

        // 2) Cycle the configuration keyword on this line.
        const toggle = TOGGLE_RE.exec(lineText);
        if (toggle) {
            const next = nextConfiguration(toggle[1]);
            const action = new vscode.CodeAction(
                `Change to ${next}(...)`,
                vscode.CodeActionKind.RefactorRewrite
            );
            action.command = {
                command: 'gradleKotlin.cycleDependencyConfiguration',
                title: `Use ${next}`,
                arguments: [document.uri, range.start.line, toggle[1], next],
            };
            out.push(action);
        }

        return out;
    }
}

/** Implementation of `gradleKotlin.cycleDependencyConfiguration`. */
export async function cycleDependencyConfigurationCommand(
    uri: vscode.Uri,
    line: number,
    from: string,
    to: string
): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.lineAt(line).text;
    const idx = text.indexOf(from);
    if (idx < 0) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(line, idx, line, idx + from.length), to);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
}

/** Implementation of `gradleKotlin.moveLiteralToCatalog`. */
export async function moveLiteralToCatalogCommand(
    uri: vscode.Uri,
    line: number
): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    const doc = await vscode.workspace.openTextDocument(uri);
    const lineText = doc.lineAt(line).text;
    const literal = findLiteralVersionDeps(lineText)[0];
    if (!literal) return;

    let catalogPath = findCatalogFile(folder.uri.fsPath);
    if (!catalogPath) {
        const choice = await vscode.window.showInformationMessage(
            'No libs.versions.toml found. Create one under gradle/?',
            { modal: false },
            'Create',
            'Cancel'
        );
        if (choice !== 'Create') return;
        catalogPath = path.join(folder.uri.fsPath, 'gradle', 'libs.versions.toml');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(catalogPath)));
        await vscode.workspace.fs.writeFile(vscode.Uri.file(catalogPath), Buffer.from('[versions]\n\n[libraries]\n', 'utf8'));
    }

    const catalogUri = vscode.Uri.file(catalogPath);
    const catalogDoc = await vscode.workspace.openTextDocument(catalogUri);
    const { newText, reference } = appendCatalogEntry(catalogDoc.getText(), {
        group: literal.group,
        name: literal.name,
        version: literal.version,
    });
    const catalogEdit = new vscode.WorkspaceEdit();
    const lastLine = catalogDoc.lineCount - 1;
    catalogEdit.replace(
        catalogUri,
        new vscode.Range(0, 0, lastLine, catalogDoc.lineAt(lastLine).text.length),
        newText
    );
    await vscode.workspace.applyEdit(catalogEdit);
    await catalogDoc.save();

    // Replace the literal coordinate in the build script with `alias(...)`.
    const buildEdit = new vscode.WorkspaceEdit();
    const replaced = lineText.replace(`"${literal.coordinate}"`, reference);
    buildEdit.replace(uri, new vscode.Range(line, 0, line, lineText.length), replaced);
    await vscode.workspace.applyEdit(buildEdit);
    await doc.save();
}
