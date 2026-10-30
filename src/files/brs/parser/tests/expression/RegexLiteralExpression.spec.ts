import { expect } from '../../../../../chai-config.spec';
import { Program } from '../../../../../Program';
import { standardizePath as s } from '../../../../../util';
import { expectDiagnostics, getTestTranspile } from '../../../../../testHelpers.spec';
import { DiagnosticMessages } from '../../../../../DiagnosticMessages';

describe('RegexLiteralExpression', () => {
    let rootDir = s`${process.cwd()}/rootDir`;
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        program.dispose();
    });

    describe('transpile', () => {
        it('captures flags', async () => {
            await testTranspile(`
                sub main()
                    print /hello/im
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "hello", "im")
                end sub
            `);
        });

        it('passes unknown flags through unchanged', async () => {
            await testTranspile(`
                sub main()
                    print /hello/gi
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "hello", "gi")
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('handles when no flags', async () => {
            await testTranspile(`
                sub main()
                    print /hello/
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "hello", "")
                end sub
            `);
        });

        it('handles weird escapes', async () => {
            await testTranspile(`
                sub main()
                    print /\\r\\n\\//
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "\\r\\n\\/", "")
                end sub
            `);
        });

        it('escapes quotemark', async () => {
            await testTranspile(`
                sub main()
                    print /"/
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "" + chr(34) + "", "")
                end sub
            `);
        });

        it('warns when in non-brighterscript mode', () => {
            program.setFile('source/main.brs', `
                sub main()
                    print /"/
                end sub
            `);
            expectDiagnostics(program, [
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('regular expression literal')
            ]);
        });

        it('supports a regex in a return statement', async () => {
            await testTranspile(`
                function getEmojiRegex() as dynamic
                    return /([\\xA9\\xAE\\x{2000}-\\x{3300}\\x{1F000}-\\x{1FBFF}])/mi
                end function
                function isMatch(value as string) as boolean
                    return /abc/i.isMatch(value)
                end function
            `, `
                function getEmojiRegex() as dynamic
                    return CreateObject("roRegex", "([\\xA9\\xAE\\x{2000}-\\x{3300}\\x{1F000}-\\x{1FBFF}])", "mi")
                end function

                function isMatch(value as string) as boolean
                    return CreateObject("roRegex", "abc", "i").isMatch(value)
                end function
            `);
        });

        it('handles edge cases', async () => {
            await testTranspile(`
                sub main()
                    print /1/
                    ? /1/
                    thing = false ?? /1/
                    v = /1/.Match("1")[0].ToInt()
                    v = [
                        0
                    ]
                    v[/0/.Match("0")[0].ToInt()] = true
                    type(/1/.Match("1")[0].ToInt())
                    v = 1 ^ /1/.Match("1")[0].ToInt()
                    v = 1 - /1/.Match("1")[0].ToInt()
                    v = 1 + /1/.Match("1")[0].ToInt()
                    v = 1 * /1/.Match("1")[0].ToInt()
                    v = 1 / /1/.Match("1")[0].ToInt()
                    v = 1 mod /1/.Match("1")[0].ToInt()
                    v = 1 \\ /1/.Match("1")[0].ToInt()
                    v = 1 >> /1/.Match("1")[0].ToInt()
                    v = 1 << /1/.Match("1")[0].ToInt()
                    v -= /1/.Match("1")[0].ToInt()
                    v += /1/.Match("1")[0].ToInt()
                    v *= /1/.Match("1")[0].ToInt()
                    v \\= /1/.Match("1")[0].ToInt()
                    v /= /1/.Match("1")[0].ToInt()
                    v <<= /1/.Match("1")[0].ToInt()
                    v >>= /1/.Match("1")[0].ToInt()
                    v = 1 < /1/.Match("1")[0].ToInt()
                    v = 1 <= /1/.Match("1")[0].ToInt()
                    v = 1 > /1/.Match("1")[0].ToInt()
                    v = 1 >= /1/.Match("1")[0].ToInt()
                    v = 1 = /1/.Match("1")[0].ToInt()
                    v = 1 <> /1/.Match("1")[0].ToInt()
                    v = 1 and /1/.Match("1")[0].ToInt()
                    v = 1 or /1/.Match("1")[0].ToInt()
                    if /1/.Match("1")[0].ToInt() > 0 then
                    end if
                    v = not /1/.Match("1")[0].ToInt() > 0
                    for i = 0 to /1/.Match("1")[0].ToInt()
                        print "for!"
                    end for
                    v = /1/
                    v = { name: /1/.Match("1")[0].ToInt() }
                    print 1; /1/.Match("1")[0].ToInt()
                    throw /1/.Match("1")[0]
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "1", "")
                    ? CreateObject("roRegex", "1", "")
                    thing = bslib_coalesce(false, CreateObject("roRegex", "1", ""))
                    v = CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = [
                        0
                    ]
                    v[CreateObject("roRegex", "0", "").Match("0")[0].ToInt()] = true
                    type(CreateObject("roRegex", "1", "").Match("1")[0].ToInt())
                    v = 1 ^ CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 - CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 + CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 * CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 / CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 mod CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 \\ CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 >> CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 << CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v -= CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v += CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v *= CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v \\= CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v /= CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v <<= CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v >>= CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 < CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 <= CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 > CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 >= CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 = CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 <> CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 and CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    v = 1 or CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    if CreateObject("roRegex", "1", "").Match("1")[0].ToInt() > 0 then
                    end if
                    v = not CreateObject("roRegex", "1", "").Match("1")[0].ToInt() > 0
                    for i = 0 to CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                        print "for!"
                    end for
                    v = CreateObject("roRegex", "1", "")
                    v = {
                        name: CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    }
                    print 1; CreateObject("roRegex", "1", "").Match("1")[0].ToInt()
                    throw CreateObject("roRegex", "1", "").Match("1")[0]
                end sub
            `);
        });

    });

    describe('validation', () => {
        /**
         * Validate a regex literal and get each diagnostic's message along with the source text it underlines
         */
        function validate(regex: string) {
            const line = `    r = ${regex}`;
            program.setFile('source/main.bs', `sub main()\n${line}\n    print r\nend sub`);
            program.validate();
            return program.getDiagnostics().map(x => ({
                message: x.message,
                text: line.substring(x.location.range.start.character, x.location.range.end.character)
            }));
        }

        function invalidPattern(reason: string, text: string) {
            return { message: DiagnosticMessages.invalidRegexPattern(reason).message, text: text };
        }

        it('allows valid patterns, including PCRE-only syntax', () => {
            for (const regex of [
                '/abc/',
                '/^a|b$/',
                '/(?:a|b)*c+d?/',
                '/a{2}b{2,}c{2,3}?/',
                '/a*?b+?c??/',
                '/a++b*+c?+d{2}+/',
                '/(?>atomic)/',
                '/(?i)abc(?-i)/',
                '/(?<name>a)\\k<name>/',
                '/(?=a)(?!b)(?<=c)(?<!d)/',
                '/(*UTF8)abc/',
                '/(?#a comment with ( and *)abc/',
                '/[(*+?{]/',
                '/[]a]/',
                '/[^]a]/',
                '/[a\\]]/',
                '/[[:alpha:]]+/',
                '/\\(\\)\\[\\*\\+\\?/',
                '/\\Q(*[\\E+/',
                '/{abc}/',
                '/a{/',
                '/a{,5}/',
                '/ ( a ) + # comment with ( and ) /x',
                '/abc/imsx'
            ]) {
                expect(validate(regex), regex).to.eql([]);
                program.dispose();
                program = new Program({ rootDir: rootDir });
            }
        });

        it('flags an unclosed group', () => {
            expect(validate('/(asdfasdf/')).to.eql([
                invalidPattern(`missing closing ')' for group`, '(')
            ]);
        });

        it('flags each unclosed group at its own paren', () => {
            expect(validate('/a(b(c/')).to.eql([
                invalidPattern(`missing closing ')' for group`, '('),
                invalidPattern(`missing closing ')' for group`, '(')
            ]);
        });

        it('flags an unclosed verb or comment group', () => {
            expect(validate('/(*UTF8/')).to.eql([
                invalidPattern(`missing closing ')' for group`, '(')
            ]);
            program.dispose();
            program = new Program({ rootDir: rootDir });
            expect(validate('/(?#comment/')).to.eql([
                invalidPattern(`missing closing ')' for group`, '(')
            ]);
        });

        it('flags an unmatched closing paren', () => {
            expect(validate('/abc)/')).to.eql([
                invalidPattern(`unmatched ')'`, ')')
            ]);
        });

        it('flags an unclosed character class', () => {
            expect(validate('/[abc/')).to.eql([
                invalidPattern(`missing closing ']' for character class`, '[')
            ]);
        });

        it('flags quantifiers with nothing to repeat', () => {
            expect(validate('/*abc/')).to.eql([
                invalidPattern(`quantifier '*' has nothing to repeat`, '*')
            ]);
            program.dispose();
            program = new Program({ rootDir: rootDir });
            expect(validate('/(+a)|?b/')).to.eql([
                invalidPattern(`quantifier '+' has nothing to repeat`, '+'),
                invalidPattern(`quantifier '?' has nothing to repeat`, '?')
            ]);
        });

        it('flags a quantifier that follows another quantifier', () => {
            expect(validate('/a**/')).to.eql([
                invalidPattern(`quantifier '*' has nothing to repeat`, '*')
            ]);
        });

        it('flags an out-of-order {n,m} quantifier', () => {
            expect(validate('/a{3,1}/')).to.eql([
                invalidPattern(`numbers out of order in '{3,1}' quantifier`, '{3,1}')
            ]);
        });

        it('ignores whitespace in extended mode when looking for something to repeat', () => {
            expect(validate('/a *b/x')).to.eql([]);
        });

        it('warns about each unknown flag', () => {
            expect(validate('/abc/gIu')).to.eql([
                { message: DiagnosticMessages.unknownRegexFlag('g').message, text: 'g' },
                { message: DiagnosticMessages.unknownRegexFlag('I').message, text: 'I' },
                { message: DiagnosticMessages.unknownRegexFlag('u').message, text: 'u' }
            ]);
        });

        it('reports pattern and flag problems together', () => {
            expect(validate('/(abc/g')).to.eql([
                { message: DiagnosticMessages.unknownRegexFlag('g').message, text: 'g' },
                invalidPattern(`missing closing ')' for group`, '(')
            ]);
        });
    });
});
