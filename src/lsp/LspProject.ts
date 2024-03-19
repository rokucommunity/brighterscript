import type { Diagnostic, Position, Location, DocumentSymbol, SymbolInformation } from 'vscode-languageserver';
import type { Hover, MaybePromise, SemanticToken } from '../interfaces';
import type { BsConfig } from '../BsConfig';
import type { DocumentAction } from './DocumentManager';
import type { FileTranspileResult, SignatureInfoObj } from '../Program';

/**
 * Defines the contract between the ProjectManager and the main or worker thread Project classes
 */
export interface LspProject {

    /**
     * The path to where the project resides
     */
    projectPath: string;

    /**
     * A unique number for this project, generated during this current language server session. Mostly used so we can identify which project is doing logging
     */
    projectNumber: number;

    /**
     * Initialize and start running the project. This will scan for all files, and build a full project in memory, then validate the project
     * @param options
     */
    activate(options: ActivateOptions): MaybePromise<void>;

    /**
     * Get a promise that resolves when the project finishes activating
     */
    whenActivated(): Promise<void>;

    /**
     * Validate the project. This will trigger a full validation on any scopes that were changed since the last validation,
     * and will also eventually emit a new 'diagnostics' event that includes all diagnostics for the project
     */
    validate(): Promise<void>;

    /**
     * Cancel any active validation that's running
     */
    cancelValidate(): MaybePromise<void>;

    /**
     * Get the bsconfig options from the program. Should only be called after `.activate()` has completed.
     */
    getOptions(): MaybePromise<BsConfig>;

    /**
     * Get the list of all file paths that are currently loaded in the project
     */
    getFilePaths(): MaybePromise<string[]>;

    /**
     * Get the list of all diagnostics from this project
     */
    getDiagnostics(): MaybePromise<LspDiagnostic[]>;

    /**
     * Get the full list of semantic tokens for the given file path
     * @param srcPath absolute path to the source file
     */
    getSemanticTokens(srcPath: string): MaybePromise<SemanticToken[]>;

    /**
     * Transpile the specified file
     * @param srcPath
     */
    transpileFile(srcPath: string): MaybePromise<FileTranspileResult>;

    /**
     * Get the hover information for the specified position in the specified file
     */
    getHover(options: { srcPath: string; position: Position }): MaybePromise<Hover[]>;

    /**
     * Get the locations where the symbol at the specified position is defined
     * @param options the file path and position to get the definition for
     */
    getDefinition(options: { srcPath: string; position: Position }): MaybePromise<Location[]>;

    /**
     * Get the locations where the symbol at the specified position is defined
     * @param options the file path and position to get the definition for
     */
    getSignatureHelp(options: { srcPath: string; position: Position }): MaybePromise<SignatureInfoObj[]>;

    /**
     * Get the list of symbols for the specified file
     */
    getDocumentSymbol(options: { srcPath: string }): MaybePromise<DocumentSymbol[]>;

    /**
     * Get the list of symbols for the entire workspace
     */
    getWorkspaceSymbol(): Promise<SymbolInformation[]>;

    /**
     * Get the list of references for the specified file and position
     */
    getReferences(options: { srcPath: string; position: Position }): MaybePromise<Location[]>;

    /**
     * Does this project have the specified file. Should only be called after `.activate()` has completed.
     */
    hasFile(srcPath: string): MaybePromise<boolean>;

    /**
     * Apply a series of file changes to the program.
     * This will cancel any active validation.
     * @param documentActions
     * @returns a boolean indicating whether this project accepted any of the file changes. If false, then this project didn't recognize any of the files and thus did nothing
     */
    applyFileChanges(documentActions: DocumentAction[]): Promise<boolean>;

    /**
     * An event that is emitted anytime the diagnostics for the project have changed (typically after a validate cycle has finished)
     * @param eventName
     * @param handler
     */
    on(eventName: 'diagnostics', handler: (data: { diagnostics: LspDiagnostic[] }) => void);
    on(eventName: 'all', handler: (eventName: string, data: Record<string, any>) => void);

    /**
     * Release all resources so this file can be safely garbage collected
     */
    dispose(): void;
}

export interface ActivateOptions {
    /**
     * The path to where the project resides
     */
    projectPath: string;
    /**
     * The path to the workspace where this project resides. A workspace can have multiple projects (by adding a bsconfig.json to each folder).
     */
    workspaceFolder?: string;
    /**
     * Path to a bsconfig.json file that shall be used for this project
     */
    configFilePath?: string;
    /**
     * A unique number for this project, generated during this current language server session. Mostly used so we can identify which project is doing logging
     */
    projectNumber?: number;
}

export interface LspDiagnostic extends Diagnostic {
    uri: string;
}
