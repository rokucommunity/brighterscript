import { EventEmitter } from 'events';
import * as path from 'path';
import { CodeWithSourceMap } from 'source-map';
import { CompletionItem, CompletionItemKind, Hover, Position, Range } from 'vscode-languageserver';

import { Deferred } from '../deferred';
import { diagnosticMessages } from '../DiagnosticMessages';
import { FunctionScope } from '../FunctionScope';
import { Callable, Diagnostic, File, FileReference, FunctionCall } from '../interfaces';
import { Program } from '../Program';
import util from '../util';

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

        //allow unlimited listeners
        this.emitter.setMaxListeners(0);
    }

    public parentNameRange: Range;

    /**
     * The extension for this file
     */
    public extension: string;

    public ownScriptImports = [] as FileReference[];

    public getDiagnostics() {
        return [...this.parseDiagnistics];
    }

    /**
     * The range of the entire file
     */
    public fileRange: Range;

    public parseDiagnistics = [] as Diagnostic[];

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

    /**
     * TODO: do we need this for xml files?
     */
    public propertyNameCompletions = [] as CompletionItem[];

    public async parse(fileContents: string) {
        if (this.parseDeferred.isCompleted) {
            throw new Error(`File was already processed. Create a new file instead. ${this.pathAbsolute}`);
        }

        //split the text into lines
        let lines = util.getLines(fileContents);

        this.parentNameRange = this.findExtendsPosition(fileContents);

        //create a range of the entire file
        this.fileRange = Range.create(0, 0, lines.length, lines[lines.length - 1].length - 1);

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
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    let match = /(.*)(<component)/gi.exec(lines[lineIndex]);
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
                    this.parseDiagnistics.push({
                        ...diagnosticMessages.xmlComponentMissingNameAttribute(),
                        location: Range.create(
                            componentRange.start.line,
                            componentRange.start.character,
                            componentRange.start.line,
                            componentRange.end.character
                        ),
                        file: this,
                        severity: 'error'
                    });
                }
                //parent component name not defined
                if (!this.parentName) {
                    this.parseDiagnistics.push({
                        ...diagnosticMessages.xmlComponentMissingExtendsAttribute(),
                        location: Range.create(
                            componentRange.start.line,
                            componentRange.start.character,
                            componentRange.start.line,
                            componentRange.end.character
                        ),
                        file: this,
                        severity: 'error'
                    });
                }
            } else {
                //the component xml element was not found in the file
                this.parseDiagnistics.push({
                    ...diagnosticMessages.xmlComponentMissingComponentDeclaration(),
                    location: Range.create(
                        0,
                        0,
                        0,
                        Number.MAX_VALUE
                    ),
                    file: this,
                    severity: 'error'
                });
            }
        } catch (e) {
            let match = /(.*)\r?\nLine:\s*(\d+)\r?\nColumn:\s*(\d+)\r?\nChar:\s*(\d*)/gi.exec(e.message);
            if (match) {

                let lineIndex = parseInt(match[2]);
                let columnIndex = parseInt(match[3]) - 1;
                //add basic xml parse diagnostic errors
                this.parseDiagnistics.push({
                    message: match[1],
                    code: diagnosticMessages.xmlGenericParseError().code,
                    location: Range.create(
                        lineIndex,
                        columnIndex,
                        lineIndex,
                        columnIndex
                    ),
                    file: this,
                    severity: 'error'
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
                        sourceFile: this,
                        text: uri,
                        lineIndex: null,
                        columnIndexBegin: null,
                        columnIndexEnd: null,
                        pkgPath: util.getPkgPathFromTarget(this.pkgPath, uri)
                    });
                }
            }

            //make a lookup of every uri range
            let uriRanges = {} as { [uri: string]: Range[] };
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                let line = lines[lineIndex];
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
                scriptImport.lineIndex = range.start.line;
                scriptImport.columnIndexBegin = range.start.character;
                scriptImport.columnIndexEnd = range.end.character;
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
    public getAllScriptImports() {
        let imports = [...this.ownScriptImports] as FileReference[];
        let file = this as XmlFile;
        while (file.parent) {
            imports = [...imports, ...file.parent.getOwnScriptImports()];
            file = file.parent;
        }
        return imports;
    }

    /**
     * Get the list of scripts explicitly imported by this file.
     * This method excludes any ancestor imports
     */
    public getOwnScriptImports() {
        return this.ownScriptImports;
    }

    /**
     * Determines if this xml file has a reference to the specified file (or if it's itself)
     * @param file
     */
    public doesReferenceFile(file: File) {
        if (file === this) {
            return true;
        }
        for (let scriptImport of this.ownScriptImports) {
            //if the script imports the file
            if (scriptImport.pkgPath.toLowerCase() === file.pkgPath.toLowerCase()) {
                return true;
            }
        }

        //if this is an xml file...do we extend the component it defines?
        if (path.extname(file.pkgPath).toLowerCase() === '.xml') {

            //didn't find any script imports for this file
            return false;
        }
    }

    /**
     * Get all available completions for the specified position
     * @param lineIndex
     * @param columnIndex
     */
    public async getCompletions(position: Position): Promise<CompletionItem[]> {
        let scriptImport = this.getScriptImportAtPosition(position);
        if (scriptImport) {
            return this.getScriptImportCompletions(scriptImport);
        } else {
            return Promise.resolve([]);
        }
    }

    private getScriptImportAtPosition(position: Position) {
        let scriptImport = this.ownScriptImports.find((x) => {
            return x.lineIndex === position.line &&
                //column between start and end
                position.character >= x.columnIndexBegin &&
                position.character <= x.columnIndexEnd;
        });
        return scriptImport;
    }

    private getScriptImportCompletions(scriptImport: FileReference) {
        let result = [] as CompletionItem[];
        //get a list of all scripts currently being imported
        let currentImports = this.ownScriptImports.map((x) => x.pkgPath);

        //restrict to only .brs files
        for (let key in this.program.files) {
            let file = this.program.files[key];
            if (
                //is a BrightScript or BrighterScript file
                (file.extension === '.bs' || file.extension === '.brs') &&
                //not already referenced in this file
                !currentImports.includes(file.pkgPath)
            ) {
                //the text range to replace if the user selects this result
                let range = {
                    start: {
                        character: scriptImport.columnIndexBegin,
                        line: scriptImport.lineIndex
                    },
                    end: {
                        character: scriptImport.columnIndexEnd,
                        line: scriptImport.lineIndex
                    }
                } as Range;

                //add the relative path
                let relativePath = util.getRelativePath(this.pkgPath, file.pkgPath).replace(/\\/g, '/');
                let pkgPathStandardized = file.pkgPath.replace(/\\/g, '/');
                let pkgPath = `pkg:/${pkgPathStandardized}`;

                result.push({
                    label: relativePath,
                    detail: file.pathAbsolute,
                    kind: CompletionItemKind.File,
                    textEdit: {
                        newText: relativePath,
                        range: range
                    }
                });

                //add the absolute path
                result.push({
                    label: pkgPath,
                    detail: file.pathAbsolute,
                    kind: CompletionItemKind.File,
                    textEdit: {
                        newText: pkgPath,
                        range: range
                    }
                });
            }
        }
        return result;
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
        throw new Error('Transpile is not implemented for XML files');
    }

    public dispose() {
        this.emitter.removeAllListeners();
    }
}
