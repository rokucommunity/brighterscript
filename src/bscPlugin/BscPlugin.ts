import type { CodeAction, Range } from 'vscode-languageserver';
import { isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { BscFile, BsDiagnostic, CompilerPlugin } from '../interfaces';
import type { Scope } from '../Scope';
import { ScopeBrsFileCodeActionsProcessor } from './codeActions/ScopeBrsFileCodeActionsProcessor';
import { XmlFileCodeActionsProcessor } from './codeActions/XmlFileCodeActionsProcessor';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onFileGetCodeActions(file: BscFile, range: Range, diagnostics: BsDiagnostic[], codeActions: CodeAction[]) {
        if (isXmlFile(file)) {
            new XmlFileCodeActionsProcessor(file, range, diagnostics, codeActions).process();
        }
    }

    public onScopeGetCodeActions(scope: Scope, file: BscFile, range: Range, diagnostics: BsDiagnostic[], codeActions: CodeAction[]) {
        if (isBrsFile(file)) {
            new ScopeBrsFileCodeActionsProcessor(scope, file, range, diagnostics, codeActions).process();
        }
    }
}
