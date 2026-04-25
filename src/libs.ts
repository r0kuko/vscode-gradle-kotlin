import * as fs from 'fs';
import * as path from 'path';

/**
 * A parsed `gradle/libs.versions.toml` file (Gradle's version catalog).
 *
 * Only the bits we need for completion + inlay hints are extracted —
 * the goal is not to be a fully-spec-compliant TOML parser.
 */
export interface VersionCatalog {
    /** Absolute path to the source file (so providers can resolve "Go to definition"). */
    file: string;
    /** Map of `versionAlias` → version string. */
    versions: Map<string, string>;
    /** Map of `libraryAlias` → resolved library info. Aliases use `.` separators. */
    libraries: Map<string, LibraryEntry>;
    /** Map of `pluginAlias` → resolved plugin info. */
    plugins: Map<string, PluginEntry>;
    /** Map of `bundleAlias` → list of library aliases. */
    bundles: Map<string, string[]>;
}

export interface LibraryEntry {
    alias: string;
    /** "group:name" (no version). */
    coordinate: string;
    group: string;
    name: string;
    /** Resolved version literal (after looking up version.ref). */
    version?: string;
    /** Original `version.ref` if used. */
    versionRef?: string;
    /** Source-file line number (0-based) of the alias declaration. */
    line: number;
}

export interface PluginEntry {
    alias: string;
    id: string;
    version?: string;
    versionRef?: string;
    line: number;
}

/** Discover the catalog file inside a workspace folder. */
export function findCatalogFile(workspaceRoot: string): string | undefined {
    const candidates = [
        path.join(workspaceRoot, 'gradle', 'libs.versions.toml'),
        path.join(workspaceRoot, 'libs.versions.toml'),
    ];
    for (const c of candidates) {
        try {
            if (fs.statSync(c).isFile()) return c;
        } catch {
            /* ignore */
        }
    }
    return undefined;
}

export function parseCatalogFile(file: string): VersionCatalog | undefined {
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
    return parseCatalog(text, file);
}

const SECTION_RE = /^\s*\[([A-Za-z][\w-]*)\]\s*(?:#.*)?$/;
const KV_RE = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*(?:#.*)?$/;

/**
 * A deliberately tiny TOML reader: enough to read the four sections
 * `[versions]`, `[libraries]`, `[plugins]` and `[bundles]` produced by
 * Gradle's version-catalog plugin. Inline tables are recognised, full
 * multi-line nested tables are NOT.
 */
export function parseCatalog(text: string, file = '<inline>'): VersionCatalog {
    const versions = new Map<string, string>();
    const libraries = new Map<string, LibraryEntry>();
    const plugins = new Map<string, PluginEntry>();
    const bundles = new Map<string, string[]>();

    let section: string | undefined;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.replace(/^\s*#.*$/, '').trimEnd();
        if (!trimmed) continue;

        const sec = trimmed.match(SECTION_RE);
        if (sec) {
            section = sec[1].toLowerCase();
            continue;
        }
        if (!section) continue;

        const kv = trimmed.match(KV_RE);
        if (!kv) continue;
        const key = kv[1];
        const value = kv[2];

        switch (section) {
            case 'versions':
                versions.set(key, stripQuotes(value));
                break;
            case 'libraries': {
                const entry = parseLibraryValue(key, value, i);
                if (entry) libraries.set(key, entry);
                break;
            }
            case 'plugins': {
                const entry = parsePluginValue(key, value, i);
                if (entry) plugins.set(key, entry);
                break;
            }
            case 'bundles': {
                const list = parseStringArray(value);
                if (list) bundles.set(key, list);
                break;
            }
        }
    }

    // Resolve version refs.
    for (const lib of libraries.values()) {
        if (lib.versionRef) {
            const v = versions.get(lib.versionRef);
            if (v) lib.version = v;
        }
    }
    for (const pl of plugins.values()) {
        if (pl.versionRef) {
            const v = versions.get(pl.versionRef);
            if (v) pl.version = v;
        }
    }

    return { file, versions, libraries, plugins, bundles };
}

function parseLibraryValue(alias: string, value: string, line: number): LibraryEntry | undefined {
    if (value.startsWith('"') || value.startsWith("'")) {
        // Shorthand: alias = "group:name:version"
        const literal = stripQuotes(value);
        const parts = literal.split(':');
        if (parts.length < 2) return undefined;
        return {
            alias,
            coordinate: `${parts[0]}:${parts[1]}`,
            group: parts[0],
            name: parts[1],
            version: parts[2],
            line,
        };
    }
    const inline = readInlineTable(value);
    if (!inline) return undefined;
    let group = inline.get('group');
    let name = inline.get('name');
    const module = inline.get('module');
    if (module && (!group || !name)) {
        const parts = stripQuotes(module).split(':');
        group = group ?? `"${parts[0]}"`;
        name = name ?? `"${parts[1] ?? ''}"`;
    }
    if (!group || !name) return undefined;
    const versionLit = inline.get('version');
    const versionRef = inline.get('version.ref');
    return {
        alias,
        group: stripQuotes(group),
        name: stripQuotes(name),
        coordinate: `${stripQuotes(group)}:${stripQuotes(name)}`,
        version: versionLit ? stripQuotes(versionLit) : undefined,
        versionRef: versionRef ? stripQuotes(versionRef) : undefined,
        line,
    };
}

function parsePluginValue(alias: string, value: string, line: number): PluginEntry | undefined {
    if (value.startsWith('"') || value.startsWith("'")) {
        return { alias, id: stripQuotes(value), line };
    }
    const inline = readInlineTable(value);
    if (!inline) return undefined;
    const id = inline.get('id');
    if (!id) return undefined;
    const versionLit = inline.get('version');
    const versionRef = inline.get('version.ref');
    return {
        alias,
        id: stripQuotes(id),
        version: versionLit ? stripQuotes(versionLit) : undefined,
        versionRef: versionRef ? stripQuotes(versionRef) : undefined,
        line,
    };
}

function readInlineTable(value: string): Map<string, string> | undefined {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
    const inner = trimmed.slice(1, -1);
    const map = new Map<string, string>();
    // Split on commas that are NOT inside quotes.
    const parts = splitTopLevelCommas(inner);
    for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        map.set(k, v);
    }
    return map;
}

function splitTopLevelCommas(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let inQuote: string | undefined;
    let buf = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQuote) {
            buf += c;
            if (c === inQuote && s[i - 1] !== '\\') inQuote = undefined;
            continue;
        }
        if (c === '"' || c === "'") {
            inQuote = c;
            buf += c;
            continue;
        }
        if (c === '{' || c === '[') depth++;
        if (c === '}' || c === ']') depth--;
        if (c === ',' && depth === 0) {
            out.push(buf);
            buf = '';
            continue;
        }
        buf += c;
    }
    if (buf.trim()) out.push(buf);
    return out;
}

function parseStringArray(value: string): string[] | undefined {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined;
    const inner = trimmed.slice(1, -1);
    return splitTopLevelCommas(inner)
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(stripQuotes);
}

function stripQuotes(s: string): string {
    const t = s.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
}

/**
 * Convert `libs.foo.bar` → `foo-bar` (the alias as it appears in the
 * catalog file). Gradle automatically maps `-` and `_` segments to `.`.
 */
export function libsRefToAlias(ref: string): string {
    if (!ref.startsWith('libs.')) return ref;
    return ref.slice('libs.'.length).replace(/\./g, '-');
}

/**
 * Inverse of `libsRefToAlias` — used for completion items.
 */
export function aliasToLibsRef(alias: string): string {
    return 'libs.' + alias.replace(/[-_]/g, '.');
}

/**
 * Resolve a `libs.x.y.z` reference against a catalog. Returns the matching
 * library/plugin/bundle/version (in that lookup order).
 */
export interface LibsResolution {
    kind: 'library' | 'plugin' | 'bundle' | 'version';
    alias: string;
    /** Display label for inlay hint (`"3.1.1"` for a library, `"androidx.core:core:1.13"` etc.). */
    inlayLabel: string;
    /** Markdown-friendly tooltip / hover text. */
    tooltip: string;
}

export function resolveLibsRef(
    catalog: VersionCatalog,
    ref: string
): LibsResolution | undefined {
    const alias = libsRefToAlias(ref);
    // libs.versions.x → version
    if (alias.startsWith('versions-')) {
        const versionAlias = alias.slice('versions-'.length);
        const v = catalog.versions.get(versionAlias);
        if (v) {
            return {
                kind: 'version',
                alias: versionAlias,
                inlayLabel: v,
                tooltip: `version **${versionAlias}** = \`${v}\``,
            };
        }
    }
    if (alias.startsWith('plugins-')) {
        const plAlias = alias.slice('plugins-'.length);
        const pl = catalog.plugins.get(plAlias);
        if (pl) {
            const v = pl.version ?? '?';
            return {
                kind: 'plugin',
                alias: plAlias,
                inlayLabel: `${pl.id}:${v}`,
                tooltip: `plugin **${pl.id}** = \`${v}\``,
            };
        }
    }
    if (alias.startsWith('bundles-')) {
        const bAlias = alias.slice('bundles-'.length);
        const list = catalog.bundles.get(bAlias);
        if (list) {
            return {
                kind: 'bundle',
                alias: bAlias,
                inlayLabel: `bundle(${list.length})`,
                tooltip: `bundle **${bAlias}** → ${list.map(s => '`' + s + '`').join(', ')}`,
            };
        }
    }
    const lib = catalog.libraries.get(alias);
    if (lib) {
        const v = lib.version ?? '?';
        return {
            kind: 'library',
            alias,
            inlayLabel: v,
            tooltip: `${lib.coordinate}:${v}`,
        };
    }
    return undefined;
}

/**
 * Locate every `libs.x.y.z` reference inside a build script. Returns
 * `{ ref, line, character, length }` for each match — providers turn
 * those into ranges/edits.
 */
export interface LibsReference {
    ref: string;
    line: number;
    character: number;
    length: number;
}

const LIBS_REF_RE = /\blibs\.(?:[A-Za-z_][\w]*)(?:\.[A-Za-z_][\w]*)*/g;

export function findLibsReferences(text: string): LibsReference[] {
    const out: LibsReference[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        LIBS_REF_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = LIBS_REF_RE.exec(lines[i])) !== null) {
            out.push({
                ref: m[0],
                line: i,
                character: m.index,
                length: m[0].length,
            });
        }
    }
    return out;
}
