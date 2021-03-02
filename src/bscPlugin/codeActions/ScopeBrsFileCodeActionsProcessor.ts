import type { CodeAction, Range } from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import { codeActionUtil } from '../../CodeActionUtil';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BsDiagnostic } from '../../interfaces';
import type { Scope } from '../../Scope';
import { util } from '../../util';

export class ScopeBrsFileCodeActionsProcessor {
    public constructor(
        public scope: Scope,
        public file: BrsFile,
        public range: Range,
        public diagnostics: BsDiagnostic[],
        public codeActions: CodeAction[]
    ) {

    }

    public process() {
        const isBsFile = this.file.extension.endsWith('.bs');
        for (const diagnostic of this.diagnostics) {
            //certain brighterscript-specific code actions
            if (isBsFile) {
                if (diagnostic.code === DiagnosticCodeMap.callToUnknownFunction) {
                    this.suggestImports(diagnostic as any);
                }
            }
        }
    }

    private suggestImports(diagnostic: DiagnosticMessageType<'callToUnknownFunction'>) {
        //find the position of the first import statement, or the top of the file if there is none
        const insertPosition = this.file.parser.references.importStatements[0]?.importToken.range?.start ?? util.createPosition(0, 0);

        //find all files that reference this function
        for (const file of this.file.program.findFilesForFunction(diagnostic.data.functionName)) {
            const pkgPath = util.getRokuPkgPath(file.pkgPath);
            this.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `import "${pkgPath}"`,
                    diagnostics: [diagnostic],
                    isPreferred: false,
                    kind: CodeActionKind.QuickFix,
                    changes: [{
                        type: 'insert',
                        filePath: this.file.pathAbsolute,
                        position: insertPosition,
                        newText: `import "${pkgPath}"\n`
                    }]
                })
            );
        }
    }
}
