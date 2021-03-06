import type { Range } from 'vscode-languageserver-protocol';
import { SemanticTokenTypes } from 'vscode-languageserver-protocol';
import { isBrsFile, isCustomType } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { OnGetSemanticTokensEvent } from '../../interfaces';
import { ParseMode } from '../../parser';
import util from '../../util';

export class SemanticTokensProcessor {
    public constructor(
        public event: OnGetSemanticTokensEvent
    ) {

    }

    public process() {
        if (isBrsFile(this.event.file)) {
            this.processBrsFile(this.event.file);
        }
    }

    private processBrsFile(file: BrsFile) {

        const classes = [] as Array<{ className: string; namespaceName: string; range: Range }>;

        //classes used in function param types
        for (const func of file.parser.references.functionExpressions) {
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
        for (const expr of file.parser.references.newExpressions) {
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
