import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import type { ParseError } from 'jsonc-parser';
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import * as path from 'path';
import * as rokuDeploy from 'roku-deploy';
import type { Diagnostic, Position, Range } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import * as xml2js from 'xml2js';
import type { BsConfig } from './BsConfig';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { CallableContainer, BsDiagnostic, FileReference, CallableContainerMap, CompilerPluginFactory, CompilerPlugin, ExpressionInfo, FunctionCall } from './interfaces';
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
import type { DottedGetExpression, Expression, VariableExpression } from './parser/Expression';
import { Logger, LogLevel } from './Logger';
import type { Token } from './lexer';
import { TokenKind } from './lexer';
import { isDottedGetExpression, isExpression, isVariableExpression, WalkMode } from './astUtils';
import { CustomType } from './types/CustomType';
import { SourceNode } from 'source-map';
import type { SGAttribute } from './parser/SGTypes';

export class Util {
    public clearConsole() {
        // process.stdout.write('\x1Bc');
    }

    /**
     * Determine if the file exists
     * @param filePath
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
     * @param filePath
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
    public getRokuPkgPath(pkgPath: string) {
        pkgPath = pkgPath.replace(/\\/g, '/');
        return 'pkg:/' + pkgPath;
    }

    /**
     * Remove any leading or trailing quotemark from the given text
     */
    public removeEnclosingQuotes(text: string) {
        let start = 0;
        let end = text.length;
        if (text.startsWith('"')) {
            start = 1;
        }
        if (text.endsWith('"')) {
            end = text.length - 1;
        }
        if (start > 0 || end < text.length) {
            return text.substring(start, end);
        } else {
            return text;
        }
    }

    /**
     * Given a path to a file/directory, replace all path separators with the current system's version.
     * @param filePath
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
     * @param configFilePath
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
     * @param configFilePath
     * @param parentProjectPaths
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
            let projectConfig = parseJsonc(projectFileContents, parseErrors) as BsConfig;
            if (parseErrors.length > 0) {
                let err = parseErrors[0];
                let diagnostic = {
                    ...DiagnosticMessages.bsConfigJsonHasSyntaxErrors(printParseErrorCode(parseErrors[0].error)),
                    file: {
                        pathAbsolute: configFilePath
                    },
                    range: this.getRangeFromOffsetLength(projectFileContents, err.offset, err.length)
                } as BsDiagnostic;
                throw diagnostic; //eslint-disable-line @typescript-eslint/no-throw-literal
            }
            this.resolvePluginPaths(projectConfig, configFilePath);

            let projectFileCwd = path.dirname(configFilePath);

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
     * Relative paths to scripts in plugins should be resolved relatively to the bsconfig file
     * and de-duplicated
     * @param config Parsed configuration
     * @param configFilePath Path of the configuration file
     */
    public resolvePluginPaths(config: BsConfig, configFilePath: string) {
        if (config.plugins?.length > 0) {
            const relPath = path.dirname(configFilePath);
            const exists: Record<string, boolean> = {};
            config.plugins = config.plugins.map(p => {
                return p?.startsWith('.') ? path.resolve(relPath, p) : p;
            }).filter(p => {
                if (!p || exists[p]) {
                    return false;
                }
                exists[p] = true;
                return true;
            });
        }
    }

    /**
     * Do work within the scope of a changed current working directory
     * @param targetCwd
     * @param callback
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
     * @param config
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
     * @param config
     */
    public normalizeConfig(config: BsConfig) {
        config = config || {} as BsConfig;
        config.deploy = config.deploy === true ? true : false;
        //use default options from rokuDeploy
        config.files = config.files ?? rokuDeploy.getOptions().files;
        config.createPackage = config.createPackage === false ? false : true;
        let rootFolderName = path.basename(process.cwd());
        config.outFile = config.outFile ?? `./out/${rootFolderName}.zip`;
        config.sourceMap = config.sourceMap === true;
        config.username = config.username ?? 'rokudev';
        config.watch = config.watch === true ? true : false;
        config.emitFullPaths = config.emitFullPaths === true ? true : false;
        config.retainStagingFolder = config.retainStagingFolder === true ? true : false;
        config.copyToStaging = config.copyToStaging === false ? false : true;
        config.ignoreErrorCodes = config.ignoreErrorCodes ?? [];
        config.diagnosticFilters = config.diagnosticFilters ?? [];
        config.plugins = config.plugins ?? [];
        config.autoImportComponentScript = config.autoImportComponentScript === true ? true : false;
        config.showDiagnosticsInConsole = config.showDiagnosticsInConsole === false ? false : true;
        config.sourceRoot = config.sourceRoot ? standardizePath(config.sourceRoot) : undefined;
        config.cwd = config.cwd ?? process.cwd();
        config.emitDefinitions = config.emitDefinitions === true ? true : false;
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
     * @param options
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
     * Format a string with placeholders replaced by argument indexes
     * @param subject
     * @param params
     */
    public stringFormat(subject: string, ...args) {
        return subject.replace(/{(\d+)}/g, (match, num) => {
            return typeof args[num] !== 'undefined' ? args[num] : match;
        });
    }

    /**
     * Given a list of callables as a dictionary indexed by their full name (namespace included, transpiled to underscore-separated.
     * @param callables
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
     * @param text
     */
    public getLines(text: string) {
        return text.split(/\r?\n/);
    }

    /**
     * Given an absolute path to a source file, and a target path,
     * compute the pkg path for the target relative to the source file's location
     * @param containingFilePathAbsolute
     * @param targetPath
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
     * @param pkgSourcePathAbsolute  - the absolute path to the source relative to the package location
     * @param pkgTargetPathAbsolute  - the absolute path ro the target relative to the package location
     */
    public getRelativePath(pkgSourcePathAbsolute: string, pkgTargetPathAbsolute: string) {
        pkgSourcePathAbsolute = path.normalize(pkgSourcePathAbsolute);
        pkgTargetPathAbsolute = path.normalize(pkgTargetPathAbsolute);

        //break by path separator
        let sourceParts = pkgSourcePathAbsolute.split(path.sep);
        let targetParts = pkgTargetPathAbsolute.split(path.sep);

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
     * Does a touch b in any way?
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
     * Test if `position` is in `range`. If the position is at the edges, will return true.
     * Adapted from core vscode
     * @param range
     * @param position
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
     * @param text
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
     * @param uri
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
     * @param fullPath
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
    public pathToUri(pathAbsolute: string) {
        return URI.file(pathAbsolute).toString();
    }

    /**
     * Get the outDir from options, taking into account cwd and absolute outFile paths
     * @param options
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
     * @param diagnostic
     */
    public diagnosticIsSuppressed(diagnostic: BsDiagnostic) {
        for (let flag of diagnostic.file?.commentFlags ?? []) {
            //this diagnostic is affected by this flag
            if (this.rangeContains(flag.affectedRange, diagnostic.range.start)) {
                //if the flag acts upon this diagnostic's code
                if (flag.codes === null || flag.codes.includes(diagnostic.code as number)) {
                    return true;
                }
            }
        }
    }

    /**
     * Walks up the chain
     * @param currentPath
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
     * @param milliseconds
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
     * @param arr
     * @param cb
     */
    public flatMap<T, R>(array: T[], cb: (arg: T) => R) {
        return Array.prototype.concat.apply([], array.map(cb)) as never as R;
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
     * @param first
     * @param second
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
     * Helper for creating `Range` objects. Prefer using this function because vscode-languageserver's `util.createRange()` is significantly slower
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
        let leftmost: { range?: Range };
        let rightmost: { range?: Range };

        for (let i = 0; i < locatables.length; i++) {
            //set the leftmost non-null-range item
            const left = locatables[i];
            if (!leftmost && left?.range) {
                leftmost = left;
            }

            //set the rightmost non-null-range item
            const right = locatables[locatables.length - 1 - i];
            if (!rightmost && right?.range) {
                rightmost = right;
            }

            //if we have both sides, quit
            if (leftmost && rightmost) {
                break;
            }
        }
        if (leftmost) {
            return this.createRangeFromPositions(leftmost.range.start, rightmost.range.end);
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
        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            result += token.leadingWhitespace + token.text;
        }
        return result;
    }

    /**
     * Convert a token into a BscType
     */
    public tokenToBscType(token: Token, allowCustomType = true) {
        if (!token) {
            return new DynamicType();
        }
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
        switch (token.kind) {
            case TokenKind.Boolean:
            case TokenKind.True:
            case TokenKind.False:
                return new BooleanType();
            case TokenKind.Double:
            case TokenKind.DoubleLiteral:
                return new DoubleType();
            case TokenKind.Dynamic:
                return new DynamicType();
            case TokenKind.Float:
            case TokenKind.FloatLiteral:
                return new FloatType();
            case TokenKind.Function:
                //TODO should there be a more generic function type without a signature that's assignable to all other function types?
                return new FunctionType(new DynamicType());
            case TokenKind.Integer:
            case TokenKind.IntegerLiteral:
                return new IntegerType();
            case TokenKind.Invalid:
                return new InvalidType();
            case TokenKind.LongInteger:
            case TokenKind.LongIntegerLiteral:
                return new LongIntegerType();
            case TokenKind.Object:
                return new ObjectType();
            case TokenKind.String:
            case TokenKind.StringLiteral:
            case TokenKind.TemplateStringExpressionBegin:
            case TokenKind.TemplateStringExpressionEnd:
            case TokenKind.TemplateStringQuasi:
                return new StringType();
            case TokenKind.Void:
                return new VoidType();
            case TokenKind.Identifier:
                switch (token.text.toLowerCase()) {
                    case 'boolean':
                        return new BooleanType();
                    case 'double':
                        return new DoubleType();
                    case 'float':
                        return new FloatType();
                    case 'function':
                        return new FunctionType(new DynamicType());
                    case 'integer':
                        return new IntegerType();
                    case 'invalid':
                        return new InvalidType();
                    case 'longinteger':
                        return new LongIntegerType();
                    case 'object':
                        return new ObjectType();
                    case 'string':
                        return new StringType();
                    case 'void':
                        return new VoidType();
                }
                if (allowCustomType) {
                    return new CustomType(token.text);
                }
        }
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
                    const loaded = this.resolveRequire(cwd, pathOrModule);
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
                } catch (err) {
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

    public resolveRequire(cwd: string, pathOrModule: string) {
        let target = pathOrModule;
        if (!path.isAbsolute(pathOrModule)) {
            const localPath = path.resolve(cwd, pathOrModule);
            if (fs.existsSync(localPath)) {
                target = localPath;
            } else {
                const modulePath = path.resolve(cwd, 'node_modules', pathOrModule);
                if (fs.existsSync(modulePath)) {
                    target = modulePath;
                }
            }
        }
        // eslint-disable-next-line
        return require(target);
    }

    /**
     * Gathers expressions, variables, and unique names from an expression.
     * This is mostly used for the ternary expression
     */
    public getExpressionInfo(expression: Expression): ExpressionInfo {
        const expressions = [expression];
        const variableExpressions = [] as VariableExpression[];
        const uniqueVarNames = new Set<string>();

        // Collect all expressions. Most of these expressions are fairly small so this should be quick!
        // This should only be called during transpile time and only when we actually need it.
        expression?.walk((expression) => {
            if (isExpression(expression)) {
                expressions.push(expression);
            }
            if (isVariableExpression(expression)) {
                variableExpressions.push(expression);
                uniqueVarNames.add(expression.tokens.name.text);
            }
        }, {
            walkMode: WalkMode.visitExpressions
        });
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
     * Creates a new SGAttribute object, but keeps the existing Range references (since those shouldn't ever get changed directly)
     */
    public cloneSGAttribute(attr: SGAttribute, value: string) {
        return {
            key: {
                text: attr.key.text,
                range: attr.range
            },
            value: {
                text: value,
                range: attr.value.range
            },
            range: attr.range
        } as SGAttribute;
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
     * Given a Diagnostic or BsDiagnostic, return a copy of the diagnostic
     */
    public toDiagnostic(diagnostic: Diagnostic | BsDiagnostic) {
        return {
            severity: diagnostic.severity,
            range: diagnostic.range,
            message: diagnostic.message,
            relatedInformation: diagnostic.relatedInformation?.map(x => {
                //clone related information just in case a plugin added circular ref info here
                return { ...x };
            }),
            code: diagnostic.code,
            source: 'brs'
        };
    }

    /**
     * Finds the array of callables from a container map, taking into account the function from which it was called
     * If the callable was called in a function in a namespace, functions in that namespace are preferred
     * @return an array with callable containers - could be empty if nothing was found
     */
    public getCallableContainersFromContainerMapByFunctionCall(callablesByLowerName: CallableContainerMap, expCall: FunctionCall): CallableContainer[] {
        let callablesWithThisName: CallableContainer[] = [];
        const lowerName = expCall.name.toLowerCase();
        if (expCall.functionExpression.namespaceName) {
            // prefer namespaced function
            const potentialNamespacedCallable = expCall.functionExpression.namespaceName.getName(ParseMode.BrightScript).toLowerCase() + '_' + lowerName;
            callablesWithThisName = callablesByLowerName.get(potentialNamespacedCallable.toLowerCase());
        }
        if (!callablesWithThisName || callablesWithThisName.length === 0) {
            // just try it as is
            callablesWithThisName = callablesByLowerName.get(lowerName);
        }
        return callablesWithThisName;
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
        rokuDeploy.standardizePath(
            result.join('')
        )
    );
}


export let util = new Util();
export default util;
