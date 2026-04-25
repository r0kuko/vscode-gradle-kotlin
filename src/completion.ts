import * as vscode from 'vscode';
import { VersionCatalog, aliasToLibsRef } from './libs';
import { isBuildScript } from './codelens';

/**
 * Completion provider that suggests `libs.x.y.z` aliases (libraries,
 * plugins, bundles, versions) inside `build.gradle.kts`.
 *
 * Triggered by typing `libs.` — once the user has typed at least the
 * `libs.` prefix we offer every alias in the catalog with the resolved
 * version shown as detail text (matching JetBrains' completion popup).
 */
export class LibsCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private readonly catalogProvider: () => VersionCatalog | undefined) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        if (!isBuildScript(document)) return [];
        const catalog = this.catalogProvider();
        if (!catalog) return [];

        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const prefixMatch = linePrefix.match(/(?:^|[^A-Za-z_])libs\.([A-Za-z0-9_.-]*)$/);
        if (!prefixMatch) return [];

        const items: vscode.CompletionItem[] = [];

        for (const lib of catalog.libraries.values()) {
            const ref = aliasToLibsRef(lib.alias);
            const item = new vscode.CompletionItem(ref, vscode.CompletionItemKind.Constant);
            item.insertText = ref.slice('libs.'.length);
            item.detail = `${lib.coordinate}${lib.version ? ':' + lib.version : ''}`;
            item.documentation = new vscode.MarkdownString(
                `**${lib.coordinate}**${lib.version ? ` — \`${lib.version}\`` : ''}` +
                    (lib.versionRef ? `\n\nversion ref: \`${lib.versionRef}\`` : '')
            );
            items.push(item);
        }

        for (const pl of catalog.plugins.values()) {
            const ref = `libs.plugins.${pl.alias.replace(/[-_]/g, '.')}`;
            const item = new vscode.CompletionItem(ref, vscode.CompletionItemKind.Module);
            item.insertText = ref.slice('libs.'.length);
            item.detail = `plugin ${pl.id}${pl.version ? ':' + pl.version : ''}`;
            items.push(item);
        }

        for (const [alias, list] of catalog.bundles) {
            const ref = `libs.bundles.${alias.replace(/[-_]/g, '.')}`;
            const item = new vscode.CompletionItem(ref, vscode.CompletionItemKind.EnumMember);
            item.insertText = ref.slice('libs.'.length);
            item.detail = `bundle (${list.length} libs)`;
            items.push(item);
        }

        for (const [alias, version] of catalog.versions) {
            const ref = `libs.versions.${alias.replace(/[-_]/g, '.')}`;
            const item = new vscode.CompletionItem(ref, vscode.CompletionItemKind.Value);
            item.insertText = ref.slice('libs.'.length);
            item.detail = `version ${version}`;
            items.push(item);
        }

        return items;
    }
}
