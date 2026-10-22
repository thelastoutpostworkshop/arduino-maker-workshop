import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from '../processRunner';

const fixture = (script: string, options: Parameters<typeof runProcess>[2] = {}) => runProcess(process.execPath, ['-e', script], options);

test('separates stdout and stderr, preserves exit status, and waits for trailing output', async () => {
    const result = await fixture('process.stdout.write(JSON.stringify({ok:true})); process.stderr.write("warning\\n"); process.exitCode=7;');
    assert.equal(result.exitCode, 7);
    assert.equal(result.canceled, false);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true });
    assert.equal(result.stderr, 'warning\n');
    assert.equal(result.error, undefined);
    assert.equal(result.truncated, false);
});

test('passes argv literally with shell disabled', async () => {
    const value = 'literal; $(echo nope) & "quoted"';
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', value]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), [value]);
});

test('returns a useful spawn error without throwing or hanging', async () => {
    const result = await runProcess(path.join(tmpdir(), 'arduino-runner-missing-fixture-executable'), []);
    assert.equal(result.exitCode, null);
    assert.equal(result.error?.code, 'ENOENT');
    assert.match(result.error?.message ?? '', /ENOENT/);
});

test('an already aborted request never spawns', async () => {
    const controller = new AbortController();
    controller.abort();
    let output = '';
    const result = await fixture('process.stdout.write("should not run")', { signal: controller.signal, onStdout: (text) => { output += text; } });
    assert.equal(result.canceled, true);
    assert.equal(result.exitCode, null);
    assert.equal(output, '');
    assert.equal(result.stdout, '');
});

test('canceling one request does not stop a concurrent discovery process', { timeout: 10000 }, async () => {
    const controller = new AbortController();
    const compile = fixture('process.stdout.write("ready\\n"); setInterval(()=>{},1000)', {
        signal: controller.signal,
        onStdout: (text) => { if (text.includes('ready')) { controller.abort(); } }
    });
    const discovery = fixture('setTimeout(()=>process.stdout.write("discovered"),150)');
    const [canceled, successful] = await Promise.all([compile, discovery]);
    assert.equal(canceled.canceled, true);
    assert.equal(successful.canceled, false);
    assert.equal(successful.exitCode, 0);
    assert.equal(successful.stdout, 'discovered');
});

test('cancellation closes a simulated compiler process tree', { timeout: 10000 }, async () => {
    const controller = new AbortController();
    const descendant = 'process.stdout.write("descendant-ready\\n"); setInterval(()=>{},1000)';
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','inherit','inherit']}); setInterval(()=>{},1000);`;
    const result = await fixture(parent, {
        signal: controller.signal,
        onStdout: (text) => { if (text.includes('descendant-ready')) { controller.abort(); } }
    });
    assert.equal(result.canceled, true);
    assert.ok(result.durationMs < 9000, 'descendant pipe handles should close after process-tree cancellation');
});

test('retains bounded UTF-8 tails and reports truncation on both streams', async () => {
    const result = await fixture('process.stdout.write("start"+("x".repeat(100)+"\\n").repeat(200)+"\\u00e9-tail"); process.stderr.write(("y".repeat(100)+"\\n").repeat(200)+"error-tail");', { maxOutputBytes: 128 });
    assert.equal(result.exitCode, 0);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.stdout) <= 128);
    assert.ok(Buffer.byteLength(result.stderr) <= 128);
    assert.ok(Buffer.byteLength(result.output) <= 128);
    assert.ok(result.stdout.endsWith('\u00e9-tail'));
    assert.ok(result.stderr.endsWith('error-tail'));
    assert.ok(!result.stdout.includes('\ufffd'));
});

test('retains the exact UTF-8 tail through buffer growth and repeated wraparound', async () => {
    const emitted = ('\u00e9\u4e2d\ud83d\ude00' + 'x'.repeat(22) + '\n').repeat(200) + '\u4e2d\ud83d\ude00\u00e9';
    const bytes = Buffer.from(emitted, 'utf8');
    for (const limit of [1, 5, 31, 2048]) {
        const result = await fixture(`process.stdout.write(${JSON.stringify(emitted)});`, { maxOutputBytes: limit });
        let start = bytes.length - limit;
        while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) { start++; }
        const expected = bytes.subarray(start).toString('utf8');
        assert.equal(result.stdout, expected, `stdout tail for a ${limit}-byte budget`);
        assert.equal(result.output, expected, `combined tail for a ${limit}-byte budget`);
        assert.equal(result.truncated, true);
        assert.ok(!result.stdout.includes('\ufffd'));
    }
});

test('retaining a multiline inventory encodes only a linear amount of output', async (context) => {
    const items = Array.from({ length: 512 }, (_, index) => ({ name: `Library ${index}`, version: '1.2.3', installed: false }));
    const expected = JSON.stringify({ libraries: items }, null, 2);
    const inputBytes = Buffer.byteLength(expected, 'utf8');
    const originalFrom = Buffer.from;
    let encodedBytes = 0;
    context.mock.method(Buffer, 'from', ((value: unknown, ...args: unknown[]): Buffer => {
        if (typeof value === 'string') { encodedBytes += Buffer.byteLength(value, 'utf8'); }
        return Reflect.apply(originalFrom, Buffer, [value, ...args]) as Buffer;
    }) as typeof Buffer.from);

    const result = await fixture(`process.stdout.write(JSON.stringify({libraries:Array.from({length:512},(_,index)=>({name:'Library '+index,version:'1.2.3',installed:false}))},null,2));`, {
        maxOutputBytes: 8 * 1024 * 1024
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.output, expected);
    assert.equal(result.truncated, false);
    // Measure work instead of elapsed time: re-encoding the retained prefix on
    // each line becomes quadratic and stalls the extension host on real catalogs.
    assert.ok(encodedBytes <= inputBytes * 4 + 64 * 1024,
        `${encodedBytes} encoded bytes for ${inputBytes} bytes of CLI output`);
});

test('preserves compact JSON lines larger than 8 KiB within the configured output budget', async () => {
    const result = await fixture('process.stdout.write(JSON.stringify({boards:"x".repeat(20000)}));', { maxOutputBytes: 64 * 1024 });
    assert.equal(result.exitCode, 0);
    assert.equal(result.truncated, false);
    assert.ok(Buffer.byteLength(result.stdout) > 20 * 1000);
    assert.deepEqual(JSON.parse(result.stdout), { boards: 'x'.repeat(20000) });
});

test('redacts a known credential split across output chunks before callbacks and retention', async () => {
    let visible = '';
    const result = await fixture('process.stdout.write("prefix super-"); setTimeout(()=>{process.stdout.write("secret suffix\\n"); process.stderr.write("super-secret");},50)', {
        sensitiveValues: ['super-secret'],
        onStdout: (text) => { visible += text; },
        onStderr: (text) => { visible += text; }
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'prefix <redacted> suffix\n');
    assert.equal(result.stderr, '<redacted>');
    assert.ok(!visible.includes('super-secret'));
    assert.ok(!result.output.includes('super-secret'));
});

test('handles overlapping credential values without retaining the longer secret', async () => {
    const result = await fixture('process.stdout.write("abcde abc");', { sensitiveValues: ['abc', 'abcde'] });
    assert.equal(result.stdout, '<redacted> <redacted>');
});

test('redacts unknown credential keys and values split across chunks before callbacks', async () => {
    const seen: string[] = [];
    const result = await fixture('process.stdout.write("password="); process.stderr.write("API_"); setTimeout(()=>{process.stdout.write("dummy-value\\n"); process.stderr.write("KEY=another-dummy\\n");},100)', {
        onStdout: (text) => { seen.push(text); },
        onStderr: (text) => { seen.push(text); }
    });
    assert.equal(result.stdout, 'password=<redacted>\n');
    assert.equal(result.stderr, 'API_KEY=<redacted>\n');
    assert.equal(result.truncated, false);
    assert.ok(seen.every((text) => !text.includes('dummy-value') && !text.includes('another-dummy')));
    assert.ok(!result.output.includes('dummy'));
});

test('redacts unknown split credentials at EOF without a newline', async () => {
    let visible = '';
    const result = await fixture('process.stdout.write("auth="); setTimeout(()=>process.stdout.write("dummy-eof"),50)', {
        onStdout: (text) => { visible += text; }
    });
    assert.equal(result.stdout, 'auth=<redacted>');
    assert.equal(visible, 'auth=<redacted>');
});

test('omits oversized lines without emitting a credential prefix and resumes after newline', async () => {
    let visible = '';
    const result = await fixture('process.stdout.write("password="+"x".repeat(8190)); setTimeout(()=>{process.stdout.write("dummy-long-secret"+"x".repeat(1024*1024)+"\\nsafe final line\\n");},50)', {
        maxOutputBytes: 128,
        onStdout: (text) => { visible += text; }
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.truncated, true);
    assert.ok(visible.includes('output line omitted'));
    assert.ok(visible.endsWith('safe final line\n'));
    assert.ok(!visible.includes('password=') && !visible.includes('dummy-long-secret'));
    assert.ok(Buffer.byteLength(visible) < 128);
    assert.ok(Buffer.byteLength(result.stdout) <= 128);
});

test('omits an oversized unterminated line and reports truncation at EOF', async () => {
    const result = await fixture('process.stderr.write("access_token="+"x".repeat(1024*1024))', { maxOutputBytes: 128 });
    assert.equal(result.exitCode, 0);
    assert.equal(result.truncated, true);
    assert.match(result.stderr, /output line omitted/);
    assert.ok(!result.stderr.includes('access_token='));
    assert.ok(Buffer.byteLength(result.stderr) < 128);
});
