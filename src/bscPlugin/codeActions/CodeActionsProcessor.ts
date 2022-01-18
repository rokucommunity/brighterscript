import type { Diagnostic } from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import { codeActionUtil } from '../../CodeActionUtil';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { BscFile, BsDiagnostic, OnGetCodeActionsEvent } from '../../interfaces';
import { ParseMode } from '../../parser';
import { util } from '../../util';
import type { XmlScope } from '../../XmlScope';

export class CodeActionsProcessor {
    public constructor(
        public event: OnGetCodeActionsEvent
    ) {

    }

    public process() {
        for (const diagnostic of this.event.diagnostics) {
            if (diagnostic.code === DiagnosticCodeMap.callToUnknownFunction) {
                this.handleCallToUnknownFunction(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.classCouldNotBeFound) {
                this.handleClassCouldNotBeFound(diagnostic as any);
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
        if (this.suggestedImports.has(key)) {
            return;
        }

        this.suggestedImports.add(key);
        const importStatements = (this.event.file as BrsFile).parser.references.importStatements;
        //find the position of the first import statement, or the top of the file if there is none
        const insertPosition = importStatements[importStatements.length - 1]?.importToken.range?.start ?? util.createPosition(0, 0);

        //suggest importing each file that references this item
        for (const file of files) {
            const pkgPath = util.getRokuPkgPath(file.pkgPath);
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `import "${pkgPath}"`,
                    diagnostics: [diagnostic],
                    isPreferred: false,
                    kind: CodeActionKind.QuickFix,
                    changes: [{
                        type: 'insert',
                        filePath: this.event.file.pathAbsolute,
                        position: insertPosition,
                        newText: `import "${pkgPath}"\n`
                    }]
                })
            );
        }
    }

    /**
     * Suggest a `<script>` reference for each of the specified files, for each of the scopes referencing the diagnostic's file.
     * @param diagnostic
     * @param key
     * @param suggestedFiles a list of files suggested for import
     */
    private suggestXmlScript(diagnostic: BsDiagnostic, key: string, suggestedFiles: BscFile[]) {
        //skip if we already have this suggestion
        if (this.suggestedImports.has(key)) {
            return;
        }
        this.suggestedImports.add(key);

        //find all of the scopes that reference this diagnostic's file
        for (const scope of this.event.scopes as XmlScope[]) {
            //skip the global scope
            if (scope.name === 'global') {
                continue;
            }
            for (const file of suggestedFiles) {
                const pkgPath = util.getRokuPkgPath(file.pkgPath);
                const slashOpenToken = scope.xmlFile.parser.ast.component?.ast.SLASH_OPEN?.[0];
                this.event.codeActions.push(
                    codeActionUtil.createCodeAction({
                        title: `Add xml script import "${pkgPath}" into component "${scope.xmlFile.componentName.text ?? scope.name}"`,
                        // diagnostics: [diagnostic]
                        changes: [{
                            filePath: scope.xmlFile.pathAbsolute,
                            newText: `  <script type="text/brightscript" uri="${pkgPath}" />\n`,
                            type: 'insert',
                            position: util.createPosition(slashOpenToken.startLine - 1, slashOpenToken.startColumn - 1)
                        }]
                    })
                );
            }
        }
    }


    private handleCallToUnknownFunction(diagnostic: DiagnosticMessageType<'callToUnknownFunction'>) {

        const lowerFunctionName = diagnostic.data.functionName.toLowerCase();
        const filesForFunction = this.event.file.program.findFilesForFunction(lowerFunctionName);

        //suggest .bs `import` statements for brighterscript file
        if ((diagnostic.file as BrsFile).parseMode === ParseMode.BrighterScript) {
            this.suggestImports(diagnostic, lowerFunctionName, filesForFunction);
        }

        //suggest xml script tag imports
        this.suggestXmlScript(diagnostic, lowerFunctionName, filesForFunction);
    }

    private handleClassCouldNotBeFound(diagnostic: DiagnosticMessageType<'classCouldNotBeFound'>) {
        const lowerClassName = diagnostic.data.className.toLowerCase();

        const filesForClass = this.event.file.program.findFilesForClass(lowerClassName);

        //suggest .bs `import` statements for brighterscript file
        if ((diagnostic.file as BrsFile).parseMode === ParseMode.BrighterScript) {
            this.suggestImports(diagnostic, lowerClassName, filesForClass);
        }

        //suggest xml script tag imports
        this.suggestXmlScript(diagnostic, lowerClassName, filesForClass);
    }

    private addMissingExtends(diagnostic: DiagnosticMessageType<'xmlComponentMissingExtendsAttribute'>) {
        const srcPath = this.event.file.pathAbsolute;
        const { component } = (this.event.file as XmlFile).parser.ast;
        //inject new attribute after the final attribute, or after the `<component` if there are no attributes
        const pos = (component.attributes[component.attributes.length - 1] ?? component.tag).range.end;
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
