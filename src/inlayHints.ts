import * as vscode from 'vscode';
import { VersionCatalog, findLibsReferences, resolveLibsRef } from './libs';
import { isBuildScript } from './codelens';

/**
 * Inlay-hint provider that shows the resolved version after every
 * `libs.x.y.z` reference in a build script.  Mirrors the JetBrains
 * "ghost" version display.
 */
export class LibsInlayHintsProvider implements vscode.InlayHintsProvider {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeInlayHints = this._onDidChange.event;

    constructor(private readonly catalogProvider: () => VersionCatalog | undefined) {}

    refresh(): void {
        this._onDidChange.fire();
    }

    provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.InlayHint[] {
        const config = vscode.workspace.getConfiguration('gradleKotlin', document.uri);
        if (!config.get<boolean>('versionInlayHints.enabled', true)) return [];
        if (!isBuildScript(document)) return [];
        const catalog = this.catalogProvider();
        if (!catalog) return [];

        const text = document.getText();
        const refs = findLibsReferences(text);
        const hints: vscode.InlayHint[] = [];

        for (const r of refs) {
            if (r.line < range.start.line || r.line > range.end.line) continue;
            const resolved = resolveLibsRef(catalog, r.ref);
            if (!resolved) continue;
            const pos = new vscode.Position(r.line, r.character + r.length);
            const hint = new vscode.InlayHint(pos, `: ${resolved.inlayLabel}`, vscode.InlayHintKind.Type);
            hint.paddingLeft = false;
            hint.paddingRight = false;
            hint.tooltip = new vscode.MarkdownString(resolved.tooltip);
            hints.push(hint);
        }
        return hints;
    }
}
