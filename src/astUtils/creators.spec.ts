import { expect } from '../chai-config.spec';
import { createIdentifier, createStringLiteral, createToken, createVariableExpression } from './creators';
import { TokenKind } from '../lexer/TokenKind';
import { Lexer } from '../lexer/Lexer';
import { util } from '../util';
import type { Locatable } from '../lexer/Token';

describe('creators', () => {

    describe('createStringLiteral', () => {
        it('wraps the value in quotes', () => {
            expect(createStringLiteral('hello world').tokens.value.text).to.equal('"hello world"');
        });
        it('does not wrap already-quoted value in extra quotes', () => {
            expect(createStringLiteral('"hello world"').tokens.value.text).to.equal('"hello world"');
        });

        it('does not wrap badly quoted value in additional quotes', () => {
            //leading
            expect(createStringLiteral('"hello world').tokens.value.text).to.equal('"hello world');
            //trailing
            expect(createStringLiteral('hello world"').tokens.value.text).to.equal('hello world"');
        });
    });

    describe('position argument', () => {
        it('copies the bounds of a locatable', () => {
            const original = Lexer.scan('\n  abc').tokens[1];
            const token = createToken(TokenKind.Identifier, 'xyz', original);
            expect(token.source).to.equal(original.source);
            expect(util.getLocation(token)).to.eql(util.getLocation(original));
        });

        it('accepts a location from util.setLocation', () => {
            const location = util.createLocation(2, 4, 2, 7, 'file:///source/main.brs');
            const locatable = util.setLocation({} as Locatable, location);
            expect(util.getLocation(createToken(TokenKind.Identifier, 'xyz', locatable))).to.eql(location);
            expect(util.getLocation(createIdentifier('xyz', locatable))).to.eql(location);
            expect(util.getLocation(createVariableExpression('xyz', locatable))).to.eql(location);
            expect(util.getLocation(createStringLiteral('xyz', locatable))).to.eql(location);
        });

        it('leaves the token synthetic when no position is given', () => {
            expect(util.getLocation(createToken(TokenKind.Identifier, 'xyz'))).to.be.undefined;
        });
    });
});
