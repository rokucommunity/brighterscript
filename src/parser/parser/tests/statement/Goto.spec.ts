import { expect } from 'chai';

import { Parser } from '../..';
import { Lexeme, Lexer } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser goto statements', () => {
    it('parses standalone statement properly', () => {
        let { errors } = Parser.parse([
            token(Lexeme.Goto, 'goto'),
            identifier('SomeLabel'),
            EOF
        ]);
        expect(errors).to.be.lengthOf(0);
        //expect({ errors, statements }).toMatchSnapshot();
    });

    it('detects labels', () => {
        let { errors } = Parser.parse([
            identifier('SomeLabel'),
            token(Lexeme.Colon, ':'),
            EOF
        ]);
        expect(errors).to.be.lengthOf(0);
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
        let { errors } = Parser.parse(tokens);
        expect(errors).to.be.lengthOf(0);
        //expect(statements).toMatchSnapshot();
    });
});
