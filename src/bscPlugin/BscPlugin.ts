import type { CompilerPlugin, OnGetCodeActionsEvent, ProvideCompletionsEvent, OnGetSemanticTokensEvent } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { CompletionsProcessor } from './completions/CompletionsProcessor';
import { SemanticTokensProcessor } from './semanticTokens/SemanticTokensProcessor';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public onGetSemanticTokens(event: OnGetSemanticTokensEvent) {
        new SemanticTokensProcessor(event).process();
    }

    public provideCompletions(event: ProvideCompletionsEvent) {
        new CompletionsProcessor(event).process();
    }
}
