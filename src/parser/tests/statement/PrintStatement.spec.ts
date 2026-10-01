import { expect } from '../../../chai-config.spec';
import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { Program } from '../../../Program';
import { expectDiagnostics, rootDir } from '../../../testHelpers.spec';
import { getTestTranspile } from '../../../testHelpers.spec';
import util from '../../../util';
import { DiagnosticCodeMap, DiagnosticMessages } from '../../../DiagnosticMessages';

describe('parser print statements', () => {

    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    it('parses singular print statements', () => {
        let { ast, diagnostics } = Parser.parse([
            token(TokenKind.Print),
            token(TokenKind.StringLiteral, 'Hello, world'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.exist;
        expect(ast.statements).not.to.be.null;
    });

    describe('maximum print count', () => {
        function parseDiagnosticCodes(source: string) {
            return Parser.parse(source).diagnostics.map(diagnostic => diagnostic.code);
        }

        function numbers(count: number, separator: string) {
            return Array.from({ length: count }, (_, index) => index + 1).join(separator);
        }

        it('allows 20 values separated by semicolons', () => {
            expect(parseDiagnosticCodes(`print ${numbers(20, '; ')}`)).to.eql([]);
        });

        it('flags 21 values separated by semicolons', () => {
            const { diagnostics } = Parser.parse(`print ${numbers(21, '; ')}`);
            expect(diagnostics.map(diagnostic => diagnostic.code)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
            expect(diagnostics[0].message).to.equal(
                'Print statement is too long: 21 values exceeds the Roku limit of 20. Split it into multiple print statements.'
            );
        });

        it('allows 20 adjacent values without separators', () => {
            expect(parseDiagnosticCodes(`print ${numbers(20, ' ')}`)).to.eql([]);
        });

        it('flags 21 adjacent values without separators', () => {
            expect(parseDiagnosticCodes(`print ${numbers(21, ' ')}`)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
        });

        it('counts each comma toward the limit', () => {
            expect(parseDiagnosticCodes(`print ${numbers(10, ', ')}`)).to.eql([]);
            const { diagnostics } = Parser.parse(`print ${numbers(11, ', ')}`);
            expect(diagnostics.map(diagnostic => diagnostic.code)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
            expect(diagnostics[0].message).to.equal(
                'Print statement is too long: 11 values and 10 commas count as 21 toward the Roku limit of 20. Split it into multiple print statements.'
            );
        });

        it('uses the singular form for exactly one comma', () => {
            const { diagnostics } = Parser.parse(`print 1, ${numbers(20, '; ')}`);
            expect(diagnostics[0].message).to.equal(
                'Print statement is too long: 21 values and 1 comma count as 22 toward the Roku limit of 20. Split it into multiple print statements.'
            );
        });

        it('builds the same messages from the diagnostic factory', () => {
            expect(DiagnosticMessages.tooManyPrintItems(21, 0, 20).message).to.equal(
                'Print statement is too long: 21 values exceeds the Roku limit of 20. Split it into multiple print statements.'
            );
            expect(DiagnosticMessages.tooManyPrintItems(11, 10, 20).message).to.include('11 values and 10 commas count as 21');
        });

        it('counts a trailing comma', () => {
            expect(parseDiagnosticCodes(`print ${numbers(10, ', ')},`)).to.eql([]);
            expect(parseDiagnosticCodes(`print ${numbers(20, '; ')},`)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
        });

        it('counts a leading comma', () => {
            //1 comma + 19 values = 20
            expect(parseDiagnosticCodes(`print , ${numbers(19, '; ')}`)).to.eql([]);
            //1 comma + 20 values = 21
            expect(parseDiagnosticCodes(`print , ${numbers(20, '; ')}`)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
        });

        it('counts each of several consecutive commas', () => {
            //3 values + 17 commas = 20
            expect(parseDiagnosticCodes(`print 1${','.repeat(8)}2${','.repeat(8)}3,`)).to.eql([]);
            //3 values + 18 commas = 21
            const { diagnostics } = Parser.parse(`print 1${','.repeat(9)}2${','.repeat(8)}3,`);
            expect(diagnostics.map(diagnostic => diagnostic.code)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
            expect(diagnostics[0].message).to.include('3 values and 18 commas count as 21');
        });

        it('does not count a trailing semicolon', () => {
            expect(parseDiagnosticCodes(`print ${numbers(20, '; ')};`)).to.eql([]);
        });

        it('handles mixed separators at the boundary', () => {
            //18 values + 2 commas = 20
            expect(parseDiagnosticCodes(`print 1, 2, ${numbers(16, '; ')}`)).to.eql([]);
            //19 values + 2 commas = 21
            expect(parseDiagnosticCodes(`print 1, 2, ${numbers(17, '; ')}`)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
        });

        it('counts tab() and pos() calls as one value each', () => {
            //tab(5) and pos(0) plus 18 more values = 20
            expect(parseDiagnosticCodes(`print tab(5) pos(0) ${numbers(18, ' ')}`)).to.eql([]);
            //tab(5) and pos(0) plus 19 more values = 21
            expect(parseDiagnosticCodes(`print tab(5) pos(0) ${numbers(19, ' ')}`)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
        });

        it('applies to the question mark form', () => {
            expect(parseDiagnosticCodes(`? ${numbers(20, '; ')}`)).to.eql([]);
            expect(parseDiagnosticCodes(`? ${numbers(21, '; ')}`)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
        });

        it('ignores value complexity', () => {
            const expressions = Array.from({ length: 21 }, () => 'a + b * c(1)').join('; ');
            expect(parseDiagnosticCodes(`print ${expressions}`)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
        });

        it('applies the limit per statement', () => {
            const twentyValues = numbers(20, '; ');
            expect(parseDiagnosticCodes(`print ${twentyValues} : print ${twentyValues}`)).to.eql([]);
        });

        it('places the diagnostic on the print statement', () => {
            const source = `print ${numbers(21, '; ')}`;
            const { diagnostics } = Parser.parse(source);
            expect(diagnostics[0].location.range).to.eql(
                util.createRange(0, 0, 0, source.length)
            );
        });

        it('does not flag a long print statement inside a disabled #if block', () => {
            const { diagnostics } = Parser.parse(`
                sub main()
                    #if false
                        print ${numbers(21, '; ')}
                    #end if
                end sub
            `);
            expect(diagnostics).to.eql([]);
        });

        it('reports the diagnostic through the program', () => {
            program.setFile('source/main.bs', `
                sub main()
                    print ${numbers(21, '; ')}
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticCodeMap.tooManyPrintItems
            ]);
        });
    });

    it('supports empty print', () => {
        let { ast, diagnostics } = Parser.parse([token(TokenKind.Print), EOF]);
        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.exist;
        expect(ast.statements).not.to.be.null;
    });

    it('parses print lists with no separator', () => {
        let { ast, diagnostics } = Parser.parse([
            token(TokenKind.Print),
            token(TokenKind.StringLiteral, 'Foo'),
            token(TokenKind.StringLiteral, 'bar'),
            token(TokenKind.StringLiteral, 'baz'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.exist;
        expect(ast.statements).not.to.be.null;
    });

    it('parses print lists with separators', () => {
        let { ast, diagnostics } = Parser.parse([
            token(TokenKind.Print),
            token(TokenKind.StringLiteral, 'Foo'),
            token(TokenKind.Semicolon),
            token(TokenKind.StringLiteral, 'bar'),
            token(TokenKind.Semicolon),
            token(TokenKind.StringLiteral, 'baz'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.exist;
        expect(ast.statements).not.to.be.null;
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1
         *    0   4   8   2
         *  +--------------
         * 1| print "foo"
         */
        let { ast, diagnostics } = Parser.parse([
            {
                kind: TokenKind.Print,
                text: 'print',
                isReserved: true,
                location: util.createLocation(0, 0, 0, 5),
                leadingTrivia: []
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"foo"`,
                isReserved: false,
                location: util.createLocation(0, 6, 0, 11),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                location: util.createLocation(0, 11, 0, 12),
                leadingTrivia: []
            }
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.be.lengthOf(1);
        expect(ast.statements[0].location?.range).to.deep.include(Range.create(0, 0, 0, 11));
    });

    describe('transpile', () => {
        it('retains comma separators', async () => {
            await testTranspile(`
                sub main()
                    a$ = "string"
                    print a$, a$, a$
                end sub
            `);
        });

        it('retains semicolon separators', async () => {
            await testTranspile(`
                sub main()
                    a$ = "string"
                    print a$; a$; a$
                end sub
            `);
        });

        it('supports no space between function calls', async () => {
            await testTranspile(`
                function getText()
                    return "text"
                end function

                function main()
                    print getText() getText() getText()
                end function
            `);
        });

        it('supports print in loop', async () => {
            await testTranspile(`
                sub main()
                    paramArr = ["This", "is", true, "and", "this", "is", 1]
                    print "This is one line of stuff:";
                    for each item in paramArr
                        print item; " ";
                    end for
                    print ""
                end sub
            `, `
                sub main()
                    paramArr = [
                        "This"
                        "is"
                        true
                        "and"
                        "this"
                        "is"
                        1
                    ]
                    print "This is one line of stuff:";
                    for each item in paramArr
                        print item; " ";
                    end for
                    print ""
                end sub
            `);
        });

        it('handles roku documentation examples', async () => {
            await testTranspile(`
                sub main()
                    x=5:print 25; " is equal to"; x^2
                    a$="string":print a$;a$,a$;" ";a$
                    print "zone 1","zone 2","zone 3","zone 4"
                    print "print statement #1 ":print "print statement #2"
                    print "this is a five " 5 "!!"
                    print {}
                    print {a:1}
                    print []
                    print [5]
                    print tab(5)"tabbed 5";tab(25)"tabbed 25"
                    print tab(40) pos(0) 'prints 40 at position 40
                    print "these" tab(pos(0)+5)"words" tab(pos(0)+5)"are":print tab(pos(0)+5)"evenly" tab(pos(0)+5)"spaced"
                end sub
            `, `
                sub main()
                    x = 5
                    print 25; " is equal to"; x ^ 2
                    a$ = "string"
                    print a$;a$,a$;" ";a$
                    print "zone 1","zone 2","zone 3","zone 4"
                    print "print statement #1 "
                    print "print statement #2"
                    print "this is a five " 5 "!!"
                    print {}
                    print {
                        a: 1
                    }
                    print []
                    print [
                        5
                    ]
                    print tab(5) "tabbed 5";tab(25) "tabbed 25"
                    print tab(40) pos(0) 'prints 40 at position 40
                    print "these" tab(pos(0) + 5) "words" tab(pos(0) + 5) "are"
                    print tab(pos(0) + 5) "evenly" tab(pos(0) + 5) "spaced"
                end sub
            `);
        });
    });
});
