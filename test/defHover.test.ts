import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LibsDefinitionProvider } from '../src/definition';
import { LibsHoverProvider } from '../src/hover';
import { parseCatalogFile } from '../src/libs';
import * as vscode from 'vscode';

const TOML = `[versions]
coroutines = "1.9.0"

[libraries]
kotlinx-coroutines-core = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-core", version.ref = "coroutines" }

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version = "2.0.21" }

[bundles]
testing = ["kotlinx-coroutines-core"]
`;

const SCRIPT = [
    'plugins { alias(libs.plugins.kotlin.jvm) }',
    '',
    'dependencies {',
    '    implementation(libs.kotlinx.coroutines.core)',
    '    implementation(libs.versions.coroutines)',
    '    implementation(libs.bundles.testing)',
    '}',
].join('\n');

let catalogFile: string;

beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-defhover-'));
    catalogFile = path.join(dir, 'libs.versions.toml');
    fs.writeFileSync(catalogFile, TOML);
});

function fakeBuildDoc(): vscode.TextDocument {
    return {
        uri: vscode.Uri.file('/ws/build.gradle.kts'),
        getText: () => SCRIPT,
        lineAt: (line: number) => ({ text: SCRIPT.split('\n')[line] }),
    } as unknown as vscode.TextDocument;
}

describe('LibsDefinitionProvider', () => {
    it('jumps to the catalog line for a library reference', () => {
        const catalog = parseCatalogFile(catalogFile);
        const provider = new LibsDefinitionProvider(() => catalog);
        const doc = fakeBuildDoc();
        // Position inside `libs.kotlinx.coroutines.core` on line 3.
        const pos = new vscode.Position(3, 25);
        const links = provider.provideDefinition(doc, pos);
        expect(links).toBeDefined();
        expect(links!.length).toBe(1);
        expect(links![0].targetUri.fsPath).toBe(catalogFile);
        // The library is on line 4 (0-based) of the TOML.
        expect(links![0].targetRange.start.line).toBe(4);
    });

    it('jumps to the version line for libs.versions.* references', () => {
        const catalog = parseCatalogFile(catalogFile);
        const provider = new LibsDefinitionProvider(() => catalog);
        const doc = fakeBuildDoc();
        // libs.versions.coroutines is on line 4 of the script.
        const pos = new vscode.Position(4, 30);
        const links = provider.provideDefinition(doc, pos);
        expect(links).toBeDefined();
        expect(links![0].targetRange.start.line).toBe(1);
    });

    it('returns undefined when not over a libs.* reference', () => {
        const catalog = parseCatalogFile(catalogFile);
        const provider = new LibsDefinitionProvider(() => catalog);
        const doc = fakeBuildDoc();
        const pos = new vscode.Position(2, 0);
        expect(provider.provideDefinition(doc, pos)).toBeUndefined();
    });
});

describe('LibsHoverProvider', () => {
    it('shows coordinate + version on hover', () => {
        const catalog = parseCatalogFile(catalogFile);
        const provider = new LibsHoverProvider(() => catalog);
        const doc = fakeBuildDoc();
        const pos = new vscode.Position(3, 25);
        const hover = provider.provideHover(doc, pos);
        expect(hover).toBeDefined();
        const md = hover!.contents as vscode.MarkdownString;
        expect(md.value).toContain('libs.kotlinx.coroutines.core');
        expect(md.value).toContain('1.9.0');
    });
});
