import { isBrsFile, isXmlFile } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideReferencesEvent, Reference } from '../../interfaces';

export class ReferencesProcessor {
    public constructor(
        private event: ProvideReferencesEvent
    ) {

    }

    public process() {
        if (isBrsFile(this.event.file)) {
            this.event.references.push(
                ...this.findVariableReferences(this.event.file)
            );
        }
    }

    private findVariableReferences(file: BrsFile) {
        const callSiteToken = file.getTokenAt(this.event.position);

        let locations = [] as Reference[];

        const searchFor = callSiteToken.text.toLowerCase();

        for (const scope of this.event.scopes) {
            const processedFiles = new Set<BrsFile>();
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file) || processedFiles.has(file)) {
                    continue;
                }
                processedFiles.add(file);
                file.ast.walk(createVisitor({
                    VariableExpression: (e) => {
                        if (e.name.text.toLowerCase() === searchFor) {
                            locations.push({
                                srcPath: file.srcPath,
                                range: e.range
                            });
                        }
                    },
                    AssignmentStatement: (e) => {
                        if (e.name.text.toLowerCase() === searchFor) {
                            locations.push({
                                srcPath: file.srcPath,
                                range: e.name.range
                            });
                        }
                    }
                }), {
                    walkMode: WalkMode.visitAllRecursive
                });
            }
        }
        return locations;
    }
}
