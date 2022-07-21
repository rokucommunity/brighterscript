import { expect } from 'chai';

import { Parser } from '../../Parser';
import { Lexer } from '../../../lexer/Lexer';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser goto statements', () => {
    it('parses standalone statement properly', () => {
        let { diagnostics } = Parser.parse([
            token(TokenKind.Newline, '\n'),
            token(TokenKind.Goto, 'goto'),
            identifier('SomeLabel'),
            EOF
        ]);
        expect(diagnostics).to.be.lengthOf(0);
    });

    it('detects labels', () => {
        let { diagnostics } = Parser.parse([
            token(TokenKind.Newline, '\n'),
            identifier('SomeLabel'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]);
        expect(diagnostics).to.be.lengthOf(0);
    });

    it('allows multiple goto statements on one line', () => {
        let { tokens } = Lexer.scan(`
            sub Main()
                'multiple goto statements on one line
                goto myLabel : goto myLabel
                myLabel:
            end sub
        `);
        let { diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
    });

    it('ignores "labels" not alone on their line', () => {
        let { tokens } = Lexer.scan(`
            sub Main()
                label1: 'some comment
                notalabel1: print "ko"
                print "ko": notalabel2:
            end sub
        `);
        let { diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(2);
    });
});
