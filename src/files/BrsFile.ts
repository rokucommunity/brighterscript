import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import * as path from 'path';
import type { SerializedCodeFile } from '../interfaces';
import { ParseMode } from '../parser/Parser';
import type { Program } from '../Program';
import { standardizePath as s, util } from '../util';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { DependencyChangedEvent, DependencyGraph } from '../DependencyGraph';
import { WorkspaceSymbolProcessor } from '../bscPlugin/symbols/WorkspaceSymbolProcessor';
import type { BscSymbol } from '../SymbolTable';
import type { SymbolTypeFlag } from '../SymbolTypeFlag';
import { Editor } from '../astUtils/Editor';
import type { BscFile } from './BscFile';
import { BrsCode } from './BrsCode';
import type { BscCode } from './BscCode';

export interface ProvidedSymbol {
    symbol: BscSymbol;
    duplicates: BscSymbol[];
    requiredSymbolNames?: Set<string>;
}
export type ProvidedSymbolMap = Map<SymbolTypeFlag, Map<string, ProvidedSymbol>>;
export type ChangedSymbolMap = Map<SymbolTypeFlag, Set<string>>;

export interface ProvidedSymbolInfo {
    symbolMap: ProvidedSymbolMap;
    changes: ChangedSymbolMap;
}

/**
 * Holds all details about this file within the scope of the whole program
 */
export class BrsFile implements BscFile {
    constructor(options: {
        /**
         * The path to the file in its source location (where the source code lives in the file system)
         */
        srcPath: string;
        /**
         * The path to the file where it should exist in the program. This is similar to pkgPath, but retains its original file extensions from srcPath
         */
        destPath: string;
        /**
         * The final path in the zip. This has the extensions changed. Typically this is the same as destPath, but with file extensions changed for transpiled files.
         */
        pkgPath?: string;
        program: Program;
    }) {
        this.code = new BrsCode({
            document: this,
            program: options?.program,
            onParserRequested: () => this.parseSkippedCode()
        });
        if (options) {
            this.srcPath = s`${options.srcPath}`;
            this.destPath = s`${options.destPath}`;
            this.program = options.program;

            this.extension = util.getExtension(this.srcPath);
            if (options.pkgPath) {
                this.pkgPath = options.pkgPath;
            } else {
                //don't rename .d.bs files to .d.brs
                if (this.extension === '.d.bs') {
                    this.pkgPath = this.destPath;
                } else {
                    this.pkgPath = this.destPath.replace(/\.bs$/i, '.brs');
                }
            }

            //all BrighterScript files need to be transpiled
            if (this.extension?.endsWith('.bs') || this.program?.options?.allowBrighterScriptInBrightScript) {
                this.code.parseMode = ParseMode.BrighterScript;
            }
            this.isTypedef = this.extension === '.d.bs';
            if (!this.isTypedef) {
                this.typedefKey = util.getTypedefPath(this.srcPath);
            }

            //global file doesn't have a program, so only resolve typedef info if we have a program
            if (this.program) {
                this.resolveTypedef();
            }
        }
    }

    public type = 'BrsFile';

    public srcPath: string;
    public destPath: string;
    public pkgPath: string;

    public program: Program;

    /**
     * The BrightScript that makes up this file. Kept private so nothing outside the file assumes a file holds a
     * single piece of code; use `codes` instead.
     */
    private code: BrsCode;

    /**
     * Indicates whether this file has been validated. Set by the program during validation
     */
    public isValidated = false;

    /**
     * All of the code this file provides
     */
    public get codes(): readonly BscCode[] {
        return [this.code];
    }

    /**
     * An editor assigned during the build flow that manages edits that will be undone once the build process is complete.
     */
    public editor?: Editor;

    /**
     * Will this file result in only comment or whitespace output? If so, it can be excluded from the output if that bsconfig setting is enabled.
     */
    public get canBePruned() {
        let canPrune = true;
        this.code.ast.walk(createVisitor({
            FunctionStatement: () => {
                canPrune = false;
            },
            ClassStatement: () => {
                canPrune = false;
            }
        }), {
            walkMode: WalkMode.visitStatements
        });
        return canPrune;
    }

    /**
     * The key used to identify this file in the dependency graph. This is set by the BrighterScript program and should not be set by plugins
     */
    public dependencyGraphKey: string;

    /**
     * The all-lowercase extension for this file (including the leading dot)
     */
    public extension: string;


    /**
     * Does this file need to be transpiled?
     * @deprecated use the `.editor` property to push changes to the file, which will force transpilation
     */
    public get needsTranspiled() {
        if (this._needsTranspiled !== undefined) {
            return this._needsTranspiled;
        }
        return !!(this.extension?.endsWith('.bs') || this.program?.options?.allowBrighterScriptInBrightScript || this.editor?.hasChanges);
    }
    public set needsTranspiled(value) {
        this._needsTranspiled = value;
    }
    public _needsTranspiled: boolean;


    /**
     * Parse the code that was skipped during `parse()` because this file has a typedef.
     * Called when something asks for the parser anyway.
     */
    private parseSkippedCode() {
        //remove the typedef file (if it exists)
        this.hasTypedef = false;
        this.typedefFile = undefined;

        //parse the file (it should parse fully since there's no linked typedef
        this.parse(this.fileContents);

        //re-link the typedef (if it exists...which it should)
        this.resolveTypedef();
    }

    public fileContents: string;

    /**
     * If this is a typedef file
     */
    public isTypedef: boolean;

    /**
     * The key to find the typedef file in the program's files map.
     * A falsey value means this file is ineligable for a typedef
     */
    public typedefKey?: string;

    /**
     * If the file was given type definitions during parse
     */
    public hasTypedef;

    /**
     * A reference to the typedef file (if one exists)
     */
    public typedefFile?: BrsFile;

    /**
     * Find and set the typedef variables (if a matching typedef file exists)
     */
    private resolveTypedef() {
        this.typedefFile = this.program.getFile<BrsFile>(this.typedefKey);
        this.hasTypedef = !!this.typedefFile;
    }

    public onDependenciesChanged(event: DependencyChangedEvent) {
        this.resolveTypedef();
    }

    /**
     * Attach the file to the dependency graph so it can monitor changes.
     * Also notify the dependency graph of our current dependencies so other dependents can be notified.
     * @deprecated this does nothing. This functionality is now handled by the file api and will be deleted in v1
     */
    public attachDependencyGraph(dependencyGraph: DependencyGraph) { }

    /**
     * The list of files that this file depends on
     */
    public get dependencies() {
        const result = this.code.ownScriptImports.filter(x => !!x.destPath).map(x => x.destPath.toLowerCase());

        //if this is a .brs file, watch for typedef changes
        if (this.extension === '.brs') {
            result.push(
                util.getTypedefPath(this.destPath)
            );
        }
        return result;
    }

    /**
     * Calculate the AST for this file
     * @param fileContents the raw source code to parse
     */
    public parse(fileContents: string) {
        this.fileContents = fileContents;

        //if we have a typedef file, skip parsing this file
        if (this.hasTypedef) {
            //skip validation since the typedef is shadowing this file
            this.isValidated = true;
            this.code.isValidated = true;
            return;
        }
        this.code.parse(fileContents);
    }


    /**
     * Builds a list of workspace symbols for this file. Used by LanguageServer's onWorkspaceSymbol functionality
     */
    public getWorkspaceSymbols() {
        return new WorkspaceSymbolProcessor({
            program: this.program,
            workspaceSymbols: []
        }).process();
    }


    /**
     * Generate the code, map, and typedef for this file
     */
    public serialize(): SerializedCodeFile {
        const result: SerializedCodeFile = {};

        const transpiled = this.transpile();
        if (typeof transpiled.code === 'string') {
            result.code = transpiled.code;
        }
        if (transpiled.map) {
            result.map = transpiled.map.toString();
        }
        //generate the typedef (if this is not a typedef itself, and if enabled)
        if (!this.isTypedef && this.program.options.emitDefinitions) {
            result.typedef = this.getTypedef();
        }
        return result;
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        const state = new BrsTranspileState(this.code);
        state.editor = this.editor ?? new Editor();
        let transpileResult: SourceNode | undefined;

        if (this.needsTranspiled) {
            const astTranspile = this.code.ast.transpile(state);
            const trailingComments = [];
            if (util.hasLeadingComments(this.code.parser.eofToken)) {
                if (util.isLeadingCommentOnSameLine(this.code.ast.statements[this.code.ast.statements.length - 1]?.location, this.code.parser.eofToken)) {
                    trailingComments.push(' ');
                } else {
                    trailingComments.push('\n');
                }
                trailingComments.push(...state.transpileLeadingComments(this.code.parser.eofToken));
            }

            transpileResult = util.sourceNodeFromTranspileResult(null, null, state.srcPath, [...astTranspile, ...trailingComments]);
        } else if (this.program.options.sourceMap) {
            //emit code as-is with a simple map to the original file location
            transpileResult = util.simpleMap(state.srcPath, this.fileContents);
        } else {
            //simple SourceNode wrapping the entire file to simplify the logic below
            transpileResult = new SourceNode(null, null, state.srcPath, this.fileContents);
        }

        //if we created an editor for this flow, undo the edits now
        if (!this.editor) {
            //undo any AST edits that the transpile cycle has made
            state.editor.undoAll();
        }

        if (this.program.options.sourceMap) {
            util.stripTrailingSourceMappingURLComment(transpileResult);
            const stagingFileName = path.basename(state.srcPath).replace(/\.bs$/, '.brs');
            return new SourceNode(null, null, stagingFileName, [
                transpileResult,
                //add the sourcemap reference comment
                state.newline + `'//# sourceMappingURL=./${stagingFileName}.map`
            ]).toStringWithSourceMap({ file: stagingFileName });
        } else {
            return {
                code: transpileResult.toString(),
                map: undefined
            };
        }
    }


    public getTypedef() {
        const state = new BrsTranspileState(this.code);
        const typedef = this.code.ast.getTypedef(state);
        const programNode = util.sourceNodeFromTranspileResult(null, null, this.srcPath, typedef);
        return programNode.toString();
    }

    public dispose() {
        this.code?.dispose();

        //deleting these properties result in lower memory usage (garbage collection is magic!)
        delete this.fileContents;
    }
}
