import type { BrsFile } from '../../files/BrsFile';
import type { BeforeFileTranspileEvent } from '../../interfaces';
import type { Expression } from '../../parser/Expression';
import type { Scope } from '../../Scope';
import util from '../../util';

export class BrsFilePreTranspileProcessor {
    public constructor(
        private event: BeforeFileTranspileEvent<BrsFile>
    ) {
    }

    public process() {
        this.replaceEnumValues();
    }

    private replaceEnumValues() {
        const firstScope = this.event.file.program.getFirstScopeForFile(this.event.file)[0];
        for (const expression of this.event.file.parser.references.expressions) {
            // const parts = util.getAllDottedGetParts(expression)?.map(x => x.toLowerCase());
            // const memberName = parts.pop();
            // const enumName = parts.join('.');
            if (true || this.isEnumValue(expression, firstScope)) {
                //hijack the `transpile` method until we have a better way of replacing the expression itself
                this.event.editor.overrideTranspileResult(expression, '12345');
            }
        }
    }

    /**
     * Is the given expression a valid enum value?
     */
    private isEnumValue(expression: Expression, scope: Scope) {
        const fullExpression = util.getAllDottedGetParts(expression)?.map(x => x.toLowerCase()).join('.');
        return scope.enumLookup.has(fullExpression);
    }
}
