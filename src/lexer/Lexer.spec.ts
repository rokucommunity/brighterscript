import { expect } from 'chai';

import { TokenKind } from '.';
import { BrsString, Double, Float, Int32, Int64 } from '../brsTypes';
import { Lexer } from './Lexer';
import { isToken } from './Token';
import { rangeToArray } from '../parser/Parser.spec';
import { Range } from 'vscode-languageserver';

describe('lexer', () => {
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

    it('correctly identifies the elseif token', () => {
        let { tokens } = Lexer.scan('else if elseif else   if');
        expect(tokens.map(t => t.kind)).to.deep.equal([
            TokenKind.ElseIf,
            TokenKind.ElseIf,
            TokenKind.ElseIf,
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

    it('aliases \'?\' to \'print\'', () => {
        let { tokens } = Lexer.scan('?2');
        expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.Print, TokenKind.IntegerLiteral, TokenKind.Eof]);
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
            expect(tokens.filter(t => !!t.literal).length).to.equal(0);
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
            expect(tokens.filter(t => !!t.literal).length).to.equal(0);
        });

        it('reads bitshift operators', () => {
            let { tokens } = Lexer.scan('<< >> <<');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.LeftShift,
                TokenKind.RightShift,
                TokenKind.LeftShift,
                TokenKind.Eof
            ]);
            expect(tokens.filter(t => !!t.literal).length).to.equal(0);
        });

        it('reads bitshift assignment operators', () => {
            let { tokens } = Lexer.scan('<<= >>=');
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.LeftShiftEqual,
                TokenKind.RightShiftEqual,
                TokenKind.Eof
            ]);
            expect(tokens.filter(t => !!t.literal).length).to.equal(0);
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
            expect(tokens.filter(t => !!t.literal).length).to.equal(0);
        });
    }); // non-literals

    describe('string literals', () => {
        it('produces string literal tokens', () => {
            let { tokens } = Lexer.scan(`"hello world"`);
            expect(tokens.map(t => t.kind)).to.deep.equal([TokenKind.StringLiteral, TokenKind.Eof]);
            expect(tokens[0].literal).to.deep.equal(new BrsString('hello world'));
        });

        it(`safely escapes " literals`, () => {
            let { tokens } = Lexer.scan(`"the cat says ""meow"""`);
            expect(tokens[0].kind).to.equal(TokenKind.StringLiteral);
            expect(tokens[0].literal).to.deep.equal(new BrsString(`the cat says "meow"`));
        });

        it('produces an error for unterminated strings', () => {
            let { diagnostics } = Lexer.scan(`"unterminated!`);
            expect(diagnostics.map(err => err.message)).to.deep.equal([
                'Unterminated string at end of file'
            ]);
        });

        it('disallows multiline strings', () => {
            let { diagnostics } = Lexer.scan(`"multi-line\n\n`);
            expect(diagnostics.map(err => err.message)).to.deep.equal([
                'Unterminated string at end of line'
            ]);
        });
    }); // string literals

    describe('double literals', () => {
        it('respects \'#\' suffix', () => {
            let d = Lexer.scan('123#').tokens[0];
            expect(d.kind).to.equal(TokenKind.DoubleLiteral);
            expect(d.literal).to.deep.equal(new Double(123));
        });

        it('forces literals >= 10 digits into doubles', () => {
            let d = Lexer.scan('0000000005').tokens[0];
            expect(d.kind).to.equal(TokenKind.DoubleLiteral);
            expect(d.literal).to.deep.equal(new Double(5));
        });

        it('forces literals with \'D\' in exponent into doubles', () => {
            let d = Lexer.scan('2.5d3').tokens[0];
            expect(d.kind).to.equal(TokenKind.DoubleLiteral);
            expect(d.literal).to.deep.equal(new Double(2500));
        });

        it('allows digits before `.` to be elided', () => {
            let f = Lexer.scan('.123#').tokens[0];
            expect(f.kind).to.equal(TokenKind.DoubleLiteral);
            expect(f.literal).to.deep.equal(new Double(0.123));
        });

        it('allows digits after `.` to be elided', () => {
            let f = Lexer.scan('12.#').tokens[0];
            expect(f.kind).to.equal(TokenKind.DoubleLiteral);
            expect(f.literal).to.deep.equal(new Double(12));
        });
    });

    describe('float literals', () => {
        it('respects \'!\' suffix', () => {
            let f = Lexer.scan('0.00000008!').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            // Floating precision will make this *not* equal
            expect(f.literal).not.to.equal(8e-8);
            expect(f.literal).to.deep.equal(new Float(0.00000008));
        });

        it('forces literals with a decimal into floats', () => {
            let f = Lexer.scan('1.0').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.literal).to.deep.equal(new Float(1000000000000e-12));
        });

        it('forces literals with \'E\' in exponent into floats', () => {
            let f = Lexer.scan('2.5e3').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.literal).to.deep.equal(new Float(2500));
        });

        it('allows digits before `.` to be elided', () => {
            let f = Lexer.scan('.123').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.literal).to.deep.equal(new Float(0.123));
        });

        it('allows digits after `.` to be elided', () => {
            let f = Lexer.scan('12.').tokens[0];
            expect(f.kind).to.equal(TokenKind.FloatLiteral);
            expect(f.literal).to.deep.equal(new Float(12));
        });
    });

    describe('long integer literals', () => {
        it('supports hexadecimal literals', () => {
            let i = Lexer.scan('&hf00d&').tokens[0];
            expect(i.kind).to.equal(TokenKind.LongIntegerLiteral);
            expect(i.literal).to.deep.equal(new Int64(61453));
        });

        it('allows very long Int64 literals', () => {
            let li = Lexer.scan('9876543210&').tokens[0];
            expect(li.kind).to.equal(TokenKind.LongIntegerLiteral);
            expect(li.literal).to.deep.equal(Int64.fromString('9876543210'));
        });

        it('forces literals with \'&\' suffix into Int64s', () => {
            let li = Lexer.scan('123&').tokens[0];
            expect(li.kind).to.equal(TokenKind.LongIntegerLiteral);
            expect(li.literal).to.deep.equal(new Int64(123));
        });
    });

    describe('integer literals', () => {
        it('supports hexadecimal literals', () => {
            let i = Lexer.scan('&hFf').tokens[0];
            expect(i.kind).to.equal(TokenKind.IntegerLiteral);
            expect(i.literal).to.deep.equal(new Int32(255));
        });

        it('falls back to a regular integer', () => {
            let i = Lexer.scan('123').tokens[0];
            expect(i.kind).to.equal(TokenKind.IntegerLiteral);
            expect(i.literal).to.deep.equal(new Int32(123));
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
                TokenKind.Identifier,
                TokenKind.Eof
            ]);
            expect(tokens.filter(w => !!w.literal).length).to.equal(0);
        });

        it('matches multi-word keywords', () => {
            let { tokens } = Lexer.scan('else if end if end while End Sub end Function Exit wHILe');
            expect(tokens.map(w => w.kind)).to.deep.equal([
                TokenKind.ElseIf,
                TokenKind.EndIf,
                TokenKind.EndWhile,
                TokenKind.EndSub,
                TokenKind.EndFunction,
                TokenKind.ExitWhile,
                TokenKind.Eof
            ]);
            expect(tokens.filter(w => !!w.literal).length).to.equal(0);
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
        it('tracks starting and ending lines', () => {
            let { tokens } = Lexer.scan(`sub foo()\n\n    print "bar"\nend sub`);
            expect(tokens.map(t => t.range.start.line)).to.deep.equal([0, 0, 0, 0, 0, 1, 2, 2, 2, 3, 3]);

            expect(tokens.map(t => t.range.end.line)).to.deep.equal([0, 0, 0, 0, 0, 1, 2, 2, 2, 3, 3]);
        });

        it('tracks starting and ending columns', () => {
            let { tokens } = Lexer.scan(`sub foo()\n    print "bar"\nend sub`);
            expect(tokens.map(t => [t.range.start.character, t.range.end.character])).to.deep.equal([
                [0, 3], // sub
                [4, 7], // foo
                [7, 8], // (
                [8, 9], // )
                [9, 10], // \n
                [4, 9], // print
                [10, 15], // "bar"
                [15, 16], // \n
                [0, 7], // end sub
                [7, 8] // EOF
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
        it('supports various spacing between else if', () => {
            let { tokens } = Lexer.scan(
                'else if else  if else    if else\tif else\t if else \tif else \t if'
            );
            expect(tokens.map(t => t.kind)).to.deep.equal([
                TokenKind.ElseIf,
                TokenKind.ElseIf,
                TokenKind.ElseIf,
                TokenKind.ElseIf,
                TokenKind.ElseIf,
                TokenKind.ElseIf,
                TokenKind.ElseIf,
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
});
