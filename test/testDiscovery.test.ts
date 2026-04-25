import { describe, expect, it } from 'vitest';
import { parseKotlinTestFile } from '../src/testDiscovery';

describe('parseKotlinTestFile', () => {
    it('extracts class + @Test methods with correct fqcn', () => {
        const src = `package com.example.foo

import org.junit.jupiter.api.Test

class BarTest {
    @Test
    fun \`adds two numbers\`() {
        assert(1 + 1 == 2)
    }

    @Test
    fun multiplies() {}

    fun helper() {}
}
`;
        const result = parseKotlinTestFile('/x/BarTest.kt', src);
        expect(result).toHaveLength(1);
        const cls = result[0];
        expect(cls.fqcn).toBe('com.example.foo.BarTest');
        expect(cls.simpleName).toBe('BarTest');
        expect(cls.methods.map(m => m.name)).toEqual(['adds two numbers', 'multiplies']);
    });

    it('skips classes without @Test methods', () => {
        const src = `package p

class Plain {
    fun foo() {}
}
`;
        expect(parseKotlinTestFile('/x.kt', src)).toEqual([]);
    });

    it('handles default package and JUnit4 @org.junit.Test annotation', () => {
        const src = `import org.junit.Test

class RootTest {
    @org.junit.Test fun a() {}
}
`;
        const result = parseKotlinTestFile('/x.kt', src);
        expect(result).toHaveLength(1);
        expect(result[0].fqcn).toBe('RootTest');
        expect(result[0].packageName).toBe('');
        expect(result[0].methods).toEqual([{ name: 'a', line: 3 }]);
    });
});
