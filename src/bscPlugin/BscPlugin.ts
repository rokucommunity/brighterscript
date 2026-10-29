import { isBrsCodeSegment, isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { Plugin, ValidateFileEvent, ProvideCodeActionsEvent, ProvideHoverEvent, ProvideSemanticTokensEvent, ValidateScopeEvent, ProvideCompletionsEvent, ProvideDefinitionEvent, ProvideReferencesEvent, ProvideDocumentSymbolsEvent, ProvideWorkspaceSymbolsEvent, AfterProvideFileEvent, ValidateBrsCodeSegmentEvent, AfterValidateFileEvent, AfterValidateProgramEvent, AfterSerializeFileEvent, BeforeBuildProgramEvent, PrepareFileEvent, PrepareBrsCodeSegmentEvent, WriteFileEvent, ProvideSourceFixAllCodeActionsEvent, ProvideSelectionRangesEvent, ProvideInlayHintsEvent } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { FixAllCodeActionsProcessor } from './codeActions/FixAllCodeActionsProcessor';
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
import type { XmlFile } from '../files/XmlFile';
import util from '../util';
import { FileWriter } from './FileWriter';
import { FileProvider } from './fileProviders/FileProvider';
import { BslibManager } from './serialize/BslibManager';
import { FileSerializer } from './serialize/FileSerializer';
import { BrsFilePreTranspileProcessor } from './transpile/BrsFileTranspileProcessor';
import { XmlFilePreTranspileProcessor } from './transpile/XmlFilePreTranspileProcessor';
import { BrsFileAfterValidator } from './validation/BrsFileAfterValidator';
import { SelectionRangesProcessor } from './selectionRanges/SelectionRangesProcessor';
import { InlayHintProcessor } from './inlayHints/InlayHintProcessor';

export class BscPlugin implements Plugin {
    public name = 'BscPlugin';

    public afterProvideFile(event: AfterProvideFileEvent) {
        new FileProvider(event).process();
    }

    public provideCodeActions(event: ProvideCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public provideSourceFixAllCodeActions(event: ProvideSourceFixAllCodeActionsEvent) {
        new FixAllCodeActionsProcessor(event).process();
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

    public provideSelectionRanges(event: ProvideSelectionRangesEvent) {
        new SelectionRangesProcessor(event).process();
    }

    public provideInlayHints(event: ProvideInlayHintsEvent) {
        new InlayHintProcessor(event).process();
    }

    public provideSemanticTokens(event: ProvideSemanticTokensEvent) {
        if (isBrsCodeSegment(event.codeSegment)) {
            return new BrsFileSemanticTokensProcessor(event).process();
        }
    }

    public validateFile(event: ValidateFileEvent) {
        if (isBrsFile(event.file) || isXmlFile(event.file)) {
            util.validateTooDeepFile(event.file);
        }
        //the BrightScript in a file is validated in `validateBrsCodeSegment`
        if (isXmlFile(event.file)) {
            return new XmlFileValidator(event as ValidateFileEvent<XmlFile>).process();
        }
    }

    public validateBrsCodeSegment(event: ValidateBrsCodeSegmentEvent) {
        return new BrsFileValidator(event).process();
    }

    public afterValidateFile(event: AfterValidateFileEvent) {
        //finish processing the symbols of all of the file's code segments together
        return new BrsFileAfterValidator(event).process();
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
    public prepareFile(event: PrepareFileEvent) {
        //the BrightScript in a file is prepared in `prepareBrsCodeSegment`
        if (isXmlFile(event.file)) {
            return new XmlFilePreTranspileProcessor(event as PrepareFileEvent<XmlFile>).process();
        }
    }

    public prepareBrsCodeSegment(event: PrepareBrsCodeSegmentEvent) {
        return new BrsFilePreTranspileProcessor(event).process();
    }

    public async afterSerializeFile(event: AfterSerializeFileEvent) {
        await new FileSerializer(event).process();
    }

    public async writeFile(event: WriteFileEvent) {
        await new FileWriter(event).process();
    }

}
