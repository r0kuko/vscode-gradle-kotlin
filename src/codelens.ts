import * as vscode from 'vscode';
import { findDependenciesBlock } from './tasks';
import { parseWrapperProperties } from './wrapper';

/**
 * CodeLens provider for `build.gradle.kts` (and the Groovy variant):
 *   - "↻ Reload Project" right at the top of the file (mirroring the
 *     JetBrains floating toolbar action).
 *   - "▶ Show dependencies" anchored to the `dependencies { ... }` block.
 *   - "⤴ Upgrade wrapper" anchored to the `distributionUrl=` line of
 *     `gradle/wrapper/gradle-wrapper.properties`.
 */
export class GradleCodeLensProvider implements vscode.CodeLensProvider {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;
    private fireTimer: ReturnType<typeof setTimeout> | undefined;

    refresh(): void {
        if (this.fireTimer) clearTimeout(this.fireTimer);
        this.fireTimer = setTimeout(() => {
            this.fireTimer = undefined;
            this._onDidChange.fire();
        }, 100);
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const config = vscode.workspace.getConfiguration('gradleKotlin', document.uri);
        if (!config.get<boolean>('codeLens.enabled', true)) return [];

        if (isWrapperProperties(document)) {
            return wrapperLenses(document);
        }

        if (!isBuildScript(document)) return [];

        const text = document.getText();
        const lenses: vscode.CodeLens[] = [];

        // Top-of-file "Reload Project" lens.
        lenses.push(
            new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                command: 'gradleKotlin.reloadProject',
                title: '$(sync) Reload Project',
                tooltip: 'Re-analyze the Gradle build (equivalent to JetBrains "Reload All Gradle Projects").',
            })
        );

        // "Show dependencies" lens above the dependencies { ... } block.
        const depLine = findDependenciesBlock(text);
        if (depLine >= 0) {
            lenses.push(
                new vscode.CodeLens(new vscode.Range(depLine, 0, depLine, 0), {
                    command: 'gradleKotlin.runDependencies',
                    title: '$(symbol-package) Refresh dependencies',
                    tooltip: 'Run the `dependencies` task for this module.',
                    arguments: [document.uri],
                })
            );
        }

        return lenses;
    }
}

export function isBuildScript(document: vscode.TextDocument): boolean {
    const name = document.uri.path.split('/').pop() ?? '';
    return (
        name === 'build.gradle.kts' ||
        name === 'build.gradle' ||
        name === 'settings.gradle.kts' ||
        name === 'settings.gradle'
    );
}

function isWrapperProperties(document: vscode.TextDocument): boolean {
    return document.uri.path.endsWith('/gradle/wrapper/gradle-wrapper.properties');
}

function wrapperLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const text = document.getText();
    const parsed = parseWrapperProperties(text);
    if (!parsed) return [];
    const lines = text.split(/\r?\n/);
    const lineIndex = lines.findIndex(l => /^\s*distributionUrl\s*=/.test(l));
    if (lineIndex < 0) return [];
    return [
        new vscode.CodeLens(new vscode.Range(lineIndex, 0, lineIndex, 0), {
            command: 'gradleKotlin.upgradeWrapper',
            title: `$(arrow-up) Check for newer Gradle (current ${parsed.version})`,
            tooltip:
                'Fetches the latest stable Gradle release from services.gradle.org and offers to upgrade the wrapper.',
            arguments: [document.uri],
        }),
    ];
}
