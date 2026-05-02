export const KOTLIN_LSP_EXTENSION_ID = 'JetBrains.kotlin';
export const KOTLIN_LSP_REPO = 'Kotlin/kotlin-lsp';

export type KotlinLspPlatform = 'mac-amd64' | 'mac-aarch64' | 'win-amd64' | 'win-aarch64';

export interface KotlinLspRelease {
    version: string;
    tag: string;
    prerelease?: boolean;
    body?: string;
}

export const KOTLIN_LSP_FALLBACK_RELEASE: KotlinLspRelease = {
    version: '262.4739.0',
    tag: 'kotlin-lsp/v262.4739.0',
};

const RELEASE_TAG_RE = /^kotlin-lsp\/v(.+)$/;

export function versionFromKotlinLspTag(tag: string): string | undefined {
    return RELEASE_TAG_RE.exec(tag)?.[1];
}

export function kotlinLspVsixUrl(version: string, platform: KotlinLspPlatform): string {
    return `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/kotlin-server-${version}-${platform}.vsix`;
}

export function kotlinLspReleaseUrl(tag: string): string {
    return `https://github.com/${KOTLIN_LSP_REPO}/releases/tag/${encodeURIComponent(tag)}`;
}

export function kotlinLspPlatformLabel(platform: KotlinLspPlatform): string {
    switch (platform) {
        case 'mac-amd64': return 'macOS x64';
        case 'mac-aarch64': return 'macOS arm64';
        case 'win-amd64': return 'Windows x64';
        case 'win-aarch64': return 'Windows arm64';
    }
}

export function defaultKotlinLspPlatform(nodePlatform: NodeJS.Platform, nodeArch: string): KotlinLspPlatform | undefined {
    const arch = nodeArch === 'arm64' ? 'aarch64' : 'amd64';
    if (nodePlatform === 'darwin') return `mac-${arch}` as KotlinLspPlatform;
    if (nodePlatform === 'win32') return `win-${arch}` as KotlinLspPlatform;
    return undefined;
}

export function parseKotlinLspReleases(input: unknown): KotlinLspRelease[] {
    const releases = Array.isArray(input) ? input : [input];
    const out: KotlinLspRelease[] = [];
    for (const release of releases) {
        if (!release || typeof release !== 'object') continue;
        const item = release as { tag_name?: unknown; prerelease?: unknown; body?: unknown };
        if (typeof item.tag_name !== 'string') continue;
        const version = versionFromKotlinLspTag(item.tag_name);
        if (!version) continue;
        out.push({
            version,
            tag: item.tag_name,
            prerelease: item.prerelease === true,
            body: typeof item.body === 'string' ? item.body : undefined,
        });
    }
    return out;
}

export function findKotlinLspVsixUrl(body: string | undefined, platform: KotlinLspPlatform): string | undefined {
    if (!body) return undefined;
    const re = new RegExp(`https://download-cdn\\.jetbrains\\.com/kotlin-lsp/[^\\s)]+/kotlin-server-[^\\s)]+-${platform}\\.vsix`, 'g');
    return re.exec(body)?.[0];
}