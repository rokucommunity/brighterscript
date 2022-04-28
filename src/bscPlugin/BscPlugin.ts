import { isBrsFile } from '../astUtils/reflection';
import type { BrsFile } from '../files/BrsFile';
import type { AfterProgramValidateEvent, BeforeFileTranspileEvent, CompilerPlugin, OnFileValidateEvent, OnGetCodeActionsEvent, OnGetSemanticTokensEvent, OnScopeValidateEvent } from '../interfaces';
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

    private scopeValidator = new ScopeValidator();

    public onScopeValidate(event: OnScopeValidateEvent) {
        this.scopeValidator.processEvent(event);
    }

    public afterProgramValidate(event: AfterProgramValidateEvent) {
        //release memory once the validation cycle has finished
        this.scopeValidator.reset();
    }

    public beforeFileTranspile(event: BeforeFileTranspileEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFilePreTranspileProcessor(event as any).process();
        }
    }
}
