import { expect } from 'chai';
import { SemanticTokenTypes } from 'vscode-languageserver-protocol';
import { encodeSemanticTokens, semanticTokensLegend } from './SemanticTokenUtils';
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
