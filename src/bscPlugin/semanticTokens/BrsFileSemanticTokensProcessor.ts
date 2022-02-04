import type { Range } from 'vscode-languageserver-protocol';
import { SemanticTokenTypes } from 'vscode-languageserver-protocol';
import { isCustomType } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { OnGetSemanticTokensEvent } from '../../interfaces';
import { ParseMode } from '../../parser/Parser';
import util from '../../util';

export class BrsFileSemanticTokensProcessor {
    public constructor(
        public event: OnGetSemanticTokensEvent<BrsFile>
    ) {

    }

    public process() {
        this.handleClasses();
    }

    private handleClasses() {

        const classes = [] as Array<{ className: string; namespaceName: string; range: Range }>;

        //classes used in function param types
        for (const func of this.event.file.parser.references.functionExpressions) {
            for (const parm of func.parameters) {
                if (isCustomType(parm.type)) {
                    classes.push({
                        className: parm.typeToken.text,
                        namespaceName: parm.namespaceName?.getName(ParseMode.BrighterScript),
                        range: parm.typeToken.range
                    });
                }
            }
        }
        //classes used in `new` expressions
        for (const expr of this.event.file.parser.references.newExpressions) {
            classes.push({
                className: expr.className.getName(ParseMode.BrighterScript),
                namespaceName: expr.namespaceName?.getName(ParseMode.BrighterScript),
                range: expr.className.range
            });
        }

        for (const cls of classes) {
            if (
                cls.className.length > 0 &&
                //only highlight classes that are in scope
                this.event.scopes.some(x => x.hasClass(cls.className, cls.namespaceName))
            ) {
                const tokens = util.splitGetRange('.', cls.className, cls.range);
                //namespace parts (skip the final array entry)
                for (let i = 0; i < tokens.length - 1; i++) {
                    const token = tokens[i];
                    this.event.semanticTokens.push({
                        range: token.range,
                        tokenType: SemanticTokenTypes.namespace
                    });
                }
                //class name
                this.event.semanticTokens.push({
                    range: tokens.pop().range,
                    tokenType: SemanticTokenTypes.class
                });
            }
        }

    }
}
