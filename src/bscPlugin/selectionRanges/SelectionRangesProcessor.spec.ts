import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { util } from '../../util';
import { rootDir, trim } from '../../testHelpers.spec';
import type { SelectionRange } from 'vscode-languageserver-types';

describe('SelectionRangesProcessor', () => {
    let program: Program;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });

    afterEach(() => {
        program.dispose();
    });

    /**
     * Flatten a SelectionRange linked list (innermost → outermost) into an array
     * of `[startLine, startChar, endLine, endChar]` tuples for easy assertion.
     */
    function flatten(sr: SelectionRange | undefined): Array<[number, number, number, number]> {
        const result: Array<[number, number, number, number]> = [];
        let current: SelectionRange | undefined = sr;
        while (current) {
            const { start, end } = current.range;
            result.push([start.line, start.character, end.line, end.character]);
            current = current.parent;
        }
        return result;
    }

    /**
     * Extract the substring of `code` that a `[startLine, startChar, endLine, endChar]` range covers.
     */
    function getText(code: string, range: [number, number, number, number]): string {
        const lines = code.split('\n');
        const [startLine, startChar, endLine, endChar] = range;
        if (startLine === endLine) {
            return lines[startLine].slice(startChar, endChar);
        }
        const parts = [lines[startLine].slice(startChar)];
        for (let i = startLine + 1; i < endLine; i++) {
            parts.push(lines[i]);
        }
        parts.push(lines[endLine].slice(0, endChar));
        return parts.join('\n');
    }

    function getSelectionRange(code: string, line: number, character: number) {
        const file = program.setFile('source/main.brs', code);
        program.validate();
        const ranges = program.getSelectionRanges(file.srcPath, [util.createPosition(line, character)]);
        return ranges[0];
    }

    // -------------------------------------------------------------------------
    // Basic identifier / variable
    // -------------------------------------------------------------------------

    it('expands from identifier token to assignment statement to function', () => {
        const code = trim`
            sub main()
                name = "hello"
            end sub
        `;

        // cursor on 'n' of 'name' (line 1, col 4)
        const sr = getSelectionRange(code, 1, 4);
        const steps = flatten(sr);

        expect(getText(code, steps[0])).to.equal('name', 'first step should be the identifier token');
        expect(getText(code, steps[1])).to.equal('name = "hello"', 'second step should be the assignment statement');
        expect(getText(code, steps[steps.length - 1])).to.equal(code, 'outermost step should be the full sub');
    });

    // -------------------------------------------------------------------------
    // String literal
    // -------------------------------------------------------------------------

    it('expands from string literal to assignment to function', () => {
        const code = trim`
            sub main()
                name = "hello"
            end sub
        `;

        // cursor inside "hello" — col 12 is 'h'
        const sr = getSelectionRange(code, 1, 12);
        const steps = flatten(sr);

        expect(getText(code, steps[0])).to.equal('"hello"', 'first step should be the string literal');
        expect(getText(code, steps[steps.length - 1])).to.equal(code, 'outermost step should be the full sub');
    });

    // -------------------------------------------------------------------------
    // Dotted-get expression (member access)
    // -------------------------------------------------------------------------

    it('expands name token then full dotted-get chain', () => {
        const code = trim`
            sub main()
                x = m.top.value
            end sub
        `;

        // cursor in the middle of 'value' — col 16
        const sr = getSelectionRange(code, 1, 16);
        const steps = flatten(sr);

        expect(getText(code, steps[0])).to.equal('value', 'first step is the name token of the dotted-get');
        expect(getText(code, steps[1])).to.equal('m.top.value', 'second step is the full dotted-get expression');
    });

    // -------------------------------------------------------------------------
    // Function call expression
    // -------------------------------------------------------------------------

    it('expands from argument to full function call expression', () => {
        const code = trim`
            sub main()
                foo("hello")
            end sub
        `;

        // cursor on 'h' inside "hello" — col 9
        const sr = getSelectionRange(code, 1, 9);
        const steps = flatten(sr);

        expect(getText(code, steps[0])).to.equal('"hello"', 'first step is the string arg');
        const hasCallRange = steps.some(r => getText(code, r) === 'foo("hello")');
        expect(hasCallRange).to.be.true;
    });

    // -------------------------------------------------------------------------
    // Nested function / function expression
    // -------------------------------------------------------------------------

    it('expands from nested function body through inner function to outer sub', () => {
        const code = trim`
            sub outer()
                inner = function()
                    x = 1
                end function
            end sub
        `;

        // cursor on 'x' — line 2, col 8
        const sr = getSelectionRange(code, 2, 8);
        const steps = flatten(sr);

        // Should have at least 4 steps: token → stmt → inner fn → outer sub
        expect(steps.length).to.be.at.least(4);
        expect(getText(code, steps[steps.length - 1])).to.equal(code, 'outermost step should be the full outer sub');
    });

    // -------------------------------------------------------------------------
    // If / else blocks
    // -------------------------------------------------------------------------

    it('expands from inside an if block to the enclosing sub', () => {
        const code = trim`
            sub main()
                if true then
                    x = 1
                end if
            end sub
        `;

        // cursor on 'x' — line 2, col 8
        const sr = getSelectionRange(code, 2, 8);
        const steps = flatten(sr);

        expect(steps.length).to.be.at.least(3);
        expect(getText(code, steps[steps.length - 1])).to.equal(code, 'outermost step should be the full sub');
    });

    // -------------------------------------------------------------------------
    // For loop
    // -------------------------------------------------------------------------

    it('expands from inside a for loop body to the enclosing sub', () => {
        const code = trim`
            sub main()
                for i = 0 to 10
                    x = 1
                end for
            end sub
        `;

        // cursor on 'x' — line 2, col 8
        const sr = getSelectionRange(code, 2, 8);
        const steps = flatten(sr);

        expect(steps.length).to.be.at.least(3);
        expect(getText(code, steps[steps.length - 1])).to.equal(code, 'outermost step should be the full sub');
    });

    // -------------------------------------------------------------------------
    // Class
    // -------------------------------------------------------------------------

    it('expands from class method body through method to class', () => {
        const code = trim`
            class MyClass
                function greet() as string
                    return "hello"
                end function
            end class
        `;

        // cursor on 'h' in "hello" — line 2, col 16
        const sr = getSelectionRange(code, 2, 16);
        const steps = flatten(sr);

        expect(steps.length).to.be.at.least(3);
        expect(getText(code, steps[steps.length - 1])).to.equal(code, 'outermost step should be the whole class');
    });

    // -------------------------------------------------------------------------
    // Namespace
    // -------------------------------------------------------------------------

    it('expands from namespace function body to namespace', () => {
        const code = trim`
            namespace MyApp
                sub doThing()
                    x = 1
                end sub
            end namespace
        `;

        // cursor on 'x' — line 2, col 8
        const sr = getSelectionRange(code, 2, 8);
        const steps = flatten(sr);

        expect(steps.length).to.be.at.least(4);
        expect(getText(code, steps[steps.length - 1])).to.equal(code, 'outermost step should be the whole namespace');
    });

    // -------------------------------------------------------------------------
    // Multiple positions in one request
    // -------------------------------------------------------------------------

    it('handles multiple positions in one request', () => {
        const code = trim`
            sub main()
                a = 1
                b = 2
            end sub
        `;
        const file = program.setFile('source/multi.brs', code);
        program.validate();

        const ranges = program.getSelectionRanges(file.srcPath, [
            util.createPosition(1, 4), // cursor on 'a'
            util.createPosition(2, 4) // cursor on 'b'
        ]);
        expect(ranges).to.have.length(2);
        expect(ranges[0]).to.exist;
        expect(ranges[1]).to.exist;

        const steps0 = flatten(ranges[0]);
        const steps1 = flatten(ranges[1]);
        expect(getText(code, steps0[0])).to.equal('a', 'first position selects identifier "a"');
        expect(getText(code, steps1[0])).to.equal('b', 'second position selects identifier "b"');
    });

    // -------------------------------------------------------------------------
    // BrighterScript: enum
    // -------------------------------------------------------------------------

    it('expands inside an enum member value to the whole enum', () => {
        const code = trim`
            enum Direction
                up = "up"
                down = "down"
            end enum
        `;

        // cursor on 'u' inside "up" on line 1 — col 10
        const sr = getSelectionRange(code, 1, 10);
        const steps = flatten(sr);

        expect(steps.length).to.be.at.least(2);
        expect(getText(code, steps[steps.length - 1])).to.equal(code, 'outermost step should be the whole enum');
    });

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    it('returns empty array for a position outside any node', () => {
        const code = trim`
            sub main()
            end sub
        `;
        const file = program.setFile('source/empty.brs', code);
        program.validate();
        // position far past the last line — should not throw
        const ranges = program.getSelectionRanges(file.srcPath, [util.createPosition(99, 0)]);
        expect(Array.isArray(ranges)).to.be.true;
    });

    it('returns empty array for unknown file', () => {
        const ranges = program.getSelectionRanges('/does/not/exist.brs', [util.createPosition(0, 0)]);
        expect(ranges).to.eql([]);
    });

    it('does not return duplicate consecutive ranges', () => {
        const code = trim`
            sub main()
                x = 1
            end sub
        `;
        const sr = getSelectionRange(code, 1, 4);
        const steps = flatten(sr);

        // Verify no two consecutive steps have identical ranges
        for (let i = 1; i < steps.length; i++) {
            const prev = steps[i - 1];
            const curr = steps[i];
            const sameRange = prev[0] === curr[0] && prev[1] === curr[1] &&
                prev[2] === curr[2] && prev[3] === curr[3];
            expect(sameRange).to.be.false;
        }
    });

    // -------------------------------------------------------------------------
    // Plugin extensibility
    // -------------------------------------------------------------------------

    it('allows plugins to contribute custom selection ranges', () => {
        const customRange = util.createRange(0, 0, 0, 10);
        program.plugins.add({
            name: 'test-plugin',
            provideSelectionRanges: (event) => {
                event.selectionRanges.push({ range: customRange });
            }
        });

        const code = trim`
            sub main()
            end sub
        `;
        const file = program.setFile('source/plugin.brs', code);
        program.validate();

        const ranges = program.getSelectionRanges(file.srcPath, [util.createPosition(0, 4)]);
        // The bsc plugin should push a range, and the test plugin pushed another
        expect(ranges.length).to.be.at.least(2);
        const hasCustom = ranges.some(r => r.range.start.line === 0 && r.range.end.character === 10);
        expect(hasCustom).to.be.true;
    });

    describe('location boundaries', () => {
        type RangeTuple = [number, number, number, number];

        /**
         * Get the full selection range chain (innermost to outermost) for each position, requesting each position individually
         */
        function getChains(pkgPath: string, code: string, positions: Array<[number, number]>) {
            const file = program.setFile(pkgPath, code);
            program.validate();
            return positions.map(([line, character]) => {
                const ranges = program.getSelectionRanges(file.srcPath, [util.createPosition(line, character)]);
                expect(ranges).to.have.length(1, `expected exactly one selection range for position ${line}:${character}`);
                return flatten(ranges[0]);
            });
        }

        const loopsCode = [
            'sub main()',
            '    value = 1',
            '    while value < 10',
            '        value = value + 1',
            '        if value = 5',
            '            exitwhile',
            '        end if',
            '    end while',
            '    for i = 0 to 3',
            '        print i',
            '    end for',
            'end sub',
            'sub empty()',
            'end sub'
        ].join('\n');

        it('computes exact chains at identifier boundaries, column 0, and inside loops with exitwhile', () => {
            const [atStart, afterEnd, column0, onExit, afterExit, inFor, onIf] = getChains('source/main.brs', loopsCode, [
                [1, 4], // |value = 1
                [1, 9], // value| = 1
                [2, 0], // |    while value < 10
                [5, 12], // |exitwhile
                [5, 16], // exit|while
                [9, 14], // print |i
                [4, 8] // |if value = 5
            ]);
            const outer: RangeTuple[] = [
                [1, 4, 10, 11], // function body block
                [0, 0, 11, 7], // sub main()...end sub
                [0, 0, 13, 7] // whole file
            ];
            const whileChain: RangeTuple[] = [
                [4, 8, 6, 14], // if value = 5 ... end if
                [3, 8, 6, 14], // while body block
                [2, 4, 7, 13], // while ... end while
                ...outer
            ];
            expect(atStart).to.eql([
                [1, 4, 1, 9], // value
                [1, 4, 1, 13], // value = 1
                ...outer
            ]);
            expect(afterEnd).to.eql(atStart);
            expect(column0).to.eql(outer);
            expect(onExit).to.eql([
                [5, 12, 5, 16], // exit (split from `exitwhile`)
                [5, 12, 5, 21], // exitwhile
                ...whileChain
            ]);
            expect(afterExit).to.eql(onExit);
            expect(inFor).to.eql([
                [9, 14, 9, 15], // i
                [9, 8, 9, 15], // print i
                [8, 4, 10, 11], // for ... end for
                ...outer
            ]);
            expect(onIf).to.eql([
                [4, 8, 4, 10], // if
                ...whileChain
            ]);
        });

        it('computes exact chains inside an empty function body followed by a column-0 `end sub`', () => {
            const [afterParen, atEnd] = getChains('source/main.brs', loopsCode, [
                [12, 11], // sub empty()|
                [13, 0] // |end sub
            ]);
            expect(afterParen).to.eql([
                [12, 10, 12, 11], // )
                [12, 11, 13, 0], // empty body block (from the end of `)` to the start of `end sub`)
                [12, 0, 13, 7], // sub empty()...end sub
                [0, 0, 13, 7] // whole file
            ]);
            expect(atEnd).to.eql([
                [13, 0, 13, 7], // end sub
                [12, 11, 13, 0], // empty body block
                [12, 0, 13, 7], // sub empty()...end sub
                [0, 0, 13, 7] // whole file
            ]);
        });

        it('computes exact chains for empty-bodied constructs and empty if/else/while/for blocks', () => {
            const code = [
                'namespace alpha',
                'end namespace',
                'class Beta',
                'end class',
                'interface Charlie',
                'end interface',
                'enum Delta',
                'end enum',
                'sub main()',
                '    if true then',
                '    else if false then',
                '    else',
                '    end if',
                '    while true',
                '    end while',
                '    for i = 0 to 1',
                '    end for',
                'end sub'
            ].join('\n');
            const chains = getChains('source/main.bs', code, [
                [1, 0], // |end namespace
                [3, 0], // |end class
                [5, 0], // |end interface
                [7, 0], // |end enum
                [9, 16], // if true then|
                [10, 0], // |    else if false then
                [11, 0], // |    else
                [11, 8], // else|
                [12, 0], // |    end if
                [13, 14], // while true|
                [14, 0], // |    end while
                [16, 0] // |    end for
            ]);
            const file: RangeTuple = [0, 0, 17, 7];
            const main: RangeTuple[] = [
                [9, 4, 16, 11], // function body block
                [8, 0, 17, 7], // sub main()...end sub
                file
            ];
            const ifChain: RangeTuple[] = [
                [9, 4, 12, 10], // if ... end if
                ...main
            ];
            const elseIfChain: RangeTuple[] = [
                [10, 9, 12, 10], // the nested `if false then ... end if` statement
                ...ifChain
            ];
            expect(chains).to.eql([
                [[1, 0, 1, 13], [0, 0, 1, 13], file],
                [[3, 0, 3, 9], [2, 0, 3, 9], file],
                [[5, 0, 5, 13], [4, 0, 5, 13], file],
                [[7, 0, 7, 8], [6, 0, 7, 8], file],
                // `then` token, then the empty `then` block (end of `then` to the start of `else`)
                [[9, 12, 9, 16], [9, 16, 10, 4], ...ifChain],
                [[9, 16, 10, 4], ...ifChain],
                // the empty `else if` block (end of `then` to the start of `else`)
                [[10, 22, 11, 4], ...elseIfChain],
                // `else` token, then the empty `else` block (end of `else` to the start of `end if`)
                [[11, 4, 11, 8], [11, 8, 12, 4], ...elseIfChain],
                [[11, 8, 12, 4], ...elseIfChain],
                // `true` token, then while statement
                [[13, 10, 13, 14], [13, 4, 14, 13], ...main],
                // empty while block
                [[13, 14, 14, 4], [13, 4, 14, 13], ...main],
                // empty for block
                [[15, 18, 16, 4], [15, 4, 16, 11], ...main]
            ]);
        });

        it('computes exact chains in a .brs file with CRLF line endings, emoji, and elseif', () => {
            const code = [
                '\' 😀 header comment',
                'function alpha(a, b)',
                '    if a then',
                '        print "😀"',
                '    elseif b then',
                '        print 2',
                '    else',
                '        print 3',
                '    end if',
                'end function',
                'sub beta() : print "😀😀" : end sub : sub charlie() : end sub',
                'sub empty()',
                'end sub',
                ''
            ].join('\r\n');
            const [onPrint, onElse, onElseIf, inElseIf, onEndSub, onCharlie, column0, afterParen, atEnd] = getChains('source/main.brs', code, [
                [3, 8], // |print "😀"
                [4, 4], // |elseif b then
                [4, 8], // else|if b then
                [5, 8], // |print 2
                [10, 30], // en|d sub (after the emoji string)
                [10, 42], // sub |charlie() (after the emoji string)
                [2, 0], // |    if a then
                [11, 11], // sub empty()|
                [12, 0] // |end sub
            ]);
            const body: RangeTuple = [1, 0, 12, 7];
            const alpha: RangeTuple[] = [
                [2, 4, 8, 10], // if ... end if
                [1, 0, 9, 12], // function alpha...end function
                body
            ];
            expect(onPrint).to.eql([
                [3, 8, 3, 13], // print
                [3, 8, 3, 18], // print "😀"
                ...alpha
            ]);
            expect(onElse).to.eql([
                [4, 4, 4, 8], // else (split from `elseif`)
                ...alpha
            ]);
            expect(onElseIf).to.eql([
                [4, 4, 4, 8], // else (split from `elseif`)
                [4, 8, 8, 10], // if b then ... end if
                ...alpha
            ]);
            expect(inElseIf).to.eql([
                [5, 8, 5, 13], // print
                [5, 8, 5, 15], // print 2
                [4, 8, 8, 10], // if b then ... end if
                ...alpha
            ]);
            expect(onEndSub).to.eql([
                [10, 28, 10, 35], // end sub
                [10, 0, 10, 35], // sub beta() : print "😀😀" : end sub
                body
            ]);
            expect(onCharlie).to.eql([
                [10, 42, 10, 49], // charlie
                [10, 38, 10, 61], // sub charlie() : end sub
                body
            ]);
            expect(column0).to.eql([
                [1, 0, 9, 12], // function alpha...end function
                body
            ]);
            expect(afterParen).to.eql([
                [11, 10, 11, 11], // )
                [11, 11, 12, 0], // empty body block (from the end of `)` to the start of `end sub`)
                [11, 0, 12, 7], // sub empty()...end sub
                body
            ]);
            expect(atEnd).to.eql([
                [12, 0, 12, 7], // end sub
                [11, 11, 12, 0], // empty body block
                [11, 0, 12, 7], // sub empty()...end sub
                body
            ]);
        });

        it('uses utf-16 code units for positions that follow an emoji on the same line', () => {
            const code = [
                'const A = "😀" : const B = 2',
                'enum E',
                '    x = "😀😀" : y = "b"',
                'end enum'
            ].join('\n');
            const chains = getChains('source/main.bs', code, [
                [0, 22], // const| B = 2
                [0, 23], // const |B = 2
                [2, 17], // |y = "b"
                [2, 24] // y = "b"|
            ]);
            expect(chains).to.eql([
                [[0, 17, 0, 22], [0, 17, 0, 28], [0, 0, 3, 8]],
                [[0, 23, 0, 24], [0, 17, 0, 28], [0, 0, 3, 8]],
                [[2, 17, 2, 18], [2, 17, 2, 24], [1, 0, 3, 8], [0, 0, 3, 8]],
                [[2, 21, 2, 24], [2, 17, 2, 24], [1, 0, 3, 8], [0, 0, 3, 8]]
            ]);
        });

        it('computes exact chains inside and after a multi-line template string', () => {
            const code = [
                'sub main(who as string)',
                '    count = 1',
                '    text = `line one 😀',
                // eslint-disable-next-line no-template-curly-in-string
                'two ${who} and ${count}',
                // eslint-disable-next-line no-template-curly-in-string
                'three ${ lcase(who) }`',
                '    print text',
                'end sub',
                'function after()',
                'end function',
                ''
            ].join('\n');
            const chains = getChains('source/main.bs', code, [
                [3, 6], // two ${|who}
                [4, 9], // three ${ |lcase(who) }
                [4, 15], // three ${ lcase(|who) }
                [7, 9] // function |after()
            ]);
            const template: RangeTuple[] = [
                [2, 11, 4, 22], // the whole template string
                [2, 4, 4, 22], // text = `...`
                [1, 4, 5, 14], // function body block
                [0, 0, 6, 7], // sub main...end sub
                [0, 0, 8, 12] // whole file
            ];
            expect(chains).to.eql([
                [[3, 4, 3, 6], [3, 6, 3, 9], ...template],
                [[4, 9, 4, 14], [4, 9, 4, 19], ...template],
                [[4, 14, 4, 15], [4, 15, 4, 18], [4, 9, 4, 19], ...template],
                [[7, 9, 7, 14], [7, 0, 8, 12], [0, 0, 8, 12]]
            ]);
        });

        it('computes exact chains for nested namespaces and a symbol on the last line with no trailing newline', () => {
            const code = [
                'namespace alpha',
                '    namespace beta.charlie',
                '        class Person',
                '            name as string',
                '            sub speak()',
                '            end sub',
                '        end class',
                '    end namespace',
                '    enum Direction',
                '        up = "up"',
                '        down = "down"',
                '    end enum',
                '    interface Shape',
                '        width as integer',
                '        function area() as float',
                '    end interface',
                '    const PI = 3.14',
                'end namespace',
                'function empty()',
                'end function',
                'const LAST_ONE = true'
            ].join('\n');
            const chains = getChains('source/main.bs', code, [
                [20, 6], // const |LAST_ONE = true
                [20, 21], // const LAST_ONE = true|
                [16, 10], // const |PI = 3.14
                [1, 19], // namespace beta.|charlie
                [9, 13], // up = |"up"
                [18, 16], // function empty()|
                [19, 0] // |end function
            ]);
            const alphaBody: RangeTuple[] = [
                [1, 4, 16, 19], // namespace alpha body
                [0, 0, 17, 13], // namespace alpha...end namespace
                [0, 0, 20, 21] // whole file
            ];
            expect(chains).to.eql([
                [[20, 6, 20, 14], [20, 0, 20, 21], [0, 0, 20, 21]],
                [[20, 17, 20, 21], [20, 0, 20, 21], [0, 0, 20, 21]],
                [[16, 10, 16, 12], [16, 4, 16, 19], ...alphaBody],
                [[1, 18, 1, 19], [1, 14, 1, 26], [1, 4, 7, 17], ...alphaBody],
                [[9, 13, 9, 17], [9, 8, 9, 17], [8, 4, 11, 12], ...alphaBody],
                // `)`, then the empty body block (end of `)` to the start of `end function`)
                [[18, 15, 18, 16], [18, 16, 19, 0], [18, 0, 19, 12], [0, 0, 20, 21]],
                [[19, 0, 19, 12], [18, 16, 19, 0], [18, 0, 19, 12], [0, 0, 20, 21]]
            ]);
        });

        it('returns the same chains when all positions are requested in a single call', () => {
            const file = program.setFile('source/main.brs', loopsCode);
            program.validate();
            const positions = [
                util.createPosition(1, 4),
                util.createPosition(5, 12),
                util.createPosition(9, 14)
            ];
            const combined = program.getSelectionRanges(file.srcPath, positions).map(x => flatten(x));
            const individual = positions.map(x => flatten(program.getSelectionRanges(file.srcPath, [x])[0]));
            expect(combined).to.eql(individual);
            expect(combined.map(x => x[0])).to.eql([
                [1, 4, 1, 9],
                [5, 12, 5, 16],
                [9, 14, 9, 15]
            ]);
        });
    });
});
