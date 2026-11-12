import { expect } from '../chai-config.spec';
import { createCall, createIdentifier, createStringLiteral, createToken, createVariableExpression } from './creators';
import { TokenKind } from '../lexer/TokenKind';
import { Lexer } from '../lexer/Lexer';
import { util } from '../util';
import type { Locatable } from '../lexer/Token';
import type { Location } from 'vscode-languageserver';

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
            expect(token.sourceInfo).to.equal(original.sourceInfo);
            expect(util.getLocation(token)).to.eql(util.getLocation(original));
        });

        it('accepts a location from util.setLocation', () => {
            const sourceInfo = Lexer.scan('\n\n    abc', { srcPath: 'source/main.brs' }).tokens[0].sourceInfo;
            const location = util.createLocation(2, 4, 2, 7, sourceInfo.uri);
            const locatable = util.setLocation({} as Locatable, location, sourceInfo);
            expect(util.getLocation(createToken(TokenKind.Identifier, 'xyz', locatable))).to.eql(location);
            expect(util.getLocation(createIdentifier('xyz', locatable))).to.eql(location);
            expect(util.getLocation(createVariableExpression('xyz', locatable))).to.eql(location);
            expect(util.getLocation(createStringLiteral('xyz', locatable))).to.eql(location);
        });

        it('leaves the token synthetic when no position is given', () => {
            expect(util.getLocation(createToken(TokenKind.Identifier, 'xyz'))).to.be.undefined;
        });

        it('accepts a line/character location', () => {
            const location = util.createLocation(12, 4, 12, 7, 'file:///source/main.brs');
            expect(util.getLocation(createToken(TokenKind.Identifier, 'xyz', location))).to.eql(location);
            expect(createToken(TokenKind.Identifier, 'xyz', location).location).to.eql(location);
            expect(util.getLocation(createIdentifier('xyz', location))).to.eql(location);
            expect(util.getLocation(createVariableExpression('xyz', location))).to.eql(location);
            expect(util.getLocation(createStringLiteral('xyz', location))).to.eql(location);
        });

        it('combines items created from line/character locations in the same file', () => {
            const expression = createCall(
                createVariableExpression('doSomething', util.createLocation(3, 4, 3, 15, 'file:///source/main.brs')),
                [createStringLiteral('a', util.createLocation(3, 16, 3, 19, 'file:///source/main.brs'))]
            );
            expect(expression.location).to.eql(util.createLocation(3, 4, 3, 19, 'file:///source/main.brs'));
        });

        it('leaves the token synthetic for a location without a range', () => {
            expect(util.getLocation(createToken(TokenKind.Identifier, 'xyz', { uri: 'file:///source/main.brs' } as Location))).to.be.undefined;
        });
    });
});
