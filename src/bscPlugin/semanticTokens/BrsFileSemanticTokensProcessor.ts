import type { Range } from 'vscode-languageserver-protocol';
import { SemanticTokenModifiers } from 'vscode-languageserver-protocol';
import { SemanticTokenTypes } from 'vscode-languageserver-protocol';
import { isAliasStatement, isCallExpression, isCallableType, isClassType, isComponentType, isConstStatement, isEnumMemberType, isEnumType, isInterfaceType, isNamespaceStatement, isNamespaceType, isNativeType, isNewExpression } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, OnGetSemanticTokensEvent } from '../../interfaces';
import type { Locatable } from '../../lexer/Token';
import { ParseMode } from '../../parser/Parser';
import type { NamespaceStatement } from '../../parser/Statement';
import util from '../../util';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import type { BscType } from '../../types/BscType';

export class BrsFileSemanticTokensProcessor {
    public constructor(
        public event: OnGetSemanticTokensEvent<BrsFile>
    ) {

    }

    public process() {
        this.handleClasses();
        this.handleConstDeclarations();
        this.iterateNodes();
    }

    private handleConstDeclarations() {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (const stmt of this.event.file['_cachedLookups'].constStatements) {
            this.addToken(stmt.tokens.name, SemanticTokenTypes.variable, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]);
        }
    }

    private handleClasses() {

        const classes = [] as Array<{ className: string; namespaceName: string; range: Range }>;

        //classes used in function param types
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (const func of this.event.file['_cachedLookups'].functionExpressions) {
            for (const param of func.parameters) {
                if (isClassType(param.getType({ flags: SymbolTypeFlag.typetime }))) {
                    const namespace = param.findAncestor<NamespaceStatement>(isNamespaceStatement);
                    classes.push({
                        className: util.getAllDottedGetParts(param.typeExpression.expression).map(x => x.text).join('.'),
                        namespaceName: namespace?.getName(ParseMode.BrighterScript),
                        range: param.typeExpression.range
                    });
                }
            }
        }

        for (const cls of classes) {
            if (
                cls.className.length > 0 &&
                //only highlight classes that are in scope
                this.event.scopes.some(x => x.hasClass(cls.className, cls.namespaceName))
            ) {
                const tokens = util.splitGetRange('.', cls.className, cls.range);
                this.addTokens(tokens.reverse(), SemanticTokenTypes.class, SemanticTokenTypes.namespace);
            }
        }
    }

    /**
     * Add tokens for each locatable item in the list.
     * Each locatable is paired with a token type. If there are more locatables than token types, all remaining locatables are given the final token type
     */
    private addTokens(locatables: Locatable[], ...semanticTokenTypes: SemanticTokenTypes[]) {
        for (let i = 0; i < locatables.length; i++) {
            const locatable = locatables[i];
            //skip items that don't have a location
            if (locatable?.range) {
                this.addToken(
                    locatables[i],
                    //use the type at the index, or the last type if missing
                    semanticTokenTypes[i] ?? semanticTokenTypes[semanticTokenTypes.length - 1]
                );
            }
        }
    }

    private addToken(locatable: Locatable, type: SemanticTokenTypes, modifiers: SemanticTokenModifiers[] = []) {
        this.event.semanticTokens.push({
            range: locatable.range,
            tokenType: type,
            tokenModifiers: modifiers
        });
    }

    private iterateNodes() {
        const scope = this.event.scopes[0];

        //if this file has no scopes, there's nothing else we can do about this
        if (!scope) {
            return;
        }
        scope.linkSymbolTable();
        /* eslint-disable @typescript-eslint/dot-notation */
        const nodes = [
            ...this.event.file['_cachedLookups'].aliasStatements,
            ...this.event.file['_cachedLookups'].expressions,
            //make a new VariableExpression to wrap the name. This is a hack, we could probably do it better
            ...this.event.file['_cachedLookups'].assignmentStatements,
            ...this.event.file['_cachedLookups'].functionExpressions.map(x => x.parameters).flat()
        ];
        /* eslint-enable @typescript-eslint/dot-notation */

        for (let node of nodes) {
            if (isCallExpression(node)) {
                //lift the callee from call expressions to handle namespaced function calls
                node = node.callee;
            } else if (isNewExpression(node)) {
                //lift the callee from call expressions to handle namespaced function calls
                node = node.call.callee;
            } else if (isAliasStatement(node)) {
                //give an alias the same SemanticToken info as its value
                const extraData = {};
                const chain = [];
                // eslint-disable-next-line no-bitwise
                const symbolType = node.value.getType({ flags: SymbolTypeFlag.typetime | SymbolTypeFlag.runtime, data: extraData, typeChain: chain });
                if (symbolType?.isResolvable()) {
                    let info = this.getSemanticTokenTypeFromType(symbolType, extraData);
                    this.addToken(node.tokens.name, info.type, info.modifiers);
                }
            }
            const nodeSymbolTable = node.getSymbolTable();
            const containingNamespaceNameLower = node.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript).toLowerCase();
            const tokens = util.getAllDottedGetParts(node);
            const processedNames: string[] = [];
            for (const token of tokens ?? []) {
                processedNames.push(token.text?.toLowerCase());
                const entityName = processedNames.join('.');

                if (scope.getEnumMemberFileLink(entityName, containingNamespaceNameLower)) {
                    this.addToken(token, SemanticTokenTypes.enumMember);
                } else if (scope.getEnum(entityName, containingNamespaceNameLower)) {
                    this.addToken(token, SemanticTokenTypes.enum);
                } else if (scope.getClass(entityName, containingNamespaceNameLower)) {
                    this.addToken(token, SemanticTokenTypes.class);
                } else if (scope.getInterface(entityName, containingNamespaceNameLower)) {
                    this.addToken(token, SemanticTokenTypes.interface);
                } else if (scope.getCallableByName(entityName)) {
                    this.addToken(token, SemanticTokenTypes.function);
                } else if (scope.getNamespace(entityName, containingNamespaceNameLower)) {
                    this.addToken(token, SemanticTokenTypes.namespace);
                } else if (scope.getConstFileLink(entityName, containingNamespaceNameLower)) {
                    this.addToken(token, SemanticTokenTypes.variable, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]);
                } else {
                    const extraData = {};
                    const symbolType = nodeSymbolTable.getSymbolType(token.text, { flags: SymbolTypeFlag.typetime, data: extraData });
                    if (symbolType?.isResolvable()) {
                        const info = this.getSemanticTokenTypeFromType(symbolType, extraData, !!containingNamespaceNameLower);
                        this.addToken(token, info.type, info.modifiers);
                    }
                }
            }
        }
        scope.unlinkSymbolTable();
    }

    // TODO: We can use the actual symbol tables to find methods and member fields.
    private getSemanticTokenTypeFromType(type: BscType, extraData: ExtraSymbolData, areMembers = false) {
        let result = {
            type: SemanticTokenTypes.type,
            modifiers: [] as SemanticTokenModifiers[]
        };

        if (isConstStatement(extraData?.definingNode)) {
            result.type = SemanticTokenTypes.variable;
            result.modifiers.push(SemanticTokenModifiers.readonly, SemanticTokenModifiers.static);
        } else if (isClassType(type)) {
            result.type = SemanticTokenTypes.class;
        } else if (isCallableType(type)) {
            result.type = areMembers ? SemanticTokenTypes.method : SemanticTokenTypes.function;
        } else if (isInterfaceType(type)) {
            result.type = SemanticTokenTypes.interface;
        } else if (isComponentType(type)) {
            result.type = SemanticTokenTypes.class;
        } else if (isEnumType(type)) {
            result.type = SemanticTokenTypes.enum;
        } else if (isEnumMemberType(type)) {
            result.type = SemanticTokenTypes.enumMember;
        } else if (isNamespaceType(type)) {
            result.type = SemanticTokenTypes.namespace;
        } else if (isNativeType(type)) {
            result.type = SemanticTokenTypes.type;
        } else {
            result.type = areMembers ? SemanticTokenTypes.property : SemanticTokenTypes.variable;
        }
        return result;
    }
}
