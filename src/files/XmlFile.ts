import { EventEmitter } from 'eventemitter3';
import * as path from 'path';
import { CodeWithSourceMap } from 'source-map';
import { CompletionItem, Hover, Position, Range } from 'vscode-languageserver';
import { Deferred } from '../deferred';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { FunctionScope } from '../FunctionScope';
import { Callable, BsDiagnostic, File, FileReference, FunctionCall } from '../interfaces';
import { Program } from '../Program';
import util from '../util';
import { Parser } from '../parser/Parser';

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

        //anytime a dependency changes, clean up some cached values
        this.subscriptions.push(
            this.program.dependencyGraph.onchange(this.pkgPath, () => {
                this._allAvailableScriptImports = undefined;
            })
        );

        this.possibleCodebehindPkgPaths = [
            this.pkgPath.replace('.xml', '.bs'),
            this.pkgPath.replace('.xml', '.brs')
        ];
    }

    /**
     * The list of possible autoImport codebehind pkg paths.
     */
    private possibleCodebehindPkgPaths: string[];

    private subscriptions = [] as Array<() => void>;

    public parentNameRange: Range;

    /**
     * The extension for this file
     */
    public extension: string;

    /**
     * The list script imports delcared in the XML of this file.
     * This excludes parent imports and auto codebehind imports
     */
    public scriptTagImports = [] as FileReference[];

    /**
     * List of all pkgPaths to scripts that this XmlFile depends on that are actually loaded into the program,
     * coming from:
     *  - script tags
     *  - inferred codebehind file
     *  - import statements from imported scripts or their descendents
     */
    public get allScriptImports() {
        return this.program.dependencyGraph.nodes[this.pkgPath].allDependencies;
    }

    /**
     * List of all pkgPaths to scripts that this XmlFile depends on that are actually loaded into the program,
     * coming from:
     *  - script tags
     *  - inferred codebehind file
     *  - import statements from imported scripts or their descendents
     */
    public get allAvailableScriptImports() {
        if (!this._allAvailableScriptImports) {
            let allDependencies = this.program.dependencyGraph.nodes[this.pkgPath].allDependencies;

            this._allAvailableScriptImports = this.program.getFilesByPkgPaths(allDependencies).map(x => x.pkgPath);

        }
        return this._allAvailableScriptImports;
    }
    private _allAvailableScriptImports = [] as string[];

    public getDiagnostics() {
        return [...this.diagnostics];
    }

    /**
     * The range of the entire file
     */
    public fileRange: Range;

    public diagnostics = [] as BsDiagnostic[];

    //TODO implement parsing
    public parser = new Parser();

    //TODO implement the xml CDATA parsing, which would populate this list
    public callables = [] as Callable[];

    //TODO implement the xml CDATA parsing, which would populate this list
    public functionCalls = [] as FunctionCall[];

    public functionScopes = [] as FunctionScope[];

    /**
     * The name of the component that this component extends
     */
    public parentName: string;

    /**
     * The name of the component declared in this xml file
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

    public async parse(fileContents: string) {
        this.fileContents = fileContents;
        if (this.parseDeferred.isCompleted) {
            throw new Error(`File was already processed. Create a new file instead. ${this.pathAbsolute}`);
        }
        //split the text into lines
        this.lines = util.getLines(fileContents);

        this.parentNameRange = this.findExtendsPosition(fileContents);

        //create a range of the entire file
        this.fileRange = Range.create(0, 0, this.lines.length, this.lines[this.lines.length - 1].length - 1);

        let parsedXml;
        try {
            parsedXml = await util.parseXml(fileContents);
            if (parsedXml?.component) {
                if (parsedXml.component.$) {
                    this.componentName = parsedXml.component.$.name;
                    this.parentName = parsedXml.component.$.extends;
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
                if (!this.parentName) {
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
        if (parsedXml?.component) {

            let scripts = parsedXml.component.script ? parsedXml.component.script : [];
            let scriptImports = [] as FileReference[];
            //get a list of all scripts
            for (let script of scripts) {
                let uri = script.$.uri;
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
     * The file needs to know when the program has settled (i.e. the `file-added` event has finished).
     * After calling this, the file is ready to be interacted with
     */
    public setFinishedLoading() {
        this.finishedLoadingDeferred.resolve();
    }
    private finishedLoadingDeferred = new Deferred();

    private parseDeferred = new Deferred();

    /**
     * Indicates that the file is completely ready for interaction
     */
    public isReady() {
        return Promise.all([this.finishedLoadingDeferred.promise, this.parseDeferred.promise]);
    }

    /**
     * Determines if this xml file has a reference to the specified file (or if it's itself)
     * @param file
     */
    public doesReferenceFile(file: File) {
        if (file === this) {
            return true;
        }
        let allScriptImports = this.allScriptImports;
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

    public emitter = new EventEmitter();

    public on(name: 'attach-parent', callback: (data: XmlFile) => void);
    public on(name: 'detach-parent', callback: () => void);
    public on(name: string, callback: (data: any) => void) {
        this.emitter.on(name, callback);
        return () => {
            this.emitter.removeListener(name, callback);
        };
    }

    protected emit(name: 'attach-parent', data: XmlFile);
    protected emit(name: 'detach-parent');
    protected emit(name: string, data?: any) {
        this.emitter.emit(name, data);
    }

    public parent: XmlFile;

    /**
     * Components can extend another component.
     * This method attaches the parent component to this component, where
     * this component can listen for script import changes on the parent.
     * @param parent
     */
    public attachParent(parent: XmlFile) {
        //detach any existing parent
        this.detachParent();
        this.parent = parent;
        this.emit('attach-parent', parent);
    }

    public detachParent() {
        if (this.parent) {
            this.parent = undefined;
            this.emit('detach-parent');
        }
    }

    public getHover(position: Position): Hover { //eslint-disable-line
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
        let parent = this.parent;
        while (parent) {
            result.push(...parent.scriptTagImports);
            parent = parent.parent;
        }
        return result;
    }

    /**
     * Get the list of script imports that this file needs to include.
     * It compares the list of imports on this file to those of its parent,
     * and only includes the ones that are not found on the parent.
     * If no parent is found, all imports are returned
     */
    private getMissingImportsForTranspile() {
        let ownImports = this.allAvailableScriptImports;

        let parentImports = this.parent?.allAvailableScriptImports ?? [];

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

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        //eventually we want to support sourcemaps and a full xml parser. However, for now just do some string transformations
        let lines = [...this.lines];
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let lowerLine = line.toLowerCase();

            let componentLocationIndex = lowerLine.indexOf('</component>');
            //include any bs import statements
            if (componentLocationIndex > -1) {
                let missingImports = this.getMissingImportsForTranspile();
                let newLines = [] as string[];

                for (let missingImport of missingImports) {
                    let scriptTag = `<script type="text/brightscript" uri="${util.getRokuPkgPath(missingImport)}" />`;
                    //indent the script tag
                    let indent = ''.padStart(componentLocationIndex + 4, ' ');
                    newLines.push(
                        indent + scriptTag
                    );
                }

                if (newLines.length > 0) {
                    lines.splice(i, 0, ...newLines);
                    //bump the loop index by however many items we added
                    i += newLines.length;
                }
            }

            //convert .bs extensions to .brs
            let idx = line.indexOf('.bs"');
            if (idx > -1) {
                lines[i] = line.substring(0, idx) + '.brs' + line.substring(idx + 3);

            }
            //convert "text/brighterscript" to "text/brightscript"
            lines[i] = lines[i].replace(`"text/brighterscript"`, `"text/brightscript"`);
        }

        return {
            code: lines.join('\n'),
            //for now, return no map. We'll support this eventually
            map: undefined
        };
    }

    public dispose() {
        this.emitter.removeAllListeners();
        for (let dispose of this.subscriptions) {
            dispose();
        }
    }
}
