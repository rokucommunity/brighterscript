import type { CompletionItem, Diagnostic, Position } from 'vscode-languageserver';
import { SemanticToken } from '..';

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
     * Get the list of all diagnostics from this project
     */
    getDiagnostics(): MaybePromise<LspDiagnostic[]>;

    /**
     * Get the full list of semantic tokens for the given file path
     * @param srcPath absolute path to the source file
     */
    getSemanticTokens(srcPath: string): MaybePromise<SemanticToken[]>;

    /**
     * Does this project have the specified filie
     */
    hasFile(srcPath: string): MaybePromise<boolean>;

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

type MaybePromise<T> = T | Promise<T>;
