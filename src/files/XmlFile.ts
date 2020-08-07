import * as path from 'path';
import { CodeWithSourceMap, SourceNode } from 'source-map';
import { CompletionItem, Hover, Position, Range } from 'vscode-languageserver';
import { Deferred } from '../deferred';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { FunctionScope } from '../FunctionScope';
import { Callable, BsDiagnostic, File, FileReference, FunctionCall } from '../interfaces';
import { Program } from '../Program';
import util from '../util';
import { Parser } from '../parser/Parser';
import chalk from 'chalk';
import { Cache } from '../Cache';
import { DependencyGraph } from '../DependencyGraph';

export interface SGAstScript {
    $?: {
        uri: string;
        type?: string;
    };
}

export interface SGAstFunction {
    $?: {
        name: string;
    };
}

export interface SGAstField {
    $?: {
        id: string;
        type?: string;
        alwaysNotify?: string;
        onChange?: string;
    };
}

export interface SGAstInterface {
    function?: SGAstFunction[];
    field?: SGAstField[];
}

export interface SGAstComponent {
    $?: {
        name: string;
        extends: string;
    };
    script?: SGAstScript[];
    interface?: SGAst;
    children?: any;
}

export interface SGAst {
    component?: SGAstComponent;
}

export class XmlFile {
    constructor(
        public pathAbsolute: string,
        /**
         * The absolute path to the file, relative to the pkg
         */
        public pkgPath: string,
        public program: Program
    ) {
        this.extension = path.extname(pathAbsolute).toLowerCase();

        this.possibleCodebehindPkgPaths = [
            this.pkgPath.replace('.xml', '.bs'),
            this.pkgPath.replace('.xml', '.brs')
        ];
    }

    private cache = new Cache();

    /**
     * The list of possible autoImport codebehind pkg paths.
     */
    private possibleCodebehindPkgPaths: string[];

    /**
     * An unsubscribe function for the dependencyGraph subscription
     */
    private unsubscribeFromDependencyGraph: () => void;

    /**
     * The range of the component's name value
     */
    public componentNameRange: Range;

    /**
     * The range of the component's parent name (if exist
     */
    public parentNameRange: Range;

    /**
     * The extension for this file
     */
    public extension: string;

    /**
     * The list of script imports delcared in the XML of this file.
     * This excludes parent imports and auto codebehind imports
     */
    public scriptTagImports = [] as FileReference[];

    /**
     * List of all pkgPaths to scripts that this XmlFile depends on directly, regardless of whether they are loaded in the program or not.
     * This does not account for parent component scripts
     * coming from:
     *  - script tags
     *  - implied codebehind file
     *  - import statements from imported scripts or their descendents
     */
    public getAllScriptImports() {
        return this.cache.getOrAdd('allScriptImports', () => {
            let value = this.program.dependencyGraph.getAllDependencies(this.dependencyGraphKey, [this.parentComponentDependencyGraphKey]);
            return value;
        });
    }

    /**
     * List of all pkgPaths to scripts that this XmlFile depends on that are actually loaded into the program.
     * This does not account for parent component scripts.
     * coming from:
     *  - script tags
     *  - inferred codebehind file
     *  - import statements from imported scripts or their descendents
     */
    public getAvailableScriptImports() {
        return this.cache.getOrAdd('allAvailableScriptImports', () => {
            let allDependencies = this.getAllScriptImports();
            let result = [] as string[];
            let filesInProgram = this.program.getFilesByPkgPaths(allDependencies);
            for (let file of filesInProgram) {
                result.push(file.pkgPath);
            }
            this.logDebug('computed allAvailableScriptImports', () => result);
            return result;
        });
    }

    public getDiagnostics() {
        return [...this.diagnostics];
    }

    public addDiagnostics(diagnostics: BsDiagnostic[]) {
        this.diagnostics.push(...diagnostics);
    }

    /**
     * The range of the entire file
     */
    public fileRange: Range;

    public diagnostics = [] as BsDiagnostic[];

    //TODO implement parsing
    public parsedXml: SGAst;
    public parser = new Parser();

    //TODO implement the xml CDATA parsing, which would populate this list
    public callables = [] as Callable[];

    //TODO implement the xml CDATA parsing, which would populate this list
    public functionCalls = [] as FunctionCall[];

    public functionScopes = [] as FunctionScope[];

    /**
     * The name of the component that this component extends.
     * Available after `parse()`
     */
    public parentComponentName: string;

    /**
     * The name of the component declared in this xml file
     * Available after `parse()`
     */
    public componentName: string;

    /**
     * Does this file need to be transpiled?
     */
    public needsTranspiled = false;

    //the lines of the xml file
    public lines: string[];

    /**
     * The full file contents
     */
    public fileContents: string;

    /**
     * TODO: do we need this for xml files?
     */
    public propertyNameCompletions = [] as CompletionItem[];

    private uriRangeRegex = /(.*?\s+uri\s*=\s*")(.*?)"/g;
    private scriptTypeRegex = /type\s*=\s*"(.*?)"/gi;

    public async parse(fileContents: string, onParsed?: () => void) {
        this.fileContents = fileContents;
        if (this.parseDeferred.isCompleted) {
            throw new Error(`File was already processed. Create a new file instead. ${this.pathAbsolute}`);
        }
        //split the text into lines
        this.lines = util.getLines(fileContents);

        this.parentNameRange = this.findExtendsPosition(fileContents);

        //create a range of the entire file
        this.fileRange = Range.create(0, 0, this.lines.length, this.lines[this.lines.length - 1].length - 1);

        this.parsedXml = {};
        try {
            this.parsedXml = (await util.parseXml(fileContents)) || {};

            //notify AST ready
            onParsed?.();

            if (this.parsedXml.component) {
                if (this.parsedXml.component.$) {
                    this.componentName = this.parsedXml.component.$.name;
                    this.parentComponentName = this.parsedXml.component.$.extends;
                }
                let componentRange: Range;

                //find the range for the component element's opening tag
                for (let lineIndex = 0; lineIndex < this.lines.length; lineIndex++) {
                    let idx = this.lines[lineIndex].indexOf('<component');
                    if (idx > -1) {
                        componentRange = Range.create(
                            Position.create(lineIndex, idx),
                            Position.create(lineIndex, idx + 10)
                        );
                        //calculate the range of the component's name (if it exists)
                        const match = /(.*?name\s*=\s*(?:'|"))(.*?)('|")/.exec(this.lines[lineIndex]);
                        if (match) {
                            this.componentNameRange = Range.create(
                                lineIndex,
                                match[1].length,
                                lineIndex,
                                match[1].length + match[2].length
                            );
                        }
                        break;
                    }
                }
                //component name not defined
                if (!this.componentName) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.xmlComponentMissingNameAttribute(),
                        range: Range.create(
                            componentRange.start.line,
                            componentRange.start.character,
                            componentRange.start.line,
                            componentRange.end.character
                        ),
                        file: this
                    });
                }

                //parent component name not defined
                if (!this.parentComponentName) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.xmlComponentMissingExtendsAttribute(),
                        range: Range.create(
                            componentRange.start.line,
                            componentRange.start.character,
                            componentRange.start.line,
                            componentRange.end.character
                        ),
                        file: this
                    });
                }
            } else {
                //the component xml element was not found in the file
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlComponentMissingComponentDeclaration(),
                    range: Range.create(
                        0,
                        0,
                        0,
                        Number.MAX_VALUE
                    ),
                    file: this
                });
            }
        } catch (e) {
            let match = /(.*)\r?\nLine:\s*(\d+)\r?\nColumn:\s*(\d+)\r?\nChar:\s*(\d*)/gi.exec(e.message);
            if (match) {
                let lineIndex = parseInt(match[2]);
                let columnIndex = parseInt(match[3]) - 1;
                //add basic xml parse diagnostic errors
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlGenericParseError(match[1]),
                    range: Range.create(
                        lineIndex,
                        columnIndex,
                        lineIndex,
                        columnIndex
                    ),
                    file: this
                });
            }
        }

        //find script imports
        if (this.parsedXml.component) {
            let scripts = this.parsedXml.component.script || [];
            let scriptImports = [] as FileReference[];
            //get a list of all scripts
            for (let script of scripts) {
                let uri = script.$?.uri;
                if (typeof uri === 'string') {
                    scriptImports.push({
                        filePathRange: null,
                        sourceFile: this,
                        text: uri,
                        pkgPath: util.getPkgPathFromTarget(this.pkgPath, uri)
                    });
                }
            }

            //make a lookup of every uri range
            let uriRanges = {} as { [uri: string]: Range[] };
            for (let lineIndex = 0; lineIndex < this.lines.length; lineIndex++) {
                let line = this.lines[lineIndex];
                //reset the regexes
                this.uriRangeRegex.lastIndex = 0;
                this.scriptTypeRegex.lastIndex = 0;

                let lineIndexOffset = 0;
                let match: RegExpExecArray;
                while (match = this.uriRangeRegex.exec(line)) { //eslint-disable-line no-cond-assign
                    let preUriContent = match[1];
                    let uri = match[2];
                    if (!uriRanges[uri]) {
                        uriRanges[uri] = [];
                    }
                    let startColumnIndex = lineIndexOffset + preUriContent.length;
                    let endColumnIndex = startColumnIndex + uri.length;

                    uriRanges[uri].push(
                        Range.create(
                            lineIndex,
                            startColumnIndex,
                            lineIndex,
                            endColumnIndex
                        )
                    );

                    //if this is a brighterscript file, validate that the `type` attribute is correct
                    let scriptType = this.scriptTypeRegex.exec(line);
                    let lowerScriptType = scriptType?.[1]?.toLowerCase();
                    let lowerUri = uri.toLowerCase();
                    //brighterscript script type with brightscript file extension
                    if (lowerUri.endsWith('.bs') && (!scriptType || lowerScriptType !== 'text/brighterscript')) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.brighterscriptScriptTagMissingTypeAttribute(),
                            file: this,
                            //just flag the whole line; we'll get better location tracking when we have a formal xml parser
                            range: Range.create(lineIndex, 0, lineIndex, line.length - 1)
                        });
                    }
                    lineIndexOffset += match[0].length;
                }
            }

            //try to compute the locations of each script import
            for (let scriptImport of scriptImports) {
                //take and remove the first item from the list
                let range = uriRanges[scriptImport.text].shift();
                scriptImport.filePathRange = range;
            }

            //add all of these script imports
            this.scriptTagImports = scriptImports;
        }

        //catch script imports with same path as the auto-imported codebehind file
        let explicitCodebehindScriptTag = this.program.options.autoImportComponentScript === true
            ? this.scriptTagImports.find(x => this.possibleCodebehindPkgPaths.includes(x.pkgPath))
            : undefined;
        if (explicitCodebehindScriptTag) {
            this.diagnostics.push({
                ...DiagnosticMessages.unnecessaryCodebehindScriptImport(),
                file: this,
                range: explicitCodebehindScriptTag.filePathRange
            });
        }

        this.parseDeferred.resolve();
    }

    /**
     * Attach the file to the dependency graph so it can monitor changes.
     * Also notify the dependency graph of our current dependencies so other dependents can be notified.
     */
    public attachDependencyGraph(dependencyGraph: DependencyGraph) {
        if (this.unsubscribeFromDependencyGraph) {
            this.unsubscribeFromDependencyGraph();
        }

        //anytime a dependency changes, clean up some cached values
        this.unsubscribeFromDependencyGraph = this.program.dependencyGraph.onchange(this.dependencyGraphKey, () => {
            this.logDebug('clear cache because dependency graph changed');
            this.cache.clear();
        });


        let dependencies = [
            ...this.scriptTagImports.map(x => x.pkgPath.toLowerCase())
        ];
        //if autoImportComponentScript is enabled, add the .bs and .brs files with the same name
        if (this.program.options.autoImportComponentScript) {
            dependencies.push(
                //add the codebehind file dependencies.
                //These are kind of optional, so it doesn't hurt to just add both extension versions
                this.pkgPath.replace(/\.xml$/i, '.bs').toLowerCase(),
                this.pkgPath.replace(/\.xml$/i, '.brs').toLowerCase()
            );
        }
        if (this.parentComponentName) {
            dependencies.push(this.parentComponentDependencyGraphKey);
        }
        this.program.dependencyGraph.addOrReplace(this.dependencyGraphKey, dependencies);
    }

    /**
     * The key used in the dependency graph for this file.
     * If we have a component name, we will use that so we can be discoverable by child components.
     * If we don't have a component name, use the pkgPath so at least we can self-validate
     */
    public get dependencyGraphKey() {
        if (this.componentName) {
            return `component:${this.componentName}`.toLowerCase();
        } else {
            return this.pkgPath.toLowerCase();
        }
    }

    /**
     * The key used in the dependency graph for this component's parent.
     * If we have aparent, we will use that. If we don't, this will return undefined
     */
    public get parentComponentDependencyGraphKey() {
        if (this.parentComponentName) {
            return `component:${this.parentComponentName}`.toLowerCase();
        } else {
            return undefined;
        }
    }

    private parseDeferred = new Deferred();

    /**
     * Indicates that the file is completely ready for interaction
     */
    public isReady() {
        return this.parseDeferred.promise;
    }

    /**
     * Determines if this xml file has a reference to the specified file (or if it's itself)
     * @param file
     */
    public doesReferenceFile(file: File) {
        return this.cache.getOrAdd(`doesReferenceFile: ${file.pkgPath}`, () => {
            if (file === this) {
                return true;
            }
            let allScriptImports = this.getAllScriptImports();
            for (let importPkgPath of allScriptImports) {
                if (importPkgPath.toLowerCase() === file.pkgPath.toLowerCase()) {
                    return true;
                }
            }

            //if this is an xml file...do we extend the component it defines?
            if (path.extname(file.pkgPath).toLowerCase() === '.xml') {

                //didn't find any script imports for this file
                return false;
            }
            return false;
        });
    }

    /**
     * Get all available completions for the specified position
     * @param lineIndex
     * @param columnIndex
     */
    public async getCompletions(position: Position): Promise<CompletionItem[]> {
        let scriptImport = util.getScriptImportAtPosition(this.scriptTagImports, position);
        if (scriptImport) {
            return this.program.getScriptImportCompletions(this.pkgPath, scriptImport);
        } else {
            return Promise.resolve([]);
        }
    }

    /**
     * Scan the xml and find the range of the parent component's name in the `extends="ParentComponentName"` attribute of the component
     */
    public findExtendsPosition(fullText: string) {
        let regexp = /.*<component[^>]*((extends\s*=\s*")(\w*)")/gms;
        let match = regexp.exec(fullText);
        if (match) {
            let extendsText = match[1]; // `extends="something"`
            let extendsToFirstQuote = match[2]; // `extends="`
            let componentName = match[3]; // `something`
            let lines = util.getLines(match[0]);
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                let line = lines[lineIndex];
                let extendsIdx = line.indexOf(extendsText);
                //we found the line index
                if (extendsIdx > -1) {
                    let colStartIndex = extendsIdx + extendsToFirstQuote.length;
                    let colEndIndex = colStartIndex + componentName.length;
                    return Range.create(lineIndex, colStartIndex, lineIndex, colEndIndex);
                }
            }
        }
    }

    /**
     * Get the parent component (the component this component extends)
     */
    public get parentComponent() {
        return this.cache.getOrAdd('parent', () => {
            return this.program.getComponent(this.parentComponentName)?.file ?? null;
        });
    }


    public getHover(position: Position): Promise<Hover> { //eslint-disable-line
        //TODO implement
        // let result = {} as Hover;
        return null;
    }

    public getFunctionScopeAtPosition(position: Position, functionScopes?: FunctionScope[]): FunctionScope { //eslint-disable-line
        //TODO implement
        return null;
    }

    /**
     * Walk up the ancestor chain and aggregate all of the script tag imports
     */
    public getAncestorScriptTagImports() {
        let result = [];
        let parent = this.parentComponent;
        while (parent) {
            result.push(...parent.scriptTagImports);
            parent = parent.parentComponent;
        }
        return result;
    }

    /**
     * Remove this file from the dependency graph as a node
     */
    public detachDependencyGraph(dependencyGraph: DependencyGraph) {
        dependencyGraph.remove(this.dependencyGraphKey);

    }

    /**
     * Get the list of script imports that this file needs to include.
     * It compares the list of imports on this file to those of its parent,
     * and only includes the ones that are not found on the parent.
     * If no parent is found, all imports are returned
     */
    private getMissingImportsForTranspile() {
        let ownImports = this.getAvailableScriptImports();

        let parentImports = this.parentComponent?.getAvailableScriptImports() ?? [];

        let parentMap = parentImports.reduce((map, pkgPath) => {
            map[pkgPath] = true;
            return map;
        }, {});

        //if the XML already has this import, skip this one
        let alreadyThereScriptImportMap = this.scriptTagImports.reduce((map, fileReference) => {
            map[fileReference.pkgPath] = true;
            return map;
        }, {});

        let result = [] as string[];
        for (let ownImport of ownImports) {
            if (
                //if the parent doesn't have this import
                !parentMap[ownImport] &&
                //the XML doesn't already have a script reference for this
                !alreadyThereScriptImportMap[ownImport]
            ) {
                result.push(ownImport);
            }
        }
        return result;
    }

    private logDebug(...args) {
        this.program.logger.debug('XmlFile', chalk.green(this.pkgPath), ...args);
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        this.logDebug('transpile');
        //eventually we want to support sourcemaps and a full xml parser. However, for now just do some string transformations
        let chunks = [] as Array<SourceNode | string>;
        for (let i = 0; i < this.lines.length; i++) {
            let line = this.lines[i];
            let lowerLine = line.toLowerCase();

            let componentLocationIndex = lowerLine.indexOf('</component>');
            //include any bs import statements
            if (componentLocationIndex > -1) {
                let missingImports = this.getMissingImportsForTranspile()
                    //change the file extension to .brs since they will be transpiled
                    .map(x => x.replace('.bs', '.brs'));
                //always include the bslib file
                missingImports.push('source/bslib.brs');

                for (let missingImport of missingImports) {
                    let scriptTag = `<script type="text/brightscript" uri="${util.getRokuPkgPath(missingImport)}" />`;
                    //indent the script tag
                    let indent = ''.padStart(componentLocationIndex + 4, ' ');
                    chunks.push(
                        '\n',
                        new SourceNode(1, 0, this.pathAbsolute, indent + scriptTag)
                    );
                }
            } else {
                //we couldn't find the closing component tag....so maybe there's something wrong? or this isn't actually a component?
            }

            //convert .bs extensions to .brs
            let idx = line.indexOf('.bs"');
            if (idx > -1) {
                line = line.substring(0, idx) + '.brs' + line.substring(idx + 3);
            }

            //convert "text/brighterscript" to "text/brightscript"
            line = line.replace(`"text/brighterscript"`, `"text/brightscript"`);

            chunks.push(
                chunks.length > 0 ? '\n' : '',
                line
            );
        }

        return new SourceNode(null, null, this.pathAbsolute, chunks).toStringWithSourceMap();
    }

    public dispose() {
        if (this.unsubscribeFromDependencyGraph) {
            this.unsubscribeFromDependencyGraph();
        }
    }
}
