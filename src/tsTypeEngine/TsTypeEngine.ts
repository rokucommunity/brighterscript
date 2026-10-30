//prototype: typescript is only a devDependency today. It would have to move to dependencies if this engine ships
// eslint-disable-next-line import/no-extraneous-dependencies
import * as ts from 'typescript';
import type { Program } from '../Program';
import type { Scope } from '../Scope';
import type { BrsFile } from '../files/BrsFile';
import type { BsDiagnostic } from '../interfaces';
import { isBrsFile } from '../astUtils/reflection';
import { DiagnosticSeverity } from 'vscode-languageserver-protocol';
import { util } from '../util';
import type { EmitResult, SourceMapping } from './TsEmitter';
import { TsEmitter } from './TsEmitter';
import { getPrelude, PRELUDE_PATH } from './Prelude';

/**
 * TypeScript diagnostics that don't make sense for the generated code
 */
const ignoredDiagnosticCodes = new Set([
    //"implicitly has an 'any' type" (7005, 7006, 7008, 7031, 7034, ...). Untyped BrightScript is dynamic on purpose
    ...Array.from({ length: 100 }, (_, i) => 7000 + i),
    //"'this' implicitly has type 'any'"
    2683,
    //"Not all code paths return a value" style diagnostics are BrightScript's business, not the type checker's
    2366,
    //unreachable code / unused labels
    7027, 7028,
    //"Duplicate function implementation": the built-in validator already reports duplicate functions with better messages
    2393
]);

export const TS_DIAGNOSTIC_SOURCE = 'bsc-ts';

interface EmittedFile {
    file: BrsFile;
    /**
     * The AST the emit was produced from. When the file is re-parsed this changes, which invalidates the emit
     */
    ast: object;
    version: number;
    emit: EmitResult;
}

interface ScopeService {
    /**
     * Created lazily, only needed for editor features like hovers
     */
    service?: ts.LanguageService;
    /**
     * Used for diagnostics: it remembers each file's diagnostics and only re-checks the files an edit could have affected
     */
    builder?: ts.SemanticDiagnosticsBuilderProgram;
    fileNames: string[];
}

/**
 * Type-checks a Program by lowering every BrsFile to TypeScript and running each Scope through its own
 * TypeScript LanguageService. The per-file emit is scope-independent, so it's cached per file and the
 * parsed TypeScript SourceFiles are shared between scopes through a single DocumentRegistry.
 */
export class TsTypeEngine {
    constructor(
        private program: Program
    ) { }

    private compilerOptions: ts.CompilerOptions = {
        noLib: true,
        noResolve: true,
        noEmit: true,
        target: ts.ScriptTarget.ES5,
        strict: true,
        alwaysStrict: false,
        noImplicitAny: true,
        noImplicitThis: false,
        noImplicitOverride: true,
        useUnknownInCatchVariables: false,
        strictPropertyInitialization: false,
        types: []
    };

    private documentRegistry = ts.createDocumentRegistry(true);

    private emittedFiles = new Map<string, EmittedFile>();

    private scopeServices = new Map<string, ScopeService>();

    private versionCounter = 0;

    private getVirtualPath(file: BrsFile) {
        return '/bsc/' + util.standardizePath(file.destPath).replace(/\\/g, '/').replace(/^\/+/, '') + '.ts';
    }

    /**
     * Get the (cached) TypeScript for a file, re-emitting it only when its AST changed
     */
    public getEmittedFile(file: BrsFile): EmittedFile {
        const virtualPath = this.getVirtualPath(file);
        let emitted = this.emittedFiles.get(virtualPath);
        if (!emitted || emitted.ast !== file.ast || emitted.file !== file) {
            emitted = {
                file: file,
                ast: file.ast,
                version: ++this.versionCounter,
                emit: new TsEmitter(file).emit()
            };
            this.emittedFiles.set(virtualPath, emitted);
        }
        return emitted;
    }

    private getScopeService(scope: Scope): ScopeService {
        const files = scope.getAllFiles().filter(x => isBrsFile(x)) as BrsFile[];
        const fileNames = [PRELUDE_PATH, ...files.map(x => this.getVirtualPath(x))];
        for (const file of files) {
            this.getEmittedFile(file);
        }

        let scopeService = this.scopeServices.get(scope.name);
        if (scopeService) {
            //the language service pulls file names and versions from the host on every request, so just update the list
            scopeService.fileNames = fileNames;
        } else {
            scopeService = { fileNames: fileNames };
            this.scopeServices.set(scope.name, scopeService);
        }
        return scopeService;
    }

    private getLanguageService(scopeService: ScopeService) {
        if (scopeService.service) {
            return scopeService.service;
        }
        const host: ts.LanguageServiceHost = {
            getCompilationSettings: () => this.compilerOptions,
            getScriptFileNames: () => scopeService.fileNames,
            getScriptVersion: (fileName) => {
                return fileName === PRELUDE_PATH ? '0' : String(this.emittedFiles.get(fileName)?.version ?? 0);
            },
            getScriptSnapshot: (fileName) => {
                const text = fileName === PRELUDE_PATH ? getPrelude() : this.emittedFiles.get(fileName)?.emit.text;
                return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
            },
            getCurrentDirectory: () => '/bsc',
            getDefaultLibFileName: () => PRELUDE_PATH,
            fileExists: (fileName) => fileName === PRELUDE_PATH || this.emittedFiles.has(fileName),
            readFile: (fileName) => (fileName === PRELUDE_PATH ? getPrelude() : this.emittedFiles.get(fileName)?.emit.text)
        };
        scopeService.service = ts.createLanguageService(host, this.documentRegistry);
        return scopeService.service;
    }

    /**
     * Parsed TypeScript files, shared by every scope's program
     */
    private sourceFiles = new Map<string, { version: number; sourceFile: ts.SourceFile }>();

    private getSourceFile(fileName: string): ts.SourceFile {
        const isPrelude = fileName === PRELUDE_PATH;
        const version = isPrelude ? 0 : this.emittedFiles.get(fileName)?.version;
        if (version === undefined) {
            return undefined;
        }
        let cached = this.sourceFiles.get(fileName);
        if (cached?.version !== version) {
            const text = isPrelude ? getPrelude() : this.emittedFiles.get(fileName).emit.text;
            const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES5, false);
            //the builder uses this to tell which files changed since the previous program
            (sourceFile as any).version = String(version);
            cached = { version: version, sourceFile: sourceFile };
            this.sourceFiles.set(fileName, cached);
        }
        return cached.sourceFile;
    }

    private compilerHost: ts.CompilerHost = {
        getSourceFile: (fileName) => this.getSourceFile(fileName),
        getDefaultLibFileName: () => PRELUDE_PATH,
        writeFile: () => { },
        getCurrentDirectory: () => '/bsc',
        getCanonicalFileName: (fileName) => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (fileName) => fileName === PRELUDE_PATH || this.emittedFiles.has(fileName),
        readFile: (fileName) => (fileName === PRELUDE_PATH ? getPrelude() : this.emittedFiles.get(fileName)?.emit.text)
    };

    private getBuilder(scopeService: ScopeService) {
        const builder = ts.createSemanticDiagnosticsBuilderProgram(scopeService.fileNames, this.compilerOptions, this.compilerHost, scopeService.builder);
        //re-check just the files affected by what changed since the previous program. Everything else keeps its cached diagnostics
        while (builder.getSemanticDiagnosticsOfNextAffectedFile()) { }
        scopeService.builder = builder;
        return builder;
    }

    /**
     * Find the innermost generated span containing the TypeScript diagnostic, and return the BrighterScript span it came from
     */
    private mapToSource(mappings: SourceMapping[], start: number, length: number): SourceMapping {
        const end = start + length;
        let best: SourceMapping;
        for (const mapping of mappings) {
            if (mapping.genStart > start) {
                break;
            }
            if (mapping.genStart <= start && mapping.genEnd >= end) {
                if (!best || (mapping.genEnd - mapping.genStart) <= (best.genEnd - best.genStart)) {
                    best = mapping;
                }
            }
        }
        return best;
    }

    /**
     * Rewrite a TypeScript message into BrightScript terms: restore the declared casing of names and use BrightScript type names
     */
    private rewriteMessage(message: string, names: Map<string, string>) {
        return message
            .replace(/\$aa\(\{.*?\}\)/g, 'associative array')
            .replace(/'([^']*)'/g, (match, quoted: string) => {
                const rewritten = quoted
                    //leave string literal types (eg. '"up"') alone
                    .replace(/"(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*/g, (word) => {
                        if (word.startsWith('"')) {
                            return word;
                        }
                        if (word === 'null') {
                            return 'invalid';
                        } else if (word === 'any') {
                            return 'dynamic';
                        } else if (word === 'Function') {
                            return 'function';
                        }
                        return names.get(word) ?? word;
                    })
                    .replace(/ \| /g, ' or ')
                    .replace(/ & roassociativearray/g, '');
                return `'${rewritten}'`;
            });
    }

    /**
     * Type-check a single scope
     */
    public getScopeDiagnostics(scope: Scope): BsDiagnostic[] {
        return this.checkScope(scope).map(x => x.diagnostic);
    }

    private checkScope(scope: Scope): Array<{ fileName: string; diagnostic: BsDiagnostic }> {
        const scopeService = this.getScopeService(scope);
        const fileNames = scopeService.fileNames;
        const builder = this.getBuilder(scopeService);
        //all names declared anywhere in the scope, so messages about one file can mention names from another
        const names = new Map<string, string>();
        for (const fileName of fileNames) {
            for (const [key, value] of this.emittedFiles.get(fileName)?.emit.names ?? []) {
                if (!names.has(key)) {
                    names.set(key, value);
                }
            }
        }
        const diagnostics: Array<{ fileName: string; diagnostic: BsDiagnostic }> = [];
        for (const fileName of fileNames) {
            const emitted = this.emittedFiles.get(fileName);
            if (!emitted) {
                continue;
            }
            for (const tsDiagnostic of builder.getSemanticDiagnostics(builder.getSourceFile(fileName))) {
                if (ignoredDiagnosticCodes.has(tsDiagnostic.code) || tsDiagnostic.start === undefined) {
                    continue;
                }
                const mapping = this.mapToSource(emitted.emit.mappings, tsDiagnostic.start, tsDiagnostic.length ?? 0);
                if (!mapping) {
                    continue;
                }
                diagnostics.push({
                    fileName: fileName,
                    diagnostic: {
                        code: `ts${tsDiagnostic.code}`,
                        source: TS_DIAGNOSTIC_SOURCE,
                        severity: DiagnosticSeverity.Error,
                        message: this.rewriteMessage(ts.flattenDiagnosticMessageText(tsDiagnostic.messageText, '\n'), names),
                        location: util.getLocation({ sourceInfo: emitted.file.sourceInfo, startPosition: mapping.srcStart, endPosition: mapping.srcEnd })
                    } as BsDiagnostic
                });
            }
        }
        return diagnostics;
    }

    /**
     * Type-check every scope in the program. A file that lives in several scopes is checked once per scope, and
     * identical diagnostics from different scopes are merged
     */
    public getDiagnostics(): BsDiagnostic[] {
        const result = new Map<string, { diagnostic: BsDiagnostic; fileName: string; scopeNames: string[] }>();
        const scopeCountPerFile = new Map<string, number>();
        for (const scope of this.program.getScopes()) {
            if (scope.name === 'global') {
                continue;
            }
            for (const { fileName, diagnostic } of this.checkScope(scope)) {
                const key = `${diagnostic.location?.uri}:${JSON.stringify(diagnostic.location?.range)}:${diagnostic.message}`;
                let entry = result.get(key);
                if (!entry) {
                    entry = { diagnostic: diagnostic, fileName: fileName, scopeNames: [] };
                    result.set(key, entry);
                }
                entry.scopeNames.push(scope.name);
            }
            for (const fileName of this.scopeServices.get(scope.name).fileNames) {
                scopeCountPerFile.set(fileName, (scopeCountPerFile.get(fileName) ?? 0) + 1);
            }
        }
        return [...result.values()].map(({ diagnostic, fileName, scopeNames }) => {
            //a file shared by several scopes can be fine in some of them and broken in others, so say which ones
            if (scopeNames.length < scopeCountPerFile.get(fileName)) {
                diagnostic.message += ` (in scope ${scopeNames.join(', ')})`;
            }
            return diagnostic;
        });
    }

    /**
     * Get TypeScript's description of the type at a position in a file, in the context of the given scope (for hovers)
     */
    public getTypeAtPosition(scope: Scope, file: BrsFile, offset: number): string {
        const service = this.getLanguageService(this.getScopeService(scope));
        const emitted = this.getEmittedFile(file);
        //find the innermost mapping whose source span contains the offset
        let best: SourceMapping;
        for (const mapping of emitted.emit.mappings) {
            if (mapping.srcStart <= offset && offset <= mapping.srcEnd) {
                if (!best || (mapping.srcEnd - mapping.srcStart) <= (best.srcEnd - best.srcStart)) {
                    best = mapping;
                }
            }
        }
        if (!best) {
            return undefined;
        }
        const info = service.getQuickInfoAtPosition(this.getVirtualPath(file), best.genStart + (offset - best.srcStart));
        if (!info) {
            return undefined;
        }
        return this.rewriteMessage(`'${ts.displayPartsToString(info.displayParts)}'`, emitted.emit.names).replace(/^'|'$/g, '');
    }

    /**
     * Get the generated TypeScript for a file (for debugging and tests)
     */
    public getGeneratedCode(file: BrsFile): string {
        return this.getEmittedFile(file).emit.text;
    }

    public dispose() {
        for (const { service } of this.scopeServices.values()) {
            service?.dispose();
        }
        this.sourceFiles.clear();
        this.scopeServices.clear();
        this.emittedFiles.clear();
    }
}
