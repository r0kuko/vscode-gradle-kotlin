import * as vscode from 'vscode';
import { isBuildScript } from './codelens';
import {
    VersionCatalog,
    findLibsReferenceAt,
    locateAliasLine,
    resolveLibsRef,
} from './libs';
import { findConventionPlugin } from './conventionPlugins';

/**
 * Cmd+click on `libs.kotlinx.coroutines.core` jumps to the matching alias
 * declaration in `libs.versions.toml`.  Cmd+click on `id("my.kotlin.x")`
 * jumps to the implementing precompiled-script convention plugin under
 * `build-logic` / `buildSrc`.
 */
export class LibsDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly catalogProvider: () => VersionCatalog | undefined) {}

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.LocationLink[] | undefined {
        if (!isBuildScript(document)) return undefined;

        // Convention plugin lookup wins when the caret sits on an `id("…")`.
        const convention = this.tryConventionJump(document, position);
        if (convention) return convention;

        const catalog = this.catalogProvider();
        if (!catalog) return undefined;

        const ref = findLibsReferenceAt(document.getText(), position.line, position.character);
        if (!ref) return undefined;
        const resolution = resolveLibsRef(catalog, ref.ref);
        if (!resolution) return undefined;

        const line = locateAliasLine(catalog, resolution);
        if (line < 0) return undefined;

        const targetUri = vscode.Uri.file(catalog.file);
        const targetRange = new vscode.Range(line, 0, line, 256);
        return [
            {
                originSelectionRange: new vscode.Range(
                    ref.line,
                    ref.character,
                    ref.line,
                    ref.character + ref.length
                ),
                targetUri,
                targetRange,
                targetSelectionRange: targetRange,
            },
        ];
    }

    private tryConventionJump(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.LocationLink[] | undefined {
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!folder) return undefined;
        const lineText = document.lineAt(position.line).text;
        const re = /\bid\s*\(\s*["']([\w.-]+)["']\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lineText)) !== null) {
            const idStart = lineText.indexOf(m[1], m.index);
            const idEnd = idStart + m[1].length;
            if (position.character < idStart || position.character > idEnd) continue;
            const file = findConventionPlugin(folder.uri.fsPath, m[1]);
            if (!file) return undefined;
            const targetUri = vscode.Uri.file(file);
            const targetRange = new vscode.Range(0, 0, 0, 0);
            return [
                {
                    originSelectionRange: new vscode.Range(position.line, idStart, position.line, idEnd),
                    targetUri,
                    targetRange,
                    targetSelectionRange: targetRange,
                },
            ];
        }
        return undefined;
    }
}
