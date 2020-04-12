import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind, Lexer } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser goto statements', () => {
    it('parses standalone statement properly', () => {
        let { diagnostics } = Parser.parse([
            token(TokenKind.Goto, 'goto'),
            identifier('SomeLabel'),
            EOF
        ]);
        expect(diagnostics).to.be.lengthOf(0);
        //expect({ errors, statements }).toMatchSnapshot();
    });

    it('detects labels', () => {
        let { diagnostics } = Parser.parse([
            identifier('SomeLabel'),
            token(TokenKind.Colon, ':'),
            EOF
        ]);
        expect(diagnostics).to.be.lengthOf(0);
        //expect(statements).toMatchSnapshot();
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
        //expect(statements).toMatchSnapshot();
    });
});
