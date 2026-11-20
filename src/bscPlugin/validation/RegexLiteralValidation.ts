import { DiagnosticMessages } from '../../DiagnosticMessages';

/**
 * A problem found in a regex literal
 */
export interface RegexLiteralProblem {
    diagnostic: ReturnType<typeof DiagnosticMessages.invalidRegexPattern | typeof DiagnosticMessages.unknownRegexFlag>;
    /**
     * Offset of the first character of the problem, relative to the start of the literal (the leading `/` is offset 0)
     */
    start: number;
    /**
     * Offset just past the last character of the problem, relative to the start of the literal
     */
    end: number;
}

/**
 * The flags `roRegex` supports. See https://developer.roku.com/docs/references/brightscript/components/roregex.md
 */
const supportedFlags = new Set(['i', 'm', 's', 'x']);

/**
 * Find mistakes in a regex literal (i.e. `/(abc/i`) that would make `roRegex` fail at runtime.
 *
 * `roRegex` uses PCRE, so this only reports structural errors that are invalid in every regex dialect (unbalanced parens and
 * brackets, quantifiers with nothing to repeat, out-of-order `{n,m}` ranges). It deliberately does not try to fully parse
 * PCRE, so valid PCRE-only syntax (possessive quantifiers, atomic groups, inline modifiers, verbs) is never flagged.
 * @param text the full text of the regex literal token, including the slashes and any flags
 */
export function findRegexLiteralProblems(text: string): RegexLiteralProblem[] {
    const problems: RegexLiteralProblem[] = [];
    //the lexer guarantees the pattern ends at the first unescaped `/`, and that only letters follow it
    const closingSlashIndex = text?.lastIndexOf('/') ?? -1;
    if (!text?.startsWith('/') || closingSlashIndex < 1) {
        return problems;
    }
    const pattern = text.substring(1, closingSlashIndex);
    const flags = text.substring(closingSlashIndex + 1);

    for (let i = 0; i < flags.length; i++) {
        if (!supportedFlags.has(flags[i])) {
            const start = closingSlashIndex + 1 + i;
            problems.push({ diagnostic: DiagnosticMessages.unknownRegexFlag(flags[i]), start: start, end: start + 1 });
        }
    }

    //pattern offsets are shifted by 1 to account for the leading `/`
    const addPatternProblem = (reason: string, start: number, end = start + 1) => {
        problems.push({ diagnostic: DiagnosticMessages.invalidRegexPattern(reason), start: start + 1, end: end + 1 });
    };
    //in extended mode, whitespace is ignored and `#` starts a comment that runs to the end of the line (the end of the literal)
    const isExtended = flags.includes('x');
    //the index of every `(` that hasn't been closed yet
    const openGroups: number[] = [];
    //is there an item right before the current position that a quantifier could apply to
    let canRepeat = false;
    let i = 0;

    while (i < pattern.length) {
        const char = pattern[i];

        if (char === '\\') {
            if (pattern[i + 1] === 'Q') {
                //`\Q...\E` quotes everything up to `\E` (or the end of the pattern)
                const quoteEnd = pattern.indexOf('\\E', i + 2);
                i = quoteEnd < 0 ? pattern.length : quoteEnd + 2;
            } else {
                i += 2;
            }
            canRepeat = true;

        } else if (char === '[') {
            const classEnd = findCharacterClassEnd(pattern, i);
            if (classEnd < 0) {
                addPatternProblem(`missing closing ']' for character class`, i);
                //everything after an unclosed `[` is part of the class, so there's nothing left to scan
                break;
            }
            i = classEnd + 1;
            canRepeat = true;

        } else if (char === '(' && (pattern[i + 1] === '*' || pattern.startsWith('?#', i + 1))) {
            //PCRE verbs like `(*UTF8)` and comments like `(?#note)` run to the next `)` and can't contain groups
            const end = pattern.indexOf(')', i);
            if (end < 0) {
                addPatternProblem(`missing closing ')' for group`, i);
                break;
            }
            i = end + 1;

        } else if (char === '(') {
            openGroups.push(i);
            //skip the `?` in group syntax like `(?:`, `(?=`, `(?<name>` so it isn't mistaken for a quantifier
            i += pattern[i + 1] === '?' ? 2 : 1;
            canRepeat = false;

        } else if (char === ')') {
            if (openGroups.length > 0) {
                openGroups.pop();
            } else {
                addPatternProblem(`unmatched ')'`, i);
            }
            i++;
            canRepeat = true;

        } else if (char === '|') {
            i++;
            canRepeat = false;

        } else if (char === '*' || char === '+' || char === '?') {
            if (!canRepeat) {
                addPatternProblem(`quantifier '${char}' has nothing to repeat`, i);
            }
            i = skipQuantifierModifier(pattern, i + 1);
            canRepeat = false;

        } else if (char === '{') {
            //`{` only starts a quantifier when it's a well-formed `{n}`, `{n,}`, or `{n,m}` following something repeatable. Otherwise it's a literal `{`
            const match = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.substring(i));
            if (match && canRepeat) {
                if (match[2] && parseInt(match[2]) < parseInt(match[1])) {
                    addPatternProblem(`numbers out of order in '${match[0]}' quantifier`, i, i + match[0].length);
                }
                i = skipQuantifierModifier(pattern, i + match[0].length);
                canRepeat = false;
            } else {
                i++;
                canRepeat = true;
            }

        } else if (isExtended && /\s/.test(char)) {
            i++;

        } else if (isExtended && char === '#') {
            i = pattern.length;

        } else {
            //a literal, `.`, or an anchor like `^` or `$`
            i++;
            canRepeat = true;
        }
    }

    for (const groupStart of openGroups) {
        addPatternProblem(`missing closing ')' for group`, groupStart);
    }
    return problems;
}

/**
 * A single `?` (lazy) or `+` (possessive) right after a quantifier modifies it rather than repeating it.
 * @returns the index just past the modifier, or `index` if there isn't one
 */
function skipQuantifierModifier(pattern: string, index: number) {
    return pattern[index] === '?' || pattern[index] === '+' ? index + 1 : index;
}

/**
 * Find the index of the `]` that closes the character class opened at `start`
 * @returns the index of the closing `]`, or -1 if the class is never closed
 */
function findCharacterClassEnd(pattern: string, start: number) {
    let i = start + 1;
    //a leading `^` negates the class, and a `]` right after the opening (or after the `^`) is a literal `]`
    if (pattern[i] === '^') {
        i++;
    }
    if (pattern[i] === ']') {
        i++;
    }
    while (i < pattern.length) {
        const char = pattern[i];
        if (char === '\\') {
            i += 2;
        } else if (char === '[' && /[:.=]/.test(pattern[i + 1] ?? '')) {
            //POSIX classes like `[:alpha:]` contain their own `]`
            const posixEnd = pattern.indexOf(pattern[i + 1] + ']', i + 2);
            i = posixEnd < 0 ? i + 1 : posixEnd + 2;
        } else if (char === ']') {
            return i;
        } else {
            i++;
        }
    }
    return -1;
}
