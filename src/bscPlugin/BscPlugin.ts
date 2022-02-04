import { isBrsFile } from '../astUtils/reflection';
import type { BrsFile } from '../files/BrsFile';
import type { BeforeFileTranspileEvent, CompilerPlugin, OnFileValidateEvent, OnGetCodeActionsEvent, OnGetSemanticTokensEvent, OnScopeValidateEvent } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { BrsFileSemanticTokensProcessor } from './semanticTokens/BrsFileSemanticTokensProcessor';
import { BrsFilePreTranspileProcessor } from './transpile/BrsFilePreTranspileProcessor';
import { BrsFileValidator } from './validation/BrsFileValidator';
import { ScopeValidator } from './validation/ScopeValidator';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public onGetSemanticTokens(event: OnGetSemanticTokensEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileSemanticTokensProcessor(event as any).process();
        }
    }

    public onFileValidate(event: OnFileValidateEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileValidator(event as OnFileValidateEvent<BrsFile>).process();
        }
    }

    public onScopeValidate(event: OnScopeValidateEvent) {
        return new ScopeValidator(event).process();
    }

    public beforeFileTranspile(event: BeforeFileTranspileEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFilePreTranspileProcessor(event as any).process();
        }
    }
}
