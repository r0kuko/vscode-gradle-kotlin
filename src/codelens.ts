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

        // "Applies to N modules" lens for `subprojects { }` / `allprojects { }`.
        const wsModules = countSiblingModules(document.uri);
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const m = /^\s*(subprojects|allprojects)\s*\{/.exec(lines[i]);
            if (!m) continue;
            const scope = m[1];
            const applies = scope === 'allprojects' ? wsModules : Math.max(0, wsModules - 1);
            lenses.push(
                new vscode.CodeLens(new vscode.Range(i, 0, i, 0), {
                    command: '',
                    title: `$(symbol-namespace) Applies to ${applies} module${applies === 1 ? '' : 's'}`,
                    tooltip: `${scope} { ... } configures every project below the root.`,
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

/**
 * Best-effort module count for the build script's workspace folder —
 * we read `settings.gradle.kts` looking for `include(":a", ":b")` and
 * `include(":c")` lines.  This avoids invoking gradle just to draw a
 * CodeLens.
 */
function countSiblingModules(uri: vscode.Uri): number {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return 0;
    for (const candidate of ['settings.gradle.kts', 'settings.gradle']) {
        const fsPath = require('path').join(folder.uri.fsPath, candidate);
        try {
            const text = require('fs').readFileSync(fsPath, 'utf8') as string;
            const matches = text.match(/include\s*\(([^)]*)\)/g) ?? [];
            const ids = new Set<string>();
            for (const block of matches) {
                for (const lit of block.match(/["']([^"']+)["']/g) ?? []) {
                    ids.add(lit.slice(1, -1));
                }
            }
            // +1 for the root project itself.
            return ids.size + 1;
        } catch {
            /* try next candidate */
        }
    }
    return 0;
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
