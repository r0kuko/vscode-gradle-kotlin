/**
 * Pure CLI argument splitter, lifted from a shell tokenizer.
 *
 * Supports:
 *  - whitespace separation
 *  - "double quoted" runs (preserve embedded whitespace)
 *  - 'single quoted' runs (no escape interpretation, like POSIX shells)
 *  - backslash escapes outside quotes (`\ ` → literal space)
 *  - backslash escapes inside double quotes for `\"` and `\\`
 *
 * Unterminated quotes are treated as if closed at end-of-string.
 *
 * Pure — must not import `vscode`.
 */
export function splitArgs(input: string): string[] {
    const out: string[] = [];
    let buf = '';
    let inDouble = false;
    let inSingle = false;
    let pending = false; // we're in the middle of an arg even when buf is empty

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (inSingle) {
            if (ch === "'") {
                inSingle = false;
            } else {
                buf += ch;
            }
            continue;
        }
        if (inDouble) {
            if (ch === '\\' && i + 1 < input.length) {
                const next = input[i + 1];
                if (next === '"' || next === '\\') {
                    buf += next;
                    i++;
                    continue;
                }
            }
            if (ch === '"') {
                inDouble = false;
            } else {
                buf += ch;
            }
            continue;
        }

        if (ch === '"') {
            inDouble = true;
            pending = true;
            continue;
        }
        if (ch === "'") {
            inSingle = true;
            pending = true;
            continue;
        }
        if (ch === '\\' && i + 1 < input.length) {
            buf += input[i + 1];
            i++;
            pending = true;
            continue;
        }
        if (/\s/.test(ch)) {
            if (buf.length > 0 || pending) {
                out.push(buf);
                buf = '';
                pending = false;
            }
            continue;
        }
        buf += ch;
        pending = true;
    }

    if (buf.length > 0 || pending) out.push(buf);
    return out;
}
