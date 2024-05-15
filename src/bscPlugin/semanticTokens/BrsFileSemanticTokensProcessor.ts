import { SemanticTokenModifiers } from 'vscode-languageserver-protocol';
import { SemanticTokenTypes } from 'vscode-languageserver-protocol';
import { isCallableType, isClassType, isComponentType, isConstStatement, isDottedGetExpression, isEnumMemberType, isEnumType, isFunctionExpression, isFunctionStatement, isInterfaceType, isNamespaceType, isVariableExpression } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, OnGetSemanticTokensEvent, SemanticToken, TypeChainEntry } from '../../interfaces';
import type { Locatable, Token } from '../../lexer/Token';
import util from '../../util';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import type { BscType } from '../../types/BscType';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import type { AstNode } from '../../parser/AstNode';

export class BrsFileSemanticTokensProcessor {
    public constructor(
        public event: OnGetSemanticTokensEvent<BrsFile>
    ) {

    }

    public process() {
        const scope = this.event.scopes[0];
        this.result.clear();
        scope.linkSymbolTable();

        this.event.file.ast.walk(createVisitor({
            VariableExpression: (node) => {
                this.tryAddToken(node, node.tokens.name);
            },
            AssignmentStatement: (node) => {
                this.addToken(node.tokens.name, SemanticTokenTypes.variable);
            },
            DottedGetExpression: (node) => {
                this.tryAddToken(node, node.tokens.name);
            },
            ConstStatement: (node) => {
                this.tryAddToken(node, node.tokens.name);
            },
            AliasStatement: (node) => {
                this.tryAddToken(node, node.tokens.name);
            },
            ClassStatement: (node) => {
                this.tryAddToken(node, node.tokens.name);
            },
            InterfaceStatement: (node) => {
                this.tryAddToken(node, node.tokens.name);
            },
            EnumStatement: (node) => {
                this.tryAddToken(node, node.tokens.name);
            },
            FunctionStatement: (node) => {
                this.tryAddToken(node, node.tokens.name);
            },
            FunctionParameterExpression: (node) => {
                this.addToken(node.tokens.name, SemanticTokenTypes.parameter);
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });

        scope.unlinkSymbolTable();

        //add all tokens to the event
        this.event.semanticTokens.push(
            ...this.result.values()
        );
    }

    private result = new Map<string, SemanticToken>();


    /**
     * Add the given token and node IF we have a resolvable type
     */
    private tryAddToken(node: AstNode, token: Token) {
        const extraData = {} as ExtraSymbolData;
        const chain = [] as TypeChainEntry[];
        // eslint-disable-next-line no-bitwise
        const symbolType = node.getType({ flags: SymbolTypeFlag.runtime, data: extraData, typeChain: chain });
        if (symbolType?.isResolvable()) {
            let info = this.getSemanticTokenInfo(node, symbolType, extraData);
            if (info) {
                this.addToken(token, info.type, info.modifiers);
            }
        }
    }

    private addToken(locatable: Locatable, type: SemanticTokenTypes, modifiers: SemanticTokenModifiers[] = []) {
        //only keep a single token per range. Last-in wins
        this.result.set(util.rangeToString(locatable.range), {
            range: locatable.range,
            tokenType: type,
            tokenModifiers: modifiers
        });
    }

    private getSemanticTokenInfo(node: AstNode, type: BscType, extraData: ExtraSymbolData): { type: SemanticTokenTypes; modifiers?: SemanticTokenModifiers[] } {
        if (isConstStatement(extraData?.definingNode)) {
            return { type: SemanticTokenTypes.variable, modifiers: [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static] };
            // non-instances of classes should be colored like classes
        } else if (isClassType(type) && extraData.isInstance !== true) {
            return { type: SemanticTokenTypes.class };
            //function statements and expressions
        } else if (isCallableType(type)) {
            //if the typetime type is a class, then color this like a class
            const typetimeType = node.getType({ flags: SymbolTypeFlag.typetime });
            if (isClassType(typetimeType)) {
                return { type: SemanticTokenTypes.class };
            }

            //if this is a function statement or expression, treat it as a function
            if (isFunctionExpression(node) || isFunctionStatement(node)) {
                return { type: SemanticTokenTypes.function };
            }
            if (
                //if this is a standalone function
                isVariableExpression(node) ||
                //if this is a dottedGet, and the LHS is a namespace, treat it as a function.
                (isDottedGetExpression(node) && isNamespaceType(node.obj.getType({ flags: SymbolTypeFlag.typetime })))
            ) {
                return { type: SemanticTokenTypes.function };

                //all others should be treated as methods
            } else {
                return { type: SemanticTokenTypes.method };
            }
        } else if (isInterfaceType(type)) {
            return { type: SemanticTokenTypes.interface };
        } else if (isComponentType(type)) {
            return { type: SemanticTokenTypes.class };
        } else if (isEnumType(type)) {
            return { type: SemanticTokenTypes.enum };
        } else if (isEnumMemberType(type)) {
            return { type: SemanticTokenTypes.enumMember };
        } else if (isNamespaceType(type)) {
            return { type: SemanticTokenTypes.namespace };
            //this is separate from the checks above because we want to resolve alias lookups before turning this variable into a const
        } else if (isConstStatement(node)) {
            return { type: SemanticTokenTypes.variable, modifiers: [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static] };
        } else if (isVariableExpression(node)) {
            return { type: SemanticTokenTypes.variable };
        } else {
            //we don't know what it is...return undefined to prevent creating a semantic token
        }
    }
}
