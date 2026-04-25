import { describe, it, expect } from 'vitest';
import { splitArgs } from '../src/argSplit';

describe('splitArgs', () => {
    it('splits on whitespace', () => {
        expect(splitArgs('a b  c')).toEqual(['a', 'b', 'c']);
    });

    it('preserves double-quoted whitespace', () => {
        expect(splitArgs('--tests "*Foo Bar*"')).toEqual(['--tests', '*Foo Bar*']);
    });

    it('preserves single-quoted whitespace and ignores nested escapes', () => {
        expect(splitArgs("--tests 'com.x.Y' -Pfoo='a b'")).toEqual([
            '--tests',
            'com.x.Y',
            "-Pfoo=a b",
        ]);
    });

    it('handles backslash escape outside quotes', () => {
        expect(splitArgs('foo\\ bar baz')).toEqual(['foo bar', 'baz']);
    });

    it('handles backslash-escaped quote inside double quotes', () => {
        expect(splitArgs('"a \\"b\\" c"')).toEqual(['a "b" c']);
    });

    it('keeps empty quoted strings as separate args', () => {
        expect(splitArgs('-Pname="" --foo')).toEqual(['-Pname=', '--foo']);
    });

    it('treats unterminated quotes as closed at EOL', () => {
        expect(splitArgs('--tests "unterminated')).toEqual(['--tests', 'unterminated']);
    });

    it('returns empty array for whitespace-only input', () => {
        expect(splitArgs('   ')).toEqual([]);
    });
});
