import { expect } from 'chai';

import { Parser } from '../../Parser';
import { Float } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {

    describe('multiplicative expressions', () => {
        it('parses left-associative multiplication chains', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.FloatLiteral, '3.0', new Float(3.0)),
                token(TokenKind.Star, '*'),
                token(TokenKind.FloatLiteral, '5.0', new Float(5.0)),
                token(TokenKind.Star, '*'),
                token(TokenKind.FloatLiteral, '7.0', new Float(7.0)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses left-associative division chains', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.FloatLiteral, '7.0', new Float(7.0)),
                token(TokenKind.Forwardslash, '/'),
                token(TokenKind.FloatLiteral, '5.0', new Float(5.0)),
                token(TokenKind.Forwardslash, '/'),
                token(TokenKind.FloatLiteral, '3.0', new Float(3.0)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses left-associative modulo chains', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.FloatLiteral, '7.0', new Float(7.0)),
                token(TokenKind.Mod, 'MOD'),
                token(TokenKind.FloatLiteral, '5.0', new Float(5.0)),
                token(TokenKind.Mod, 'MOD'),
                token(TokenKind.FloatLiteral, '3.0', new Float(3.0)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses left-associative integer-division chains', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.FloatLiteral, '32.5', new Float(32.5)),
                token(TokenKind.Backslash, '\\'),
                token(TokenKind.FloatLiteral, '5.0', new Float(5.0)),
                token(TokenKind.Backslash, '\\'),
                token(TokenKind.FloatLiteral, '3.0', new Float(3.0)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });
});
