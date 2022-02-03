import { Cache } from '../../Cache';
import type { BrsFile } from '../../files/BrsFile';
import type { BeforeFileTranspileEvent } from '../../interfaces';
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
        const enumMap = new Cache<string, Map<string, string>>();
        const firstScope = this.event.file.program.getFirstScopeForFile(this.event.file);
        for (const expression of this.event.file.parser.references.expressions) {
            const parts = util.getAllDottedGetParts(expression)?.map(x => x.toLowerCase());
            const memberName = parts.pop();
            const enumName = parts.join('.');
            const theEnum = firstScope.enumLookup.get(enumName);
            const values = enumMap.getOrAdd(enumName, () => theEnum.statement.getMemberValueMap());
            if (theEnum) {
                const value = values.get(memberName);
                this.event.editor.overrideTranspileResult(expression, value);
            }
        }
    }

}
