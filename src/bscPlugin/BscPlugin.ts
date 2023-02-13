import { isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { BrsFile } from '../files/BrsFile';
import type { XmlFile } from '../files/XmlFile';
import type { AfterPrepareFileEvent, AfterSerializeFileEvent, BeforeBuildProgramEvent, CompilerPlugin, OnFileValidateEvent, OnGetCodeActionsEvent, OnGetSemanticTokensEvent, OnScopeValidateEvent, ProvideCompletionsEvent, ProvideFileEvent, ProvideHoverEvent, WriteFileEvent } from '../interfaces';
import type { Program } from '../Program';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { CompletionsProcessor } from './completions/CompletionsProcessor';
import { FileProvider } from './fileProviders/FileProvider';
import { FileSerializer } from './serialize/FileSerializer';
import { FileWriter } from './FileWriter';
import { HoverProcessor } from './hover/HoverProcessor';
import { BrsFileSemanticTokensProcessor } from './semanticTokens/BrsFileSemanticTokensProcessor';
import { BrsFilePreTranspileProcessor as BrsFileTranspileProcessor } from './transpile/BrsFileTranspileProcessor';
import { BrsFileValidator } from './validation/BrsFileValidator';
import { ProgramValidator } from './validation/ProgramValidator';
import { ScopeValidator } from './validation/ScopeValidator';
import { XmlFileValidator } from './validation/XmlFileValidator';
import { BslibManager } from './serialize/BslibManager';

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
        new ProgramValidator(program).process();
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
    public afterPrepareFile(event: AfterPrepareFileEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileTranspileProcessor(event as any).process();
        }
    }

    public afterSerializeFile(event: AfterSerializeFileEvent) {
        new FileSerializer(event).process();
    }

    public async writeFile(event: WriteFileEvent) {
        await new FileWriter(event).process();
    }

}
