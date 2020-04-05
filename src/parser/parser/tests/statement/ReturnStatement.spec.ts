import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { FunctionStatement } from '../../Statement';

describe('parser return statements', () => {
    it('parses void returns', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.Function, 'function'),
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.Return, 'return'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.EndFunction, 'end function'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.ok;
        // //expect(statements).toMatchSnapshot();
    });

    it('parses literal returns', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.Function, 'function'),
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.Return, 'return'),
            { kind: TokenKind.String, literal: new BrsString('test'), text: '"test"', line: 2 },
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.EndFunction, 'end function'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.ok;
        // //expect(statements).toMatchSnapshot();
    });

    it('parses expression returns', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.Function, 'function'),
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.Return, 'return'),
            identifier('RebootSystem'),
            { kind: TokenKind.LeftParen, text: '(', line: 2 },
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.EndFunction, 'end function'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.ok;
        // //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 1| function foo()
         * 2|   return 5
         * 3| end function
         */
        let { statements, errors } = Parser.parse([
            token(TokenKind.Function, 'function'),
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            {
                kind: TokenKind.Return,
                text: 'return',
                isReserved: true,
                location: {
                    start: { line: 2, column: 2 },
                    end: { line: 2, column: 8 }
                }
            },
            {
                kind: TokenKind.Integer,
                text: '5',
                literal: new Int32(5),
                isReserved: false,
                location: {
                    start: { line: 2, column: 9 },
                    end: { line: 2, column: 10 }
                }
            },
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.EndFunction, 'end function'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect((statements[0] as FunctionStatement).func.body.statements[0].location).to.deep.include({
            start: { line: 2, column: 2 },
            end: { line: 2, column: 10 }
        });
    });
});
