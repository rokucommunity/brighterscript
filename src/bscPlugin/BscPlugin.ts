import type { CodeAction, Range } from 'vscode-languageserver';
import { isXmlFile } from '../astUtils/reflection';
import type { BscFile, BsDiagnostic, CompilerPlugin } from '../interfaces';
import { XmlFileCodeActionsProcessor } from './codeActions/XmlFileCodeActionsProcessor';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onFileGetCodeActions(file: BscFile, range: Range, diagnostics: BsDiagnostic[], codeActions: CodeAction[]) {
        if (isXmlFile(file)) {
            new XmlFileCodeActionsProcessor(file, range, diagnostics, codeActions).process();
        }
    }
}
