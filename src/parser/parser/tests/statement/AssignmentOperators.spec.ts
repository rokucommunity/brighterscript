import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser assignment operators', () => {
    it('+=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.PlusEqual),
            token(TokenKind.String, `"lorem"`, new BrsString('lorem')),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('-=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.MinusEqual),
            token(TokenKind.Integer, '1', new Int32(1)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('*=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.StarEqual),
            token(TokenKind.Integer, '3', new Int32(3)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('/=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.SlashEqual),
            token(TokenKind.Integer, '4', new Int32(4)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('\\=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.BackslashEqual),
            token(TokenKind.Integer, '5', new Int32(5)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('<<=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.LeftShiftEqual),
            token(TokenKind.Integer, '6', new Int32(6)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('>>=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.RightShiftEqual),
            token(TokenKind.Integer, '7', new Int32(7)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });
});
