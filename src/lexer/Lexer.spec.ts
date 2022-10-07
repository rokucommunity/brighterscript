/* eslint no-template-curly-in-string: 0 */
import { expect } from '../chai-config.spec';

import { TokenKind } from './TokenKind';
import { Lexer } from './Lexer';
import { isToken } from './Token';
import { rangeToArray } from '../parser/Parser.spec';
import { Range } from 'vscode-languageserver';
import util from '../util';

describe('lexer', () => {
    it('recognizes the `const` keyword', () => {
        let { tokens } = Lexer.scan('const');
        expect(tokens.map(x => x.kind)).to.eql([
            TokenKind.Const,
            TokenKind.Eof
        ]);
    });
    it('recognizes namespace keywords', () => {
        let { tokens } = Lexer.scan('namespace end namespace endnamespace end   namespace');
        expect(tokens.map(x => x.kind)).to.eql([
            TokenKind.Namespace,
            TokenKind.EndNamespace,
            TokenKind.EndNamespace,
            TokenKind.EndNamespace,
            TokenKind.Eof
        ]);
    });

    it('recognizes the question mark operator in various contexts', () => {
        expectKinds('? ?? ?. ?[ ?.[ ?( ?@', [
            TokenKind.Question,
            TokenKind.QuestionQuestion,
            TokenKind.QuestionDot,
            TokenKind.QuestionLeftSquare,
            TokenKind.QuestionDot,
            TokenKind.LeftSquareBracket,
            TokenKind.QuestionLeftParen,
            TokenKind.QuestionAt
        ]);
    });

    it('separates optional chain characters and LeftSquare when found at beginning of statement locations', () => {
        //a statement starting with a question mark is actually a print statement, so we need to keep the ? separate from [
        expectKinds(`?[ ?[ : ?[ ?[`, [
            TokenKind.Question,
            TokenKind.LeftSquareBracket,
            TokenKind.QuestionLeftSquare,
            TokenKind.Colon,
            TokenKind.Question,
            TokenKind.LeftSquareBracket,
            TokenKind.QuestionLeftSquare
        ]);
    });

    it('separates optional chain characters and LeftParen when found at beginning of statement locations', () => {
        //a statement starting with a question mark is actually a print statement, so we need to keep the ? separate from [
        expectKinds(`?( ?( : ?( ?(`, [
            TokenKind.Question,
            TokenKind.LeftParen,
            TokenKind.QuestionLeftParen,
            TokenKind.Colon,
            TokenKind.Question,
            TokenKind.LeftParen,
            TokenKind.QuestionLeftParen
        ]);
    });

    it('handles QuestionDot and Square properly', () => {
        expectKinds('?.[ ?. [', [
            TokenKind.QuestionDot,
            TokenKind.LeftSquareBracket,
            TokenKind.QuestionDot,
            TokenKind.LeftSquareBracket
        ]);
    });

    it('does not make conditional chaining tokens with space between', () => {
        expectKinds('? . ? [ ? ( ? @', [
            TokenKind.Question,
            TokenKind.Dot,
            TokenKind.Question,
            TokenKind.LeftSquareBracket,
            TokenKind.Question,
            TokenKind.LeftParen,
            TokenKind.Question,
            TokenKind.At
        ]);
    });

    it('recognizes the callfunc operator', () => {
        let { tokens } = Lexer.scan('@.');
        expect(tokens[0].kind).to.equal(TokenKind.Callfunc);
    });

    it('recognizes the import token', () => {
        let { tokens } = Lexer.scan('import');
        expect(tokens[0].kind).to.eql(TokenKind.Import);
    });

    it('recognizes library token', () => {
        let { tokens } = Lexer.scan('library');
        expect(tokens[0].kind).to.eql(TokenKind.Library);
    });

    it('produces an at symbol token', () => {
        let { tokens } = Lexer.scan('@');
        expect(tokens[0].kind).to.equal(TokenKind.At);
    });

    it('produces a semicolon token', () => {
        let { tokens } = Lexer.scan(';');
        expect(tokens[0].kind).to.equal(TokenKind.Semicolon);
    });

    it('emits error on unknown character type', () => {
        let { diagnostics } = Lexer.scan('\0');
        expect(diagnostics).to.be.lengthOf(1);
    });

    it('includes an end-of-file marker', () => {
        let { tokens } = Lexer.scan('');
        expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.Eof]);
    });

    it('ignores tabs and spaces', () => {
        let { tokens } = Lexer.scan('\t\t  \t     \t');
        expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.Eof]);
    });

    it('retains every single newline', () => {
        let { tokens } = Lexer.scan('\n\n\'foo\n\n\nprint 2\n\n');
        expect(tokens.map(t => t.kind)).to.deep.equal([
            TokenKind.Newline,
            TokenKind.Newline,
            TokenKind.Comment,
            TokenKind.Newline,
            TokenKind.Newline,
            TokenKind.Newline,
            TokenKind.Print,
            TokenKind.IntegerLiteral,
            TokenKind.Newline,
            TokenKind.Newline,
            TokenKind.Eof
        ]);
    });

    it('does not insert double newlines with the windows \\r\\n newline', () => {
        let kinds = Lexer.scan(
            'function boolToNumber() as string\r\n' +
            '   if true then\r\n' +
            '       print 1\r\n' +
            '   else\r\n' +
            '       print 0\r\n' +
            '   end if\r\n' +
            'end function\r\n'
        ).tokens.map(x => x.kind);
        expect(kinds).to.eql([
            TokenKind.Function, TokenKind.Identifier, TokenKind.LeftParen, TokenKind.RightParen, TokenKind.As, TokenKind.String, TokenKind.Newline,
            TokenKind.If, TokenKind.True, TokenKind.Then, TokenKind.Newline,
            TokenKind.Print, TokenKind.IntegerLiteral, TokenKind.Newline,
            TokenKind.Else, TokenKind.Newline,
            TokenKind.Print, TokenKind.IntegerLiteral, TokenKind.Newline,
            TokenKind.EndIf, TokenKind.Newline,
            TokenKind.EndFunction, TokenKind.Newline,
            TokenKind.Eof
        ]);
    });

    it('computes range properly both with and without whitespace', () => {
        let withoutWhitespace = Lexer.scan(`sub Main()\n    bob = true\nend sub`).tokens
            .map(x => rangeToArray(x.range));

        let withWhitespace = Lexer.scan(`sub Main()\n    bob = true\nend sub`).tokens
            //filter out the whitespace...we only care that it was computed during the scan
            .filter(x => x.kind !== TokenKind.Whitespace)
            .map(x => rangeToArray(x.range));

        /*eslint-disable */
        let expectedLocations = [
            [0, 0, 0, 3],   // sub
            [0, 4, 0, 8],   // main
            [0, 8, 0, 9],   // (
            [0, 9, 0, 10],  // )
            [0, 10, 0, 11], // \n
            [1, 4, 1, 7],   // bob
            [1, 8, 1, 9],   // =
            [1, 10, 1, 14], // true,
            [1, 14, 1, 15], // \n
            [2, 0, 2, 7],   //end sub
            [2, 7, 2, 8]    //Eof
        ];
        /*eslint-enable*/

        expect(withoutWhitespace, 'Without whitespace').to.eql(expectedLocations);
        expect(withWhitespace, 'With whitespace').to.eql(expectedLocations);
    });

    it('retains original line endings', () => {
        let { tokens } = Lexer.scan('print "hello"\r\nprint "world"\n');
        expect([
            tokens[2].text.charCodeAt(0),
            tokens[2].text.charCodeAt(1)
        ], 'should contain \\r\\n').to.eql([13, 10]);
        expect(tokens[5].text.charCodeAt(0), 'should contain \\r\\n').to.eql(10);
    });

    it('correctly splits the elseif token', () => {
        let { tokens } = Lexer.scan('else if elseif else   if');
        expect(tokens.map(t => t.kind)).to.deep.equal([
            TokenKind.Else,
            TokenKind.If,
            TokenKind.Else,
            TokenKind.If,
            TokenKind.Else,
            TokenKind.If,
            TokenKind.Eof
        ]);
    });

    it('gives the `as` keyword its own TokenKind', () => {
        let { tokens } = Lexer.scan('as');
        expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.As, TokenKind.Eof]);
    });

    it('gives the `stop` keyword its own TokenKind', () => {
        let { tokens } = Lexer.scan('stop');
        expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.Stop, TokenKind.Eof]);
    });

    it('does not alias \'?\' to \'print\' - the parser will do that', () => {
        let { tokens } = Lexer.scan('?2');
        expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.Question, TokenKind.IntegerLiteral, TokenKind.Eof]);
    });

    describe('comments', () => {
        it('does not include carriage return character', () => {
            let tokens = Lexer.scan(`'someComment\r\nprint "hello"`).tokens;
            expect(tokens[0].text).to.equal(`'someComment`);
        });

        it('includes the comment characters in the text', () => {
            let text = Lexer.scan(`
                'comment
                REM some comment
            `).tokens
                .filter(x => ![TokenKind.Newline, TokenKind.Eof].includes(x.kind))
                .map(x => x.text);

            expect(text).to.eql([
                `'comment`,
                'REM some comment'
            ]);
        });

        it('tracks the correct location', () => {
            let tokens = Lexer.scan(`
                sub main() 'first comment
                    k = 2 ' second comment
                    REM third comment
                end sub
            `, {
                includeWhitespace: true
            }).tokens.map(x => [...rangeToArray(x.range), x.text]);

            expect(tokens).to.eql([
                [0, 0, 0, 1, '\n'],
                [1, 0, 1, 16, '                '],
                [1, 16, 1, 19, 'sub'],
                [1, 19, 1, 20, ' '],
                [1, 20, 1, 24, 'main'],
                [1, 24, 1, 25, '('],
                [1, 25, 1, 26, ')'],
                [1, 26, 1, 27, ' '],
                [1, 27, 1, 41, `'first comment`],
                [1, 41, 1, 42, '\n'],
                [2, 0, 2, 20, '                    '],
                [2, 20, 2, 21, 'k'],
                [2, 21, 2, 22, ' '],
                [2, 22, 2, 23, '='],
                [2, 23, 2, 24, ' '],
                [2, 24, 2, 25, '2'],
                [2, 25, 2, 26, ' '],
                [2, 26, 2, 42, `' second comment`],
                [2, 42, 2, 43, '\n'],
                [3, 0, 3, 20, '                    '],
                [3, 20, 3, 37, 'REM third comment'],
                [3, 37, 3, 38, '\n'],
                [4, 0, 4, 16, '                '],
                [4, 16, 4, 23, 'end sub'],
                [4, 23, 4, 24, '\n'],
                [5, 0, 5, 12, '            '],
                [5, 12, 5, 13, '']//EOF
            ]);
        });

        it('tracks the correct location for comments', () => {
            let tokens = Lexer.scan(`
                'comment
                REM some comment
            `).tokens.filter(x => ![TokenKind.Newline, TokenKind.Eof].includes(x.kind));

            expect(tokens[0].range).to.eql(
                Range.create(1, 16, 1, 24)
            );

            expect(tokens[1].range).to.eql(
                Range.create(2, 16, 2, 32)
            );
        });

        it('finds correct location for newlines', () => {
            let tokens = Lexer.scan('sub\nsub\r\nsub\n\n').tokens
                //ignore the Eof token
                .filter(x => x.kind !== TokenKind.Eof);

            expect(tokens.map(x => x.range)).to.eql([
                Range.create(0, 0, 0, 3), // sub
                Range.create(0, 3, 0, 4), // \n
                Range.create(1, 0, 1, 3), // sub
                Range.create(1, 3, 1, 5), // \r\n
                Range.create(2, 0, 2, 3), // sub
                Range.create(2, 3, 2, 4), // \n
                Range.create(3, 0, 3, 1) //  /n
            ]);
        });
        it('finds correct location for comment after if statement', () => {
            let { tokens } = Lexer.scan(`
                sub a()
                    if true then
                        print false
                    else if true then
                        print "true"
                    else
                        print "else"
                    end if 'comment
                end sub
            `);
            let comments = tokens.filter(x => x.kind === TokenKind.Comment);
            expect(comments).to.be.lengthOf(1);
            expect(comments[0].range).to.eql(
                Range.create(8, 27, 8, 35)
            );
        });
        it('ignores everything after `\'`', () => {
            let { tokens } = Lexer.scan('= \' (');
            expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.Equal, TokenKind.Comment, TokenKind.Eof]);
        });

        it('ignores everything after `REM`', () => {
            let { tokens } = Lexer.scan('= REM (');
            expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.Equal, TokenKind.Comment, TokenKind.Eof]);
        });

        it('ignores everything after `rem`', () => {
            let { tokens } = Lexer.scan('= rem (');
            expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.Equal, TokenKind.Comment, TokenKind.Eof]);
        });
    }); // comments

    describe('non-literals', () => {
        it('reads parens & braces', () => {
            let { tokens } = Lexer.scan('(){}');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.LeftParen,
                TokenKind.RightParen,
                TokenKind.LeftCurlyBrace,
                TokenKind.RightCurlyBrace,
                TokenKind.Eof
            ]);
        });

        it('reads operators', () => {
            let { tokens } = Lexer.scan('^ - + * MOD / \\ -- ++');

            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.Caret,
                TokenKind.Minus,
                TokenKind.Plus,
                TokenKind.Star,
                TokenKind.Mod,
                TokenKind.Forwardslash,
                TokenKind.Backslash,
                TokenKind.MinusMinus,
                TokenKind.PlusPlus,
                TokenKind.Eof
            ]);
        });

        it('reads bitshift operators', () => {
            let { tokens } = Lexer.scan('<< >> <<');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.LeftShift,
                TokenKind.RightShift,
                TokenKind.LeftShift,
                TokenKind.Eof
            ]);
        });

        it('reads bitshift assignment operators', () => {
            let { tokens } = Lexer.scan('<<= >>=');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.LeftShiftEqual,
                TokenKind.RightShiftEqual,
                TokenKind.Eof
            ]);
        });

        it('reads comparators', () => {
            let { tokens } = Lexer.scan('< <= > >= = <>');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.Less,
                TokenKind.LessEqual,
                TokenKind.Greater,
                TokenKind.GreaterEqual,
                TokenKind.Equal,
                TokenKind.LessGreater,
                TokenKind.Eof
            ]);
        });
    }); // non-literals

    describe('string literals', () => {
        it('produces string literal tokens', () => {
            let { tokens } = Lexer.scan(`"hello world"`);
            expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.StringLiteral, TokenKind.Eof]);
        });

        it(`safely escapes " literals`, () => {
            let { tokens } = Lexer.scan(`"the cat says ""meow"""`);
            expect(tokens[0].kind).to.equal(TokenKind.StringLiteral);
        });

        it('captures text to end of line for unterminated strings with LF', () => {
            let { tokens } = Lexer.scan(`"unterminated!\n`);
            expect(tokens[0].kind).to.eql(TokenKind.StringLiteral);
        });

        it('captures text to end of line for unterminated strings with CRLF', () => {
            let { tokens } = Lexer.scan(`"unterminated!\r\n`);
            expect(tokens[0].text).to.equal('"unterminated!');
        });

        it('disallows multiline strings', () => {
            let { diagnostics } = Lexer.scan(`"multi-line\n\n`);
            expect(diagnostics.map(err => err.message)).to.deep.equal([
                'Unterminated string at end of line'
            ]);
        });
    });

    // template string literals

    describe('template string literals', () => {
        it('supports escaped chars', () => {
            let { tokens } = Lexer.scan('`\\n\\`\\r\\n`');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi, //empty
                TokenKind.EscapedCharCodeLiteral, // slash n
                TokenKind.TemplateStringQuasi, //empty
                TokenKind.EscapedCharCodeLiteral, // slash backtick
                TokenKind.TemplateStringQuasi, //empty
                TokenKind.EscapedCharCodeLiteral, // slash r
                TokenKind.TemplateStringQuasi, //empty
                TokenKind.EscapedCharCodeLiteral, // slash n
                TokenKind.TemplateStringQuasi, //empty
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
            expect(tokens.map(x => (x as any).charCode).filter(x => !!x)).to.eql([
                10,
                96,
                13,
                10
            ]);
        });

        it('prevents expressions when escaping the dollar sign', () => {
            let { tokens } = Lexer.scan('`\\${just text}`');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi, //empty
                TokenKind.EscapedCharCodeLiteral, // slash dollar sign
                TokenKind.TemplateStringQuasi,
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
        });

        it('supports escaping unicode char codes', () => {
            let { tokens } = Lexer.scan('`\\c1\\c12\\c123`');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi, //empty
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi, //empty
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi, //empty
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
            expect(tokens.map(x => (x as any).charCode).filter(x => !!x)).to.eql([
                1,
                12,
                123
            ]);
        });

        it('converts doublequote to EscapedCharCodeLiteral', () => {
            let { tokens } = Lexer.scan('`"`');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
            expect((tokens[2] as any).charCode).to.equal(34);
        });

        it(`safely escapes \` literals`, () => {
            let { tokens } = Lexer.scan('`the cat says \\`meow\\` a lot`');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral, // slash backtick
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral, // slash backtick
                TokenKind.TemplateStringQuasi,
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
            expect(tokens.map(x => x.text)).to.eql([
                '`',
                'the cat says ',
                '\\`',
                'meow',
                '\\`',
                ' a lot',
                '`',
                '' //EOF
            ]);
        });

        it('produces template string literal tokens', () => {
            let { tokens } = Lexer.scan('`hello world`');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi,
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
            expect(tokens[1].text).to.deep.equal('hello world');
        });

        it('collects quasis outside and expressions inside of template strings', () => {
            let { tokens } = Lexer.scan('`hello ${"world"}!`');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi,
                TokenKind.TemplateStringExpressionBegin,
                TokenKind.StringLiteral,
                TokenKind.TemplateStringExpressionEnd,
                TokenKind.TemplateStringQuasi,
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
            expect(tokens[1].text).to.deep.equal(`hello `);
        });

        it('real example, which is causing issues in the formatter', () => {
            let { tokens } = Lexer.scan(`
                function getItemXML(item)
                    return \`
                        <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
                        <channel>
                            <title>smithsonian</title>
                            <item>
                                <title>\${item.title}</title>
                                <guid>\${item.vamsId}</guid>
                                <media:rating scheme="urn:v-chip">\${item.ratings.first.code.name}</media:rating>
                            </item>
                        </channel>
                        </rss>
                    \`
                end function
            `);
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.Newline,
                TokenKind.Function,
                TokenKind.Identifier,
                TokenKind.LeftParen,
                TokenKind.Identifier,
                TokenKind.RightParen,
                TokenKind.Newline,
                TokenKind.Return,
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.TemplateStringExpressionBegin,
                TokenKind.Identifier,
                TokenKind.Dot,
                TokenKind.Identifier,
                TokenKind.TemplateStringExpressionEnd,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.TemplateStringExpressionBegin,
                TokenKind.Identifier,
                TokenKind.Dot,
                TokenKind.Identifier,
                TokenKind.TemplateStringExpressionEnd,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.TemplateStringExpressionBegin,
                TokenKind.Identifier,
                TokenKind.Dot,
                TokenKind.Identifier,
                TokenKind.Dot,
                TokenKind.Identifier,
                TokenKind.Dot,
                TokenKind.Identifier,
                TokenKind.Dot,
                TokenKind.Identifier,
                TokenKind.TemplateStringExpressionEnd,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.BackTick,
                TokenKind.Newline,
                TokenKind.EndFunction,
                TokenKind.Newline,
                TokenKind.Eof
            ]);
        });

        it('complicated example', () => {
            let { tokens } = Lexer.scan(
                '`hello ${"world"}!I am a ${"template" + "string"} and I am very ${["pleased"][0]} to meet you ${m.top.getChildCount()}.The end`'
            );
            expect(tokens.map(t => t.kind)).to.eql([
                TokenKind.BackTick, // `
                TokenKind.TemplateStringQuasi, // hello
                TokenKind.TemplateStringExpressionBegin, //$ {
                TokenKind.StringLiteral, // "world"
                TokenKind.TemplateStringExpressionEnd, // }
                TokenKind.TemplateStringQuasi, //!I am a
                TokenKind.TemplateStringExpressionBegin, // ${
                TokenKind.StringLiteral, // "template"
                TokenKind.Plus, // +
                TokenKind.StringLiteral, //"string"
                TokenKind.TemplateStringExpressionEnd, // }
                TokenKind.TemplateStringQuasi, // and I am very
                TokenKind.TemplateStringExpressionBegin, // ${
                TokenKind.LeftSquareBracket, // [
                TokenKind.StringLiteral, // "pleased"
                TokenKind.RightSquareBracket, // ]
                TokenKind.LeftSquareBracket, // [
                TokenKind.IntegerLiteral, // 0
                TokenKind.RightSquareBracket, // ]
                TokenKind.TemplateStringExpressionEnd, // }
                TokenKind.TemplateStringQuasi, // to meet you
                TokenKind.TemplateStringExpressionBegin, // ${
                TokenKind.Identifier, // m
                TokenKind.Dot, // .
                TokenKind.Identifier, // top
                TokenKind.Dot, // .
                TokenKind.Identifier, //getChildCount,
                TokenKind.LeftParen, // (
                TokenKind.RightParen, // )
                TokenKind.TemplateStringExpressionEnd, // }
                TokenKind.TemplateStringQuasi, // .The end
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
        });

        it('allows multiline strings', () => {
            let { tokens } = Lexer.scan('`multi-line\n\n`');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
            expect(tokens.map(x => x.text)).to.eql([
                '`',
                'multi-line',
                '\n',
                '',
                '\n',
                '',
                '`',
                '' //EOF
            ]);
        });

        it('maintains proper line/column locations for multiline strings', () => {
            let { tokens } = Lexer.scan(
                '123 `multi\nline\r\nstrings` true\nfalse'
            );
            expect(tokens.map(x => {
                return {
                    range: x.range,
                    kind: x.kind
                };
            })).to.eql([
                { range: Range.create(0, 0, 0, 3), kind: TokenKind.IntegerLiteral },
                { range: Range.create(0, 4, 0, 5), kind: TokenKind.BackTick },
                { range: Range.create(0, 5, 0, 10), kind: TokenKind.TemplateStringQuasi },
                { range: Range.create(0, 10, 0, 11), kind: TokenKind.EscapedCharCodeLiteral },
                { range: Range.create(1, 0, 1, 4), kind: TokenKind.TemplateStringQuasi },
                { range: Range.create(1, 4, 1, 5), kind: TokenKind.EscapedCharCodeLiteral },
                { range: Range.create(1, 5, 1, 6), kind: TokenKind.EscapedCharCodeLiteral },
                { range: Range.create(2, 0, 2, 7), kind: TokenKind.TemplateStringQuasi },
                { range: Range.create(2, 7, 2, 8), kind: TokenKind.BackTick },
                { range: Range.create(2, 9, 2, 13), kind: TokenKind.True },
                { range: Range.create(2, 13, 2, 14), kind: TokenKind.Newline },
                { range: Range.create(3, 0, 3, 5), kind: TokenKind.False },
                { range: Range.create(3, 5, 3, 6), kind: TokenKind.Eof }
            ]);
        });

        it('Example that tripped up the expression tests', () => {
            let { tokens } = Lexer.scan(
                '`I am a complex example\n${a.isRunning(["a","b","c"])}\nmore ${m.finish(true)}`'
            );
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.BackTick,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.TemplateStringExpressionBegin,
                TokenKind.Identifier,
                TokenKind.Dot,
                TokenKind.Identifier,
                TokenKind.LeftParen,
                TokenKind.LeftSquareBracket,
                TokenKind.StringLiteral,
                TokenKind.Comma,
                TokenKind.StringLiteral,
                TokenKind.Comma,
                TokenKind.StringLiteral,
                TokenKind.RightSquareBracket,
                TokenKind.RightParen,
                TokenKind.TemplateStringExpressionEnd,
                TokenKind.TemplateStringQuasi,
                TokenKind.EscapedCharCodeLiteral,
                TokenKind.TemplateStringQuasi,
                TokenKind.TemplateStringExpressionBegin,
                TokenKind.Identifier,
                TokenKind.Dot,
                TokenKind.Identifier,
                TokenKind.LeftParen,
                TokenKind.True,
                TokenKind.RightParen,
                TokenKind.TemplateStringExpressionEnd,
                TokenKind.TemplateStringQuasi,
                TokenKind.BackTick,
                TokenKind.Eof
            ]);
        });
    }); // string literals

    describe('double literals', () => {
        it('respects \'#\' suffix', () => {
            let d = Lexer.scan('123#').tokens[0];
            expect(d.kind).to.equal(TokenKind.DoubleLiteral);
            expect(d.text).to.eql('123#');
        });

        it('forces literals >= 10 digits into doubles', () => {
            let d = Lexer.scan('0000000005').tokens[0];
            expect(d.kind).to.equal(TokenKind.DoubleLiteral);
            expect(d.text).to.eql('0000000005');
        });

        it('forces literals with \'D\' in exponent into doubles', () => {
            let d = Lexer.scan('2.5d3').tokens[0];
            expect(d.kind).to.equal(TokenKind.DoubleLiteral);
            expect(d.text).to.eql('2.5d3');
        });

        it('allows digits before `.` to be elided', () => {
            let f = Lexer.scan('.123#').tokens[0];
            expect(f.kind).to.equal(TokenKind.DoubleLiteral);
            expect(f.text).to.eql('.123#');
        });

        it('allows digits after `.` to be elided', () => {
            let f = Lexer.scan('12.#').tokens[0];
            expect(f.kind).to.equal(TokenKind.DoubleLiteral);
            expect(f.text).to.eql('12.#');
        });
    });

    describe('float literals', () => {
        it('respects \'!\' suffix', () => {
            let f = Lexer.scan('0.00000008!').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            // Floating precision will make this *not* equal
            expect(f.text).not.to.equal(8e-8);
            expect(f.text).to.eql('0.00000008!');
        });

        it('forces literals with a decimal into floats', () => {
            let f = Lexer.scan('1.0').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.text).to.equal('1.0');
        });

        it('forces literals with \'E\' in exponent into floats', () => {
            let f = Lexer.scan('2.5e3').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.text).to.eql('2.5e3');
        });

        it('supports larger-than-supported-precision floats to be defined with exponents', () => {
            let f = Lexer.scan('2.3659475627512424e-38').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.text).to.eql('2.3659475627512424e-38');
        });

        it('allows digits before `.` to be elided', () => {
            let f = Lexer.scan('.123').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.text).to.equal('.123');
        });

        it('allows digits after `.` to be elided', () => {
            let f = Lexer.scan('12.').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.text).to.equal('12.');
        });
    });

    describe('long integer literals', () => {
        it('respects \'&\' suffix', () => {
            let f = Lexer.scan('1&').tokens[0];
            expect(f.kind).to.equal(TokenKind.LongIntegerLiteral);
            expect(f.text).to.eql('1&');
        });

        it('supports hexadecimal literals', () => {
            let i = Lexer.scan('&hf00d&').tokens[0];
            expect(i.kind).to.equal(TokenKind.LongIntegerLiteral);
            expect(i.text).to.equal('&hf00d&');
        });

        it('allows very long Int64 literals', () => {
            let li = Lexer.scan('9876543210&').tokens[0];
            expect(li.kind).to.equal(TokenKind.LongIntegerLiteral);
            expect(li.text).to.equal('9876543210&');
        });

        it('forces literals with \'&\' suffix into Int64s', () => {
            let li = Lexer.scan('123&').tokens[0];
            expect(li.kind).to.equal(TokenKind.LongIntegerLiteral);
            expect(li.text).to.deep.equal('123&');
        });
    });

    describe('integer literals', () => {
        it('respects \'%\' suffix', () => {
            let f = Lexer.scan('1%').tokens[0];
            expect(f.kind).to.equal(TokenKind.IntegerLiteral);
            expect(f.text).to.eql('1%');
        });

        it('does not allow decimal numbers to end with %', () => {
            let f = Lexer.scan('1.2%').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.text).to.eql('1.2');
        });

        it('supports hexadecimal literals', () => {
            let i = Lexer.scan('&hFf').tokens[0];
            expect(i.kind).to.equal(TokenKind.IntegerLiteral);
            expect(i.text).to.deep.equal('&hFf');
        });

        it('falls back to a regular integer', () => {
            let i = Lexer.scan('123').tokens[0];
            expect(i.kind).to.equal(TokenKind.IntegerLiteral);
            expect(i.text).to.deep.equal('123');
        });
    });

    describe('types', () => {
        it('captures type tokens', () => {
            expect(Lexer.scan(`
                void boolean integer longinteger float double string object interface invalid dynamic
            `.trim()).tokens.map(x => x.kind)).to.eql([
                TokenKind.Void,
                TokenKind.Boolean,
                TokenKind.Integer,
                TokenKind.LongInteger,
                TokenKind.Float,
                TokenKind.Double,
                TokenKind.String,
                TokenKind.Object,
                TokenKind.Interface,
                TokenKind.Invalid,
                TokenKind.Dynamic,
                TokenKind.Eof
            ]);
        });
    });

    describe('identifiers', () => {
        it('matches single-word keywords', () => {
            // test just a sample of single-word reserved words for now.
            // if we find any that we've missed
            let { tokens } = Lexer.scan('and then or if else endif return true false line_num');
            expect(tokens.map(w => w.kind)).to.deep.equal([
                TokenKind.And,
                TokenKind.Then,
                TokenKind.Or,
                TokenKind.If,
                TokenKind.Else,
                TokenKind.EndIf,
                TokenKind.Return,
                TokenKind.True,
                TokenKind.False,
                TokenKind.LineNumLiteral,
                TokenKind.Eof
            ]);
        });

        it('matches multi-word keywords', () => {
            let { tokens } = Lexer.scan('end if end while End Sub end Function Exit wHILe');
            expect(tokens.map(w => w.kind)).to.deep.equal([
                TokenKind.EndIf,
                TokenKind.EndWhile,
                TokenKind.EndSub,
                TokenKind.EndFunction,
                TokenKind.ExitWhile,
                TokenKind.Eof
            ]);
        });

        it('accepts \'exit for\' but not \'exitfor\'', () => {
            let { tokens } = Lexer.scan('exit for exitfor');
            expect(tokens.map(w => w.kind)).to.deep.equal([
                TokenKind.ExitFor,
                TokenKind.Identifier,
                TokenKind.Eof
            ]);
        });

        it('matches keywords with silly capitalization', () => {
            let { tokens } = Lexer.scan('iF ELSE eNDIf FUncTioN');
            expect(tokens.map(w => w.kind)).to.deep.equal([
                TokenKind.If,
                TokenKind.Else,
                TokenKind.EndIf,
                TokenKind.Function,
                TokenKind.Eof
            ]);
        });

        it('allows alpha-numeric (plus \'_\') identifiers', () => {
            let identifier = Lexer.scan('_abc_123_').tokens[0];
            expect(identifier.kind).to.equal(TokenKind.Identifier);
            expect(identifier.text).to.equal('_abc_123_');
        });

        it('allows identifiers with trailing type designators', () => {
            let { tokens } = Lexer.scan('lorem$ ipsum% dolor! sit# amet&');
            let identifiers = tokens.filter(t => t.kind !== TokenKind.Eof);
            expect(identifiers.every(t => t.kind === TokenKind.Identifier));
            expect(identifiers.map(t => t.text)).to.deep.equal([
                'lorem$',
                'ipsum%',
                'dolor!',
                'sit#',
                'amet&'
            ]);
        });
    });

    describe('conditional compilation', () => {
        it('reads constant declarations', () => {
            let { tokens } = Lexer.scan('#const foo true');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.HashConst,
                TokenKind.Identifier,
                TokenKind.True,
                TokenKind.Eof
            ]);
        });

        it('reads constant aliases', () => {
            let { tokens } = Lexer.scan('#const bar foo');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.HashConst,
                TokenKind.Identifier,
                TokenKind.Identifier,
                TokenKind.Eof
            ]);
        });

        it('reads conditional directives', () => {
            let { tokens } = Lexer.scan(`
                #if
                #else if
                #elseif
                #else
                #end if
                #endif
            `, {
                includeWhitespace: false
            });
            expect(
                tokens.map(t => t.kind).filter(x => x !== TokenKind.Newline)
            ).to.deep.equal([
                TokenKind.HashIf,
                TokenKind.HashElseIf,
                TokenKind.HashElseIf,
                TokenKind.HashElse,
                TokenKind.HashEndIf,
                TokenKind.HashEndIf,
                TokenKind.Eof
            ]);
        });

        it('treats text "constructor" as an identifier', () => {
            let lexer = Lexer.scan(`function constructor()\nend function`);
            expect(lexer.tokens[1].kind).to.equal(TokenKind.Identifier);
        });

        it('reads upper case conditional directives', () => {
            let { tokens } = Lexer.scan(`
                #IF
                #ELSE IF
                #ELSEIF
                #ELSE
                #END IF
                #ENDIF
            `, {
                includeWhitespace: false
            });
            expect(
                tokens.map(t => t.kind).filter(x => x !== TokenKind.Newline)
            ).to.deep.equal([
                TokenKind.HashIf,
                TokenKind.HashElseIf,
                TokenKind.HashElseIf,
                TokenKind.HashElse,
                TokenKind.HashEndIf,
                TokenKind.HashEndIf,
                TokenKind.Eof
            ]);
        });

        it('supports various spacings between #endif', () => {
            let { tokens } = Lexer.scan('#endif #end if #end\tif #end  if #end\t\t if');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.HashEndIf,
                TokenKind.HashEndIf,
                TokenKind.HashEndIf,
                TokenKind.HashEndIf,
                TokenKind.HashEndIf,
                TokenKind.Eof
            ]);
        });

        it('reads forced compilation diagnostics with messages', () => {
            let { tokens } = Lexer.scan('#error a message goes here\n', {
                includeWhitespace: true
            });
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.HashError,
                TokenKind.Whitespace,
                TokenKind.HashErrorMessage,
                TokenKind.Newline,
                TokenKind.Eof
            ]);

            expect(tokens[2].text).to.equal('a message goes here');
        });
    });

    describe('location tracking', () => {
        it('tracks starting and ending locations including whitespace', () => {
            let { tokens } = Lexer.scan(`sub foo()\n    print "bar"\r\nend sub`, { includeWhitespace: true });
            expect(tokens.map(t => t.range)).to.eql([
                Range.create(0, 0, 0, 3), // sub
                Range.create(0, 3, 0, 4), // <space>
                Range.create(0, 4, 0, 7), // foo
                Range.create(0, 7, 0, 8), // (
                Range.create(0, 8, 0, 9), // )
                Range.create(0, 9, 0, 10), // \n
                Range.create(1, 0, 1, 4), //<space>
                Range.create(1, 4, 1, 9), // print
                Range.create(1, 9, 1, 10), // <space>
                Range.create(1, 10, 1, 15), // "bar"
                Range.create(1, 15, 1, 17), // \n
                Range.create(2, 0, 2, 7), // end sub
                Range.create(2, 7, 2, 8) // EOF
            ]);
        });

        it('tracks starting and ending locations excluding whitespace', () => {
            let { tokens } = Lexer.scan(`sub foo()\n    print "bar"\r\nend sub`, { includeWhitespace: false });
            expect(tokens.map(t => t.range)).to.eql([
                Range.create(0, 0, 0, 3), // sub
                Range.create(0, 4, 0, 7), // foo
                Range.create(0, 7, 0, 8), // (
                Range.create(0, 8, 0, 9), // )
                Range.create(0, 9, 0, 10), // \n
                Range.create(1, 4, 1, 9), // print
                Range.create(1, 10, 1, 15), // "bar"
                Range.create(1, 15, 1, 17), // \n
                Range.create(2, 0, 2, 7), // end sub
                Range.create(2, 7, 2, 8) // EOF
            ]);
        });
    });

    describe('two word keywords', () => {
        it('supports various spacing between for each', () => {
            let { tokens } = Lexer.scan(
                'for each for  each for    each for\teach for\t each for \teach for \t each'
            );
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.ForEach,
                TokenKind.ForEach,
                TokenKind.ForEach,
                TokenKind.ForEach,
                TokenKind.ForEach,
                TokenKind.ForEach,
                TokenKind.ForEach,
                TokenKind.Eof
            ]);
        });
    });

    it('detects rem when used as keyword', () => {
        let { tokens } = Lexer.scan('person.rem=true');
        expect(tokens.map(t => t.kind)).to.eql([
            TokenKind.Identifier,
            TokenKind.Dot,
            TokenKind.Identifier,
            TokenKind.Equal,
            TokenKind.True,
            TokenKind.Eof
        ]);

        //verify the location of `rem`
        expect(tokens.map(t => [t.range.start.character, t.range.end.character])).to.eql([
            [0, 6], // person
            [6, 7], // .
            [7, 10], // rem
            [10, 11], // =
            [11, 15], // true
            [15, 16] // EOF
        ]);
    });

    describe('isToken', () => {
        it('works', () => {
            let range = Range.create(0, 0, 0, 2);

            expect(isToken({ kind: TokenKind.And, text: 'and', range: range })).is.true;
            expect(isToken({ text: 'and', range: range })).is.false;
        });
    });

    it('recognizes enum-related keywords', () => {
        expect(
            Lexer.scan('enum end enum endenum').tokens.map(x => x.kind)
        ).to.eql([
            TokenKind.Enum,
            TokenKind.EndEnum,
            TokenKind.EndEnum,
            TokenKind.Eof
        ]);
    });

    it('recognizes class-related keywords', () => {
        expect(
            Lexer.scan('class public protected private end class endclass new override').tokens.map(x => x.kind)
        ).to.eql([
            TokenKind.Class,
            TokenKind.Public,
            TokenKind.Protected,
            TokenKind.Private,
            TokenKind.EndClass,
            TokenKind.EndClass,
            TokenKind.New,
            TokenKind.Override,
            TokenKind.Eof
        ]);
    });

    describe('whitespace', () => {
        it('preserves the exact number of whitespace characterswhitespace', () => {
            let { tokens } = Lexer.scan('   ', { includeWhitespace: true });
            expect(tokens[0]).to.include({
                kind: TokenKind.Whitespace,
                text: '   '
            });
        });

        it('tokenizes whitespace between things', () => {
            let { tokens } = Lexer.scan('sub main ( ) \n end sub', { includeWhitespace: true });
            expect(tokens.map(x => x.kind)).to.eql([
                TokenKind.Sub,
                TokenKind.Whitespace,
                TokenKind.Identifier,
                TokenKind.Whitespace,
                TokenKind.LeftParen,
                TokenKind.Whitespace,
                TokenKind.RightParen,
                TokenKind.Whitespace,
                TokenKind.Newline,
                TokenKind.Whitespace,
                TokenKind.EndSub,
                TokenKind.Eof
            ]);
        });
    });

    it('identifies brighterscript source literals', () => {
        let { tokens } = Lexer.scan('LINE_NUM SOURCE_FILE_PATH SOURCE_LINE_NUM FUNCTION_NAME SOURCE_FUNCTION_NAME SOURCE_LOCATION PKG_PATH PKG_LOCATION');
        expect(tokens.map(x => x.kind)).to.eql([
            TokenKind.LineNumLiteral,
            TokenKind.SourceFilePathLiteral,
            TokenKind.SourceLineNumLiteral,
            TokenKind.FunctionNameLiteral,
            TokenKind.SourceFunctionNameLiteral,
            TokenKind.SourceLocationLiteral,
            TokenKind.PkgPathLiteral,
            TokenKind.PkgLocationLiteral,
            TokenKind.Eof
        ]);
    });

    it('properly tracks leadingWhitespace', () => {
        const text = `
            sub main()

                print "main"\r\n\n

            end sub
        `;
        const { tokens } = Lexer.scan(text, { includeWhitespace: false });
        expect(util.tokensToString(tokens)).to.equal(text);
    });

    it('properly detects try/catch tokens', () => {
        const { tokens } = Lexer.scan(`try catch endtry end try throw`, { includeWhitespace: false });
        expect(tokens.map(x => x.kind)).to.eql([
            TokenKind.Try,
            TokenKind.Catch,
            TokenKind.EndTry,
            TokenKind.EndTry,
            TokenKind.Throw,
            TokenKind.Eof
        ]);
    });

    describe('regular expression literals', () => {
        function testRegex(...regexps: Array<string | RegExp>) {
            regexps = regexps.map(x => x.toString());
            const results = [] as string[];
            for (const regexp of regexps) {
                const { tokens } = Lexer.scan(regexp as string);
                results.push(tokens[0].text);
            }
            expect(results).to.eql(regexps);
        }

        it('recognizes regex literals', () => {
            testRegex(
                /simple/,
                /SimpleWithValidFlags/g,
                /UnknownFlags/gi,
                /with spaces/s,
                /with(parens)and[squarebraces]/,
                //lots of special characters
                /.*()^$@/,
                //captures quote char
                /"/
            );
        });

        it('does not capture multiple divisions on one line as regex', () => {
            const { tokens } = Lexer.scan(`one = 1/2 + 1/4 + 1/4`, {
                includeWhitespace: false
            });
            expect(tokens.map(x => x.kind)).to.eql([
                TokenKind.Identifier,
                TokenKind.Equal,
                TokenKind.IntegerLiteral,
                TokenKind.Forwardslash,
                TokenKind.IntegerLiteral,
                TokenKind.Plus,
                TokenKind.IntegerLiteral,
                TokenKind.Forwardslash,
                TokenKind.IntegerLiteral,
                TokenKind.Plus,
                TokenKind.IntegerLiteral,
                TokenKind.Forwardslash,
                TokenKind.IntegerLiteral,
                TokenKind.Eof
            ]);
        });

        it('only captures alphanumeric flags', () => {
            expect(
                Lexer.scan('speak(/a/)').tokens.map(x => x.kind)
            ).to.eql([
                TokenKind.Identifier,
                TokenKind.LeftParen,
                TokenKind.RegexLiteral,
                TokenKind.RightParen,
                TokenKind.Eof
            ]);
        });

        it('handles escape characters properly', () => {
            testRegex(
                //an escaped forward slash right next to the end-regexp forwardslash
                /\//,
                /\r/,
                /\n/,
                /\r\n/,
                //a literal backslash in front of an escape backslash
                /\\\n/
            );
        });
    });

    it('detects "continue" as a keyword', () => {
        expect(
            Lexer.scan('continue').tokens.map(x => x.kind)
        ).to.eql([
            TokenKind.Continue,
            TokenKind.Eof
        ]);
    });
});

function expectKinds(text: string, tokenKinds: TokenKind[]) {
    let actual = Lexer.scan(text).tokens.map(x => x.kind);
    //remove the EOF token
    actual.pop();
    expect(actual).to.eql(tokenKinds);
}
