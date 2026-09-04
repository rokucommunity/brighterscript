import type {
    SemanticTokensLegend
} from 'vscode-languageserver-protocol/node';
import {
    SemanticTokenTypes,
    SemanticTokenModifiers
} from 'vscode-languageserver-protocol/node';
import { SemanticTokensBuilder } from 'vscode-languageserver/node';
import type {
    SemanticToken
} from './interfaces';
import util from './util';

export const semanticTokensLegend = {
    tokenTypes: [
        SemanticTokenTypes.namespace,
        SemanticTokenTypes.type,
        SemanticTokenTypes.class,
        SemanticTokenTypes.enum,
        SemanticTokenTypes.interface,
        SemanticTokenTypes.struct,
        SemanticTokenTypes.typeParameter,
        SemanticTokenTypes.parameter,
        SemanticTokenTypes.variable,
        SemanticTokenTypes.property,
        SemanticTokenTypes.enumMember,
        SemanticTokenTypes.event,
        SemanticTokenTypes.function,
        SemanticTokenTypes.method,
        SemanticTokenTypes.macro,
        SemanticTokenTypes.keyword,
        SemanticTokenTypes.modifier,
        SemanticTokenTypes.comment,
        SemanticTokenTypes.string,
        SemanticTokenTypes.number,
        SemanticTokenTypes.regexp,
        SemanticTokenTypes.operator
    ],
    tokenModifiers: [
        SemanticTokenModifiers.declaration,
        SemanticTokenModifiers.definition,
        SemanticTokenModifiers.readonly,
        SemanticTokenModifiers.static,
        SemanticTokenModifiers.deprecated,
        SemanticTokenModifiers.abstract,
        SemanticTokenModifiers.async,
        SemanticTokenModifiers.modification,
        SemanticTokenModifiers.documentation,
        SemanticTokenModifiers.defaultLibrary
    ]
} as SemanticTokensLegend;

/**
 * The LSP has a very specific format for semantic tokens, so this encodes our internal representation into the LSP format.
 * Currently all tokens must be single-line
 * See for more info: https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_semanticTokens
 */
export function encodeSemanticTokens(tokens: SemanticToken[]) {
    util.sortByRange(tokens);
    const builder = new SemanticTokensBuilder();
    for (const token of tokens ?? []) {
        builder.push(
            token.range.start.line,
            token.range.start.character,
            token.range.end.character - token.range.start.character,
            //token type index
            semanticTokensLegend.tokenTypes.indexOf(token.tokenType),
            //modifier bit flags
            token.tokenModifiers ? getModifierBitFlags(token.tokenModifiers) : 0
        );
    }
    return builder.build().data;
}

/**
 * Convert an array of strings into a binary bitflag integer, where each non-zero bit indiciates the index of the modifier from `semanticTokensLegend.tokenModifiers`
 */
export function getModifierBitFlags(modifiers: SemanticTokenModifiers[]) {
    let result = 0;
    for (const modifier of modifiers) {
        const idx = semanticTokensLegend.tokenModifiers.indexOf(modifier);
        if (idx === -1) {
            throw new Error(`Unknown semantic token modifier: '${modifier}'`);
        }

        //convert the index into a bit flag by bitshifting 1 the by the number of zeros for the idx.
        //example: idx=3. binary should be 0b1000, so we bitshift 1 << 3
        // eslint-disable-next-line no-bitwise
        result |= 1 << idx;
    }
    return result;
}
