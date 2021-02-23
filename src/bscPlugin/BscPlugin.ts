import { isXmlFile } from '../astUtils/reflection';
import type { CompilerPlugin, OnFileGetCodeActionsEvent } from '../interfaces';
import { XmlFileCodeActionsProcessor } from './codeActions/XmlFileCodeActionsProcessor';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onFileGetCodeActions({ file, range, diagnostics, codeActions }: OnFileGetCodeActionsEvent) {
        if (isXmlFile(file)) {
            new XmlFileCodeActionsProcessor(file, range, diagnostics, codeActions).process();
        }
    }
}
