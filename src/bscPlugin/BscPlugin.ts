import { isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { BeforeFileTranspileEvent, Plugin, OnFileValidateEvent, OnGetCodeActionsEvent, ProvideHoverEvent, OnGetSemanticTokensEvent, OnScopeValidateEvent, ProvideCompletionsEvent, ProvideDefinitionEvent, ProvideReferencesEvent, ProvideDocumentSymbolsEvent, ProvideWorkspaceSymbolsEvent } from '../interfaces';
import type { Program } from '../Program';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { CompletionsProcessor } from './completions/CompletionsProcessor';
import { DefinitionProvider } from './definition/DefinitionProvider';
import { DocumentSymbolProcessor } from './symbols/DocumentSymbolProcessor';
import { HoverProcessor } from './hover/HoverProcessor';
import { ReferencesProvider } from './references/ReferencesProvider';
import { BrsFileSemanticTokensProcessor } from './semanticTokens/BrsFileSemanticTokensProcessor';
import { BrsFilePreTranspileProcessor } from './transpile/BrsFilePreTranspileProcessor';
import { BrsFileValidator } from './validation/BrsFileValidator';
import { ProgramValidator } from './validation/ProgramValidator';
import { ScopeValidator } from './validation/ScopeValidator';
import { XmlFileValidator } from './validation/XmlFileValidator';
import { WorkspaceSymbolProcessor } from './symbols/WorkspaceSymbolProcessor';

export class BscPlugin implements Plugin {
    public name = 'BscPlugin';

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public provideHover(event: ProvideHoverEvent) {
        return new HoverProcessor(event).process();
    }

    public provideDocumentSymbols(event: ProvideDocumentSymbolsEvent) {
        return new DocumentSymbolProcessor(event).process();
    }

    public provideWorkspaceSymbols(event: ProvideWorkspaceSymbolsEvent) {
        return new WorkspaceSymbolProcessor(event).process();
    }

    public provideCompletions(event: ProvideCompletionsEvent) {
        new CompletionsProcessor(event).process();
    }

    public provideDefinition(event: ProvideDefinitionEvent) {
        new DefinitionProvider(event).process();
    }

    public provideReferences(event: ProvideReferencesEvent) {
        new ReferencesProvider(event).process();
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
