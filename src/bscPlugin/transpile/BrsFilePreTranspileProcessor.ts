import { isBinaryExpression } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import type { BrsFile } from '../../files/BrsFile';
import type { BeforeFileTranspileEvent } from '../../interfaces';
import type { Expression } from '../../parser/Expression';
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
        const membersByEnum = new Cache<string, Map<string, string>>();

        const enumLookup = this.event.file.program.getFirstScopeForFile(this.event.file)?.getEnumMap();
        //skip this logic if current scope has no enums
        if ((enumLookup?.size ?? 0) === 0) {
            return;
        }
        for (const referenceExpression of this.event.file.parser.references.expressions) {
            const actualExpressions: Expression[] = [];
            //binary expressions actually have two expressions (left and right), so handle them independently
            if (isBinaryExpression(referenceExpression)) {
                actualExpressions.push(referenceExpression.left, referenceExpression.right);
            } else {
                //assume all other expressions are a single chain
                actualExpressions.push(referenceExpression);
            }
            for (const expression of actualExpressions) {
                const parts = util.getAllDottedGetParts(expression)?.map(x => x.toLowerCase());
                if (parts) {
                    //get the name of the enum member
                    const memberName = parts.pop();
                    //get the name of the enum (including leading namespace if applicable)
                    const enumName = parts.join('.');
                    const lowerEnumName = enumName.toLowerCase();
                    const theEnum = enumLookup.get(lowerEnumName)?.item;
                    if (theEnum) {
                        const members = membersByEnum.getOrAdd(lowerEnumName, () => theEnum.getMemberValueMap());
                        const value = members?.get(memberName);
                        this.event.editor.overrideTranspileResult(expression, value);
                    }
                }
            }
        }
    }
}
