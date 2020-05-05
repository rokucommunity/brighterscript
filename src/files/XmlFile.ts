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
    }

    public parentNameRange: Range;

    /**
     * The extension for this file
     */
    public extension: string;

    public ownScriptImports = [] as FileReference[];

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
     * TODO: do we need this for xml files?
     */
    public propertyNameCompletions = [] as CompletionItem[];

    public async parse(fileContents: string) {
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
                    let match = /(.*)(<component)/gi.exec(this.lines[lineIndex]);
                    if (match) {
                        componentRange = Range.create(
                            Position.create(lineIndex, match[1].length),
                            Position.create(lineIndex, match[0].length)
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
                let regex = /(.*?\s+uri\s*=\s*")(.*?)"/gi;
                let lineIndexOffset = 0;
                let match: RegExpExecArray;
                while (match = regex.exec(line)) { //eslint-disable-line no-cond-assign
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
            this.ownScriptImports = scriptImports;
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
     * Get the list of scripts imported by this component and all of its ancestors
     */
    public getAllFileReferences() {
        let imports = [
            ...this.getOwnFileReferences()
        ] as FileReference[];
        let file = this as XmlFile;
        while (file.parent) {
            imports = [...imports, ...file.parent.getOwnFileReferences()];
            file = file.parent;
        }
        return imports;
    }

    /**
     * Get the list of scripts explicitly imported by this file.
     * This method excludes any ancestor imports
     */
    public getOwnFileReferences() {
        let result = [
            ...this.ownScriptImports,
            ...this.getCodeImports()
        ];
        let codebehind = this.getCodebehindFileReference();
        if (codebehind) {
            result.push(codebehind);
        }
        return result;
    }

    private getCodebehindFileReference() {
        //if auto importing of codebehind files is enabled, include the codebehind file if exists
        if (this.program.options.autoImportComponentScript === true) {
            let bsCodebehind = this.program.getFileByPkgPath(this.pkgPath.replace(/\.xml$/i, '.bs'));
            let brsCodebehind = this.program.getFileByPkgPath(this.pkgPath.replace(/\.xml$/i, '.brs'));
            if (bsCodebehind && brsCodebehind) {
                this.diagnostics.push({
                    ...DiagnosticMessages.autoImportComponentScriptCollision(),
                    //the whole line
                    range: Range.create(0, 0, 0, 999999),
                    file: this
                });
            }
            //prefer the bs file over brs
            let codebehind = bsCodebehind ?? brsCodebehind;
            if (codebehind) {
                return {
                    filePathRange: null,
                    pkgPath: codebehind.pkgPath,
                    sourceFile: this,
                    text: codebehind.pkgPath
                };
            }
        }
    }

    /**
     * Create a list of all the `import` statements from source files
     */
    public getCodeImports() {
        let processedFileMap = {} as { [pkgPath: string]: boolean };
        let result = [] as FileReference[];
        let fileRefStack = [
            ...this.ownScriptImports,
            this.getCodebehindFileReference()
        ];
        while (fileRefStack.length > 0) {
            //consume a file from the list
            let fileRef = fileRefStack.pop();
            //skip invalid/undefined fileRefs
            if (!fileRef) {
                continue;
            }
            let targetFile = this.program.getFileByPkgPath(fileRef.pkgPath);

            //only add code imports that we can actually find the file for
            if (targetFile) {
                let lowerPkgPath = targetFile.pkgPath.toLowerCase();

                //only process a source file once
                if (!processedFileMap[lowerPkgPath]) {
                    processedFileMap[lowerPkgPath] = true;

                    //add all of the target file's fileRefs to the list
                    result.push(...targetFile.ownScriptImports);

                    //add the target file's imports to the stack so they can be evaluated
                    fileRefStack.push(...targetFile.ownScriptImports);
                }
            }
        }
        return result;
    }

    /**
     * Determines if this xml file has a reference to the specified file (or if it's itself)
     * @param file
     */
    public doesReferenceFile(file: File) {
        if (file === this) {
            return true;
        }
        let fileReferences = this.getOwnFileReferences();
        for (let scriptImport of fileReferences) {
            if (scriptImport.pkgPath.toLowerCase() === file.pkgPath.toLowerCase()) {
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
        let scriptImport = util.getScriptImportAtPosition(this.ownScriptImports, position);
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
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        //eventually we want to support sourcemaps and a full xml parser. However, for now just do some string transformations
        let lines = [...this.lines];
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let lowerLine = line.toLowerCase();

            //include any bs import statements
            if (lowerLine.includes('</component>')) {
                let codeImports = this.getCodeImports();
                let newLines = [] as string[];

                for (let codeImport of codeImports) {
                    newLines.push(
                        `<script type="text/brightscript" uri="${util.getRokuPkgPath(codeImport.pkgPath)}" />`
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
    }
}
