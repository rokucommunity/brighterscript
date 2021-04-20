import { Location } from 'vscode-languageserver';
import { createVisitor, isBrsFile, WalkMode } from '../../astUtils';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile, OnGetReferencesEvent } from '../../interfaces';
import { util } from '../../util';

export class ReferencesProcessor {
    public constructor(
        public event: OnGetReferencesEvent
    ) {
    }

    public process() {
        if (isBrsFile(this.event.file)) {
            this.processBrsFile(this.event.file);
        }
    }

    private processBrsFile(file1: BrsFile) {
        const callSiteToken = file1.getTokenAt(this.event.position);

        const searchFor = callSiteToken.text.toLowerCase();

        //get every file from all scopes this file is a member of
        const scopeFiles = new Set<BrsFile>(
            this.event.scopes.flatMap(
                x => x.getAllFiles()
            ).filter(
                x => isBrsFile(x)
            ) as BrsFile[]
        );

        for (const scopeFile of scopeFiles) {
            scopeFile.ast.walk(createVisitor({
                VariableExpression: (e) => {
                    if (e.name.text.toLowerCase() === searchFor) {
                        this.event.references.push(
                            Location.create(util.pathToUri(scopeFile.pathAbsolute), e.range)
                        );
                    }
                }
            }), {
                walkMode: WalkMode.visitExpressionsRecursive
            });
        }
    }
}
