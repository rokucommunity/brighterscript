/* eslint-disable no-bitwise */
import { expect } from './chai-config.spec';
import { SemanticTokenModifiers, SemanticTokenTypes } from 'vscode-languageserver-protocol';
import { encodeSemanticTokens, getModifierBitFlags, semanticTokensLegend } from './SemanticTokenUtils';
import util from './util';

describe('SemanticTokenUtils', () => {
    describe('encodeSemanticTokens', () => {
        it('encodes single entry at start of line', () => {
            expectEncodeEquals(
                encodeSemanticTokens([{
                    range: util.createRange(1, 0, 1, 2),
                    tokenType: SemanticTokenTypes.class
                }]),
                [
                    1, 0, 2, semanticTokensLegend.tokenTypes.indexOf(SemanticTokenTypes.class), 0
                ]
            );
        });

        it('encodes two non-touching entries on same line', () => {
            expectEncodeEquals(
                encodeSemanticTokens([{
                    range: util.createRange(1, 0, 1, 2),
                    tokenType: SemanticTokenTypes.class
                }, {
                    range: util.createRange(1, 10, 1, 12),
                    tokenType: SemanticTokenTypes.namespace
                }]),
                [
                    1, 0, 2, semanticTokensLegend.tokenTypes.indexOf(SemanticTokenTypes.class), 0,
                    0, 10, 2, semanticTokensLegend.tokenTypes.indexOf(SemanticTokenTypes.namespace), 0
                ]
            );
        });
    });

    //these tests depend on the semanticTokensLegend.tokenModifiers being in a specific order. If those change order, then this test needs changed as well
    describe('getModifierBitFlags', () => {
        it('works for single modifier', () => {
            expect(getModifierBitFlags([SemanticTokenModifiers.declaration])).to.eql(1 << 0);
            expect(getModifierBitFlags([SemanticTokenModifiers.definition])).to.eql(1 << 1);
            expect(getModifierBitFlags([SemanticTokenModifiers.readonly])).to.eql(1 << 2);
            expect(getModifierBitFlags([SemanticTokenModifiers.static])).to.eql(1 << 3);
            expect(getModifierBitFlags([SemanticTokenModifiers.deprecated])).to.eql(1 << 4);
            expect(getModifierBitFlags([SemanticTokenModifiers.abstract])).to.eql(1 << 5);
            expect(getModifierBitFlags([SemanticTokenModifiers.async])).to.eql(1 << 6);
            expect(getModifierBitFlags([SemanticTokenModifiers.modification])).to.eql(1 << 7);
            expect(getModifierBitFlags([SemanticTokenModifiers.documentation])).to.eql(1 << 8);
            expect(getModifierBitFlags([SemanticTokenModifiers.defaultLibrary])).to.eql(1 << 9);
        });

        it('properly combines multiple modifiers', () => {
            expect(getModifierBitFlags([
                SemanticTokenModifiers.declaration, //idx=0
                SemanticTokenModifiers.static, //idx=3
                SemanticTokenModifiers.documentation //idx=8
            ])).to.eql(0b100001001);
        });
    });
});

function expectEncodeEquals(actual: number[], expected: number[]) {
    //results should be in multiples of 5
    expect(actual.length % 5).to.eql(0);
    expect(expected.length % 5).to.eql(0);

    expect(
        decodeSemanticTokens(actual)
    ).to.eql(
        decodeSemanticTokens(expected)
    );
}

function decodeSemanticTokens(data: number[]) {
    const result = [] as SemanticTokenDelta[];
    for (let i = 0; i < data.length; i += 5) {
        result.push({
            deltaLine: data[i],
            deltaCharacter: data[i + 1],
            length: data[i + 2],
            tokenTypeIndex: data[i + 3],
            tokenModifierIndex: data[i + 4]
        });
    }
    return result;
}

interface SemanticTokenDelta {
    deltaLine: number;
    deltaCharacter: number;
    length: number;
    tokenTypeIndex: number;
    tokenModifierIndex: number;
}
