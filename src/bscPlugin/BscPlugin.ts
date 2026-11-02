import { isBrsCodeSegment, isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { Plugin, AfterProvideCodeActionsEvent, AfterProvideHoverEvent, AfterProvideSemanticTokensEvent, ValidateScopeEvent, AfterProvideCompletionsEvent, AfterProvideDefinitionEvent, AfterProvideReferencesEvent, AfterProvideDocumentSymbolsEvent, AfterProvideWorkspaceSymbolsEvent, AfterProvideFileEvent, AfterValidateFileEvent, AfterValidateProgramEvent, AfterSerializeFileEvent, BeforeBuildProgramEvent, AfterPrepareFileEvent, AfterPrepareBrsCodeSegmentEvent, AfterWriteFileEvent, AfterProvideSourceFixAllCodeActionsEvent, AfterProvideSelectionRangesEvent, AfterProvideInlayHintsEvent } from '../interfaces';
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
        if (isBrsCodeSegment(event.codeSegment)) {
            return new BrsFileSemanticTokensProcessor(event).process();
        }
    }

    /**
     * Validates the file and each of its code segments, then finishes processing the symbols of all of the file's code segments together.
     * This runs after every plugin's `validateFile` and `validateBrsCodeSegment`, and before any `afterValidateBrsCodeSegment`
     */
    public afterValidateFile(event: AfterValidateFileEvent) {
        if (isBrsFile(event.file) || isXmlFile(event.file)) {
            util.validateTooDeepFile(event.file);
        }
        if (isXmlFile(event.file)) {
            new XmlFileValidator(event as AfterValidateFileEvent<XmlFile>).process();
        }
        const codeSegments = util.getCodeSegments(event.file);
        if (!codeSegments) {
            return;
        }
        for (const codeSegment of codeSegments) {
            new BrsFileValidator({ program: event.program, file: event.file, codeSegment: codeSegment }).process();
        }
        new BrsFileAfterValidator(event).process();
    }

    private scopeValidator = new ScopeValidator();

    /**
     * Uses `validateScope` instead of `afterValidateScope` because the scope's symbol tables are only linked during `validateScope`
     */
    public validateScope(event: ValidateScopeEvent) {
        this.scopeValidator.processEvent(event);
    }

    public afterValidateProgram(event: AfterValidateProgramEvent) {
        new ProgramValidator(event).process();
        //release memory once the validation cycle has finished
        this.scopeValidator.reset();
    }

    /**
     * Uses `beforeBuildProgram` because bslib must be in the file list before files are prepared
     */
    public beforeBuildProgram(event: BeforeBuildProgramEvent) {
        this.bslibManager.addBslibFileIfMissing(event);
    }
    private bslibManager = new BslibManager();

    public afterPrepareFile(event: AfterPrepareFileEvent) {
        //the BrightScript in a file is prepared in `afterPrepareBrsCodeSegment`
        if (isXmlFile(event.file)) {
            return new XmlFilePreTranspileProcessor(event as AfterPrepareFileEvent<XmlFile>).process();
        }
    }

    public afterPrepareBrsCodeSegment(event: AfterPrepareBrsCodeSegmentEvent) {
        return new BrsFilePreTranspileProcessor(event).process();
    }

    public async afterSerializeFile(event: AfterSerializeFileEvent) {
        await new FileSerializer(event).process();
    }

    public async afterWriteFile(event: AfterWriteFileEvent) {
        await new FileWriter(event).process();
    }

}
