import * as vscode from 'vscode';
import { isBuildScript } from './codelens';
import {
    VersionCatalog,
    findLibsReferenceAt,
    locateAliasLine,
    resolveLibsRef,
} from './libs';

/**
 * Cmd+click on `libs.kotlinx.coroutines.core` jumps to the matching alias
 * declaration in `libs.versions.toml`.
 */
export class LibsDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly catalogProvider: () => VersionCatalog | undefined) {}

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.LocationLink[] | undefined {
        if (!isBuildScript(document)) return undefined;
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
}
