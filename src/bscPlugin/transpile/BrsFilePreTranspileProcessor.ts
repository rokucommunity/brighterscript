import { isLiteralExpression, isVariableExpression } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import type { BrsFile } from '../../files/BrsFile';
import type { BeforeFileTranspileEvent } from '../../interfaces';
import { ParseMode } from '../../parser/Parser';
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

        const scope = this.event.file.program.getFirstScopeForFile(this.event.file);

        //skip this logic if current scope has no enums and no consts
        if ((scope?.getEnumMap()?.size ?? 0) === 0 && (scope?.getConstMap()?.size ?? 0) === 0) {
            return;
        }
        for (const expression of this.event.file.parser.references.expressions) {
            let parts: string[];
            //constants with no owner (i.e. SOME_CONST)
            if (isVariableExpression(expression)) {
                parts = [expression.name.text.toLowerCase()];

                /**
                 * direct enum member (i.e. Direction.up),
                 * namespaced enum member access (i.e. Name.Space.Direction.up),
                 * namespaced const access (i.e. Name.Space.SOME_CONST) or class consts (i.e. SomeClass.SOME_CONST),
                 */
            } else {
                parts = util.getAllDottedGetParts(expression)?.map(x => x.text.toLowerCase());
            }
            if (parts) {
                //get the name of the  member
                const memberName = parts.pop();
                //get the name of the enum (including leading namespace if applicable)
                const ownerName = parts.join('.');
                let containingNamespace = this.event.file.getNamespaceStatementForPosition(expression.range.start)?.getName(ParseMode.BrighterScript);

                /**
                 * Enum member replacements
                 */
                const theEnum = scope.getEnumFileLink(ownerName, containingNamespace)?.item;
                if (theEnum) {
                    const members = membersByEnum.getOrAdd(ownerName, () => theEnum.getMemberValueMap());
                    const value = members?.get(memberName);
                    this.event.editor.overrideTranspileResult(expression, value);
                    continue;
                }

                /**
                 * const replacements
                 */
                const fullName = ownerName ? `${ownerName}.${memberName}` : memberName.toLowerCase();

                const constStatement = scope.getConstFileLink(fullName, containingNamespace)?.item;

                //if we found a const, override the transpile result
                if (constStatement) {
                    this.event.editor.setProperty(expression, 'transpile', (state) => {
                        return isLiteralExpression(constStatement.value)
                            //transpile primitive value as-is
                            ? constStatement.value.transpile(state)
                            //wrap non-primitive value in parens
                            : ['(', ...constStatement.value.transpile(state), ')'];
                    });
                    continue;
                }
            }
        }
    }
}
