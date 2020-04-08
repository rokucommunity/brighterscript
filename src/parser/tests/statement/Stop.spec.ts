import { expect } from 'chai';

import { Parser } from '../../parser';
import { TokenKind, Lexer } from '../../../lexer';
import { EOF, token } from '../Parser.spec';

describe('stop statement', () => {
    it('cannot be used as a local variable', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.Stop, 'stop'),
            token(TokenKind.Equal, '='),
            token(TokenKind.True, 'true'),
            EOF
        ]);

        //should be an error
        expect(errors).to.be.lengthOf(1);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        // //expect(statements).toMatchSnapshot();
    });

    it('is valid as a statement', () => {
        let { errors } = Parser.parse([token(TokenKind.Stop, 'stop'), EOF]);
        expect(errors[0]).to.be.undefined;
        // //expect(statements).toMatchSnapshot();
    });

    it('can be used as an object property', () => {
        let { tokens } = Lexer.scan(`
            sub Main()
                theObject = {
                    stop: false
                }
                theObject.stop = true
            end sub
        `);
        let { errors } = Parser.parse(tokens);
        expect(errors.length).to.equal(0);
        // //expect(statements).toMatchSnapshot();
    });
});
