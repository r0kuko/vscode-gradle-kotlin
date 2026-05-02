import { describe, expect, it } from 'vitest';
import {
    defaultKotlinLspPlatform,
    findKotlinLspVsixUrl,
    kotlinLspPlatformLabel,
    kotlinLspReleaseUrl,
    kotlinLspVsixUrl,
    parseKotlinLspReleases,
    versionFromKotlinLspTag,
} from '../src/kotlinLsp';

describe('kotlinLsp helpers', () => {
    it('parses Kotlin LSP release tags', () => {
        expect(versionFromKotlinLspTag('kotlin-lsp/v262.4739.0')).toBe('262.4739.0');
        expect(versionFromKotlinLspTag('v262.4739.0')).toBeUndefined();
    });

    it('builds JetBrains CDN VSIX URLs', () => {
        expect(kotlinLspVsixUrl('262.4739.0', 'mac-amd64')).toBe(
            'https://download-cdn.jetbrains.com/kotlin-lsp/262.4739.0/kotlin-server-262.4739.0-mac-amd64.vsix'
        );
        expect(kotlinLspVsixUrl('262.4739.0', 'win-aarch64')).toBe(
            'https://download-cdn.jetbrains.com/kotlin-lsp/262.4739.0/kotlin-server-262.4739.0-win-aarch64.vsix'
        );
    });

    it('builds the GitHub release URL', () => {
        expect(kotlinLspReleaseUrl('kotlin-lsp/v262.4739.0')).toBe(
            'https://github.com/Kotlin/kotlin-lsp/releases/tag/kotlin-lsp%2Fv262.4739.0'
        );
    });

    it('labels and defaults platforms', () => {
        expect(kotlinLspPlatformLabel('mac-aarch64')).toBe('macOS arm64');
        expect(kotlinLspPlatformLabel('win-amd64')).toBe('Windows x64');
        expect(defaultKotlinLspPlatform('darwin', 'arm64')).toBe('mac-aarch64');
        expect(defaultKotlinLspPlatform('win32', 'x64')).toBe('win-amd64');
        expect(defaultKotlinLspPlatform('linux', 'x64')).toBeUndefined();
    });

    it('parses GitHub release payloads', () => {
        expect(parseKotlinLspReleases([
            { tag_name: 'kotlin-lsp/v262.4739.0', prerelease: false, body: 'notes' },
            { tag_name: 'not-a-kotlin-lsp-release' },
        ])).toEqual([
            { version: '262.4739.0', tag: 'kotlin-lsp/v262.4739.0', prerelease: false, body: 'notes' },
        ]);
    });

    it('extracts platform VSIX URLs from release notes', () => {
        const body = [
            'Download for macOS-x64 https://download-cdn.jetbrains.com/kotlin-lsp/262.4739.0/kotlin-server-262.4739.0-mac-amd64.vsix',
            'Download for Windows-x64 https://download-cdn.jetbrains.com/kotlin-lsp/262.4739.0/kotlin-server-262.4739.0-win-amd64.vsix',
        ].join('\n');
        expect(findKotlinLspVsixUrl(body, 'win-amd64')).toBe(
            'https://download-cdn.jetbrains.com/kotlin-lsp/262.4739.0/kotlin-server-262.4739.0-win-amd64.vsix'
        );
    });
});