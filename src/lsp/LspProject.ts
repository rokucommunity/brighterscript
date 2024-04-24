import type { Diagnostic, Position, Range, Location, DocumentSymbol, WorkspaceSymbol, CodeAction, CompletionList } from 'vscode-languageserver-protocol';
import type { Hover, MaybePromise, SemanticToken } from '../interfaces';
import type { DocumentAction, DocumentActionWithStatus } from './DocumentManager';
import type { FileTranspileResult, SignatureInfoObj } from '../Program';
import type { Logger, LogLevel } from '../logging';

/**
 * Defines the contract between the ProjectManager and the main or worker thread Project classes
 */
export interface LspProject {

    /**
     * A logger instance used for logging in this project
     */
    logger: Logger;

    /**
     * The config used to activate this project
     */
    activateOptions: ProjectConfig;

    /**
     * The path to where the project resides
     */
    projectPath: string;

    /**
     * A unique number for this project, generated during this current language server session. Mostly used so we can identify which project is doing logging
     */
    projectNumber: number;

    /**
     * The root directory of the project.
     * Only available after `.activate()` has completed
     */
    rootDir: string;

    /**
     * The file patterns from bsconfig.json that were used to find all files for this project
     */
    filePatterns: string[];

    /**
     * Path to a bsconfig.json file that will be used for this project.
     * Only available after `.activate()` has completed
     */
    bsconfigPath?: string;

    /**
     * Initialize and start running the project. This will scan for all files, and build a full project in memory, then validate the project
     * @param options
     */
    activate(options: ProjectConfig): MaybePromise<ActivateResponse>;

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
     * Get the list of all diagnostics from this project
     */
    getDiagnostics(): MaybePromise<LspDiagnostic[]>;

    /**
     * Get the full list of semantic tokens for the given file path
     * @param srcPath absolute path to the source file
     */
    getSemanticTokens(options: { srcPath: string }): MaybePromise<SemanticToken[]>;

    /**
     * Transpile the specified file
     * @param srcPath
     */
    transpileFile(options: { srcPath: string }): MaybePromise<FileTranspileResult>;

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
    getWorkspaceSymbol(): Promise<WorkspaceSymbol[]>;

    /**
     * Get the list of references for the specified file and position
     */
    getReferences(options: { srcPath: string; position: Position }): MaybePromise<Location[]>;

    /**
     * Get all of the code actions for the specified file and range
     */
    getCodeActions(options: { srcPath: string; range: Range }): Promise<CodeAction[]>;

    /**
     * Get the completions for the specified file and position
     */
    getCompletions(options: { srcPath: string; position: Position }): Promise<CompletionList>;

    /**
     * Apply a series of file changes to the program.
     * This will cancel any active validation.
     * @param documentActions
     * @returns a boolean indicating whether this project accepted any of the file changes. If false, then this project didn't recognize any of the files and thus did nothing
     */
    applyFileChanges(documentActions: DocumentAction[]): Promise<DocumentActionWithStatus[]>;

    /**
     * An event that is emitted anytime the diagnostics for the project have changed (typically after a validate cycle has finished)
     * @param eventName
     * @param handler
     */
    on(eventName: 'diagnostics', handler: (data: { diagnostics: LspDiagnostic[] }) => void);
    on(eventName: 'all', handler: (eventName: string, data: Record<string, any>) => void);

    /**
     * List of items to dispose when this project is disposed
     */
    disposables: Array<{ dispose(): void }>;

    /**
     * Release all resources so this file can be safely garbage collected
     */
    dispose(): void;
}


export interface ProjectConfig {
    /**
     * Path to the project
     */
    projectPath: string;
    /**
     * Path to the workspace in which all project files reside or are referenced by
     */
    workspaceFolder: string;
    /**
     * A list of glob patterns used to _exclude_ files from various bsconfig searches
     */
    excludePatterns?: string[];
    /**
     * An optional project number to assign to the project within the context of a language server. reloaded projects should keep the same number if possible
     */
    projectNumber?: number;
    /**
     * Path to a bsconfig that should be used instead of the auto-discovery algorithm. If this is present, no bsconfig discovery should be used. and an error should be emitted if this file is missing
     */
    bsconfigPath?: string;
    /**
     * Should this project run in its own dedicated worker thread
     * TODO - is there a better name for this?
     */
    enableThreading?: boolean;
    /**
     * If present, this will override any files array found in bsconfig or the default.
     *
     * The list of file globs used to find all files for the project
     * If using the {src;dest;} format, you can specify a different destination directory
     * for the matched files in src.
     *
     */
    files?: Array<string | { src: string | string[]; dest?: string }>;
}


export interface LspDiagnostic extends Diagnostic {
    uri: string;
}

export interface ActivateResponse {
    /**
     * The root directory of the project
     */
    rootDir: string;
    /**
     * The path to the config file (i.e. `bsconfig.json`) that was used to load this project
     */
    bsconfigPath: string;
    /**
     * The file patterns from bsconfig.json that were used to find all files for this project
     */
    filePatterns: string[];
    /**
     * The logLevel used for this project's logger
     */
    logLevel: LogLevel;
}
