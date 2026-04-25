import * as vscode from 'vscode';
import { isBuildScript } from './codelens';
import { VersionCatalog, findLibsReferenceAt, resolveLibsRef } from './libs';
import { guessGitHubRepo } from './mavenSearch';

/**
 * Hover provider showing coordinate / version / bundle membership for
 * `libs.x.y.z` references.  Mirrors what completion already exposes but
 * triggers on mouse hover.
 */
export class LibsHoverProvider implements vscode.HoverProvider {
    constructor(private readonly catalogProvider: () => VersionCatalog | undefined) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Hover | undefined {
        if (!isBuildScript(document)) return undefined;
        const catalog = this.catalogProvider();
        if (!catalog) return undefined;

        const ref = findLibsReferenceAt(document.getText(), position.line, position.character);
        if (!ref) return undefined;
        const resolution = resolveLibsRef(catalog, ref.ref);
        if (!resolution) return undefined;

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown(`**${ref.ref}** — ${resolution.kind}\n\n${resolution.tooltip}`);
        if (resolution.kind === 'library') {
            const lib = catalog.libraries.get(resolution.alias);
            if (lib) {
                const [group, name] = lib.coordinate.split(':');
                const repo = guessGitHubRepo(group, name);
                if (repo) {
                    md.appendMarkdown(`\n\n[View on GitHub](https://github.com/${repo}) · [Maven Central](https://central.sonatype.com/artifact/${group}/${name})`);
                }
            }
        }
        const range = new vscode.Range(
            ref.line,
            ref.character,
            ref.line,
            ref.character + ref.length
        );
        return new vscode.Hover(md, range);
    }
}
