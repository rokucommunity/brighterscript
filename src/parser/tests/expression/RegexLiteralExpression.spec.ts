import { Program } from '../../../Program';
import { standardizePath as s } from '../../../util';
import { getTestTranspile } from '../../../testHelpers.spec';

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
        it('captures flags', () => {
            testTranspile(`
                sub main()
                    print /hello/gi
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "hello", "gi")
                end sub
            `);
        });

        it('handles when no flags', () => {
            testTranspile(`
                sub main()
                    print /hello/
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "hello", "")
                end sub
            `);
        });

        it('handles weird escapes', () => {
            testTranspile(`
                sub main()
                    print /\\r\\n\\//
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "\\r\\n\\/", "")
                end sub
            `);
        });

        it('escapes quotemark', () => {
            testTranspile(`
                sub main()
                    print /"/
                end sub
            `, `
                sub main()
                    print CreateObject("roRegex", "" + chr(34) + "", "")
                end sub
            `);
        });

    });
});
