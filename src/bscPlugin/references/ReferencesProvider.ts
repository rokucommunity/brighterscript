import type { BrsCodeSegment } from '../../files/BrsCodeSegment';
import type { ProvideReferencesEvent } from '../../interfaces';
import type { Location } from 'vscode-languageserver-protocol';
import util from '../../util';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import type { XmlFile } from '../../files/XmlFile';
import { isBrsCodeSegment, isXmlFile } from '../../astUtils/reflection';

export class ReferencesProvider {
    constructor(
        private event: ProvideReferencesEvent
    ) { }

    public process(): Location[] {
        if (isBrsCodeSegment(this.event.codeSegment)) {
            this.brsCodeGetReferences(this.event.codeSegment);
        } else if (isXmlFile(this.event.file)) {
            this.xmlFileGetReferences(this.event.file);
        }
        return this.event.references;
    }

    /**
     * For a position in BrightScript code, get the location where the token at that position was defined
     */
    private brsCodeGetReferences(code: BrsCodeSegment): void {

        const callSiteToken = code.getTokenAt(this.event.position);

        //there's no token at this position (i.e. the cursor is past the end of a line), so there's nothing to search for
        if (!callSiteToken) {
            return;
        }

        const searchFor = callSiteToken.text.toLowerCase();

        const scopes = this.event.program.getScopesForCodeSegment(code);

        //track processed code across all scopes. Code's references are the same no matter which
        //scope it was reached through, so walking it once per scope would emit duplicate results
        const processedCodeSegments = new Set<BrsCodeSegment>();

        for (const scope of scopes) {
            for (const scopeCode of scope.getAllCodeSegments()) {
                if (!isBrsCodeSegment(scopeCode) || processedCodeSegments.has(scopeCode)) {
                    continue;
                }
                processedCodeSegments.add(scopeCode);
                scopeCode.ast.walk(createVisitor({
                    AssignmentStatement: (s) => {
                        if (s.tokens.name?.text?.toLowerCase() === searchFor) {
                            this.event.references.push(util.createLocationFromRange(util.pathToUri(scopeCode.srcPath), s.tokens.name.location?.range));
                        }
                    },
                    VariableExpression: (e) => {
                        if (e.tokens.name.text.toLowerCase() === searchFor) {
                            this.event.references.push(util.createLocationFromRange(util.pathToUri(scopeCode.srcPath), e.location?.range));
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
