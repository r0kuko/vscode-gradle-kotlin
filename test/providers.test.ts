import { describe, it, expect, vi } from 'vitest';
import { GradleCodeLensProvider } from '../src/codelens';
import { LibsCompletionProvider } from '../src/completion';
import { parseCatalog } from '../src/libs';
import { GradleModulesProvider } from '../src/treeProvider';
import * as vscode from 'vscode';

const SAMPLE_BUILD = [
    'plugins { kotlin("jvm") }',
    '',
    'dependencies {',
    '    implementation(libs.kotlinx.coroutines.core)',
    '}',
].join('\n');

const TOML = `
[versions]
coroutines = "1.9.0"
[libraries]
kotlinx-coroutines-core = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-core", version.ref = "coroutines" }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version = "5.11.3" }
[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version = "2.0.21" }
[bundles]
testing = ["junit-jupiter"]
`;

function fakeDocument(name: string, text: string): vscode.TextDocument {
    return {
        uri: vscode.Uri.file(`/ws/${name}`),
        getText: () => text,
        lineAt: (line: number) => ({ text: text.split('\n')[line] }),
    } as unknown as vscode.TextDocument;
}

describe('GradleCodeLensProvider', () => {
    it('emits a top-of-file Reload lens and a dependencies-block lens', () => {
        const provider = new GradleCodeLensProvider();
        const doc = fakeDocument('build.gradle.kts', SAMPLE_BUILD);
        const lenses = provider.provideCodeLenses(doc);
        expect(lenses.length).toBe(2);
        expect(lenses[0].command?.command).toBe('gradleKotlin.reloadProject');
        expect(lenses[1].command?.command).toBe('gradleKotlin.runDependencies');
        // Dependencies lens points at the line with `dependencies {`.
        expect(lenses[1].range.startLine).toBe(2);
    });

    it('returns nothing for non-build scripts', () => {
        const provider = new GradleCodeLensProvider();
        const doc = fakeDocument('Main.kt', 'fun main() {}');
        expect(provider.provideCodeLenses(doc)).toEqual([]);
    });
});

describe('LibsCompletionProvider', () => {
    const catalog = parseCatalog(TOML);

    it('offers libs.* aliases when typing after `libs.`', () => {
        const provider = new LibsCompletionProvider(() => catalog);
        const text = '    implementation(libs.';
        const doc = {
            uri: vscode.Uri.file('/ws/build.gradle.kts'),
            getText: () => text,
            lineAt: (_l: number) => ({ text }),
        } as unknown as vscode.TextDocument;
        const items = provider.provideCompletionItems(doc, new vscode.Position(0, text.length));
        const labels = items.map(i => i.label);
        expect(labels).toContain('libs.kotlinx.coroutines.core');
        expect(labels).toContain('libs.plugins.kotlin.jvm');
        expect(labels).toContain('libs.bundles.testing');
        expect(labels).toContain('libs.versions.coroutines');
    });

    it('returns nothing when the caret is not after `libs.`', () => {
        const provider = new LibsCompletionProvider(() => catalog);
        const text = '    implementation(';
        const doc = {
            uri: vscode.Uri.file('/ws/build.gradle.kts'),
            getText: () => text,
            lineAt: (_l: number) => ({ text }),
        } as unknown as vscode.TextDocument;
        const items = provider.provideCompletionItems(doc, new vscode.Position(0, text.length));
        expect(items).toEqual([]);
    });

    it('completes plugin ids inside id("…")', () => {
        const provider = new LibsCompletionProvider(() => catalog);
        const text = 'plugins { id("org.jetbrains';
        const doc = {
            uri: vscode.Uri.file('/ws/build.gradle.kts'),
            getText: () => text,
            lineAt: (_l: number) => ({ text }),
        } as unknown as vscode.TextDocument;
        const items = provider.provideCompletionItems(doc, new vscode.Position(0, text.length));
        const labels = items.map(i => i.label);
        expect(labels).toContain('org.jetbrains.kotlin.jvm');
    });

    it('completes kotlin("jvm") with the short id only', () => {
        const provider = new LibsCompletionProvider(() => catalog);
        const text = 'plugins { kotlin("';
        const doc = {
            uri: vscode.Uri.file('/ws/build.gradle.kts'),
            getText: () => text,
            lineAt: (_l: number) => ({ text }),
        } as unknown as vscode.TextDocument;
        const items = provider.provideCompletionItems(doc, new vscode.Position(0, text.length));
        const labels = items.map(i => i.label);
        expect(labels).toContain('jvm');
        expect(labels).not.toContain('org.jetbrains.kotlin.jvm');
    });
});

describe('GradleModulesProvider multi-root', () => {
    it('clears stale roots on clear()', () => {
        const provider = new GradleModulesProvider('/ext');
        provider.setModules('/ws1', [
            {
                rootPath: '/ws1',
                projectPath: ':',
                name: 'ws1',
                workspaceRoot: '/ws1',
                buildScript: '/ws1/build.gradle.kts',
                kotlinDsl: true,
            },
        ]);
        provider.setModules('/ws2', [
            {
                rootPath: '/ws2',
                projectPath: ':',
                name: 'ws2',
                workspaceRoot: '/ws2',
                buildScript: '/ws2/build.gradle.kts',
                kotlinDsl: true,
            },
        ]);
        expect(provider.getChildren(undefined).length).toBe(2);
        provider.clear();
        expect(provider.getChildren(undefined).length).toBe(0);
    });
});
