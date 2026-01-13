import { isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { Plugin, ValidateFileEvent, ProvideCodeActionsEvent, ProvideHoverEvent, ProvideSemanticTokensEvent, ValidateScopeEvent, ProvideCompletionsEvent, ProvideDefinitionEvent, ProvideReferencesEvent, ProvideDocumentSymbolsEvent, ProvideWorkspaceSymbolsEvent, AfterProvideFileEvent, AfterValidateFileEvent, AfterValidateProgramEvent, AfterSerializeFileEvent, BeforeBuildProgramEvent, OnPrepareFileEvent, WriteFileEvent } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { CompletionsProcessor } from './completions/CompletionsProcessor';
import { DefinitionProvider } from './definition/DefinitionProvider';
import { DocumentSymbolProcessor } from './symbols/DocumentSymbolProcessor';
import { HoverProcessor } from './hover/HoverProcessor';
import { ReferencesProvider } from './references/ReferencesProvider';
import { BrsFileSemanticTokensProcessor } from './semanticTokens/BrsFileSemanticTokensProcessor';
import { BrsFileValidator } from './validation/BrsFileValidator';
import { ProgramValidator } from './validation/ProgramValidator';
import { ScopeValidator } from './validation/ScopeValidator';
import { XmlFileValidator } from './validation/XmlFileValidator';
import { WorkspaceSymbolProcessor } from './symbols/WorkspaceSymbolProcessor';
import type { BrsFile } from '../files/BrsFile';
import type { XmlFile } from '../files/XmlFile';
import { FileWriter } from './FileWriter';
import { FileProvider } from './fileProviders/FileProvider';
import { BslibManager } from './serialize/BslibManager';
import { FileSerializer } from './serialize/FileSerializer';
import { BrsFilePreTranspileProcessor } from './transpile/BrsFileTranspileProcessor';
import { XmlFilePreTranspileProcessor } from './transpile/XmlFilePreTranspileProcessor';
import { BrsFileAfterValidator } from './validation/BrsFileAfterValidator';

export class BscPlugin implements Plugin {
    public name = 'BscPlugin';

    public afterProvideFile(event: AfterProvideFileEvent) {
        new FileProvider(event).process();
    }

    public provideCodeActions(event: ProvideCodeActionsEvent) {
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

    public provideSemanticTokens(event: ProvideSemanticTokensEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileSemanticTokensProcessor(event as any).process();
        }
    }

    public validateFile(event: ValidateFileEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileValidator(event as ValidateFileEvent<BrsFile>).process();
        } else if (isXmlFile(event.file)) {
            return new XmlFileValidator(event as ValidateFileEvent<XmlFile>).process();
        }
    }

    public afterValidateFile(event: AfterValidateFileEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileAfterValidator(event as AfterValidateFileEvent<BrsFile>).process();
        }
    }

    private scopeValidator = new ScopeValidator();

    public validateScope(event: ValidateScopeEvent) {
        this.scopeValidator.processEvent(event);
    }

    public afterValidateProgram(event: AfterValidateProgramEvent) {
        new ProgramValidator(event).process();
        //release memory once the validation cycle has finished
        this.scopeValidator.reset();
    }

    public beforeBuildProgram(event: BeforeBuildProgramEvent) {
        this.bslibManager.addBslibFileIfMissing(event);
    }
    private bslibManager = new BslibManager();

    /**
     * Do transpiling-related work after all plugins had a chance to operate on the files
     */
    public prepareFile(event: OnPrepareFileEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFilePreTranspileProcessor(event as OnPrepareFileEvent<BrsFile>).process();
        } else if (isXmlFile(event.file)) {
            return new XmlFilePreTranspileProcessor(event as OnPrepareFileEvent<XmlFile>).process();
        }
    }

    public afterSerializeFile(event: AfterSerializeFileEvent) {
        new FileSerializer(event).process();
    }

    public async writeFile(event: WriteFileEvent) {
        await new FileWriter(event).process();
    }

}
