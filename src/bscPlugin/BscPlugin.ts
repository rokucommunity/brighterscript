import { isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { BeforeFileTranspileEvent, CompilerPlugin, OnFileValidateEvent, OnGetCodeActionsEvent, ProvideHoverEvent, OnGetSemanticTokensEvent, OnScopeValidateEvent, ProvideCompletionsEvent, ProvideReferencesEvent } from '../interfaces';
import type { Program } from '../Program';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { CompletionsProcessor } from './completions/CompletionsProcessor';
import { HoverProcessor } from './hover/HoverProcessor';
import { ReferencesProcessor } from './references/ReferencesProcessor';
import { BrsFileSemanticTokensProcessor } from './semanticTokens/BrsFileSemanticTokensProcessor';
import { BrsFilePreTranspileProcessor } from './transpile/BrsFilePreTranspileProcessor';
import { BrsFileValidator } from './validation/BrsFileValidator';
import { ProgramValidator } from './validation/ProgramValidator';
import { ScopeValidator } from './validation/ScopeValidator';
import { XmlFileValidator } from './validation/XmlFileValidator';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public provideHover(event: ProvideHoverEvent) {
        return new HoverProcessor(event).process();
    }

    public provideCompletions(event: ProvideCompletionsEvent) {
        new CompletionsProcessor(event).process();
    }

    /**
     * Handle the "find all references" event
     */
    public provideReferences(event: ProvideReferencesEvent) {
        new ReferencesProcessor(event).process();
    }

    public onGetSemanticTokens(event: OnGetSemanticTokensEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileSemanticTokensProcessor(event as any).process();
        }
    }

    public onFileValidate(event: OnFileValidateEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileValidator(event as any).process();
        } else if (isXmlFile(event.file)) {
            return new XmlFileValidator(event as any).process();
        }
    }

    private scopeValidator = new ScopeValidator();

    public onScopeValidate(event: OnScopeValidateEvent) {
        this.scopeValidator.processEvent(event);
    }

    public afterProgramValidate(program: Program) {
        new ProgramValidator(program).process();
        //release memory once the validation cycle has finished
        this.scopeValidator.reset();
    }

    public beforeFileTranspile(event: BeforeFileTranspileEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFilePreTranspileProcessor(event as any).process();
        }
    }
}
