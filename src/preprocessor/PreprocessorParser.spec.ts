import { PreprocessorParser } from './PreprocessorParser';
import { identifier, token } from '../parser/tests/Parser.spec';
import { TokenKind } from '../lexer/TokenKind';
import { expect } from 'chai';
import type { BrightScriptChunk } from './Chunk';

describe('preprocessor parser', () => {
    let parser: PreprocessorParser;

    beforeEach(() => {
        parser = new PreprocessorParser();
    });

    it('parses chunks of brightscript', () => {
        let { chunks, diagnostics } = parser.parse([
            identifier('someFunction'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.Eof, '\0')
        ]);

        expect(diagnostics).to.eql([]);
        expect((chunks[0] as BrightScriptChunk).tokens.map(x => x.kind)).to.eql([
            TokenKind.Identifier,
            TokenKind.LeftParen,
            TokenKind.RightParen,
            TokenKind.Newline
        ]);
    });

    it('parses #const', () => {
        let { chunks, diagnostics } = parser.parse([
            token(TokenKind.HashConst, '#const'),
            identifier('foo'),
            token(TokenKind.Equal, '='),
            token(TokenKind.True, 'true'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.Eof, '\0')
        ]);

        expect(diagnostics).to.be.empty;
        expect(chunks).to.exist;
    });

    it('parses #error', () => {
        let { chunks, diagnostics } = parser.parse([
            token(TokenKind.HashError, '#error'),
            token(TokenKind.HashErrorMessage, 'I\'m an error message!'),
            token(TokenKind.Eof, '\0')
        ]);

        expect(diagnostics).to.eql([]);
        expect(chunks).to.exist;
    });

    describe('conditionals', () => {
        it('#if only', () => {
            let { chunks, diagnostics } = parser.parse([
                token(TokenKind.HashIf, '#if'),
                identifier('foo'),
                token(TokenKind.Newline, '\n'),
                identifier('fooIsTrue'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.HashEndIf, '#endif'),
                token(TokenKind.Eof, '\0')
            ]);

            expect(diagnostics).to.eql([]);
            expect(chunks).to.exist;
        });

        it('#if and #else', () => {
            let { chunks, diagnostics } = parser.parse([
                token(TokenKind.HashIf, '#if'),
                identifier('foo'),
                token(TokenKind.Newline, '\n'),

                identifier('fooIsTrue'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\n'),

                token(TokenKind.HashElse, '#else'),
                token(TokenKind.Newline, '\n'),

                identifier('fooIsFalse'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\n'),

                token(TokenKind.HashEndIf, '#endif'),
                token(TokenKind.Eof, '\0')
            ]);

            expect(diagnostics).to.eql([]);
            expect(chunks).to.exist;
        });

        it('#if #else if and #else', () => {
            let { chunks, diagnostics } = parser.parse([
                token(TokenKind.HashIf, '#if'),
                identifier('foo'),
                token(TokenKind.Newline, '\n'),

                identifier('fooIsTrue'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\n'),

                token(TokenKind.HashElseIf, '#elseif'),
                identifier('bar'),
                token(TokenKind.Newline, '\n'),

                identifier('bar'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\n'),

                token(TokenKind.HashElse, '#else'),
                token(TokenKind.Newline, '\n'),

                identifier('neither'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\n'),

                token(TokenKind.HashEndIf, '#endif'),
                token(TokenKind.Eof, '\0')
            ]);

            expect(diagnostics).to.eql([]);
            expect(chunks).to.exist;
        });
    });
});
