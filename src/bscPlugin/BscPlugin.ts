import { isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { BrsFile } from '../files/BrsFile';
import type { XmlFile } from '../files/XmlFile';
import type { AfterSerializeFileEvent, BeforeFileTranspileEvent, CompilerPlugin, OnFileValidateEvent, OnGetCodeActionsEvent, OnGetSemanticTokensEvent, OnScopeValidateEvent, ProvideCompletionsEvent, ProvideFileEvent, ProvideHoverEvent } from '../interfaces';
import type { Program } from '../Program';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { CompletionsProcessor } from './completions/CompletionsProcessor';
import { FileProvider } from './fileProviders/FileProvider';
import { FileSerializer } from './FileSerializer';
import { HoverProcessor } from './hover/HoverProcessor';
import { BrsFileSemanticTokensProcessor } from './semanticTokens/BrsFileSemanticTokensProcessor';
import { BrsFilePreTranspileProcessor } from './transpile/BrsFilePreTranspileProcessor';
import { BrsFileValidator } from './validation/BrsFileValidator';
import { ScopeValidator } from './validation/ScopeValidator';
import { XmlFileValidator } from './validation/XmlFileValidator';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public afterProvideFile(event: ProvideFileEvent) {
        new FileProvider(event).process();
    }

    public afterSerializeFile(event: AfterSerializeFileEvent) {
        new FileSerializer(event).process();
    }

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public provideHover(event: ProvideHoverEvent) {
        return new HoverProcessor(event).process();
    }

    public provideCompletions(event: ProvideCompletionsEvent) {
        new CompletionsProcessor(event).process();
    }

    public onGetSemanticTokens(event: OnGetSemanticTokensEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileSemanticTokensProcessor(event as any).process();
        }
    }

    public onFileValidate(event: OnFileValidateEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileValidator(event as OnFileValidateEvent<BrsFile>).process();
        } else if (isXmlFile(event.file)) {
            return new XmlFileValidator(event as OnFileValidateEvent<XmlFile>).process();
        }
    }

    private scopeValidator = new ScopeValidator();

    public onScopeValidate(event: OnScopeValidateEvent) {
        this.scopeValidator.processEvent(event);
    }

    public afterProgramValidate(program: Program) {
        //release memory once the validation cycle has finished
        this.scopeValidator.reset();
    }

    public beforeFileTranspile(event: BeforeFileTranspileEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFilePreTranspileProcessor(event as any).process();
        }
    }
}
