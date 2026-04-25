import * as vscode from 'vscode';
import { lookupProperty, parsePropertyLine, PROPERTY_DOCS } from './propertiesKeys';

export class GradlePropertiesHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        if (!isPropertiesDocument(document)) return undefined;
        const line = document.lineAt(position.line).text;
        const parsed = parsePropertyLine(line);
        if (!parsed) return undefined;
        const doc = lookupProperty(parsed.key);
        if (!doc) return undefined;

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown(`**${doc.key}**\n\n${doc.summary}\n`);
        if (doc.defaultValue) md.appendMarkdown(`\nDefault: \`${doc.defaultValue}\`\n`);
        if (doc.link) md.appendMarkdown(`\n[Reference](${doc.link})\n`);
        return new vscode.Hover(md);
    }
}

export class GradlePropertiesCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        if (!isPropertiesDocument(document)) return [];
        const line = document.lineAt(position.line).text.slice(0, position.character);
        if (/=/.test(line)) return [];
        return PROPERTY_DOCS.map(d => {
            const item = new vscode.CompletionItem(d.key, vscode.CompletionItemKind.Property);
            item.insertText = `${d.key}=${d.defaultValue ?? ''}`;
            item.detail = d.summary.split('.')[0];
            return item;
        });
    }
}

/**
 * Validate values for known keys (e.g. `org.gradle.logging.level=verbose` → warning).
 */
export function buildPropertiesDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
    const out: vscode.Diagnostic[] = [];
    if (!isPropertiesDocument(document)) return out;
    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        const parsed = parsePropertyLine(text);
        if (!parsed) continue;
        const meta = lookupProperty(parsed.key);
        if (!meta?.validate) continue;
        const msg = meta.validate(parsed.value);
        if (!msg) continue;
        const valueStart = text.indexOf(parsed.value);
        const range = new vscode.Range(i, valueStart, i, valueStart + parsed.value.length);
        const diag = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
        diag.source = 'gradle.properties';
        out.push(diag);
    }
    return out;
}

export function isPropertiesDocument(document: vscode.TextDocument): boolean {
    return document.uri.path.endsWith('/gradle.properties');
}
