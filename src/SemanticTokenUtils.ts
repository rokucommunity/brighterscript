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
    for (const token of tokens) {
        builder.push(
            token.range.start.line,
            token.range.start.character,
            token.range.end.character - token.range.start.character,
            semanticTokensLegend.tokenTypes.indexOf(token.tokenType),
            //modifier bit flags (TODO implement)
            0
        );
    }
    return builder.build().data;
}
