import { SemanticTokenTypes } from 'vscode-languageserver-protocol';
import { isBrsFile } from '../../astUtils/reflection';
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
        //color `NewExpression` namespace and class names
        for (const newExpression of file.parser.references.newExpressions) {
            const name = newExpression.className.getName(ParseMode.BrighterScript);

            if (
                name.length > 0 &&
                //only highlight classes that are in scope
                this.event.scopes.some(x => x.hasClass(name, newExpression.namespaceName?.getName(ParseMode.BrighterScript)))
            ) {
                const tokens = util.splitGetRange('.', name, newExpression.className.range);
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
