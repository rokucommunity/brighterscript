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
            token(TokenKind.StringLiteral, `"lorem"`, new BrsString('lorem')),
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
            token(TokenKind.IntegerLiteral, '1', new Int32(1)),
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
            token(TokenKind.IntegerLiteral, '3', new Int32(3)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('/=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.ForwardslashEqual),
            token(TokenKind.IntegerLiteral, '4', new Int32(4)),
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
            token(TokenKind.IntegerLiteral, '5', new Int32(5)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('<<=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.LessLessEqual),
            token(TokenKind.IntegerLiteral, '6', new Int32(6)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });

    it('>>=', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.GreaterGreaterEqual),
            token(TokenKind.IntegerLiteral, '7', new Int32(7)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        //expect(statements).toMatchSnapshot();
    });
});
