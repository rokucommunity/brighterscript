import type { Range } from 'vscode-languageserver-protocol';
import { SemanticTokenTypes } from 'vscode-languageserver-protocol';
import { isCallExpression, isCustomType, isNewExpression } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { OnGetSemanticTokensEvent } from '../../interfaces';
import type { Locatable } from '../../lexer/Token';
import { ParseMode } from '../../parser/Parser';
import util from '../../util';

export class BrsFileSemanticTokensProcessor {
    public constructor(
        public event: OnGetSemanticTokensEvent<BrsFile>
    ) {

    }

    public process() {
        this.handleClasses();
        this.iterateExpressions();
    }

    private handleClasses() {

        const classes = [] as Array<{ className: string; namespaceName: string; range: Range }>;

        //classes used in function param types
        for (const func of this.event.file.parser.references.functionExpressions) {
            for (const parm of func.parameters) {
                if (isCustomType(parm.type)) {
                    classes.push({
                        className: parm.type.getText(),
                        namespaceName: parm.namespaceName?.getName(ParseMode.BrighterScript),
                        range: parm.type.range
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

    private addToken(locatable: Locatable, type: SemanticTokenTypes) {
        this.event.semanticTokens.push({
            range: locatable.range,
            tokenType: type
        });
    }

    private iterateExpressions() {
        const scope = this.event.scopes[0];

        for (let expression of this.event.file.parser.references.expressions) {
            //lift the callee from call expressions to handle namespaced function calls
            if (isCallExpression(expression)) {
                expression = expression.callee;
            } else if (isNewExpression(expression)) {
                expression = expression.call.callee;
            }
            const tokens = util.getAllDottedGetParts(expression);
            const processedNames: string[] = [];
            for (const token of tokens ?? []) {
                processedNames.push(token.text?.toLowerCase());
                const entityName = processedNames.join('.');

                if (scope.getEnumMemberMap().has(entityName)) {
                    this.addToken(token, SemanticTokenTypes.enumMember);
                } else if (scope.getEnumMap().has(entityName)) {
                    this.addToken(token, SemanticTokenTypes.enum);
                } else if (scope.getClassMap().has(entityName)) {
                    this.addToken(token, SemanticTokenTypes.class);
                } else if (scope.getCallableByName(entityName)) {
                    this.addToken(token, SemanticTokenTypes.function);
                } else if (scope.namespaceLookup.has(entityName)) {
                    this.addToken(token, SemanticTokenTypes.namespace);
                }
            }
        }
    }
}
