import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import type { ParseError } from 'jsonc-parser';
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import * as path from 'path';
import { rokuDeploy, DefaultFiles, standardizePath as rokuDeployStandardizePath } from 'roku-deploy';
import type { Diagnostic, Position, Range, Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import * as xml2js from 'xml2js';
import type { BsConfig } from './BsConfig';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { CallableContainer, BsDiagnostic, FileReference, CallableContainerMap, CompilerPluginFactory, CompilerPlugin, ExpressionInfo, TypeChainEntry, TypeChainProcessResult } from './interfaces';
import { BooleanType } from './types/BooleanType';
import { DoubleType } from './types/DoubleType';
import { DynamicType } from './types/DynamicType';
import { FloatType } from './types/FloatType';
import { FunctionType } from './types/FunctionType';
import { IntegerType } from './types/IntegerType';
import { InvalidType } from './types/InvalidType';
import { LongIntegerType } from './types/LongIntegerType';
import { ObjectType } from './types/ObjectType';
import { StringType } from './types/StringType';
import { VoidType } from './types/VoidType';
import { ParseMode } from './parser/Parser';
import type { CallExpression, CallfuncExpression, DottedGetExpression, FunctionParameterExpression, IndexedGetExpression, LiteralExpression, NewExpression, TypeExpression, VariableExpression, XmlAttributeGetExpression } from './parser/Expression';
import { Logger, LogLevel } from './Logger';
import type { Identifier, Locatable, Token } from './lexer/Token';
import { TokenKind } from './lexer/TokenKind';
import { isBooleanType, isBrsFile, isCallExpression, isCallfuncExpression, isDottedGetExpression, isDoubleType, isExpression, isFloatType, isIndexedGetExpression, isIntegerType, isInvalidType, isLongIntegerType, isStringType, isTypeExpression, isVariableExpression, isXmlAttributeGetExpression, isXmlFile } from './astUtils/reflection';
import { WalkMode } from './astUtils/visitors';
import { SourceNode } from 'source-map';
import * as requireRelative from 'require-relative';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import type { AstNode } from './parser/AstNode';
import { AstNodeKind, type Expression, type Statement } from './parser/AstNode';
import { createIdentifier } from './astUtils/creators';
import type { BscType } from './types/BscType';
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
        return fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory();
    }

    /**
     * Given a pkg path of any kind, transform it to a roku-specific pkg path (i.e. "pkg:/some/path.brs")
     */
    public sanitizePkgPath(pkgPath: string) {
        pkgPath = pkgPath.replace(/\\/g, '/');
        //if there's no protocol, assume it's supposed to start with `pkg:/`
        if (!this.startsWithProtocol(pkgPath)) {
            pkgPath = 'pkg:/' + pkgPath;
        }
        return pkgPath;
    }

    /**
     * Determine if the given path starts with a protocol
     */
    public startsWithProtocol(path: string) {
        return !!/^[-a-z]+:\//i.exec(path);
    }

    /**
     * Given a pkg path of any kind, transform it to a roku-specific pkg path (i.e. "pkg:/some/path.brs")
     */
    public getRokuPkgPath(pkgPath: string) {
        pkgPath = pkgPath.replace(/\\/g, '/');
        return 'pkg:/' + pkgPath;
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
    public loadConfigFile(configFilePath: string, parentProjectPaths?: string[], cwd = process.cwd()) {
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
    public cwdWork<T>(targetCwd: string | null | undefined, callback: () => T) {
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
            return result;
        }
    }

    /**
     * Given a BsConfig object, start with defaults,
     * merge with bsconfig.json and the provided options.
     * @param config a bsconfig object to use as the baseline for the resulting config
     */
    public normalizeAndResolveConfig(config: BsConfig) {
        let result = this.normalizeConfig({});

        //if no options were provided, try to find a bsconfig.json file
        if (!config || !config.project) {
            result.project = this.getConfigFilePath(config?.cwd);
        } else {
            //use the config's project link
            result.project = config.project;
        }
        if (result.project) {
            let configFile = this.loadConfigFile(result.project, null, config?.cwd);
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
    public normalizeConfig(config: BsConfig) {
        config = config || {} as BsConfig;
        config.cwd = config.cwd ?? process.cwd();
        config.deploy = config.deploy === true ? true : false;
        //use default files array from rokuDeploy
        config.files = config.files ?? [...DefaultFiles];
        config.createPackage = config.createPackage === false ? false : true;
        let rootFolderName = path.basename(config.cwd);
        config.outFile = config.outFile ?? `./out/${rootFolderName}.zip`;
        config.sourceMap = config.sourceMap === true;
        config.username = config.username ?? 'rokudev';
        config.watch = config.watch === true ? true : false;
        config.emitFullPaths = config.emitFullPaths === true ? true : false;
        config.retainStagingDir = config.retainStagingDir ?? false;
        config.copyToStaging = config.copyToStaging === false ? false : true;
        config.ignoreErrorCodes = config.ignoreErrorCodes ?? [];
        config.diagnosticSeverityOverrides = config.diagnosticSeverityOverrides ?? {};
        config.diagnosticFilters = config.diagnosticFilters ?? [];
        config.plugins = config.plugins ?? [];
        config.autoImportComponentScript = config.autoImportComponentScript === true ? true : false;
        config.showDiagnosticsInConsole = config.showDiagnosticsInConsole === false ? false : true;
        config.sourceRoot = config.sourceRoot ? standardizePath(config.sourceRoot) : undefined;
        config.allowBrighterScriptInBrightScript = config.allowBrighterScriptInBrightScript === true ? true : false;
        config.emitDefinitions = config.emitDefinitions === true ? true : false;
        config.removeParameterTypes = config.removeParameterTypes === true ? true : false;
        config.enableTypeValidation = config.enableTypeValidation === true ? true : false;
        if (typeof config.logLevel === 'string') {
            config.logLevel = LogLevel[(config.logLevel as string).toLowerCase()];
        }
        config.logLevel = config.logLevel ?? LogLevel.log;
        return config;
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
        //if the target starts with 'pkg:', it's an absolute path. Return as is
        if (targetPath.startsWith('pkg:/')) {
            targetPath = targetPath.substring(5);
            if (targetPath === '') {
                return null;
            } else {
                return path.normalize(targetPath);
            }
        }
        if (targetPath === 'pkg:') {
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
    public rangesIntersect(a: Range, b: Range) {
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
    public rangesIntersectOrTouch(a: Range, b: Range) {
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
    public rangeContains(range: Range, position: Position) {
        return this.comparePositionToRange(position, range) === 0;
    }

    public comparePositionToRange(position: Position, range: Range) {
        if (position.line < range.start.line || (position.line === range.start.line && position.character < range.start.character)) {
            return -1;
        }
        if (position.line > range.end.line || (position.line === range.end.line && position.character > range.end.character)) {
            return 1;
        }
        return 0;
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
    public getOutDir(options: BsConfig) {
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
    public async getFilePaths(options: BsConfig) {
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
                if (flag.codes === null || flag.codes.includes(diagnosticCode)) {
                    return true;
                }
            }
        }
    }

    /**
     * Walks up the chain to find the closest bsconfig.json file
     */
    public async findClosestConfigFile(currentPath: string) {
        //make the path absolute
        currentPath = path.resolve(
            path.normalize(
                currentPath
            )
        );

        let previousPath: string;
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
    public flatMap<T, R>(array: T[], callback: (arg: T) => R) {
        return Array.prototype.concat.apply([], array.map(callback)) as never as R;
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
     * Get a location object back by extracting location information from other objects that contain location
     */
    public getRange(startObj: { range: Range }, endObj: { range: Range }): Range {
        return util.createRangeFromPositions(startObj.range.start, endObj.range.end);
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
    public linesTouch(first: { range: Range }, second: { range: Range }) {
        if (first && second && (
            first.range.start.line === second.range.start.line ||
            first.range.start.line === second.range.end.line ||
            first.range.end.line === second.range.start.line ||
            first.range.end.line === second.range.end.line
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
    public getScriptImportAtPosition(scriptImports: FileReference[], position: Position) {
        let scriptImport = scriptImports.find((x) => {
            return x.filePathRange.start.line === position.line &&
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

    public getTextForRange(string: string | string[], range: Range) {
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
        rangeLines.push(lastLine.substring(0, endCharacter));
        return rangeLines.join('\n');
    }

    /**
     * Helper for creating `Location` objects. Prefer using this function because vscode-languageserver's `Location.create()` is significantly slower at scale
     */
    public createLocation(uri: string, range: Range): Location {
        return {
            uri: uri,
            range: range
        };
    }

    /**
     * Helper for creating `Range` objects. Prefer using this function because vscode-languageserver's `Range.create()` is significantly slower
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
        return {
            start: {
                line: startPosition.line,
                character: startPosition.character
            },
            end: {
                line: endPosition.line,
                character: endPosition.character
            }
        };
    }

    /**
     * Given a list of ranges, create a range that starts with the first non-null lefthand range, and ends with the first non-null
     * righthand range. Returns undefined if none of the items have a range.
     */
    public createBoundingRange(...locatables: Array<{ range?: Range }>) {
        let leftmostRange: Range;
        let rightmostRange: Range;

        for (let i = 0; i < locatables.length; i++) {
            //set the leftmost non-null-range item
            const left = locatables[i];
            //the range might be a getter, so access it exactly once
            const leftRange = left?.range;
            if (!leftmostRange && leftRange) {
                leftmostRange = leftRange;
            }

            //set the rightmost non-null-range item
            const right = locatables[locatables.length - 1 - i];
            //the range might be a getter, so access it exactly once
            const rightRange = right?.range;
            if (!rightmostRange && rightRange) {
                rightmostRange = rightRange;
            }

            //if we have both sides, quit
            if (leftmostRange && rightmostRange) {
                break;
            }
        }
        if (leftmostRange) {
            return this.createRangeFromPositions(leftmostRange.start, rightmostRange.end);
        } else {
            return undefined;
        }
    }

    /**
     * Create a `Position` object. Prefer this over `Position.create` for performance reasons
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
                //TODO should there be a more generic function type without a signature that's assignable to all other function types?
                return new FunctionType(new DynamicType(token.text));
            case TokenKind.Integer:
                return new IntegerType(token.text);
            case TokenKind.IntegerLiteral:
                return IntegerType.instance;
            case TokenKind.Invalid:
                return new InvalidType(token.text);
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
                        return new FunctionType(new DynamicType(token.text));
                    case 'integer':
                        return new IntegerType(token.text);
                    case 'invalid':
                        return new InvalidType(token.text);
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

    public isNumberType(targetType: BscType): boolean {
        return isIntegerType(targetType) ||
            isFloatType(targetType) ||
            isDoubleType(targetType) ||
            isLongIntegerType(targetType);
    }

    /**
     * Return the type of the result of a binary operator
     * Note: compound assignments (eg. +=) internally use a binary expression, so that's why TokenKind.PlusEqual, etc. are here too
     */
    public binaryOperatorResultType(leftType: BscType, operator: Token, rightType: BscType): BscType {
        let hasDouble = isDoubleType(leftType) || isDoubleType(rightType);
        let hasFloat = isFloatType(leftType) || isFloatType(rightType);
        let hasLongInteger = isLongIntegerType(leftType) || isLongIntegerType(rightType);
        let hasInvalid = isInvalidType(leftType) || isInvalidType(rightType);
        let bothNumbers = this.isNumberType(leftType) && this.isNumberType(rightType);
        let bothStrings = isStringType(leftType) && isStringType(rightType);
        let eitherBooleanOrNum = (this.isNumberType(leftType) || isBooleanType(leftType)) && (this.isNumberType(rightType) || isBooleanType(rightType));

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
                // = and <> can accept invalid
                if (hasInvalid || bothStrings || eitherBooleanOrNum) {
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
            // Logical operators
            case TokenKind.Or:
            case TokenKind.And:
                if (eitherBooleanOrNum) {
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
                if (this.isNumberType(exprType)) {
                    // a negative number will be the same type, eg, double->double, int->int, etc.
                    return exprType;
                }
                break;
            case TokenKind.Not:
                if (isBooleanType(exprType)) {
                    return BooleanType.instance;
                } else if (this.isNumberType(exprType)) {
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
     */
    public getExtension(filePath: string) {
        filePath = filePath.toLowerCase();
        if (filePath.endsWith('.d.bs')) {
            return '.d.bs';
        } else {
            const idx = filePath.lastIndexOf('.');
            if (idx > -1) {
                return filePath.substring(idx);
            }
        }
    }

    /**
     * Load and return the list of plugins
     */
    public loadPlugins(cwd: string, pathOrModules: string[], onError?: (pathOrModule: string, err: Error) => void) {
        const logger = new Logger();
        return pathOrModules.reduce<CompilerPlugin[]>((acc, pathOrModule) => {
            if (typeof pathOrModule === 'string') {
                try {
                    const loaded = requireRelative(pathOrModule, cwd);
                    const theExport: CompilerPlugin | CompilerPluginFactory = loaded.default ? loaded.default : loaded;

                    let plugin: CompilerPlugin;

                    // legacy plugins returned a plugin object. If we find that, then add a warning
                    if (typeof theExport === 'object') {
                        logger.warn(`Plugin "${pathOrModule}" was loaded as a singleton. Please contact the plugin author to update to the factory pattern.\n`);
                        plugin = theExport;

                        // the official plugin format is a factory function that returns a new instance of a plugin.
                    } else if (typeof theExport === 'function') {
                        plugin = theExport();
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
    public getExpressionInfo(expression: Expression): ExpressionInfo {
        const expressions = [expression];
        const variableExpressions = [] as VariableExpression[];
        const uniqueVarNames = new Set<string>();

        function expressionWalker(expression) {
            if (isExpression(expression)) {
                expressions.push(expression);
            }
            if (isVariableExpression(expression)) {
                variableExpressions.push(expression);
                uniqueVarNames.add(expression.name.text);
            }
        }

        // Collect all expressions. Most of these expressions are fairly small so this should be quick!
        // This should only be called during transpile time and only when we actually need it.
        expression?.walk(expressionWalker, {
            walkMode: WalkMode.visitExpressions
        });

        //handle the expression itself (for situations when expression is a VariableExpression)
        expressionWalker(expression);

        return { expressions: expressions, varExpressions: variableExpressions, uniqueVarNames: [...uniqueVarNames] };
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
     * Copy the version of bslib from local node_modules to the staging folder
     */
    public async copyBslibToStaging(stagingDir: string) {
        //copy bslib to the output directory
        await fsExtra.ensureDir(standardizePath(`${stagingDir}/source`));
        // eslint-disable-next-line
        const bslib = require('@rokucommunity/bslib');
        let source = bslib.source as string;

        //apply the `bslib_` prefix to the functions
        let match: RegExpExecArray;
        const positions = [] as number[];
        const regexp = /^(\s*(?:function|sub)\s+)([a-z0-9_]+)/mg;
        // eslint-disable-next-line no-cond-assign
        while (match = regexp.exec(source)) {
            positions.push(match.index + match[1].length);
        }

        for (let i = positions.length - 1; i >= 0; i--) {
            const position = positions[i];
            source = source.slice(0, position) + 'bslib_' + source.slice(position);
        }
        await fsExtra.writeFile(`${stagingDir}/source/bslib.brs`, source);
    }

    /**
     * Given a Diagnostic or BsDiagnostic, return a deep clone of the diagnostic.
     * @param diagnostic the diagnostic to clone
     * @param relatedInformationFallbackLocation a default location to use for all `relatedInformation` entries that are missing a location
     */
    public toDiagnostic(diagnostic: Diagnostic | BsDiagnostic, relatedInformationFallbackLocation: string) {
        return {
            severity: diagnostic.severity,
            range: diagnostic.range,
            message: diagnostic.message,
            relatedInformation: diagnostic.relatedInformation?.map(x => {

                //clone related information just in case a plugin added circular ref info here
                const clone = { ...x };
                if (!clone.location) {
                    // use the fallback location if available
                    if (relatedInformationFallbackLocation) {
                        clone.location = util.createLocation(relatedInformationFallbackLocation, diagnostic.range);
                    } else {
                        //remove this related information so it doesn't bring crash the language server
                        return undefined;
                    }
                }
                return clone;
                //filter out null relatedInformation items
            }).filter(x => x),
            code: diagnostic.code,
            source: 'brs'
        };
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
    public sortByRange<T extends Locatable>(locatables: T[]) {
        //sort the tokens by range
        return locatables.sort((a, b) => {
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
                    return [(node as AssignmentStatement).name];
                case AstNodeKind.DottedGetExpression:
                    parts.push((nextPart as DottedGetExpression)?.name);
                    nextPart = (nextPart as DottedGetExpression).obj;
                    continue;
                case AstNodeKind.CallExpression:
                    nextPart = (nextPart as CallExpression).callee;
                    continue;
                case AstNodeKind.TypeExpression:
                    nextPart = (nextPart as TypeExpression).expression;
                    continue;
                case AstNodeKind.VariableExpression:
                    parts.push((nextPart as VariableExpression)?.name);
                    break loop;
                case AstNodeKind.LiteralExpression:
                    parts.push((nextPart as LiteralExpression)?.token as Identifier);
                    break loop;
                case AstNodeKind.IndexedGetExpression:
                    nextPart = (nextPart as IndexedGetExpression).obj;
                    continue;
                case AstNodeKind.FunctionParameterExpression:
                    return [(nextPart as FunctionParameterExpression).name];
                case AstNodeKind.GroupingExpression:
                    parts.push(createIdentifier('()', nextPart.range));
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
        let pkgPath = file.pkgPath ?? file.pkgPath.toString();
        let rootFolder = pkgPath.replace(/^pkg:/, '').split(/[\\\/]/)[0].toLowerCase();

        if (isBrsFile(file) && rootFolder !== 'source') {
            return;
        }

        if (isXmlFile(file) && rootFolder !== 'components') {
            return;
        }

        let fileDepth = this.getParentDirectoryCount(pkgPath);
        if (fileDepth >= 8) {
            file.addDiagnostics([{
                ...DiagnosticMessages.detectedTooDeepFileSource(fileDepth),
                file: file,
                range: this.createRange(0, 0, 0, Number.MAX_VALUE)
            }]);
        }
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
        let errorRange: Range;
        for (let i = 0; i < typeChain.length; i++) {
            const chainItem = typeChain[i];
            if (i > 0) {
                fullChainName += '.';
            }
            fullChainName += chainItem.name;
            parentTypeName = previousTypeName;
            fullErrorName = previousTypeName ? `${previousTypeName}.${chainItem.name}` : chainItem.name;
            previousTypeName = chainItem.type.toString();
            itemName = chainItem.name;
            if (!chainItem.isResolved) {
                errorRange = chainItem.range;
                break;
            }
        }
        return {
            itemName: itemName,
            itemParentTypeName: parentTypeName,
            fullNameOfItem: fullErrorName,
            fullChainName: fullChainName,
            range: errorRange
        };
    }
}

/**
 * A tagged template literal function for standardizing the path. This has to be defined as standalone function since it's a tagged template literal function,
 * we can't use `object.tag` syntax.
 */
export function standardizePath(stringParts, ...expressions: any[]) {
    let result = [];
    for (let i = 0; i < stringParts.length; i++) {
        result.push(stringParts[i], expressions[i]);
    }
    return util.driveLetterToLower(
        rokuDeployStandardizePath(
            result.join('')
        )
    );
}

export let util = new Util();
export default util;
