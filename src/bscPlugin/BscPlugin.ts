import type { CodeAction, Range } from 'vscode-languageserver';
import { isXmlFile, isXmlScope } from '../astUtils/reflection';
import type { BscFile, BsDiagnostic, CompilerPlugin } from '../interfaces';
import type { Scope } from '../Scope';
import { XmlFileCodeActionsProcessor } from './codeActions/XmlFileCodeActionsProcessor';
import { XmlScopeCodeActionProcessor } from './codeActions/XmlScopeCodeActionsProcessor';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onFileGetCodeActions(file: BscFile, range: Range, diagnostics: BsDiagnostic[], codeActions: CodeAction[]) {
        if (isXmlFile(file)) {
            new XmlFileCodeActionsProcessor(file, range, diagnostics, codeActions).process();
        }
    }

    public onScopeGetCodeActions(scope: Scope, file: BscFile, range: Range, diagnostics: BsDiagnostic[], codeActions: CodeAction[]) {
        if (isXmlScope(scope)) {
            new XmlScopeCodeActionProcessor(scope, file, range, diagnostics, codeActions).process();
        }
    }
}
