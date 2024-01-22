import type { Diagnostic } from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import { codeActionUtil } from '../../CodeActionUtil';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile } from '../../files/BscFile';
import type { XmlFile } from '../../files/XmlFile';
import type { OnGetCodeActionsEvent } from '../../interfaces';
import { ParseMode } from '../../parser/Parser';
import { util } from '../../util';
import { isBrsFile } from '../../astUtils/reflection';

export class CodeActionsProcessor {
    public constructor(
        public event: OnGetCodeActionsEvent
    ) {

    }

    public process() {
        for (const diagnostic of this.event.diagnostics) {
            if (diagnostic.code === DiagnosticCodeMap.cannotFindName) {
                this.suggestCannotFindName(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.classCouldNotBeFound) {
                this.suggestClassImports(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.xmlComponentMissingExtendsAttribute) {
                this.addMissingExtends(diagnostic as any);
            }
        }
    }

    private suggestedImports = new Set<string>();

    /**
     * Generic import suggestion function. Shouldn't be called directly from the main loop, but instead called by more specific diagnostic handlers
     */
    private suggestImports(diagnostic: Diagnostic, key: string, files: BscFile[]) {
        //skip if we already have this suggestion
        if (this.suggestedImports.has(key) || !isBrsFile(this.event.file)) {
            return;
        }

        this.suggestedImports.add(key);
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const importStatements = this.event.file['_cachedLookups'].importStatements;
        //find the position of the first import statement, or the top of the file if there is none
        const insertPosition = importStatements[importStatements.length - 1]?.importToken.range?.start ?? util.createPosition(0, 0);

        //find all files that reference this function
        for (const file of files) {
            const destPath = util.sanitizePkgPath(file.destPath);
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `import "${destPath}"`,
                    diagnostics: [diagnostic],
                    isPreferred: false,
                    kind: CodeActionKind.QuickFix,
                    changes: [{
                        type: 'insert',
                        filePath: this.event.file.srcPath,
                        position: insertPosition,
                        newText: `import "${destPath}"\n`
                    }]
                })
            );
        }
    }

    private suggestCannotFindName(diagnostic: DiagnosticMessageType<'cannotFindName'>) {
        //skip if not a BrighterScript file
        if ((diagnostic.file as BrsFile).parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const lowerName = (diagnostic.data.fullName ?? diagnostic.data.name).toLowerCase();

        this.suggestImports(
            diagnostic,
            lowerName,
            [
                ...this.event.program.findFilesForFunction(lowerName),
                ...this.event.program.findFilesForClass(lowerName),
                ...this.event.program.findFilesForNamespace(lowerName),
                ...this.event.program.findFilesForEnum(lowerName)
            ]
        );
    }

    private suggestClassImports(diagnostic: DiagnosticMessageType<'classCouldNotBeFound'>) {
        //skip if not a BrighterScript file
        if ((diagnostic.file as BrsFile).parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const lowerClassName = diagnostic.data.className.toLowerCase();
        this.suggestImports(
            diagnostic,
            lowerClassName,
            this.event.program.findFilesForClass(lowerClassName)
        );
    }

    private addMissingExtends(diagnostic: DiagnosticMessageType<'xmlComponentMissingExtendsAttribute'>) {
        const srcPath = this.event.file.srcPath;
        const { componentElement } = (this.event.file as XmlFile).parser.ast;
        //inject new attribute after the final attribute, or after the `<component` if there are no attributes
        const pos = (componentElement.attributes[componentElement.attributes.length - 1] ?? componentElement.tokens.startTagName).range.end;
        this.event.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Extend "Group"`,
                diagnostics: [diagnostic],
                isPreferred: true,
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: srcPath,
                    position: pos,
                    newText: ' extends="Group"'
                }]
            })
        );
        this.event.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Extend "Task"`,
                diagnostics: [diagnostic],
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: srcPath,
                    position: pos,
                    newText: ' extends="Task"'
                }]
            })
        );
        this.event.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Extend "ContentNode"`,
                diagnostics: [diagnostic],
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: srcPath,
                    position: pos,
                    newText: ' extends="ContentNode"'
                }]
            })
        );
    }
}
