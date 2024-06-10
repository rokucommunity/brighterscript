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

        const searchFor = callSiteToken.text.toLowerCase();

        const scopes = this.event.program.getScopesForFile(file);

        for (const scope of scopes) {
            const processedFiles = new Set<BrsFile>();
            for (const file of scope.getAllFiles()) {
                if (!isBrsFile(file) || processedFiles.has(file)) {
                    continue;
                }
                processedFiles.add(file);
                file.ast.walk(createVisitor({
                    AssignmentStatement: (s) => {
                        if (s.tokens.name?.text?.toLowerCase() === searchFor) {
                            this.event.references.push(util.createLocationFromRange(util.pathToUri(file.srcPath), s.tokens.name.location?.range));
                        }
                    },
                    VariableExpression: (e) => {
                        if (e.tokens.name.text.toLowerCase() === searchFor) {
                            this.event.references.push(util.createLocationFromRange(util.pathToUri(file.srcPath), e.location?.range));
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
