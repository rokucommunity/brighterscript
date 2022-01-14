import { isBrsFile } from '../astUtils/reflection';
import type { BrsFile } from '../files/BrsFile';
import type { CompilerPlugin, OnFileValidateEvent, OnGetCodeActionsEvent, OnGetSemanticTokensEvent } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { SemanticTokensProcessor } from './semanticTokens/SemanticTokensProcessor';
import { BrsFileValidator } from './validation/BrsFileValidator';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public onGetSemanticTokens(event: OnGetSemanticTokensEvent) {
        return new SemanticTokensProcessor(event).process();
    }

    public onFileValidate(event: OnFileValidateEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileValidator(event as OnFileValidateEvent<BrsFile>).process();
        }
    }
}
