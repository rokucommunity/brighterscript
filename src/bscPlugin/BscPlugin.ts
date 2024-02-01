import { isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { CompilerPlugin, OnFileValidateEvent, OnGetCodeActionsEvent, ProvideHoverEvent, OnGetSemanticTokensEvent, OnScopeValidateEvent, ProvideCompletionsEvent, ProvideDefinitionEvent, AfterProgramValidateEvent, AfterSerializeFileEvent, BeforeBuildProgramEvent, OnPrepareFileEvent, ProvideFileEvent, WriteFileEvent } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { CompletionsProcessor } from './completions/CompletionsProcessor';
import { DefinitionProvider } from './definition/DefinitionProvider';
import { HoverProcessor } from './hover/HoverProcessor';
import { BrsFileSemanticTokensProcessor } from './semanticTokens/BrsFileSemanticTokensProcessor';
import { BrsFileValidator } from './validation/BrsFileValidator';
import { ProgramValidator } from './validation/ProgramValidator';
import { ScopeValidator } from './validation/ScopeValidator';
import { XmlFileValidator } from './validation/XmlFileValidator';
import { BslibManager } from './serialize/BslibManager';
import { BrsFilePreTranspileProcessor } from './transpile/BrsFileTranspileProcessor';
import { XmlFilePreTranspileProcessor } from './transpile/XmlFilePreTranspileProcessor';
import type { BrsFile } from '../files/BrsFile';
import type { XmlFile } from '../files/XmlFile';
import { FileWriter } from './FileWriter';
import { FileProvider } from './fileProviders/FileProvider';
import { FileSerializer } from './serialize/FileSerializer';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public afterProvideFile(event: ProvideFileEvent) {
        new FileProvider(event).process();
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

    public provideDefinition(event: ProvideDefinitionEvent) {
        new DefinitionProvider(event).process();
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

    public afterProgramValidate(event: AfterProgramValidateEvent) {
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
