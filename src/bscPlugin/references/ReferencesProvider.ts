import type { BrsFile } from '../../files/BrsFile';
import type { ProvideReferencesEvent } from '../../interfaces';
import type { Location } from 'vscode-languageserver-protocol';
import util from '../../util';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import type { XmlFile } from '../../files/XmlFile';
import { isBrsFile, isXmlFile } from '../../astUtils/reflection';

export class ReferencesProvider {
    constructor(
        private event: ProvideReferencesEvent
    ) { }

    public process(): Location[] {
        if (isBrsFile(this.event.file)) {
            this.brsFileGetReferences(this.event.file);
        } else if (isXmlFile(this.event.file)) {
            this.xmlFileGetReferences(this.event.file);
        }
        return this.event.references;
    }

    /**
     * For a position in a BrsFile, get the location where the token at that position was defined
     */
    private brsFileGetReferences(file: BrsFile): void {

        const callSiteToken = file.getTokenAt(this.event.position);

        //there's no token at this position (i.e. the cursor is past the end of a line), so there's nothing to search for
        if (!callSiteToken) {
            return;
        }

        const searchFor = callSiteToken.text.toLowerCase();

        const scopes = this.event.program.getScopesForFile(file);

        //track processed files across all scopes. A file's references are the same no matter which
        //scope it was reached through, so walking it once per scope would emit duplicate results
        const processedFiles = new Set<BrsFile>();

        for (const scope of scopes) {
            for (const file of scope.getAllFiles()) {
                if (!isBrsFile(file) || processedFiles.has(file)) {
                    continue;
                }
                processedFiles.add(file);
                file.ast.walk(createVisitor({
                    AssignmentStatement: (s) => {
                        if (s.name?.text?.toLowerCase() === searchFor) {
                            this.event.references.push(util.createLocation(util.pathToUri(file.srcPath), s.name.range));
                        }
                    },
                    VariableExpression: (e) => {
                        if (e.name.text.toLowerCase() === searchFor) {
                            this.event.references.push(util.createLocation(util.pathToUri(file.srcPath), e.range));
                        }
                    }
                }), {
                    walkMode: WalkMode.visitAllRecursive
                });
            }
        }
    }

    private xmlFileGetReferences(file: XmlFile) {

    }
}
