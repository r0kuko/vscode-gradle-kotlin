import { describe, expect, it } from 'vitest';
import { parseJUnitXml } from '../src/junitReport';

describe('parseJUnitXml', () => {
    it('parses passed / failed / skipped cases', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.FooTest" tests="3">
  <testcase classname="com.example.FooTest" name="passes" time="0.012"/>
  <testcase classname="com.example.FooTest" name="fails" time="0.5">
    <failure message="boom &amp; bust" type="AssertionError">stack&#10;here</failure>
  </testcase>
  <testcase classname="com.example.FooTest" name="ignored" time="0">
    <skipped/>
  </testcase>
</testsuite>`;
        const cases = parseJUnitXml(xml);
        expect(cases).toHaveLength(3);
        expect(cases[0]).toMatchObject({ name: 'passes', status: 'passed', durationSec: 0.012 });
        expect(cases[1]).toMatchObject({
            name: 'fails',
            status: 'failed',
            durationSec: 0.5,
            message: 'boom & bust',
        });
        expect(cases[2]).toMatchObject({ name: 'ignored', status: 'skipped' });
    });

    it('treats <error> as errored and falls back to inner text when message attr missing', () => {
        const xml = `<testsuite>
  <testcase classname="X" name="oops">
    <error type="RuntimeException">java.lang.RuntimeException: nope</error>
  </testcase>
</testsuite>`;
        const cases = parseJUnitXml(xml);
        expect(cases).toHaveLength(1);
        expect(cases[0]).toMatchObject({
            status: 'errored',
            message: 'java.lang.RuntimeException: nope',
        });
    });
});
