import { expect } from '../../../chai-config.spec';
import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { Program } from '../../../Program';
import { rootDir } from '../../../testHelpers.spec';
import { getTestTranspile } from '../../../testHelpers.spec';
import util from '../../../util';

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
                leadingWhitespace: '',
                leadingTrivia: []
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"foo"`,
                isReserved: false,
                location: util.createLocation(0, 6, 0, 11),
                leadingWhitespace: '',
                leadingTrivia: []
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                location: util.createLocation(0, 11, 0, 12),
                leadingWhitespace: '',
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
                    print a$; a$, a$; " "; a$
                    print "zone 1", "zone 2", "zone 3", "zone 4"
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
                    print tab(5) "tabbed 5"; tab(25) "tabbed 25"
                    print tab(40) pos(0) 'prints 40 at position 40
                    print "these" tab(pos(0) + 5) "words" tab(pos(0) + 5) "are"
                    print tab(pos(0) + 5) "evenly" tab(pos(0) + 5) "spaced"
                end sub
            `);
        });
    });
});
