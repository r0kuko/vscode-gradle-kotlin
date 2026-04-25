/**
 * Pure helpers for editing settings.gradle(.kts) include lines.
 */

export function normalizeProjectPath(input: string): string | undefined {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const parts = trimmed.replace(/^:+/, '').split(':').filter(Boolean);
    if (parts.length === 0) return undefined;
    if (!parts.every(p => /^[A-Za-z0-9_.-]+$/.test(p))) return undefined;
    return ':' + parts.join(':');
}

/**
 * Inserts `include(":a:b")` near other include lines or at EOF.
 * Returns original text when already present.
 */
export function insertIncludeLine(settingsText: string, projectPath: string): string {
    const includeLine = `include("${projectPath}")`;
    if (settingsText.includes(includeLine)) return settingsText;

    const lines = settingsText.split(/\r?\n/);
    let insertAt = lines.length;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*include\s*\(/.test(lines[i])) insertAt = i + 1;
    }
    lines.splice(insertAt, 0, includeLine);
    return lines.join('\n');
}

export function projectPathToRelativeDir(projectPath: string): string {
    return projectPath.replace(/^:/, '').split(':').filter(Boolean).join('/');
}
