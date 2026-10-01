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
        function getPrintDiagnosticCodes(printSource: string, fileName = 'source/main.brs') {
            program.setFile(fileName, `sub main()\n${printSource}\nend sub`);
            program.validate();
            return program.getDiagnostics().map(diagnostic => diagnostic.code);
        }

        function numbers(count: number, separator: string) {
            return Array.from({ length: count }, (_, index) => index + 1).join(separator);
        }

        function expectTooManyPrintItems(printSource: string, count: number, fileName = 'source/main.brs') {
            program.setFile(fileName, `sub main()\n${printSource}\nend sub`);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.tooManyPrintItems(count, 20)
            ]);
        }

        it('builds the message from the diagnostic factory', () => {
            expect(DiagnosticMessages.tooManyPrintItems(21, 20)).to.include({
                message: 'Print statement has 21 expressions (commas count too), max is 20.',
                code: 'exceeds-max-print-items'
            });
        });

        it('does not report from the parser', () => {
            expect(Parser.parse(`print ${numbers(21, '; ')}`).diagnostics).to.eql([]);
        });

        it('allows 20 values separated by semicolons', () => {
            expect(getPrintDiagnosticCodes(`print ${numbers(20, '; ')}`)).to.eql([]);
        });

        it('flags 21 values separated by semicolons', () => {
            expectTooManyPrintItems(`print ${numbers(21, '; ')}`, 21);
        });

        it('allows 20 adjacent values without separators', () => {
            expect(getPrintDiagnosticCodes(`print ${numbers(20, ' ')}`)).to.eql([]);
        });

        it('flags 21 adjacent values without separators', () => {
            expectTooManyPrintItems(`print ${numbers(21, ' ')}`, 21);
        });

        it('allows 10 values separated by commas', () => {
            expect(getPrintDiagnosticCodes(`print ${numbers(10, ', ')}`)).to.eql([]);
        });

        it('counts each comma toward the limit', () => {
            //11 values + 10 commas
            expectTooManyPrintItems(`print ${numbers(11, ', ')}`, 21);
        });

        it('allows a trailing comma within the limit', () => {
            expect(getPrintDiagnosticCodes(`print ${numbers(10, ', ')},`)).to.eql([]);
        });

        it('counts a trailing comma', () => {
            expectTooManyPrintItems(`print ${numbers(20, '; ')},`, 21);
        });

        it('allows a leading comma within the limit', () => {
            //1 comma + 19 values
            expect(getPrintDiagnosticCodes(`print , ${numbers(19, '; ')}`)).to.eql([]);
        });

        it('counts a leading comma', () => {
            //1 comma + 20 values
            expectTooManyPrintItems(`print , ${numbers(20, '; ')}`, 21);
        });

        it('allows consecutive commas within the limit', () => {
            //3 values + 17 commas
            expect(getPrintDiagnosticCodes(`print 1${','.repeat(8)}2${','.repeat(8)}3,`)).to.eql([]);
        });

        it('counts each of several consecutive commas', () => {
            //3 values + 18 commas
            expectTooManyPrintItems(`print 1${','.repeat(9)}2${','.repeat(8)}3,`, 21);
        });

        it('does not count a trailing semicolon', () => {
            expect(getPrintDiagnosticCodes(`print ${numbers(20, '; ')};`)).to.eql([]);
        });

        it('allows mixed separators at the limit', () => {
            //18 values + 2 commas
            expect(getPrintDiagnosticCodes(`print 1, 2, ${numbers(16, '; ')}`)).to.eql([]);
        });

        it('flags mixed separators over the limit', () => {
            //19 values + 2 commas
            expectTooManyPrintItems(`print 1, 2, ${numbers(17, '; ')}`, 21);
        });

        it('counts tab() and pos() calls as one value each at the limit', () => {
            //tab(5) and pos(0) plus 18 more values
            expect(getPrintDiagnosticCodes(`print tab(5) pos(0) ${numbers(18, ' ')}`)).to.eql([]);
        });

        it('counts tab() and pos() calls as one value each over the limit', () => {
            //tab(5) and pos(0) plus 19 more values
            expectTooManyPrintItems(`print tab(5) pos(0) ${numbers(19, ' ')}`, 21);
        });

        it('allows 20 values in the question mark form', () => {
            expect(getPrintDiagnosticCodes(`? ${numbers(20, '; ')}`)).to.eql([]);
        });

        it('flags 21 values in the question mark form', () => {
            expectTooManyPrintItems(`? ${numbers(21, '; ')}`, 21);
        });

        it('ignores value complexity', () => {
            const expressions = Array.from({ length: 21 }, () => '1 + 2 * 3').join('; ');
            expectTooManyPrintItems(`print ${expressions}`, 21);
        });

        it('counts an associative array literal as one expression', () => {
            const fields = Array.from({ length: 30 }, (_, index) => `k${index + 1}: ${index + 1}`).join(', ');
            expect(getPrintDiagnosticCodes(`print {${fields}}`)).to.eql([]);
        });

        it('counts an array literal as one expression', () => {
            const items = Array.from({ length: 30 }, (_, index) => index + 1).join(', ');
            expect(getPrintDiagnosticCodes(`print [${items}]`)).to.eql([]);
        });

        it('allows 20 values when the last is an associative array literal', () => {
            expect(getPrintDiagnosticCodes(`print ${numbers(19, '; ')}; { a: 1, b: 2 }`)).to.eql([]);
        });

        it('flags 21 values when the last is an associative array literal', () => {
            expectTooManyPrintItems(`print ${numbers(20, '; ')}; { a: 1, b: 2 }`, 21);
        });

        it('allows 20 values when the last is an array literal', () => {
            expect(getPrintDiagnosticCodes(`print ${numbers(19, '; ')}; [1, 2, 3]`)).to.eql([]);
        });

        it('flags 21 values when the last is an array literal', () => {
            expectTooManyPrintItems(`print ${numbers(20, '; ')}; [1, 2, 3]`, 21);
        });

        it('applies the limit per statement', () => {
            const twentyValues = numbers(20, '; ');
            expect(getPrintDiagnosticCodes(`print ${twentyValues} : print ${twentyValues}`)).to.eql([]);
        });

        it('flags only the statement over the limit when two share a line', () => {
            program.setFile('source/main.brs', `sub main()\nprint 1 : print ${numbers(21, '; ')}\nend sub`);
            program.validate();
            expect(program.getDiagnostics().map(diagnostic => diagnostic.code)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
        });

        it('places the diagnostic on the whole print statement', () => {
            const printSource = `print ${numbers(21, '; ')}`;
            program.setFile('source/main.brs', `sub main()\n${printSource}\nend sub`);
            program.validate();
            expectDiagnostics(program, [{
                code: DiagnosticCodeMap.tooManyPrintItems,
                location: { range: util.createRange(1, 0, 1, printSource.length) }
            }]);
        });

        it('reports the diagnostic once per validation', () => {
            program.setFile('source/main.brs', `sub main()\nprint ${numbers(21, '; ')}\nend sub`);
            program.validate();
            program.validate();
            expect(program.getDiagnostics().map(diagnostic => diagnostic.code)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
        });

        it('flags a long print statement in a brighterscript file', () => {
            expectTooManyPrintItems(`print ${numbers(21, '; ')}`, 21, 'source/main.bs');
        });

        it('does not flag a long print statement inside a disabled #if block', () => {
            program.setFile('source/main.brs', `
                sub main()
                    #if false
                        print ${numbers(21, '; ')}
                    #end if
                end sub
            `);
            program.validate();
            expect(program.getDiagnostics().map(diagnostic => diagnostic.code)).to.eql([]);
        });

        it('does not flag a long print statement inside a disabled #else block', () => {
            program.setFile('source/main.brs', `
                #const featureEnabled = true
                sub main()
                    #if featureEnabled
                        print 1
                    #else
                        print ${numbers(21, '; ')}
                    #end if
                end sub
            `);
            program.validate();
            expect(program.getDiagnostics().map(diagnostic => diagnostic.code)).to.eql([]);
        });

        it('flags a long print statement inside an enabled #if block', () => {
            program.setFile('source/main.brs', `
                #const featureEnabled = true
                sub main()
                    #if featureEnabled
                        print ${numbers(21, '; ')}
                    #end if
                end sub
            `);
            program.validate();
            expect(program.getDiagnostics().map(diagnostic => diagnostic.code)).to.eql([DiagnosticCodeMap.tooManyPrintItems]);
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
