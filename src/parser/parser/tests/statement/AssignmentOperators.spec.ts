/* eslint-disable */
import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser assignment operators', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    it('+=', () => {
        let { statements, errors } = parser.parse([
            identifier('_'),
            token(Lexeme.PlusEqual),
            token(Lexeme.String, `"lorem"`, new BrsString('lorem')),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('-=', () => {
        let { statements, errors } = parser.parse([
            identifier('_'),
            token(Lexeme.MinusEqual),
            token(Lexeme.Integer, '1', new Int32(1)),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('*=', () => {
        let { statements, errors } = parser.parse([
            identifier('_'),
            token(Lexeme.StarEqual),
            token(Lexeme.Integer, '3', new Int32(3)),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('/=', () => {
        let { statements, errors } = parser.parse([
            identifier('_'),
            token(Lexeme.SlashEqual),
            token(Lexeme.Integer, '4', new Int32(4)),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('\\=', () => {
        let { statements, errors } = parser.parse([
            identifier('_'),
            token(Lexeme.BackslashEqual),
            token(Lexeme.Integer, '5', new Int32(5)),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('<<=', () => {
        let { statements, errors } = parser.parse([
            identifier('_'),
            token(Lexeme.LeftShiftEqual),
            token(Lexeme.Integer, '6', new Int32(6)),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('>>=', () => {
        let { statements, errors } = parser.parse([
            identifier('_'),
            token(Lexeme.RightShiftEqual),
            token(Lexeme.Integer, '7', new Int32(7)),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });
});
