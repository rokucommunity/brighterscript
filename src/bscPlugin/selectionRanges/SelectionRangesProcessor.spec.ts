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
        const ranges = program.getSelectionRanges(file.pathAbsolute, [util.createPosition(line, character)]);
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

        const ranges = program.getSelectionRanges(file.pathAbsolute, [
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
        const ranges = program.getSelectionRanges(file.pathAbsolute, [util.createPosition(99, 0)]);
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

        const ranges = program.getSelectionRanges(file.pathAbsolute, [util.createPosition(0, 4)]);
        // The bsc plugin should push a range, and the test plugin pushed another
        expect(ranges.length).to.be.at.least(2);
        const hasCustom = ranges.some(r => r.range.start.line === 0 && r.range.end.character === 10);
        expect(hasCustom).to.be.true;
    });
});
