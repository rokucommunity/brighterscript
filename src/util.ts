import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import type { ParseError } from 'jsonc-parser';
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import * as path from 'path';
import { rokuDeploy, DefaultFiles, standardizePath as rokuDeployStandardizePath } from 'roku-deploy';
import type { DiagnosticRelatedInformation, Diagnostic, Position } from 'vscode-languageserver';
import { Location } from 'vscode-languageserver';
import { Range } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import * as xml2js from 'xml2js';
import type { BsConfig, FinalizedBsConfig } from './BsConfig';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { CallableContainer, BsDiagnostic, FileReference, CallableContainerMap, CompilerPluginFactory, CompilerPlugin, ExpressionInfo, TranspileResult, TypeChainEntry, TypeChainProcessResult, GetTypeOptions } from './interfaces';
import { BooleanType } from './types/BooleanType';
import { DoubleType } from './types/DoubleType';
import { DynamicType } from './types/DynamicType';
import { FloatType } from './types/FloatType';
import { IntegerType } from './types/IntegerType';
import { LongIntegerType } from './types/LongIntegerType';
import { ObjectType } from './types/ObjectType';
import { StringType } from './types/StringType';
import { VoidType } from './types/VoidType';
import { ParseMode } from './parser/Parser';
import type { CallExpression, CallfuncExpression, DottedGetExpression, FunctionParameterExpression, IndexedGetExpression, LiteralExpression, NewExpression, TypeExpression, VariableExpression, XmlAttributeGetExpression } from './parser/Expression';
import { LogLevel, createLogger } from './logging';
import { isToken, type Identifier, type Locatable, type Token } from './lexer/Token';
import { TokenKind } from './lexer/TokenKind';
import { isAnyReferenceType, isBinaryExpression, isBooleanType, isBrsFile, isCallExpression, isCallableType, isCallfuncExpression, isClassType, isDottedGetExpression, isDoubleType, isDynamicType, isEnumMemberType, isExpression, isFloatType, isIndexedGetExpression, isInvalidType, isLiteralString, isLongIntegerType, isNamespaceType, isNewExpression, isNumberType, isStringType, isTypeExpression, isTypedArrayExpression, isTypedFunctionType, isUnionType, isVariableExpression, isXmlAttributeGetExpression, isXmlFile } from './astUtils/reflection';
import { WalkMode } from './astUtils/visitors';
import { SourceNode } from 'source-map';
import * as requireRelative from 'require-relative';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import type { AstNode, Expression, Statement } from './parser/AstNode';
import { AstNodeKind } from './parser/AstNode';
import type { UnresolvedSymbol } from './AstValidationSegmenter';
import type { SymbolTable } from './SymbolTable';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import { createIdentifier, createToken } from './astUtils/creators';
import { MAX_RELATED_INFOS_COUNT } from './diagnosticUtils';
import type { BscType } from './types/BscType';
import { unionTypeFactory } from './types/UnionType';
import { ArrayType } from './types/ArrayType';
import { BinaryOperatorReferenceType } from './types/ReferenceType';
import { AssociativeArrayType } from './types/AssociativeArrayType';
import { ComponentType } from './types/ComponentType';
import { FunctionType } from './types/FunctionType';
import type { AssignmentStatement } from './parser/Statement';

export class Util {
    public clearConsole() {
        // process.stdout.write('\x1Bc');
    }

    /**
     * Returns the number of parent directories in the filPath
     */
    public getParentDirectoryCount(filePath: string | undefined) {
        if (!filePath) {
            return -1;
        } else {
            return filePath.replace(/^pkg:/, '').split(/[\\\/]/).length - 1;
        }
    }

    /**
     * Determine if the file exists
     */
    public async pathExists(filePath: string | undefined) {
        if (!filePath) {
            return false;
        } else {
            return fsExtra.pathExists(filePath);
        }
    }

    /**
     * Determine if the file exists
     */
    public pathExistsSync(filePath: string | undefined) {
        if (!filePath) {
            return false;
        } else {
            return fsExtra.pathExistsSync(filePath);
        }
    }

    /**
     * Determine if this path is a directory
     */
    public isDirectorySync(dirPath: string | undefined) {
        return dirPath !== undefined && fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory();
    }

    /**
     * Given a pkg path of any kind, transform it to a roku-specific pkg path (i.e. "pkg:/some/path.brs")
     */
    public sanitizePkgPath(pkgPath: string) {
        //convert all slashes to forwardslash
        pkgPath = pkgPath.replace(/[\/\\]+/g, '/');
        //ensure every path has the leading pkg:/
        return 'pkg:/' + pkgPath.replace(/^pkg:\//i, '');
    }

    /**
     * Determine if the given path starts with a protocol
     */
    public startsWithProtocol(path: string) {
        return !!/^[-a-z]+:\//i.exec(path);
    }

    /**
     * Given a pkg path of any kind, transform it to a roku-specific pkg path (i.e. "pkg:/some/path.brs")
     * @deprecated use `sanitizePkgPath instead. Will be removed in v1
     */
    public getRokuPkgPath(pkgPath: string) {
        return this.sanitizePkgPath(pkgPath);
    }

    /**
     * Given a path to a file/directory, replace all path separators with the current system's version.
     */
    public pathSepNormalize(filePath: string, separator?: string) {
        if (!filePath) {
            return filePath;
        }
        separator = separator ? separator : path.sep;
        return filePath.replace(/[\\/]+/g, separator);
    }

    /**
     * Find the path to the config file.
     * If the config file path doesn't exist
     * @param cwd the current working directory where the search for configs should begin
     */
    public getConfigFilePath(cwd?: string) {
        cwd = cwd ?? process.cwd();
        let configPath = path.join(cwd, 'bsconfig.json');
        //find the nearest config file path
        for (let i = 0; i < 100; i++) {
            if (this.pathExistsSync(configPath)) {
                return configPath;
            } else {
                let parentDirPath = path.dirname(path.dirname(configPath));
                configPath = path.join(parentDirPath, 'bsconfig.json');
            }
        }
    }

    public getRangeFromOffsetLength(text: string, offset: number, length: number) {
        let lineIndex = 0;
        let colIndex = 0;
        for (let i = 0; i < text.length; i++) {
            if (offset === i) {
                break;
            }
            let char = text[i];
            if (char === '\n' || (char === '\r' && text[i + 1] === '\n')) {
                lineIndex++;
                colIndex = 0;
                i++;
                continue;
            } else {
                colIndex++;
            }
        }
        return util.createRange(lineIndex, colIndex, lineIndex, colIndex + length);
    }

    /**
     * Load the contents of a config file.
     * If the file extends another config, this will load the base config as well.
     * @param configFilePath the relative or absolute path to a brighterscript config json file
     * @param parentProjectPaths a list of parent config files. This is used by this method to recursively build the config list
     */
    public loadConfigFile(configFilePath: string | undefined, parentProjectPaths?: string[], cwd = process.cwd()): BsConfig | undefined {
        if (configFilePath) {
            //if the config file path starts with question mark, then it's optional. return undefined if it doesn't exist
            if (configFilePath.startsWith('?')) {
                //remove leading question mark
                configFilePath = configFilePath.substring(1);
                if (fsExtra.pathExistsSync(path.resolve(cwd, configFilePath)) === false) {
                    return undefined;
                }
            }
            //keep track of the inheritance chain
            parentProjectPaths = parentProjectPaths ? parentProjectPaths : [];
            configFilePath = path.resolve(cwd, configFilePath);
            if (parentProjectPaths?.includes(configFilePath)) {
                parentProjectPaths.push(configFilePath);
                parentProjectPaths.reverse();
                throw new Error('Circular dependency detected: "' + parentProjectPaths.join('" => ') + '"');
            }
            //load the project file
            let projectFileContents = fsExtra.readFileSync(configFilePath).toString();
            let parseErrors = [] as ParseError[];
            let projectConfig = parseJsonc(projectFileContents, parseErrors, {
                allowEmptyContent: true,
                allowTrailingComma: true,
                disallowComments: false
            }) as BsConfig ?? {};
            if (parseErrors.length > 0) {
                let err = parseErrors[0];
                let diagnostic = {
                    ...DiagnosticMessages.bsConfigJsonHasSyntaxErrors(printParseErrorCode(parseErrors[0].error)),
                    file: {
                        srcPath: configFilePath
                    },
                    range: this.getRangeFromOffsetLength(projectFileContents, err.offset, err.length)
                } as BsDiagnostic;
                throw diagnostic; //eslint-disable-line @typescript-eslint/no-throw-literal
            }

            let projectFileCwd = path.dirname(configFilePath);

            //`plugins` paths should be relative to the current bsconfig
            this.resolvePathsRelativeTo(projectConfig, 'plugins', projectFileCwd);

            //`require` paths should be relative to cwd
            util.resolvePathsRelativeTo(projectConfig, 'require', projectFileCwd);

            let result: BsConfig;
            //if the project has a base file, load it
            if (projectConfig && typeof projectConfig.extends === 'string') {
                let baseProjectConfig = this.loadConfigFile(projectConfig.extends, [...parentProjectPaths, configFilePath], projectFileCwd);
                //extend the base config with the current project settings
                result = { ...baseProjectConfig, ...projectConfig };
            } else {
                result = projectConfig;
                let ancestors = parentProjectPaths ? parentProjectPaths : [];
                ancestors.push(configFilePath);
                (result as any)._ancestors = parentProjectPaths;
            }

            //make any paths in the config absolute (relative to the CURRENT config file)
            if (result.outFile) {
                result.outFile = path.resolve(projectFileCwd, result.outFile);
            }
            if (result.rootDir) {
                result.rootDir = path.resolve(projectFileCwd, result.rootDir);
            }
            if (result.cwd) {
                result.cwd = path.resolve(projectFileCwd, result.cwd);
            }
            if (result.stagingDir) {
                result.stagingDir = path.resolve(projectFileCwd, result.stagingDir);
            }
            return result;
        }
    }

    /**
     * Convert relative paths to absolute paths, relative to the given directory. Also de-dupes the paths. Modifies the array in-place
     * @param collection usually a bsconfig.
     * @param key a key of the config to read paths from (usually this is `'plugins'` or `'require'`)
     * @param relativeDir the path to the folder where the paths should be resolved relative to. This should be an absolute path
     */
    public resolvePathsRelativeTo(collection: any, key: string, relativeDir: string) {
        if (!collection[key]) {
            return;
        }
        const result = new Set<string>();
        for (const p of collection[key] as string[] ?? []) {
            if (p) {
                result.add(
                    p?.startsWith('.') ? path.resolve(relativeDir, p) : p
                );
            }
        }
        collection[key] = [...result];
    }

    /**
     * Do work within the scope of a changed current working directory
     * @param targetCwd the cwd where the work should be performed
     * @param callback a function to call when the cwd has been changed to `targetCwd`
     */
    public cwdWork<T>(targetCwd: string | null | undefined, callback: () => T): T {
        let originalCwd = process.cwd();
        if (targetCwd) {
            process.chdir(targetCwd);
        }

        let result: T;
        let err;

        try {
            result = callback();
        } catch (e) {
            err = e;
        }

        if (targetCwd) {
            process.chdir(originalCwd);
        }

        if (err) {
            throw err;
        } else {
            //justification: `result` is set as long as `err` is not set and vice versa
            return result!;
        }
    }

    /**
     * Given a BsConfig object, start with defaults,
     * merge with bsconfig.json and the provided options.
     * @param config a bsconfig object to use as the baseline for the resulting config
     */
    public normalizeAndResolveConfig(config: BsConfig | undefined): FinalizedBsConfig {
        let result = this.normalizeConfig({});

        if (config?.noProject) {
            return result;
        }

        //if no options were provided, try to find a bsconfig.json file
        if (!config || !config.project) {
            result.project = this.getConfigFilePath(config?.cwd);
        } else {
            //use the config's project link
            result.project = config.project;
        }
        if (result.project) {
            let configFile = this.loadConfigFile(result.project, undefined, config?.cwd);
            result = Object.assign(result, configFile);
        }
        //override the defaults with the specified options
        result = Object.assign(result, config);
        return result;
    }

    /**
     * Set defaults for any missing items
     * @param config a bsconfig object to use as the baseline for the resulting config
     */
    public normalizeConfig(config: BsConfig | undefined): FinalizedBsConfig {
        config = config ?? {} as BsConfig;

        const cwd = config.cwd ?? process.cwd();
        const rootFolderName = path.basename(cwd);
        const retainStagingDir = (config.retainStagingDir ?? config.retainStagingDir) === true ? true : false;

        let logLevel: LogLevel = LogLevel.log;

        if (typeof config.logLevel === 'string') {
            logLevel = LogLevel[(config.logLevel as string).toLowerCase()] ?? LogLevel.log;
        }

        let bslibDestinationDir = config.bslibDestinationDir ?? 'source';
        if (bslibDestinationDir !== 'source') {
            // strip leading and trailing slashes
            bslibDestinationDir = bslibDestinationDir.replace(/^(\/*)(.*?)(\/*)$/, '$2');
        }

        const configWithDefaults: Omit<FinalizedBsConfig, 'rootDir'> = {
            cwd: cwd,
            deploy: config.deploy === true ? true : false,
            //use default files array from rokuDeploy
            files: config.files ?? [...DefaultFiles],
            createPackage: config.createPackage === false ? false : true,
            outFile: config.outFile ?? `./out/${rootFolderName}.zip`,
            sourceMap: config.sourceMap === true,
            username: config.username ?? 'rokudev',
            watch: config.watch === true ? true : false,
            emitFullPaths: config.emitFullPaths === true ? true : false,
            retainStagingDir: retainStagingDir,
            copyToStaging: config.copyToStaging === false ? false : true,
            ignoreErrorCodes: config.ignoreErrorCodes ?? [],
            diagnosticSeverityOverrides: config.diagnosticSeverityOverrides ?? {},
            diagnosticFilters: config.diagnosticFilters ?? [],
            plugins: config.plugins ?? [],
            pruneEmptyCodeFiles: config.pruneEmptyCodeFiles === true ? true : false,
            autoImportComponentScript: config.autoImportComponentScript === true ? true : false,
            showDiagnosticsInConsole: config.showDiagnosticsInConsole === false ? false : true,
            sourceRoot: config.sourceRoot ? standardizePath(config.sourceRoot) : undefined,
            allowBrighterScriptInBrightScript: config.allowBrighterScriptInBrightScript === true ? true : false,
            emitDefinitions: config.emitDefinitions === true ? true : false,
            removeParameterTypes: config.removeParameterTypes === true ? true : false,
            logLevel: logLevel,
            bslibDestinationDir: bslibDestinationDir,
            legacyCallfuncHandling: config.legacyCallfuncHandling === true ? true : false
        };

        //mutate `config` in case anyone is holding a reference to the incomplete one
        const merged: FinalizedBsConfig = Object.assign(config, configWithDefaults);

        return merged;
    }

    /**
     * Get the root directory from options.
     * Falls back to options.cwd.
     * Falls back to process.cwd
     * @param options a bsconfig object
     */
    public getRootDir(options: BsConfig) {
        if (!options) {
            throw new Error('Options is required');
        }
        let cwd = options.cwd;
        cwd = cwd ? cwd : process.cwd();
        let rootDir = options.rootDir ? options.rootDir : cwd;

        rootDir = path.resolve(cwd, rootDir);

        return rootDir;
    }

    /**
     * Given a list of callables as a dictionary indexed by their full name (namespace included, transpiled to underscore-separated.
     */
    public getCallableContainersByLowerName(callables: CallableContainer[]): CallableContainerMap {
        //find duplicate functions
        const result = new Map<string, CallableContainer[]>();

        for (let callableContainer of callables) {
            let lowerName = callableContainer.callable.getName(ParseMode.BrightScript).toLowerCase();

            //create a new array for this name
            const list = result.get(lowerName);
            if (list) {
                list.push(callableContainer);
            } else {
                result.set(lowerName, [callableContainer]);
            }
        }
        return result;
    }

    /**
     * Split a file by newline characters (LF or CRLF)
     */
    public getLines(text: string) {
        return text.split(/\r?\n/);
    }

    /**
     * Given an absolute path to a source file, and a target path,
     * compute the pkg path for the target relative to the source file's location
     */
    public getPkgPathFromTarget(containingFilePathAbsolute: string, targetPath: string) {
        // https://regex101.com/r/w7CG2N/1
        const regexp = /^(?:pkg|libpkg):(\/)?/i;
        const [fullScheme, slash] = regexp.exec(targetPath) ?? [];
        //if the target starts with 'pkg:' or 'libpkg:' then it's an absolute path. Return as is
        if (slash) {
            targetPath = targetPath.substring(fullScheme.length);
            if (targetPath === '') {
                return null;
            } else {
                return path.normalize(targetPath);
            }
        }
        //if the path is exactly `pkg:` or `libpkg:`
        if (targetPath === fullScheme && !slash) {
            return null;
        }

        //remove the filename
        let containingFolder = path.normalize(path.dirname(containingFilePathAbsolute));
        //start with the containing folder, split by slash
        let result = containingFolder.split(path.sep);

        //split on slash
        let targetParts = path.normalize(targetPath).split(path.sep);

        for (let part of targetParts) {
            if (part === '' || part === '.') {
                //do nothing, it means current directory
                continue;
            }
            if (part === '..') {
                //go up one directory
                result.pop();
            } else {
                result.push(part);
            }
        }
        return result.join(path.sep);
    }

    /**
     * Compute the relative path from the source file to the target file
     * @param pkgSrcPath  - the absolute path to the source, where cwd is the package location
     * @param pkgTargetPath  - the absolute path to the target, where cwd is the package location
     */
    public getRelativePath(pkgSrcPath: string, pkgTargetPath: string) {
        pkgSrcPath = path.normalize(pkgSrcPath);
        pkgTargetPath = path.normalize(pkgTargetPath);

        //break by path separator
        let sourceParts = pkgSrcPath.split(path.sep);
        let targetParts = pkgTargetPath.split(path.sep);

        let commonParts = [] as string[];
        //find their common root
        for (let i = 0; i < targetParts.length; i++) {
            if (targetParts[i].toLowerCase() === sourceParts[i].toLowerCase()) {
                commonParts.push(targetParts[i]);
            } else {
                //we found a non-matching part...so no more commonalities past this point
                break;
            }
        }

        //throw out the common parts from both sets
        sourceParts.splice(0, commonParts.length);
        targetParts.splice(0, commonParts.length);

        //throw out the filename part of source
        sourceParts.splice(sourceParts.length - 1, 1);
        //start out by adding updir paths for each remaining source part
        let resultParts = sourceParts.map(() => '..');

        //now add every target part
        resultParts = [...resultParts, ...targetParts];
        return path.join(...resultParts);
    }

    /**
     * Walks left in a DottedGetExpression and returns a VariableExpression if found, or undefined if not found
     */
    public findBeginningVariableExpression(dottedGet: DottedGetExpression): VariableExpression | undefined {
        let left: any = dottedGet;
        while (left) {
            if (isVariableExpression(left)) {
                return left;
            } else if (isDottedGetExpression(left)) {
                left = left.obj;
            } else {
                break;
            }
        }
    }

    /**
     * Do `a` and `b` overlap by at least one character. This returns false if they are at the edges. Here's some examples:
     * ```
     * | true | true | true | true | true | false | false | false | false |
     * |------|------|------|------|------|-------|-------|-------|-------|
     * | aa   |  aaa |  aaa | aaa  |  a   |  aa   |    aa | a     |     a |
     * |  bbb | bb   |  bbb |  b   | bbb  |    bb |  bb   |     b | a     |
     * ```
     */
    public rangesIntersect(a: Range | undefined, b: Range | undefined) {
        //stop if the either range is misisng
        if (!a || !b) {
            return false;
        }

        // Check if `a` is before `b`
        if (a.end.line < b.start.line || (a.end.line === b.start.line && a.end.character <= b.start.character)) {
            return false;
        }

        // Check if `b` is before `a`
        if (b.end.line < a.start.line || (b.end.line === a.start.line && b.end.character <= a.start.character)) {
            return false;
        }

        // These ranges must intersect
        return true;
    }

    /**
     * Do `a` and `b` overlap by at least one character or touch at the edges
     * ```
     * | true | true | true | true | true | true  | true  | false | false |
     * |------|------|------|------|------|-------|-------|-------|-------|
     * | aa   |  aaa |  aaa | aaa  |  a   |  aa   |    aa | a     |     a |
     * |  bbb | bb   |  bbb |  b   | bbb  |    bb |  bb   |     b | a     |
     * ```
     */
    public rangesIntersectOrTouch(a: Range | undefined, b: Range | undefined) {
        //stop if the either range is misisng
        if (!a || !b) {
            return false;
        }
        // Check if `a` is before `b`
        if (a.end.line < b.start.line || (a.end.line === b.start.line && a.end.character < b.start.character)) {
            return false;
        }

        // Check if `b` is before `a`
        if (b.end.line < a.start.line || (b.end.line === a.start.line && b.end.character < a.start.character)) {
            return false;
        }

        // These ranges must intersect
        return true;
    }

    /**
     * Test if `position` is in `range`. If the position is at the edges, will return true.
     * Adapted from core vscode
     */
    public rangeContains(range: Range | undefined, position: Position | undefined) {
        return this.comparePositionToRange(position, range) === 0;
    }

    public comparePositionToRange(position: Position | undefined, range: Range | undefined) {
        //stop if the either range is missng
        if (!position || !range) {
            return 0;
        }

        if (this.comparePosition(position, range.start) < 0) {
            return -1;
        }
        if (this.comparePosition(position, range.end) > 0) {
            return 1;
        }
        return 0;
    }

    public comparePosition(a: Position | undefined, b: Position) {
        //stop if the either position is missing
        if (!a || !b) {
            return 0;
        }

        if (a.line < b.line || (a.line === b.line && a.character < b.character)) {
            return -1;
        }
        if (a.line > b.line || (a.line === b.line && a.character > b.character)) {
            return 1;
        }
        return 0;
    }

    /**
     * Combine all the documentation found before a token (i.e. comment tokens)
     */
    public getTokenDocumentation(token?: Token | AstNode) {
        const leadingTrivia = isToken(token) ? token.leadingTrivia : token?.getLeadingTrivia() ?? [];
        const tokens = leadingTrivia?.filter(t => t.kind === TokenKind.Newline || t.kind === TokenKind.Comment);
        const comments = [] as Token[];

        let newLinesInRow = 0;
        for (let i = tokens.length - 1; i >= 0; i--) {
            const token = tokens[i];
            //skip whitespace and newline chars
            if (token.kind === TokenKind.Comment) {
                comments.push(token);
                newLinesInRow = 0;
            } else if (token.kind === TokenKind.Newline) {
                //skip these tokens
                newLinesInRow++;

                if (newLinesInRow > 1) {
                    // stop processing on empty line.
                    break;
                }
                //any other token means there are no more comments
            } else {
                break;
            }
        }
        const jsDocCommentBlockLine = /(\/\*{2,}|\*{1,}\/)/i;
        let usesjsDocCommentBlock = false;
        if (comments.length > 0) {
            return comments.reverse()
                .map(x => x.text.replace(/^('|rem)/i, '').trim())
                .filter(line => {
                    if (jsDocCommentBlockLine.exec(line)) {
                        usesjsDocCommentBlock = true;
                        return false;
                    }
                    return true;
                }).map(line => {
                    if (usesjsDocCommentBlock) {
                        if (line.startsWith('*')) {
                            //remove jsDoc leading '*'
                            line = line.slice(1).trim();
                        }
                    }
                    if (line.startsWith('@')) {
                        // Handle jsdoc/brightscriptdoc tags specially
                        // make sure they are on their own markdown line, and add italics
                        const firstSpaceIndex = line.indexOf(' ');
                        if (firstSpaceIndex === -1) {
                            return `\n_${line}_`;
                        }
                        const firstWord = line.substring(0, firstSpaceIndex);
                        return `\n_${firstWord}_ ${line.substring(firstSpaceIndex + 1)}`;
                    }
                    return line;
                }).join('\n');
        }
    }

    /**
     * Combine all the documentation for a node - uses the AstNode's leadingTrivia property
     */
    public getNodeDocumentation(node: AstNode) {
        if (!node) {
            return;
        }
        return this.getTokenDocumentation(node);
    }

    /**
     * Prefixes a component name so it can be used as type in the symbol table, without polluting available symbols
     *
     * @param sgNodeName the Name of the component
     * @returns the node name, prefixed with `roSGNode`
     */
    public getSgNodeTypeName(sgNodeName: string) {
        return 'roSGNode' + sgNodeName;
    }

    /**
     * Parse an xml file and get back a javascript object containing its results
     */
    public parseXml(text: string) {
        return new Promise<any>((resolve, reject) => {
            xml2js.parseString(text, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }

    public propertyCount(object: Record<string, unknown>) {
        let count = 0;
        for (let key in object) {
            if (object.hasOwnProperty(key)) {
                count++;
            }
        }
        return count;
    }

    public padLeft(subject: string, totalLength: number, char: string) {
        totalLength = totalLength > 1000 ? 1000 : totalLength;
        while (subject.length < totalLength) {
            subject = char + subject;
        }
        return subject;
    }


    /**
     * Given a URI, convert that to a regular fs path
     */
    public uriToPath(uri: string) {
        let parsedPath = URI.parse(uri).fsPath;

        //Uri annoyingly coverts all drive letters to lower case...so this will bring back whatever case it came in as
        let match = /\/\/\/([a-z]:)/i.exec(uri);
        if (match) {
            let originalDriveCasing = match[1];
            parsedPath = originalDriveCasing + parsedPath.substring(2);
        }
        const normalizedPath = path.normalize(parsedPath);
        return normalizedPath;
    }

    /**
     * Force the drive letter to lower case
     */
    public driveLetterToLower(fullPath: string) {
        if (fullPath) {
            let firstCharCode = fullPath.charCodeAt(0);
            if (
                //is upper case A-Z
                firstCharCode >= 65 && firstCharCode <= 90 &&
                //next char is colon
                fullPath[1] === ':'
            ) {
                fullPath = fullPath[0].toLowerCase() + fullPath.substring(1);
            }
        }
        return fullPath;
    }

    /**
     * Replace the first instance of `search` in `subject` with `replacement`
     */
    public replaceCaseInsensitive(subject: string, search: string, replacement: string) {
        let idx = subject.toLowerCase().indexOf(search.toLowerCase());
        if (idx > -1) {
            let result = subject.substring(0, idx) + replacement + subject.substring(idx + search.length);
            return result;
        } else {
            return subject;
        }
    }

    /**
     * Determine if two arrays containing primitive values are equal.
     * This considers order and compares by equality.
     */
    public areArraysEqual(arr1: any[], arr2: any[]) {
        if (arr1.length !== arr2.length) {
            return false;
        }
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * Given a file path, convert it to a URI string
     */
    public pathToUri(filePath: string) {
        return URI.file(filePath).toString();
    }

    /**
     * Get the outDir from options, taking into account cwd and absolute outFile paths
     */
    public getOutDir(options: FinalizedBsConfig) {
        options = this.normalizeConfig(options);
        let cwd = path.normalize(options.cwd ? options.cwd : process.cwd());
        if (path.isAbsolute(options.outFile)) {
            return path.dirname(options.outFile);
        } else {
            return path.normalize(path.join(cwd, path.dirname(options.outFile)));
        }
    }

    /**
     * Get paths to all files on disc that match this project's source list
     */
    public async getFilePaths(options: FinalizedBsConfig) {
        let rootDir = this.getRootDir(options);

        let files = await rokuDeploy.getFilePaths(options.files, rootDir);
        return files;
    }

    /**
     * Given a path to a brs file, compute the path to a theoretical d.bs file.
     * Only `.brs` files can have typedef path, so return undefined for everything else
     */
    public getTypedefPath(brsSrcPath: string) {
        const typedefPath = brsSrcPath
            .replace(/\.brs$/i, '.d.bs')
            .toLowerCase();

        if (typedefPath.endsWith('.d.bs')) {
            return typedefPath;
        } else {
            return undefined;
        }
    }

    /**
     * Determine whether this diagnostic should be supressed or not, based on brs comment-flags
     */
    public diagnosticIsSuppressed(diagnostic: BsDiagnostic) {
        const diagnosticCode = typeof diagnostic.code === 'string' ? diagnostic.code.toLowerCase() : diagnostic.code;
        for (let flag of diagnostic.file?.commentFlags ?? []) {
            //this diagnostic is affected by this flag
            if (diagnostic.range && this.rangeContains(flag.affectedRange, diagnostic.range.start)) {
                //if the flag acts upon this diagnostic's code
                if (flag.codes === null || (diagnosticCode !== undefined && flag.codes.includes(diagnosticCode))) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Walks up the chain to find the closest bsconfig.json file
     */
    public async findClosestConfigFile(currentPath: string): Promise<string | undefined> {
        //make the path absolute
        currentPath = path.resolve(
            path.normalize(
                currentPath
            )
        );

        let previousPath: string | undefined;
        //using ../ on the root of the drive results in the same file path, so that's how we know we reached the top
        while (previousPath !== currentPath) {
            previousPath = currentPath;

            let bsPath = path.join(currentPath, 'bsconfig.json');
            let brsPath = path.join(currentPath, 'brsconfig.json');
            if (await this.pathExists(bsPath)) {
                return bsPath;
            } else if (await this.pathExists(brsPath)) {
                return brsPath;
            } else {
                //walk upwards one directory
                currentPath = path.resolve(path.join(currentPath, '../'));
            }
        }
        //got to the root path, no config file exists
    }

    /**
     * Set a timeout for the specified milliseconds, and resolve the promise once the timeout is finished.
     * @param milliseconds the minimum number of milliseconds to sleep for
     */
    public sleep(milliseconds: number) {
        return new Promise((resolve) => {
            //if milliseconds is 0, don't actually timeout (improves unit test throughput)
            if (milliseconds === 0) {
                process.nextTick(resolve);
            } else {
                setTimeout(resolve, milliseconds);
            }
        });
    }

    /**
     * Given an array, map and then flatten
     * @param array the array to flatMap over
     * @param callback a function that is called for every array item
     */
    public flatMap<T, R>(array: T[], callback: (arg: T) => R[]): R[] {
        return Array.prototype.concat.apply([], array.map(callback));
    }

    /**
     * Determines if the position is greater than the range. This means
     * the position does not touch the range, and has a position greater than the end
     * of the range. A position that touches the last line/char of a range is considered greater
     * than the range, because the `range.end` is EXclusive
     */
    public positionIsGreaterThanRange(position: Position, range: Range) {

        //if the position is a higher line than the range
        if (position.line > range.end.line) {
            return true;
        } else if (position.line < range.end.line) {
            return false;
        }
        //they are on the same line

        //if the position's char is greater than or equal to the range's
        if (position.character >= range.end.character) {
            return true;
        } else {
            return false;
        }
    }

    /**
     * Get a range back from an object that contains (or is) a range
     */
    public extractRange(rangeIsh: RangeLike): Range | undefined {
        if (!rangeIsh) {
            return undefined;
        } else if ('location' in rangeIsh) {
            return rangeIsh.location?.range;
        } else if ('range' in rangeIsh) {
            return rangeIsh.range;
        } else if (Range.is(rangeIsh)) {
            return rangeIsh;
        } else {
            return undefined;
        }
    }


    /**
     * Get a location object back by extracting location information from other objects that contain location
     */
    public getRange(startObj: | { range: Range }, endObj: { range: Range }): Range {
        if (!startObj?.range || !endObj?.range) {
            return undefined;
        }
        return util.createRangeFromPositions(startObj.range?.start, endObj.range?.end);
    }

    /**
     * If the two items both start on the same line
     */
    public sameStartLine(first: { range: Range }, second: { range: Range }) {
        if (first && second && first.range.start.line === second.range.start.line) {
            return true;
        } else {
            return false;
        }
    }

    /**
     * If the two items have lines that touch
     */
    public linesTouch(first: RangeLike, second: RangeLike) {
        const firstRange = this.extractRange(first);
        const secondRange = this.extractRange(second);
        if (firstRange && secondRange && (
            firstRange.start.line === secondRange.start.line ||
            firstRange.start.line === secondRange.end.line ||
            firstRange.end.line === secondRange.start.line ||
            firstRange.end.line === secondRange.end.line
        )) {
            return true;
        } else {
            return false;
        }
    }

    /**
     * Given text with (or without) dots separating text, get the rightmost word.
     * (i.e. given "A.B.C", returns "C". or "B" returns "B because there's no dot)
     */
    public getTextAfterFinalDot(name: string) {
        if (name) {
            let parts = name.split('.');
            if (parts.length > 0) {
                return parts[parts.length - 1];
            }
        }
    }

    /**
     * Find a script import that the current position touches, or undefined if not found
     */
    public getScriptImportAtPosition(scriptImports: FileReference[], position: Position): FileReference | undefined {
        let scriptImport = scriptImports.find((x) => {
            return x.filePathRange &&
                x.filePathRange.start.line === position.line &&
                //column between start and end
                position.character >= x.filePathRange.start.character &&
                position.character <= x.filePathRange.end.character;
        });
        return scriptImport;
    }

    /**
     * Given the class name text, return a namespace-prefixed name.
     * If the name already has a period in it, or the namespaceName was not provided, return the class name as is.
     * If the name does not have a period, and a namespaceName was provided, return the class name prepended by the namespace name.
     * If no namespace is provided, return the `className` unchanged.
     */
    public getFullyQualifiedClassName(className: string, namespaceName?: string) {
        if (className?.includes('.') === false && namespaceName) {
            return `${namespaceName}.${className}`;
        } else {
            return className;
        }
    }

    public splitIntoLines(string: string) {
        return string.split(/\r?\n/g);
    }

    public getTextForRange(string: string | string[], range: Range): string {
        let lines: string[];
        if (Array.isArray(string)) {
            lines = string;
        } else {
            lines = this.splitIntoLines(string);
        }

        const start = range.start;
        const end = range.end;

        let endCharacter = end.character;
        // If lines are the same we need to subtract out our new starting position to make it work correctly
        if (start.line === end.line) {
            endCharacter -= start.character;
        }

        let rangeLines = [lines[start.line].substring(start.character)];
        for (let i = start.line + 1; i <= end.line; i++) {
            rangeLines.push(lines[i]);
        }
        const lastLine = rangeLines.pop();
        if (lastLine !== undefined) {
            rangeLines.push(lastLine.substring(0, endCharacter));
        }
        return rangeLines.join('\n');
    }

    /**
     * Helper for creating `Location` objects. Prefer using this function because vscode-languageserver's `Location.create()` is significantly slower at scale
     */
    public createLocationFromRange(uri: string, range: Range): Location {
        return {
            uri: uri,
            range: range
        };
    }

    /**
     * Helper for creating `Location` objects by passing each range value in directly. Prefer using this function because vscode-languageserver's `Location.create()` is significantly slower at scale
     */
    public createLocation(startLine: number, startCharacter: number, endLine: number, endCharacter: number, uri?: string): Location {
        return {
            uri: uri,
            range: {
                start: {
                    line: startLine,
                    character: startCharacter
                },
                end: {
                    line: endLine,
                    character: endCharacter
                }
            }
        };
    }

    /**
     * Helper for creating `Range` objects. Prefer using this function because vscode-languageserver's `Range.create()` is significantly slower.
     */
    public createRange(startLine: number, startCharacter: number, endLine: number, endCharacter: number): Range {
        return {
            start: {
                line: startLine,
                character: startCharacter
            },
            end: {
                line: endLine,
                character: endCharacter
            }
        };
    }

    /**
     * Create a `Range` from two `Position`s
     */
    public createRangeFromPositions(startPosition: Position, endPosition: Position): Range {
        return this.createRange(startPosition.line, startPosition.character, endPosition.line, endPosition.character);
    }

    /**
     *  Gets the bounding range of a bunch of ranges or objects that have ranges
     *  TODO: this does a full iteration of the args. If the args were guaranteed to be in range order, we could optimize this
     */
    public createBoundingLocation(...locatables: Array<{ location?: Location } | Location | { range?: Range } | Range | undefined>): Location | undefined {
        let uri: string | undefined;
        let startPosition: Position | undefined;
        let endPosition: Position | undefined;

        for (let locatable of locatables) {
            let range: Range;
            if ('location' in locatable) {
                range = locatable.location?.range;
                if (!uri) {
                    uri = locatable.location?.uri;
                }
            } else if (Location.is(locatable)) {
                range = locatable.range;
                if (!uri) {
                    uri = locatable.uri;
                }
            } else if ('range' in locatable) {
                range = locatable.range;
            } else {
                range = locatable as Range;
            }

            //skip undefined locations or locations without a range
            if (!range) {
                continue;
            }

            if (!startPosition) {
                startPosition = range.start;
            } else if (this.comparePosition(range.start, startPosition) < 0) {
                startPosition = range.start;
            }
            if (!endPosition) {
                endPosition = range.end;
            } else if (this.comparePosition(range.end, endPosition) > 0) {
                endPosition = range.end;
            }
        }
        if (startPosition && endPosition) {
            return util.createLocation(startPosition.line, startPosition.character, endPosition.line, endPosition.character, uri);
        } else {
            return undefined;
        }
    }

    /**
     *  Gets the bounding range of a bunch of ranges or objects that have ranges
     *  TODO: this does a full iteration of the args. If the args were guaranteed to be in range order, we could optimize this
     */
    public createBoundingRange(...locatables: Array<RangeLike>): Range | undefined {
        return this.createBoundingLocation(...locatables)?.range;
    }

    /**
     * Gets the bounding range of an object that contains a bunch of tokens
     * @param tokens Object with tokens in it
     * @returns Range containing all the tokens
     */
    public createBoundingLocationFromTokens(tokens: Record<string, { location?: Location }>): Location | undefined {
        let uri: string;
        let startPosition: Position | undefined;
        let endPosition: Position | undefined;
        for (let key in tokens) {
            let token = tokens?.[key];
            let locatableRange = token?.location?.range;
            if (!locatableRange) {
                continue;
            }

            if (!startPosition) {
                startPosition = locatableRange.start;
            } else if (this.comparePosition(locatableRange.start, startPosition) < 0) {
                startPosition = locatableRange.start;
            }
            if (!endPosition) {
                endPosition = locatableRange.end;
            } else if (this.comparePosition(locatableRange.end, endPosition) > 0) {
                endPosition = locatableRange.end;
            }
            if (!uri) {
                uri = token.location.uri;
            }
        }
        if (startPosition && endPosition) {
            return this.createLocation(startPosition.line, startPosition.character, endPosition.line, endPosition.character, uri);
        } else {
            return undefined;
        }
    }

    /**
     * Create a `Position` object. Prefer this over `Position.create` for performance reasons.
     */
    public createPosition(line: number, character: number) {
        return {
            line: line,
            character: character
        };
    }

    /**
     * Convert a list of tokens into a string, including their leading whitespace
     */
    public tokensToString(tokens: Token[]) {
        let result = '';
        //skip iterating the final token
        for (let token of tokens) {
            result += token.leadingWhitespace + token.text;
        }
        return result;
    }

    /**
     * Convert a token into a BscType
     */
    public tokenToBscType(token: Token) {
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
        switch (token.kind) {
            case TokenKind.Boolean:
                return new BooleanType(token.text);
            case TokenKind.True:
            case TokenKind.False:
                return BooleanType.instance;
            case TokenKind.Double:
                return new DoubleType(token.text);
            case TokenKind.DoubleLiteral:
                return DoubleType.instance;
            case TokenKind.Dynamic:
                return new DynamicType(token.text);
            case TokenKind.Float:
                return new FloatType(token.text);
            case TokenKind.FloatLiteral:
                return FloatType.instance;
            case TokenKind.Function:
                return new FunctionType(token.text);
            case TokenKind.Integer:
                return new IntegerType(token.text);
            case TokenKind.IntegerLiteral:
                return IntegerType.instance;
            case TokenKind.Invalid:
                return DynamicType.instance; // TODO: use InvalidType better new InvalidType(token.text);
            case TokenKind.LongInteger:
                return new LongIntegerType(token.text);
            case TokenKind.LongIntegerLiteral:
                return LongIntegerType.instance;
            case TokenKind.Object:
                return new ObjectType(token.text);
            case TokenKind.String:
                return new StringType(token.text);
            case TokenKind.StringLiteral:
            case TokenKind.TemplateStringExpressionBegin:
            case TokenKind.TemplateStringExpressionEnd:
            case TokenKind.TemplateStringQuasi:
                return StringType.instance;
            case TokenKind.Void:
                return new VoidType(token.text);
            case TokenKind.Identifier:
                switch (token.text.toLowerCase()) {
                    case 'boolean':
                        return new BooleanType(token.text);
                    case 'double':
                        return new DoubleType(token.text);
                    case 'dynamic':
                        return new DynamicType(token.text);
                    case 'float':
                        return new FloatType(token.text);
                    case 'function':
                        return new FunctionType(token.text);
                    case 'integer':
                        return new IntegerType(token.text);
                    case 'invalid':
                        return DynamicType.instance; // TODO: use InvalidType better new InvalidType(token.text);
                    case 'longinteger':
                        return new LongIntegerType(token.text);
                    case 'object':
                        return new ObjectType(token.text);
                    case 'string':
                        return new StringType(token.text);
                    case 'void':
                        return new VoidType(token.text);
                }
        }
    }

    /**
     * Deciphers the correct types for fields based on docs
     * https://developer.roku.com/en-ca/docs/references/scenegraph/xml-elements/interface.md
     * @param typeDescriptor the type descriptor from the docs
     * @returns {BscType} the known type, or dynamic
     */
    public getNodeFieldType(typeDescriptor: string, lookupTable?: SymbolTable): BscType {
        let typeDescriptorLower = typeDescriptor.toLowerCase().trim().replace(/\*/g, '');

        if (typeDescriptorLower.startsWith('as ')) {
            typeDescriptorLower = typeDescriptorLower.substring(3).trim();
        }
        const nodeFilter = (new RegExp(/^\[?(.* node)/, 'i')).exec(typeDescriptorLower);
        if (nodeFilter?.[1]) {
            typeDescriptorLower = nodeFilter[1].trim();
        }
        const parensFilter = (new RegExp(/(.*)\(.*\)/, 'gi')).exec(typeDescriptorLower);
        if (parensFilter?.[1]) {
            typeDescriptorLower = parensFilter[1].trim();
        }

        const bscType = this.tokenToBscType(createToken(TokenKind.Identifier, typeDescriptorLower));
        if (bscType) {
            return bscType;
        }

        function getRect2dType() {
            const rect2dType = new AssociativeArrayType();
            rect2dType.addMember('height', {}, FloatType.instance, SymbolTypeFlag.runtime);
            rect2dType.addMember('width', {}, FloatType.instance, SymbolTypeFlag.runtime);
            rect2dType.addMember('x', {}, FloatType.instance, SymbolTypeFlag.runtime);
            rect2dType.addMember('y', {}, FloatType.instance, SymbolTypeFlag.runtime);
            return rect2dType;
        }

        function getColorType() {
            return unionTypeFactory([IntegerType.instance, StringType.instance]);
        }

        //check for uniontypes
        const multipleTypes = typeDescriptorLower.split(' or ').map(s => s.trim());
        if (multipleTypes.length > 1) {
            const individualTypes = multipleTypes.map(t => this.getNodeFieldType(t, lookupTable));
            return unionTypeFactory(individualTypes);
        }

        const typeIsArray = typeDescriptorLower.startsWith('array of ') || typeDescriptorLower.startsWith('roarray of ');

        if (typeIsArray) {
            const ofSearch = ' of ';
            const arrayPrefixLength = typeDescriptorLower.indexOf(ofSearch) + ofSearch.length;
            let arrayOfTypeName = typeDescriptorLower.substring(arrayPrefixLength); //cut off beginnin, eg. 'array of' or 'roarray of'
            if (arrayOfTypeName.endsWith('s')) {
                // remove "s" in "floats", etc.
                arrayOfTypeName = arrayOfTypeName.substring(0, arrayOfTypeName.length - 1);
            }
            if (arrayOfTypeName.endsWith('\'')) {
                // remove "'" in "float's", etc.
                arrayOfTypeName = arrayOfTypeName.substring(0, arrayOfTypeName.length - 1);
            }
            let arrayType = this.getNodeFieldType(arrayOfTypeName, lookupTable);
            return new ArrayType(arrayType);
        } else if (typeDescriptorLower.startsWith('option ')) {
            const actualTypeName = typeDescriptorLower.substring('option '.length); //cut off beginning 'option '
            return this.getNodeFieldType(actualTypeName, lookupTable);
        } else if (typeDescriptorLower.startsWith('value ')) {
            const actualTypeName = typeDescriptorLower.substring('value '.length); //cut off beginning 'value '
            return this.getNodeFieldType(actualTypeName, lookupTable);
        } else if (typeDescriptorLower === 'n/a') {
            return DynamicType.instance;
        } else if (typeDescriptorLower === 'uri') {
            return StringType.instance;
        } else if (typeDescriptorLower === 'color') {
            return getColorType();
        } else if (typeDescriptorLower === 'vector2d' || typeDescriptorLower === 'floatarray') {
            return new ArrayType(FloatType.instance);
        } else if (typeDescriptorLower === 'vector2darray') {
            return new ArrayType(new ArrayType(FloatType.instance));
        } else if (typeDescriptorLower === 'intarray') {
            return new ArrayType(IntegerType.instance);
        } else if (typeDescriptorLower === 'colorarray') {
            return new ArrayType(getColorType());
        } else if (typeDescriptorLower === 'boolarray') {
            return new ArrayType(BooleanType.instance);
        } else if (typeDescriptorLower === 'stringarray' || typeDescriptorLower === 'strarray') {
            return new ArrayType(StringType.instance);
        } else if (typeDescriptorLower === 'int') {
            return IntegerType.instance;
        } else if (typeDescriptorLower === 'time') {
            return DoubleType.instance;
        } else if (typeDescriptorLower === 'str') {
            return StringType.instance;
        } else if (typeDescriptorLower === 'bool') {
            return BooleanType.instance;
        } else if (typeDescriptorLower === 'array' || typeDescriptorLower === 'roarray') {
            return new ArrayType();
        } else if (typeDescriptorLower === 'assocarray' ||
            typeDescriptorLower === 'associative array' ||
            typeDescriptorLower === 'associativearray' ||
            typeDescriptorLower === 'roassociativearray' ||
            typeDescriptorLower.startsWith('associative array of') ||
            typeDescriptorLower.startsWith('associativearray of') ||
            typeDescriptorLower.startsWith('roassociativearray of')
        ) {
            return new AssociativeArrayType();
        } else if (typeDescriptorLower === 'node') {
            return ComponentType.instance;
        } else if (typeDescriptorLower === 'nodearray') {
            return new ArrayType(ComponentType.instance);
        } else if (typeDescriptorLower === 'rect2d') {
            return getRect2dType();
        } else if (typeDescriptorLower === 'rect2darray') {
            return new ArrayType(getRect2dType());
        } else if (typeDescriptorLower === 'font') {
            return this.getNodeFieldType('roSGNodeFont', lookupTable);
        } else if (typeDescriptorLower === 'contentnode') {
            return this.getNodeFieldType('roSGNodeContentNode', lookupTable);
        } else if (typeDescriptorLower.endsWith(' node')) {
            return this.getNodeFieldType('roSgNode' + typeDescriptorLower.substring(0, typeDescriptorLower.length - 5), lookupTable);
        } else if (lookupTable) {
            //try doing a lookup
            return lookupTable.getSymbolType(typeDescriptorLower, {
                flags: SymbolTypeFlag.typetime,
                fullName: typeDescriptor,
                tableProvider: () => lookupTable
            });
        }

        return DynamicType.instance;
    }

    /**
     * Return the type of the result of a binary operator
     * Note: compound assignments (eg. +=) internally use a binary expression, so that's why TokenKind.PlusEqual, etc. are here too
     */
    public binaryOperatorResultType(leftType: BscType, operator: Token, rightType: BscType): BscType {
        if ((isAnyReferenceType(leftType) && !leftType.isResolvable()) ||
            (isAnyReferenceType(rightType) && !rightType.isResolvable())) {
            return new BinaryOperatorReferenceType(leftType, operator, rightType, (lhs, op, rhs) => {
                return this.binaryOperatorResultType(lhs, op, rhs);
            });
        }
        if (isEnumMemberType(leftType)) {
            leftType = leftType.underlyingType;
        }
        if (isEnumMemberType(rightType)) {
            rightType = rightType.underlyingType;
        }
        let hasDouble = isDoubleType(leftType) || isDoubleType(rightType);
        let hasFloat = isFloatType(leftType) || isFloatType(rightType);
        let hasLongInteger = isLongIntegerType(leftType) || isLongIntegerType(rightType);
        let hasInvalid = isInvalidType(leftType) || isInvalidType(rightType);
        let hasDynamic = isDynamicType(leftType) || isDynamicType(rightType);
        let bothNumbers = isNumberType(leftType) && isNumberType(rightType);
        let bothStrings = isStringType(leftType) && isStringType(rightType);
        let eitherBooleanOrNum = (isNumberType(leftType) || isBooleanType(leftType)) && (isNumberType(rightType) || isBooleanType(rightType));

        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
        switch (operator.kind) {
            // Math operators
            case TokenKind.Plus:
            case TokenKind.PlusEqual:
                if (bothStrings) {
                    // "string" + "string" is the only binary expression allowed with strings
                    return StringType.instance;
                }
            // eslint-disable-next-line no-fallthrough
            case TokenKind.Minus:
            case TokenKind.MinusEqual:
            case TokenKind.Star:
            case TokenKind.StarEqual:
            case TokenKind.Mod:
                if (bothNumbers) {
                    if (hasDouble) {
                        return DoubleType.instance;
                    } else if (hasFloat) {
                        return FloatType.instance;

                    } else if (hasLongInteger) {
                        return LongIntegerType.instance;
                    }
                    return IntegerType.instance;
                }
                break;
            case TokenKind.Forwardslash:
            case TokenKind.ForwardslashEqual:
                if (bothNumbers) {
                    if (hasDouble) {
                        return DoubleType.instance;
                    } else if (hasFloat) {
                        return FloatType.instance;

                    } else if (hasLongInteger) {
                        return LongIntegerType.instance;
                    }
                    return FloatType.instance;
                }
                break;
            case TokenKind.Backslash:
            case TokenKind.BackslashEqual:
                if (bothNumbers) {
                    if (hasLongInteger) {
                        return LongIntegerType.instance;
                    }
                    return IntegerType.instance;
                }
                break;
            case TokenKind.Caret:
                if (bothNumbers) {
                    if (hasDouble || hasLongInteger) {
                        return DoubleType.instance;
                    } else if (hasFloat) {
                        return FloatType.instance;
                    }
                    return IntegerType.instance;
                }
                break;
            // Bitshift operators
            case TokenKind.LeftShift:
            case TokenKind.LeftShiftEqual:
            case TokenKind.RightShift:
            case TokenKind.RightShiftEqual:
                if (bothNumbers) {
                    if (hasLongInteger) {
                        return LongIntegerType.instance;
                    }
                    // Bitshifts are allowed with non-integer numerics
                    // but will always truncate to ints
                    return IntegerType.instance;
                }
                break;
            // Comparison operators
            // All comparison operators result in boolean
            case TokenKind.Equal:
            case TokenKind.LessGreater:
                // = and <> can accept invalid / dynamic
                if (hasDynamic || hasInvalid || bothStrings || eitherBooleanOrNum) {
                    return BooleanType.instance;
                }
                break;
            case TokenKind.Greater:
            case TokenKind.Less:
            case TokenKind.GreaterEqual:
            case TokenKind.LessEqual:
                if (bothStrings || bothNumbers) {
                    return BooleanType.instance;
                }
                break;
            // Logical or bitwise operators
            case TokenKind.Or:
            case TokenKind.And:
                if (bothNumbers) {
                    // "and"/"or" represent bitwise operators
                    if (hasLongInteger && !hasDouble && !hasFloat) {
                        // 2 long ints or long int and int
                        return LongIntegerType.instance;
                    }
                    return IntegerType.instance;
                } else if (eitherBooleanOrNum) {
                    // "and"/"or" represent logical operators
                    return BooleanType.instance;
                }
                break;
        }
        return DynamicType.instance;
    }

    /**
     * Return the type of the result of a binary operator
     */
    public unaryOperatorResultType(operator: Token, exprType: BscType): BscType {
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
        switch (operator.kind) {
            // Math operators
            case TokenKind.Minus:
                if (isNumberType(exprType)) {
                    // a negative number will be the same type, eg, double->double, int->int, etc.
                    return exprType;
                }
                break;
            case TokenKind.Not:
                if (isBooleanType(exprType)) {
                    return BooleanType.instance;
                } else if (isNumberType(exprType)) {
                    //numbers can be "notted"
                    // by default they go to ints, except longints, which stay that way
                    if (isLongIntegerType(exprType)) {
                        return LongIntegerType.instance;
                    }
                    return IntegerType.instance;
                }
                break;
        }
        return DynamicType.instance;
    }

    /**
     * Get the extension for the given file path. Basically the part after the final dot, except for
     * `d.bs` which is treated as single extension
     * @returns the file extension (i.e. ".d.bs", ".bs", ".brs", ".xml", ".jpg", etc...)
     */
    public getExtension(filePath: string) {
        filePath = filePath.toLowerCase();
        if (filePath.endsWith('.d.bs')) {
            return '.d.bs';
        } else {
            return path.extname(filePath).toLowerCase();
        }
    }

    /**
     * Load and return the list of plugins
     */
    public loadPlugins(cwd: string, pathOrModules: string[], onError?: (pathOrModule: string, err: Error) => void): CompilerPlugin[] {
        const logger = createLogger();
        return pathOrModules.reduce<CompilerPlugin[]>((acc, pathOrModule) => {
            if (typeof pathOrModule === 'string') {
                try {
                    const loaded = requireRelative(pathOrModule, cwd);
                    const theExport: CompilerPlugin | CompilerPluginFactory = loaded.default ? loaded.default : loaded;

                    let plugin: CompilerPlugin | undefined;

                    // legacy plugins returned a plugin object. If we find that, then add a warning
                    if (typeof theExport === 'object') {
                        logger.warn(`Plugin "${pathOrModule}" was loaded as a singleton. Please contact the plugin author to update to the factory pattern.\n`);
                        plugin = theExport;

                        // the official plugin format is a factory function that returns a new instance of a plugin.
                    } else if (typeof theExport === 'function') {
                        plugin = theExport();
                    } else {
                        //this should never happen; somehow an invalid plugin has made it into here
                        throw new Error(`TILT: Encountered an invalid plugin: ${String(plugin)}`);
                    }

                    if (!plugin.name) {
                        plugin.name = pathOrModule;
                    }
                    acc.push(plugin);
                } catch (err: any) {
                    if (onError) {
                        onError(pathOrModule, err);
                    } else {
                        throw err;
                    }
                }
            }
            return acc;
        }, []);
    }

    /**
     * Gathers expressions, variables, and unique names from an expression.
     * This is mostly used for the ternary expression
     */
    public getExpressionInfo(expression: Expression, file: BrsFile): ExpressionInfo {
        const expressions = [expression];
        const variableExpressions = [] as VariableExpression[];
        const uniqueVarNames = new Set<string>();

        function expressionWalker(expression) {
            if (isExpression(expression)) {
                expressions.push(expression);
            }
            if (isVariableExpression(expression)) {
                variableExpressions.push(expression);
                uniqueVarNames.add(expression.tokens.name.text);
            }
        }

        // Collect all expressions. Most of these expressions are fairly small so this should be quick!
        // This should only be called during transpile time and only when we actually need it.
        expression?.walk(expressionWalker, {
            walkMode: WalkMode.visitExpressions
        });

        //handle the expression itself (for situations when expression is a VariableExpression)
        expressionWalker(expression);

        const scope = file.program.getFirstScopeForFile(file);
        const filteredVarNames = [...uniqueVarNames].filter((varName: string) => {
            const varNameLower = varName.toLowerCase();
            // TODO: include namespaces in this filter
            return !scope.getEnumMap().has(varNameLower) &&
                !scope.getConstMap().has(varNameLower);
        });

        return { expressions: expressions, varExpressions: variableExpressions, uniqueVarNames: filteredVarNames };
    }


    public concatAnnotationLeadingTrivia(stmt: Statement, otherTrivia: Token[] = []): Token[] {
        return [...(stmt.annotations?.map(anno => anno.getLeadingTrivia()).flat() ?? []), ...otherTrivia];
    }

    /**
     * Create a SourceNode that maps every line to itself. Useful for creating maps for files
     * that haven't changed at all, but we still need the map
     */
    public simpleMap(source: string, src: string) {
        //create a source map from the original source code
        let chunks = [] as (SourceNode | string)[];
        let lines = src.split(/\r?\n/g);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            let line = lines[lineIndex];
            chunks.push(
                lineIndex > 0 ? '\n' : '',
                new SourceNode(lineIndex + 1, 0, source, line)
            );
        }
        return new SourceNode(null, null, source, chunks);
    }

    /**
     * Converts a path into a standardized format (drive letter to lower, remove extra slashes, use single slash type, resolve relative parts, etc...)
     */
    public standardizePath(thePath: string) {
        return util.driveLetterToLower(
            rokuDeployStandardizePath(thePath)
        );
    }

    /**
     * Given a Diagnostic or BsDiagnostic, return a deep clone of the diagnostic.
     * @param diagnostic the diagnostic to clone
     * @param relatedInformationFallbackLocation a default location to use for all `relatedInformation` entries that are missing a location
     */
    public toDiagnostic(diagnostic: Diagnostic | BsDiagnostic, relatedInformationFallbackLocation: string): Diagnostic {
        let relatedInformation = diagnostic.relatedInformation ?? [];
        if (relatedInformation.length > MAX_RELATED_INFOS_COUNT) {
            const relatedInfoLength = relatedInformation.length;
            relatedInformation = relatedInformation.slice(0, MAX_RELATED_INFOS_COUNT);
            relatedInformation.push({
                message: `...and ${relatedInfoLength - MAX_RELATED_INFOS_COUNT} more`,
                location: util.createLocationFromRange('   ', util.createRange(0, 0, 0, 0))
            });
        }
        let result = {
            severity: diagnostic.severity,
            range: diagnostic.range,
            message: diagnostic.message,
            relatedInformation: relatedInformation.map(x => {

                //clone related information just in case a plugin added circular ref info here
                const clone = { ...x };
                if (!clone.location) {
                    // use the fallback location if available
                    if (relatedInformationFallbackLocation) {
                        clone.location = util.createLocationFromRange(relatedInformationFallbackLocation, diagnostic.range);
                    } else {
                        //remove this related information so it doesn't bring crash the language server
                        return undefined;
                    }
                }
                return clone;
                //filter out null relatedInformation items
            }).filter((x): x is DiagnosticRelatedInformation => Boolean(x)),
            code: diagnostic.code,
            source: 'brs'
        } as Diagnostic;
        if (diagnostic?.tags?.length > 0) {
            result.tags = diagnostic.tags;
        }
        return result;
    }

    /**
     * Get the first locatable item found at the specified position
     * @param locatables an array of items that have a `range` property
     * @param position the position that the locatable must contain
     */
    public getFirstLocatableAt(locatables: Locatable[], position: Position) {
        for (let token of locatables) {
            if (util.rangeContains(token.range, position)) {
                return token;
            }
        }
    }

    /**
     * Sort an array of objects that have a Range
     */
    public sortByRange<T extends { range: Range | undefined }>(locatables: T[]) {
        //sort the tokens by range
        return locatables.sort((a, b) => {
            //handle undefined tokens to prevent crashes
            if (!a?.range) {
                return 1;
            }
            if (!b?.range) {
                return -1;
            }

            //start line
            if (a.range.start.line < b.range.start.line) {
                return -1;
            }
            if (a.range.start.line > b.range.start.line) {
                return 1;
            }
            //start char
            if (a.range.start.character < b.range.start.character) {
                return -1;
            }
            if (a.range.start.character > b.range.start.character) {
                return 1;
            }
            //end line
            if (a.range.end.line < b.range.end.line) {
                return -1;
            }
            if (a.range.end.line > b.range.end.line) {
                return 1;
            }
            //end char
            if (a.range.end.character < b.range.end.character) {
                return -1;
            } else if (a.range.end.character > b.range.end.character) {
                return 1;
            }
            return 0;
        });
    }

    /**
     * Split the given text and return ranges for each chunk.
     * Only works for single-line strings
     */
    public splitGetRange(separator: string, text: string, range: Range) {
        const chunks = text.split(separator);
        const result = [] as Array<{ text: string; range: Range }>;
        let offset = 0;
        for (let chunk of chunks) {
            //only keep nonzero chunks
            if (chunk.length > 0) {
                result.push({
                    text: chunk,
                    range: this.createRange(
                        range.start.line,
                        range.start.character + offset,
                        range.end.line,
                        range.start.character + offset + chunk.length
                    )
                });
            }
            offset += chunk.length + separator.length;
        }
        return result;
    }

    /**
     * Wrap the given code in a markdown code fence (with the language)
     */
    public mdFence(code: string, language = '') {
        return '```' + language + '\n' + code + '\n```';
    }

    /**
     * Gets each part of the dotted get.
     * @param node any ast expression
     * @returns an array of the parts of the dotted get. If not fully a dotted get, then returns undefined
     */
    public getAllDottedGetParts(node: AstNode): Identifier[] | undefined {
        //this is a hot function and has been optimized. Don't rewrite unless necessary
        const parts: Identifier[] = [];
        let nextPart = node;
        loop: while (nextPart) {
            switch (nextPart?.kind) {
                case AstNodeKind.AssignmentStatement:
                    return [(node as AssignmentStatement).tokens.name];
                case AstNodeKind.DottedGetExpression:
                    parts.push((nextPart as DottedGetExpression)?.tokens.name);
                    nextPart = (nextPart as DottedGetExpression).obj;
                    continue;
                case AstNodeKind.CallExpression:
                    nextPart = (nextPart as CallExpression).callee;
                    continue;
                case AstNodeKind.TypeExpression:
                    nextPart = (nextPart as TypeExpression).expression;
                    continue;
                case AstNodeKind.VariableExpression:
                    parts.push((nextPart as VariableExpression)?.tokens.name);
                    break loop;
                case AstNodeKind.LiteralExpression:
                    parts.push((nextPart as LiteralExpression)?.tokens.value as Identifier);
                    break loop;
                case AstNodeKind.IndexedGetExpression:
                    nextPart = (nextPart as unknown as IndexedGetExpression).obj;
                    continue;
                case AstNodeKind.FunctionParameterExpression:
                    return [(nextPart as FunctionParameterExpression).tokens.name];
                case AstNodeKind.GroupingExpression:
                    parts.push(createIdentifier('()', nextPart.location));
                    break loop;
                default:
                    //we found a non-DottedGet expression, so return because this whole operation is invalid.
                    return undefined;
            }
        }
        return parts.reverse();
    }

    /**
     * Given an expression, return all the DottedGet name parts as a string.
     * Mostly used to convert namespaced item full names to a strings
     */
    public getAllDottedGetPartsAsString(node: Expression | Statement, parseMode = ParseMode.BrighterScript): string {
        //this is a hot function and has been optimized. Don't rewrite unless necessary
        /* eslint-disable no-var */
        var sep = parseMode === ParseMode.BrighterScript ? '.' : '_';
        const parts = this.getAllDottedGetParts(node) ?? [];
        var result = parts[0]?.text;
        for (var i = 1; i < parts.length; i++) {
            result += sep + parts[i].text;
        }
        return result;
        /* eslint-enable no-var */
    }

    public stringJoin(strings: string[], separator: string) {
        // eslint-disable-next-line no-var
        var result = strings[0] ?? '';
        // eslint-disable-next-line no-var
        for (var i = 1; i < strings.length; i++) {
            result += separator + strings[i];
        }
        return result;
    }

    /**
     * Break an expression into each part.
     */
    public splitExpression(expression: Expression) {
        const parts: Expression[] = [expression];
        let nextPart = expression;
        while (nextPart) {
            if (isDottedGetExpression(nextPart) || isIndexedGetExpression(nextPart) || isXmlAttributeGetExpression(nextPart)) {
                nextPart = nextPart.obj;

            } else if (isCallExpression(nextPart) || isCallfuncExpression(nextPart)) {
                nextPart = nextPart.callee;

            } else if (isTypeExpression(nextPart)) {
                nextPart = nextPart.expression;
            } else {
                break;
            }
            parts.unshift(nextPart);
        }
        return parts;
    }

    /**
     * Break an expression into each part, and return any VariableExpression or DottedGet expresisons from left-to-right.
     */
    public getDottedGetPath(expression: Expression): [VariableExpression, ...DottedGetExpression[]] {
        let parts: Expression[] = [];
        let nextPart = expression;
        loop: while (nextPart) {
            switch (nextPart?.kind) {
                case AstNodeKind.DottedGetExpression:
                    parts.push(nextPart);
                    nextPart = (nextPart as DottedGetExpression).obj;
                    continue;
                case AstNodeKind.IndexedGetExpression:
                case AstNodeKind.XmlAttributeGetExpression:
                    nextPart = (nextPart as IndexedGetExpression | XmlAttributeGetExpression).obj;
                    parts = [];
                    continue;
                case AstNodeKind.CallExpression:
                case AstNodeKind.CallfuncExpression:
                    nextPart = (nextPart as CallExpression | CallfuncExpression).callee;
                    parts = [];
                    continue;
                case AstNodeKind.NewExpression:
                    nextPart = (nextPart as NewExpression).call.callee;
                    parts = [];
                    continue;
                case AstNodeKind.TypeExpression:
                    nextPart = (nextPart as TypeExpression).expression;
                    continue;
                case AstNodeKind.VariableExpression:
                    parts.push(nextPart);
                    break loop;
                default:
                    return [] as any;
            }
        }
        return parts.reverse() as any;
    }

    /**
     * Returns an integer if valid, or undefined. Eliminates checking for NaN
     */
    public parseInt(value: any) {
        const result = parseInt(value);
        if (!isNaN(result)) {
            return result;
        } else {
            return undefined;
        }
    }

    /**
     * Converts a range to a string in the format 1:2-3:4
     */
    public rangeToString(range: Range) {
        return `${range?.start?.line}:${range?.start?.character}-${range?.end?.line}:${range?.end?.character}`;
    }

    public validateTooDeepFile(file: (BrsFile | XmlFile)) {
        //find any files nested too deep
        let destPath = file?.destPath?.toString();
        let rootFolder = destPath?.replace(/^pkg:/, '').split(/[\\\/]/)[0].toLowerCase();

        if (isBrsFile(file) && rootFolder !== 'source') {
            return;
        }

        if (isXmlFile(file) && rootFolder !== 'components') {
            return;
        }

        let fileDepth = this.getParentDirectoryCount(destPath);
        if (fileDepth >= 8) {
            file.program?.diagnostics.register({
                ...DiagnosticMessages.detectedTooDeepFileSource(fileDepth),
                file: file,
                range: this.createRange(0, 0, 0, Number.MAX_VALUE)
            });
        }
    }

    /**
     * Wraps SourceNode's constructor to be compatible with the TranspileResult type
     */
    public sourceNodeFromTranspileResult(
        line: number | null,
        column: number | null,
        source: string | null,
        chunks?: string | SourceNode | TranspileResult,
        name?: string
    ): SourceNode {
        // we can use a typecast rather than actually transforming the data because SourceNode
        // accepts a more permissive type than its typedef states
        return new SourceNode(line, column, source, chunks as any, name);
    }

    /**
     * Find the index of the last item in the array that matches.
     */
    public findLastIndex<T>(array: T[], matcher: (T) => boolean) {
        for (let i = array.length - 1; i >= 0; i--) {
            if (matcher(array[i])) {
                return i;
            }
        }
    }

    public processTypeChain(typeChain: TypeChainEntry[]): TypeChainProcessResult {
        let fullChainName = '';
        let fullErrorName = '';
        let itemName = '';
        let previousTypeName = '';
        let parentTypeName = '';
        let itemTypeKind = '';
        let parentTypeKind = '';
        let astNode: AstNode;
        let errorRange: Range;
        let containsDynamic = false;
        let continueResolvingAllItems = true;
        for (let i = 0; i < typeChain.length; i++) {
            const chainItem = typeChain[i];
            const dotSep = chainItem.separatorToken?.text ?? '.';
            if (i > 0) {
                fullChainName += dotSep;
            }
            fullChainName += chainItem.name;
            if (continueResolvingAllItems) {
                parentTypeName = previousTypeName;
                parentTypeKind = itemTypeKind;
                fullErrorName = previousTypeName ? `${previousTypeName}${dotSep}${chainItem.name}` : chainItem.name;
                itemTypeKind = (chainItem.type as any)?.kind;

                let typeString = chainItem.type?.toString();
                let typeToFindStringFor = chainItem.type;
                while (typeToFindStringFor) {
                    if (isUnionType(chainItem.type)) {
                        typeString = `(${typeToFindStringFor.toString()})`;
                        break;
                    } else if (isCallableType(typeToFindStringFor)) {
                        if (isTypedFunctionType(typeToFindStringFor) && i < typeChain.length - 1) {
                            typeToFindStringFor = typeToFindStringFor.returnType;
                        } else {
                            typeString = 'function';
                            break;
                        }
                        parentTypeName = previousTypeName;
                    } else if (isNamespaceType(typeToFindStringFor) && parentTypeName) {
                        const chainItemTypeName = typeToFindStringFor.toString();
                        typeString = parentTypeName + '.' + chainItemTypeName;
                        if (chainItemTypeName.toLowerCase().startsWith(parentTypeName.toLowerCase())) {
                            // the following namespace already knows...
                            typeString = chainItemTypeName;
                        }
                        break;
                    } else {
                        typeString = typeToFindStringFor?.toString();
                        break;
                    }
                }

                previousTypeName = typeString ?? '';
                itemName = chainItem.name;
                astNode = chainItem.astNode;
                containsDynamic = containsDynamic || (isDynamicType(chainItem.type) && !isAnyReferenceType(chainItem.type));
                if (!chainItem.isResolved) {
                    errorRange = chainItem.range;
                    continueResolvingAllItems = false;
                }
            }
        }
        return {
            itemName: itemName,
            itemTypeKind: itemTypeKind,
            itemParentTypeName: parentTypeName,
            itemParentTypeKind: parentTypeKind,
            fullNameOfItem: fullErrorName,
            fullChainName: fullChainName,
            range: errorRange,
            containsDynamic: containsDynamic,
            astNode: astNode
        };
    }


    public isInTypeExpression(expression: AstNode): boolean {
        //TODO: this is much faster than node.findAncestor(), but may need to be updated for "complicated" type expressions
        if (isTypeExpression(expression) ||
            isTypeExpression(expression.parent) ||
            isTypedArrayExpression(expression) ||
            isTypedArrayExpression(expression.parent)) {
            return true;
        }
        if (isBinaryExpression(expression.parent)) {
            let currentExpr: AstNode = expression.parent;
            while (isBinaryExpression(currentExpr) && currentExpr.tokens.operator.kind === TokenKind.Or) {
                currentExpr = currentExpr.parent;
            }
            return isTypeExpression(currentExpr) || isTypedArrayExpression(currentExpr);
        }
        return false;
    }

    public hasAnyRequiredSymbolChanged(requiredSymbols: UnresolvedSymbol[], changedSymbols: Map<SymbolTypeFlag, Set<string>>) {
        if (!requiredSymbols || !changedSymbols) {
            return false;
        }
        const runTimeChanges = changedSymbols.get(SymbolTypeFlag.runtime);
        const typeTimeChanges = changedSymbols.get(SymbolTypeFlag.typetime);

        for (const symbol of requiredSymbols) {
            if (this.setContainsUnresolvedSymbol(runTimeChanges, symbol) || this.setContainsUnresolvedSymbol(typeTimeChanges, symbol)) {
                return true;
            }
        }

        return false;
    }

    public setContainsUnresolvedSymbol(symbolLowerNameSet: Set<string>, symbol: UnresolvedSymbol) {
        if (!symbolLowerNameSet || symbolLowerNameSet.size === 0) {
            return false;
        }

        for (const possibleNameLower of symbol.lookups) {
            if (symbolLowerNameSet.has(possibleNameLower)) {
                return true;
            }
        }
        return false;
    }

    public truncate<T>(options: {
        leadingText: string;
        items: T[];
        trailingText?: string;
        maxLength: number;
        itemSeparator?: string;
        partBuilder?: (item: T) => string;
    }): string {
        let leadingText = options.leadingText;
        let items = options?.items ?? [];
        let trailingText = options?.trailingText ?? '';
        let maxLength = options?.maxLength ?? 160;
        let itemSeparator = options?.itemSeparator ?? ', ';
        let partBuilder = options?.partBuilder ?? ((x) => x.toString());

        let parts = [];
        let length = leadingText.length + (trailingText?.length ?? 0);

        //calculate the max number of items we could fit in the given space
        for (let i = 0; i < items.length; i++) {
            let part = partBuilder(items[i]);
            if (i > 0) {
                part = itemSeparator + part;
            }
            parts.push(part);
            length += part.length;
            //exit the loop if we've maxed out our length
            if (length >= maxLength) {
                break;
            }
        }
        let message: string;
        //we have enough space to include all the parts
        if (parts.length >= items.length) {
            message = leadingText + parts.join('') + trailingText;

            //we require truncation
        } else {
            //account for truncation message length including max possible "more" items digits, trailing text length, and the separator between last item and trailing text
            length = leadingText.length + `...and ${items.length} more`.length + itemSeparator.length + (trailingText?.length ?? 0);
            message = leadingText;
            for (let i = 0; i < parts.length; i++) {
                //always include at least 2 items. if this part would overflow the max, then skip it and finalize the message
                if (i > 1 && length + parts[i].length > maxLength) {
                    message += itemSeparator + `...and ${items.length - i} more` + trailingText;
                    return message;
                } else {
                    message += parts[i];
                    length += parts[i].length;
                }
            }
        }
        return message;
    }

    public getAstNodeFriendlyName(node: AstNode) {
        return node?.kind.replace(/Statement|Expression/g, '');
    }


    public hasLeadingComments(input: Token | AstNode) {
        const leadingTrivia = isToken(input) ? input?.leadingTrivia : input?.getLeadingTrivia() ?? [];
        return !!leadingTrivia.find(t => t.kind === TokenKind.Comment);
    }

    public getLeadingComments(input: Token | AstNode) {
        const leadingTrivia = isToken(input) ? input?.leadingTrivia : input?.getLeadingTrivia() ?? [];
        return leadingTrivia.filter(t => t.kind === TokenKind.Comment);
    }

    public isLeadingCommentOnSameLine(line: RangeLike, input: Token | AstNode) {
        const leadingCommentRange = this.getLeadingComments(input)?.[0];
        if (leadingCommentRange) {
            return this.linesTouch(line, leadingCommentRange?.location);
        }
        return false;
    }

    public isClassUsedAsFunction(potentialClassType: BscType, expression: Expression, options: GetTypeOptions) {
        // eslint-disable-next-line no-bitwise
        if ((options?.flags ?? 0) & SymbolTypeFlag.runtime &&
            isClassType(potentialClassType) &&
            !options.isExistenceTest &&
            potentialClassType.name.toLowerCase() === this.getAllDottedGetPartsAsString(expression).toLowerCase() &&
            !expression.findAncestor(isNewExpression)) {
            return true;
        }
        return false;
    }

    public getSpecialCaseCallExpressionReturnType(callExpr: CallExpression) {
        if (isVariableExpression(callExpr.callee) && callExpr.callee.tokens.name.text.toLowerCase() === 'createobject') {
            const componentName = isLiteralString(callExpr.args[0]) ? callExpr.args[0].tokens.value?.text?.replace(/"/g, '') : '';
            const nodeType = componentName.toLowerCase() === 'rosgnode' && isLiteralString(callExpr.args[1]) ? callExpr.args[1].tokens.value?.text?.replace(/"/g, '') : '';
            if (componentName?.toLowerCase().startsWith('ro')) {
                const fullName = componentName + nodeType;
                const data = {};
                const symbolTable = callExpr.getSymbolTable();
                const foundType = symbolTable.getSymbolType(fullName, {
                    flags: SymbolTypeFlag.typetime,
                    data: data,
                    tableProvider: () => callExpr?.getSymbolTable(),
                    fullName: fullName
                });
                if (foundType) {
                    return foundType;
                }
            }
        }
    }
}

/**
 * A tagged template literal function for standardizing the path. This has to be defined as standalone function since it's a tagged template literal function,
 * we can't use `object.tag` syntax.
 */
export function standardizePath(stringParts, ...expressions: any[]) {
    let result: string[] = [];
    for (let i = 0; i < stringParts.length; i++) {
        result.push(stringParts[i], expressions[i]);
    }
    return util.driveLetterToLower(
        rokuDeployStandardizePath(
            result.join('')
        )
    );
}

/**
 * An item that can be coerced into a range
 */
export type RangeLike = { location?: Location } | Location | { range?: Range } | Range | undefined;

export let util = new Util();
export default util;
