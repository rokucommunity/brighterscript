import { isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { Plugin, AfterProvideCodeActionsEvent, AfterProvideHoverEvent, AfterProvideSemanticTokensEvent, AfterValidateScopeEvent, AfterProvideCompletionsEvent, AfterProvideDefinitionEvent, AfterProvideReferencesEvent, AfterProvideDocumentSymbolsEvent, AfterProvideWorkspaceSymbolsEvent, AfterProvideFileEvent, AfterValidateFileEvent, AfterValidateProgramEvent, AfterSerializeFileEvent, BeforeBuildProgramEvent, AfterPrepareFileEvent, AfterWriteFileEvent, AfterProvideSourceFixAllCodeActionsEvent, AfterProvideSelectionRangesEvent, AfterProvideInlayHintsEvent } from '../interfaces';
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
import type { BrsFile } from '../files/BrsFile';
import type { XmlFile } from '../files/XmlFile';
import { FileWriter } from './FileWriter';
import { FileProvider } from './fileProviders/FileProvider';
import { BslibManager } from './serialize/BslibManager';
import { FileSerializer } from './serialize/FileSerializer';
import { BrsFilePreTranspileProcessor } from './transpile/BrsFileTranspileProcessor';
import { XmlFilePreTranspileProcessor } from './transpile/XmlFilePreTranspileProcessor';
import { BrsFileAfterValidator } from './validation/BrsFileAfterValidator';
import { SelectionRangesProcessor } from './selectionRanges/SelectionRangesProcessor';
import { InlayHintProcessor } from './inlayHints/InlayHintProcessor';

/**
 * The built-in plugin. It is registered before every other plugin and does its work in the `after*` hooks,
 * so from a plugin author's point of view it is the last participant in each event's "during" phase.
 */
export class BscPlugin implements Plugin {
    public name = 'BscPlugin';

    public afterProvideFile(event: AfterProvideFileEvent) {
        new FileProvider(event).process();
    }

    public afterProvideCodeActions(event: AfterProvideCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public afterProvideSourceFixAllCodeActions(event: AfterProvideSourceFixAllCodeActionsEvent) {
        new FixAllCodeActionsProcessor(event).process();
    }

    public afterProvideHover(event: AfterProvideHoverEvent) {
        return new HoverProcessor(event).process();
    }

    public afterProvideDocumentSymbols(event: AfterProvideDocumentSymbolsEvent) {
        return new DocumentSymbolProcessor(event).process();
    }

    public afterProvideWorkspaceSymbols(event: AfterProvideWorkspaceSymbolsEvent) {
        return new WorkspaceSymbolProcessor(event).process();
    }

    public afterProvideCompletions(event: AfterProvideCompletionsEvent) {
        new CompletionsProcessor(event).process();
    }

    public afterProvideDefinition(event: AfterProvideDefinitionEvent) {
        new DefinitionProvider(event).process();
    }

    public afterProvideReferences(event: AfterProvideReferencesEvent) {
        new ReferencesProvider(event).process();
    }

    public afterProvideSelectionRanges(event: AfterProvideSelectionRangesEvent) {
        new SelectionRangesProcessor(event).process();
    }

    public afterProvideInlayHints(event: AfterProvideInlayHintsEvent) {
        new InlayHintProcessor(event).process();
    }

    public afterProvideSemanticTokens(event: AfterProvideSemanticTokensEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFileSemanticTokensProcessor(event as AfterProvideSemanticTokensEvent<BrsFile>).process();
        }
    }

    public afterValidateFile(event: AfterValidateFileEvent) {
        if (isBrsFile(event.file)) {
            new BrsFileValidator(event as AfterValidateFileEvent<BrsFile>).process();
            new BrsFileAfterValidator(event as AfterValidateFileEvent<BrsFile>).process();
        } else if (isXmlFile(event.file)) {
            new XmlFileValidator(event as AfterValidateFileEvent<XmlFile>).process();
        }
    }

    private scopeValidator = new ScopeValidator();

    public afterValidateScope(event: AfterValidateScopeEvent) {
        this.scopeValidator.processEvent(event);
    }

    public afterValidateProgram(event: AfterValidateProgramEvent) {
        new ProgramValidator(event).process();
        //release memory once the validation cycle has finished
        this.scopeValidator.reset();
    }

    /**
     * This is the one exception to the `after*` rule: bslib must be in the file list before files are prepared,
     * and `afterBuildProgram` fires after the build is finished.
     */
    public beforeBuildProgram(event: BeforeBuildProgramEvent) {
        this.bslibManager.addBslibFileIfMissing(event);
    }
    private bslibManager = new BslibManager();

    public afterPrepareFile(event: AfterPrepareFileEvent) {
        if (isBrsFile(event.file)) {
            return new BrsFilePreTranspileProcessor(event as AfterPrepareFileEvent<BrsFile>).process();
        } else if (isXmlFile(event.file)) {
            return new XmlFilePreTranspileProcessor(event as AfterPrepareFileEvent<XmlFile>).process();
        }
    }

    public async afterSerializeFile(event: AfterSerializeFileEvent) {
        await new FileSerializer(event).process();
    }

    public async afterWriteFile(event: AfterWriteFileEvent) {
        await new FileWriter(event).process();
    }

}
