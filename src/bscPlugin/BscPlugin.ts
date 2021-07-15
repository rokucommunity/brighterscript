import type { CompilerPlugin, OnGetCodeActionsEvent, OnGetSemanticTokensEvent } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { SemanticTokensProcessor } from './semanticTokens/SemanticTokensProcessor';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public onGetSemanticTokens(event: OnGetSemanticTokensEvent) {
        return new SemanticTokensProcessor(event).process();
    }
}
