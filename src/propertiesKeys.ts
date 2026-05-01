/**
 * Curated documentation for well-known `gradle.properties` keys.  The
 * data lives in a pure module so unit tests don't need the vscode API.
 */

export interface PropertyDoc {
    /** The property key, e.g. `org.gradle.jvmargs`. */
    key: string;
    /** Short summary used in hover popups. */
    summary: string;
    /** Optional default the user gets when they don't set the key. */
    defaultValue?: string;
    /** Optional one-line link target. */
    link?: string;
    /** Pure validator — return undefined when the value is OK. */
    validate?: (value: string) => string | undefined;
}

export const PROPERTY_DOCS: PropertyDoc[] = [
    {
        key: 'org.gradle.jvmargs',
        summary:
            'JVM arguments passed to the Gradle daemon. Use `-Xmx<size>` to bump the heap; ' +
            'the typical bump for Android / large multi-module projects is `-Xmx4g`.',
        defaultValue: '-Xmx512m',
        link: 'https://docs.gradle.org/current/userguide/build_environment.html#sec:gradle_configuration_properties',
        validate: v => (/-Xmx\d+[mMgG]/.test(v) ? undefined : 'Recommended: include an explicit -Xmx value (e.g. -Xmx2g).'),
    },
    {
        key: 'org.gradle.parallel',
        summary: 'Build independent tasks in parallel across modules. Major speed-up on multi-project builds.',
        defaultValue: 'false',
    },
    {
        key: 'org.gradle.caching',
        summary: 'Enable Gradle build cache for inputs/outputs reuse across CI agents and local clean builds.',
        defaultValue: 'false',
    },
    {
        key: 'org.gradle.configuration-cache',
        summary: 'Persist the configuration phase result; massively speeds up subsequent invocations of unchanged builds.',
        defaultValue: 'false',
        link: 'https://docs.gradle.org/current/userguide/configuration_cache.html',
    },
    {
        key: 'org.gradle.daemon',
        summary: 'Whether Gradle may keep a daemon process alive between builds. Disabling reduces idle memory at the cost of startup time.',
        defaultValue: 'true',
    },
    {
        key: 'org.gradle.daemon.idletimeout',
        summary: 'Idle daemons are stopped after this many milliseconds. Default: 3 hours.',
        defaultValue: '10800000',
    },
    {
        key: 'org.gradle.workers.max',
        summary: 'Cap the number of worker threads/processes spawned for parallel work.',
    },
    {
        key: 'org.gradle.logging.level',
        summary: 'Default Gradle log level: quiet | warn | lifecycle | info | debug.',
        defaultValue: 'lifecycle',
        validate: v =>
            ['quiet', 'warn', 'lifecycle', 'info', 'debug'].includes(v.trim())
                ? undefined
                : 'Expected one of: quiet, warn, lifecycle, info, debug.',
    },
    {
        key: 'kotlin.code.style',
        summary: 'Default Kotlin code style applied by IntelliJ and ktlint integrations: `official` or `obsolete`.',
        defaultValue: 'official',
        validate: v =>
            ['official', 'obsolete'].includes(v.trim())
                ? undefined
                : 'Expected `official` or `obsolete`.',
    },
    {
        key: 'kotlin.incremental',
        summary: 'Enable Kotlin compiler incremental compilation. Disabling forces full rebuilds.',
        defaultValue: 'true',
    },
    {
        key: 'kotlin.mpp.enableCInteropCommonization',
        summary: 'Enable cinterop commonization for Kotlin Multiplatform native targets.',
    },
    {
        key: 'kapt.use.worker.api',
        summary: 'Run kapt processors via Gradle workers (parallel, isolated).',
        defaultValue: 'true',
    },
    {
        key: 'android.useAndroidX',
        summary: 'Migrate to AndroidX support libraries. Required by modern Android Gradle plugin versions.',
        defaultValue: 'true',
    },
    {
        key: 'android.enableJetifier',
        summary: 'Rewrite legacy Support library references to AndroidX at build time. Slows builds — disable when no transitive depends.',
        defaultValue: 'false',
    },
    {
        key: 'android.nonTransitiveRClass',
        summary: 'Generate per-module R classes only with the resources declared in that module — much faster builds.',
        defaultValue: 'true',
    },
];

const byKey = new Map(PROPERTY_DOCS.map(d => [d.key, d]));

export function lookupProperty(key: string): PropertyDoc | undefined {
    return byKey.get(key);
}

/**
 * Parse a `gradle.properties`-style line, returning `{ key, value }` or
 * `undefined` when the line is empty/comment.  Properties files allow
 * `key=value`, `key:value`, `key value` and backslash continuations —
 * we only need single-line `key=value` because gradle.properties values
 * are almost always short.
 */
export function parsePropertyLine(line: string): { key: string; value: string } | undefined {
    if (!line || /^\s*[#!]/.test(line)) return undefined;
    const m = /^\s*([\w.-]+)\s*[=: ]\s*(.+?)\s*$/.exec(line);
    if (!m) return undefined;
    return { key: m[1], value: m[2] };
}
