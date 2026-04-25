import { describe, expect, it } from 'vitest';
import { guessGitHubRepo } from '../src/mavenSearch';

describe('guessGitHubRepo', () => {
    it('maps well-known groups to their canonical repo', () => {
        expect(guessGitHubRepo('com.squareup.okhttp3', 'okhttp')).toBe('square/okhttp');
        expect(guessGitHubRepo('org.jetbrains.kotlinx', 'kotlinx-coroutines-core')).toBe(
            'Kotlin/kotlinx-coroutines-core'
        );
    });

    it('decodes com.github.<owner>.<repo> JitPack groups', () => {
        expect(guessGitHubRepo('com.github.bumptech.glide', 'glide')).toBe('bumptech/glide/glide');
    });

    it('returns undefined for unknown groups', () => {
        expect(guessGitHubRepo('com.example.something', 'lib')).toBeUndefined();
    });
});
