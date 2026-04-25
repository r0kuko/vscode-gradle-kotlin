/**
 * Pure refactoring helpers used by `ExtraCodeActions`:
 *   - move an inline `"group:name:version"` dependency declaration into
 *     `libs.versions.toml`
 *   - toggle a dependency configuration (`implementation` ↔ `api` ↔
 *     `compileOnly` ↔ `runtimeOnly`).
 */

const TOGGLE_CYCLE = ['implementation', 'api', 'compileOnly', 'runtimeOnly'] as const;
const TEST_CYCLE = ['testImplementation', 'testRuntimeOnly', 'testCompileOnly'] as const;

export function nextConfiguration(current: string): string {
    const cycles: readonly (readonly string[])[] = [TOGGLE_CYCLE, TEST_CYCLE];
    for (const cycle of cycles) {
        const idx = cycle.indexOf(current as never);
        if (idx >= 0) return cycle[(idx + 1) % cycle.length];
    }
    return current;
}

/**
 * Sanitize a Maven coordinate into a TOML-safe alias following the
 * Gradle convention: lowercased, hyphens, no consecutive dashes.
 */
export function suggestCatalogAlias(group: string, name: string): {
    versionAlias: string;
    libraryAlias: string;
} {
    const base = (group.split('.').slice(-1)[0] ?? group).toLowerCase();
    const tail = name.toLowerCase().replace(/[._]/g, '-');
    const libraryAlias = uniqueDashes(`${base}-${tail}`);
    const versionAlias = uniqueDashes(`${base}-${tail.split('-')[0]}`);
    return { versionAlias, libraryAlias };
}

function uniqueDashes(s: string): string {
    return s.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Append a `[versions]` and `[libraries]` entry to existing TOML text.
 * Sections are created when missing.  Returns the new text and the
 * resulting catalog reference (`libs.foo.bar`) for the build script.
 */
export function appendCatalogEntry(
    tomlText: string,
    entry: { group: string; name: string; version: string }
): { newText: string; reference: string } {
    const { versionAlias, libraryAlias } = suggestCatalogAlias(entry.group, entry.name);
    let text = tomlText;
    if (!/\[versions\]/.test(text)) {
        text = `[versions]\n${text}`.trimEnd() + '\n';
    }
    if (!/\[libraries\]/.test(text)) {
        text = text.trimEnd() + `\n\n[libraries]\n`;
    }

    text = text.replace(/(\[versions\][^\[]*?)(?=\n\[|$)/, (block: string) =>
        block.trimEnd() + `\n${versionAlias} = "${entry.version}"\n`
    );
    text = text.replace(/(\[libraries\][^\[]*?)(?=\n\[|$)/, (block: string) =>
        block.trimEnd() +
        `\n${libraryAlias} = { group = "${entry.group}", name = "${entry.name}", version.ref = "${versionAlias}" }\n`
    );

    return {
        newText: text,
        reference: 'libs.' + libraryAlias.replace(/-/g, '.'),
    };
}
