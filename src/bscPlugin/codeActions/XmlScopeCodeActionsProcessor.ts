import type { CodeAction, Range } from 'vscode-languageserver';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import { isBrsFile } from '../../astUtils/reflection';
import type { BscFile, BsDiagnostic } from '../../interfaces';
import util from '../../util';
import type { XmlScope } from '../../XmlScope';
import codeActionUtil from '../../CodeActionUtil';

export class XmlScopeCodeActionProcessor {
    public constructor(
        public scope: XmlScope,
        public file: BscFile,
        public range: Range,
        public diagnostics: BsDiagnostic[],
        public codeActions: CodeAction[]
    ) {

    }

    public process() {
        for (const diagnostic of this.diagnostics) {
            if (diagnostic.code === DiagnosticCodeMap.callToUnknownFunction) {
                this.importXmlScript(diagnostic as any);
            }
        }
    }

    public importXmlScript(diagnostic: DiagnosticMessageType<'callToUnknownFunction'>) {
        const lowerFunctionName = diagnostic.data.functionName.toLowerCase();

        //find every file with this function defined
        for (const key in this.scope.program.files) {
            const file = this.scope.program.files[key];
            if (isBrsFile(file)) {
                //TODO handle namespace-relative function calls
                const stmt = file.parser.references.functionStatementLookup.get(lowerFunctionName);
                const slashOpenToken = this.scope.xmlFile.parser.ast.component?.ast.SLASH_OPEN?.[0];
                if (stmt && slashOpenToken) {
                    const pkgPath = util.getRokuPkgPath(file.pkgPath);
                    this.codeActions.push(
                        codeActionUtil.createCodeAction({
                            title: `Import "${pkgPath}" into component "${this.scope.xmlFile.componentName.text ?? this.scope.name}"`,
                            // diagnostics: [diagnostic]
                            changes: [{
                                filePath: this.scope.xmlFile.pathAbsolute,
                                newText: `  <script type="text/brightscript" uri="${pkgPath}" />\n`,
                                type: 'insert',
                                position: util.createPosition(slashOpenToken.startLine - 1, slashOpenToken.startColumn - 1)
                            }]
                        })
                    );
                }
            }
        }
    }

}
