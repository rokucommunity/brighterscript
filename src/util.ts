import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';
import * as path from 'path';
import * as rokuDeploy from 'roku-deploy';
import { Position, Range, Diagnostic } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import * as xml2js from 'xml2js';

import { BsConfig } from './BsConfig';
import { DiagnosticMessages } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { CallableContainer, ValueKind, BsDiagnostic, FileReference } from './interfaces';
import { BooleanType } from './types/BooleanType';
import { BrsType } from './types/BrsType';
import { DoubleType } from './types/DoubleType';
import { DynamicType } from './types/DynamicType';
import { FloatType } from './types/FloatType';
import { FunctionType } from './types/FunctionType';
import { IntegerType } from './types/IntegerType';
import { InvalidType } from './types/InvalidType';
import { LongIntegerType } from './types/LongIntegerType';
import { ObjectType } from './types/ObjectType';
import { StringType } from './types/StringType';
import { UninitializedType } from './types/UninitializedType';
import { VoidType } from './types/VoidType';
import { ParseMode } from './parser/Parser';
import { DottedGetExpression, VariableExpression } from './parser/Expression';
import { LogLevel } from './Logger';

export class Util {

    public clearConsole() {
        // process.stdout.write('\x1Bc');
    }

    /**
     * Determine if the file exists
     * @param filePath
     */
    public async fileExists(filePath: string | undefined) {
        if (!filePath) {
            return false;
        } else {
            return fsExtra.pathExists(filePath);
        }
    }

    /**
     * Determine if this path is a directory
     */
    public isDirectorySync(dirPath: string | undefined) {
        return fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory();
    }

    /**
     * Load a file from disc into a string
     * @param filePath
     */
    public async getFileContents(filePath: string) {
        let file = await fsExtra.readFile(filePath);
        let fileContents = file.toString();
        return fileContents;
    }

    /**
     * Given a pkg path of any kind, transform it to a roku-specific pkg path (i.e. "pkg:/some/path.brs")
     */
    public getRokuPkgPath(pkgPath: string) {
        pkgPath = pkgPath.replace('\\', '/');
        return 'pkg:/' + pkgPath;
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
    public async getConfigFilePath(cwd?: string) {
        cwd = cwd ? cwd : process.cwd();
        let configPath = path.join(cwd, 'bsconfig.json');
        //find the nearest config file path
        for (let i = 0; i < 100; i++) {
            if (await this.fileExists(configPath)) {
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
        return Range.create(lineIndex, colIndex, lineIndex, colIndex + length);
    }

    /**
     * Load the contents of a config file.
     * If the file extends another config, this will load the base config as well.
     * @param configFilePath
     * @param parentProjectPaths
     */
    public async loadConfigFile(configFilePath: string, parentProjectPaths?: string[]) {
        let cwd = process.cwd();

        if (configFilePath) {
            //keep track of the inheritance chain
            parentProjectPaths = parentProjectPaths ? parentProjectPaths : [];
            configFilePath = path.resolve(configFilePath);
            if (parentProjectPaths?.includes(configFilePath)) {
                parentProjectPaths.push(configFilePath);
                parentProjectPaths.reverse();
                throw new Error('Circular dependency detected: "' + parentProjectPaths.join('" => ') + '"');
            }
            //load the project file
            let projectFileContents = await this.getFileContents(configFilePath);
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

            //set working directory to the location of the project file
            process.chdir(path.dirname(configFilePath));

            let result: BsConfig;
            //if the project has a base file, load it
            if (projectConfig && typeof projectConfig.extends === 'string') {
                let baseProjectConfig = await this.loadConfigFile(projectConfig.extends, [...parentProjectPaths, configFilePath]);
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
                result.outFile = path.resolve(result.outFile);
            }
            if (result.rootDir) {
                result.rootDir = path.resolve(result.rootDir);
            }
            if (result.cwd) {
                result.cwd = path.resolve(result.cwd);
            }

            //restore working directory
            process.chdir(cwd);
            return result;
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
    public async normalizeAndResolveConfig(config: BsConfig) {
        let result = this.normalizeConfig({});

        //if no options were provided, try to find a bsconfig.json file
        if (!config || !config.project) {
            result.project = await this.getConfigFilePath();
        } else {
            //use the config's project link
            result.project = config.project;
        }
        if (result.project) {
            let configFile = await this.loadConfigFile(result.project);
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
        config.username = config.username ?? 'rokudev';
        config.watch = config.watch === true ? true : false;
        config.emitFullPaths = config.emitFullPaths === true ? true : false;
        config.retainStagingFolder = config.retainStagingFolder === true ? true : false;
        config.copyToStaging = config.copyToStaging === false ? false : true;
        config.ignoreErrorCodes = config.ignoreErrorCodes ?? [];
        config.diagnosticFilters = config.diagnosticFilters ?? [];
        config.autoImportComponentScript = config.autoImportComponentScript === true ? true : false;
        config.showDiagnosticsInConsole = config.showDiagnosticsInConsole === false ? false : true;
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

    public valueKindToBrsType(kind: ValueKind): BrsType {
        switch (kind) {
            case ValueKind.Boolean:
                return new BooleanType();
            //TODO refine the function type on the outside (I don't think this ValueKind is actually returned)
            case ValueKind.Callable:
                return new FunctionType(new VoidType());
            case ValueKind.Double:
                return new DoubleType();
            case ValueKind.Dynamic:
                return new DynamicType();
            case ValueKind.Float:
                return new FloatType();
            case ValueKind.Int32:
                return new IntegerType();
            case ValueKind.Int64:
                return new LongIntegerType();
            case ValueKind.Invalid:
                return new InvalidType();
            case ValueKind.Object:
                return new ObjectType();
            case ValueKind.String:
                return new StringType();
            case ValueKind.Uninitialized:
                return new UninitializedType();
            case ValueKind.Void:
                return new VoidType();
            default:
                return undefined;
        }
    }

    /**
     * Given a list of callables as a dictionary indexed by their full name (namespace included, transpiled to underscore-separated.
     * @param callables
     */
    public getCallableContainersByLowerName(callables: CallableContainer[]) {
        //find duplicate functions
        let result = {} as { [name: string]: CallableContainer[] };

        for (let callableContainer of callables) {
            let lowerName = callableContainer.callable.getName(ParseMode.BrightScript).toLowerCase();

            //create a new array for this name
            if (result[lowerName] === undefined) {
                result[lowerName] = [];
            }
            result[lowerName].push(callableContainer);
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
            if (left instanceof VariableExpression) {
                return left;
            } else if (left instanceof DottedGetExpression) {
                left = left.obj;
            } else {
                break;
            }
        }
    }

    /**
     * Given a diagnostic, compute the range for the squiggly
     */
    public getDiagnosticSquigglyText(diagnostic: Diagnostic, line: string) {
        let squiggle: string;
        //fill the entire line
        if (
            //there is no range
            !diagnostic.range ||
            //there is no line
            !line ||
            //both positions point to same location
            diagnostic.range.start.character === diagnostic.range.end.character ||
            //the diagnostic starts after the end of the line
            diagnostic.range.start.character >= line.length
        ) {
            squiggle = ''.padStart(line?.length ?? 0, '~');
        } else {

            let endIndex = Math.max(diagnostic.range?.end.character, line.length);
            endIndex = endIndex > 0 ? endIndex : 0;
            if (line?.length < endIndex) {
                endIndex = line.length;
            }

            let leadingWhitespaceLength = diagnostic.range.start.character;
            let squiggleLength: number;
            if (diagnostic.range.end.character === Number.MAX_VALUE) {
                squiggleLength = line.length - leadingWhitespaceLength;
            } else {
                squiggleLength = diagnostic.range.end.character - diagnostic.range.start.character;
            }
            let trailingWhitespaceLength = endIndex - diagnostic.range.end.character;

            //opening whitespace
            squiggle =
                ''.padStart(leadingWhitespaceLength, ' ') +
                //squiggle
                ''.padStart(squiggleLength, '~') +
                //trailing whitespace
                ''.padStart(trailingWhitespaceLength, ' ');

            //trim the end of the squiggle so it doesn't go longer than the end of the line
            if (squiggle.length > endIndex) {
                squiggle = squiggle.slice(0, endIndex);
            }
        }
        return squiggle;
    }

    /**
     * Find all properties in an object that match the predicate.
     * @param seenMap - used to prevent circular dependency infinite loops
     */
    public findAllDeep<T>(obj: any, predicate: (value: any) => boolean | undefined, parentKey?: string, ancestors?: any[], seenMap?: Map<any, boolean>) {
        seenMap = seenMap ?? new Map<any, boolean>();
        let result = [] as Array<{ key: string; value: T; ancestors: any[] }>;

        //skip this object if we've already seen it
        if (seenMap.has(obj)) {
            return result;
        }

        //base case. If this object maches, keep it as a result
        if (predicate(obj) === true) {
            result.push({
                key: parentKey,
                ancestors: ancestors,
                value: obj
            });
        }

        seenMap.set(obj, true);

        //look through all children
        if (obj instanceof Object) {
            for (let key in obj) {
                let value = obj[key];
                let fullKey = parentKey ? parentKey + '.' + key : key;
                if (typeof value === 'object') {
                    result = [...result, ...this.findAllDeep<T>(
                        value,
                        predicate,
                        fullKey,
                        [
                            ...(ancestors ?? []),
                            obj
                        ],
                        seenMap
                    )];
                }
            }
        }
        return result;
    }

    /**
     * Test if `position` is in `range`. If the position is at the edges, will return true.
     * Adapted from core vscode
     * @param range
     * @param position
     */
    public rangeContains(range: Range, position: Position) {
        if (position.line < range.start.line || position.line > range.end.line) {
            return false;
        }
        if (position.line === range.start.line && position.character < range.start.character) {
            return false;
        }
        if (position.line === range.end.line && position.character > range.end.character) {
            return false;
        }
        return true;
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

    public propertyCount(object: object) {
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
     * Determine whether this diagnostic should be supressed or not, based on brs comment-flags
     * @param diagnostic
     */
    public diagnosticIsSuppressed(diagnostic: BsDiagnostic) {
        //for now, we only support suppressing brs file diagnostics
        if (diagnostic.file instanceof BrsFile) {
            for (let flag of diagnostic.file.commentFlags) {
                //this diagnostic is affected by this flag
                if (this.rangeContains(flag.affectedRange, diagnostic.range.start)) {
                    //if the flag acts upon this diagnostic's code
                    if (flag.codes === null || flag.codes.includes(diagnostic.code as number)) {
                        return true;
                    }
                }
            }
        }
    }

    /**
     * Given a string, extract each item split by whitespace
     * @param text
     */
    public tokenizeByWhitespace(text: string) {
        let tokens = [] as Array<{ startIndex: number; text: string }>;
        let currentToken = null;
        for (let i = 0; i < text.length; i++) {
            let char = text[i];
            //if we hit whitespace
            if (char === ' ' || char === '\t') {
                if (currentToken) {
                    tokens.push(currentToken);
                    currentToken = null;
                }

                //we hit non-whitespace
            } else {
                if (!currentToken) {
                    currentToken = {
                        startIndex: i,
                        text: ''
                    };
                }
                currentToken.text += char;
            }
        }
        if (currentToken) {
            tokens.push(currentToken);
        }
        return tokens;
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
            if (await this.fileExists(bsPath)) {
                return bsPath;
            } else if (await this.fileExists(brsPath)) {
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
            setTimeout(resolve, milliseconds);
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
        return Range.create(startObj.range.start, endObj.range.end);
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
     * If the name does not have a period, and a namespaceName was provided, return the class name prepended
     * by the namespace name
     */
    public getFulllyQualifiedClassName(className: string, namespaceName?: string) {
        if (className.includes('.') === false && namespaceName) {
            return `${namespaceName}.${className}`;
        } else {
            return className;
        }
    }
}

/**
 * A tagged template literal function for standardizing the path.
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
