import { Location, Position, Range } from 'vscode-languageserver';

import { Scope } from './Scope';
import { diagnosticMessages, DiagnosticInfo } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { FileReference } from './interfaces';
import { Program } from './Program';
import util from './util';

export class XmlScope extends Scope {
    constructor(xmlFile: XmlFile) {
        super(xmlFile.pkgPath, (file) => {
            return this.xmlFile.doesReferenceFile(file);
        });
        this.xmlFile = xmlFile;
        this.xmlFileHandles = [
            //when the xml file gets a parent added, link to that parent's scope
            this.xmlFile.on('attach-parent', (parent: XmlFile) => {
                this.handleXmlFileParentAttach(parent);
            }),

            //when xml file detaches its parent, remove the scope link
            this.xmlFile.on('detach-parent', () => {
                this.detachParent();
            })
        ];

        //if the xml file already has a parent attached, attach our scope to that parent xml's scope
        if (this.xmlFile.parent) {
            this.handleXmlFileParentAttach(this.xmlFile.parent);
        }
    }

    public attachProgram(program: Program) {
        super.attachProgram(program);
        //if the xml file has an unresolved parent, look for its parent on every file add
        this.programHandles.push(
            this.program.on('file-added', (file) => {
                this.addParentIfMatch(file);
            })
        );

        //detach xml file's parent if it's removed from the program
        this.programHandles.push(
            this.program.on('file-removed', this.onProgramFileRemove.bind(this))
        );

        //try finding and attaching the parent component
        for (let key in this.program.files) {
            this.addParentIfMatch(this.program.files[key]);
        }

        //if the xml file already has a parent xml file, attach it
        if (this.xmlFile.parent && this.xmlFile.parent !== (this.program.platformScope as any)) {
            this.handleXmlFileParentAttach(this.xmlFile.parent);
        }
    }

    /**
     * Event handler for when the attached program removes a file
     * @param file
     */
    private onProgramFileRemove(file: BrsFile | XmlFile) {
        if (
            //incoming file is an xml file
            file instanceof XmlFile &&
            //incoming file has a component name
            file.componentName &&
            //this xml file has a parent
            this.xmlFile.parentName &&
            //incoming file has same name as parent
            file.componentName.toLowerCase() === this.xmlFile.parentName.toLowerCase()
        ) {
            this.isValidated = false;
            this.xmlFile.detachParent();

            //disconnect the scope link
            this.detachParent();
        }
    }

    private handleXmlFileParentAttach(file: XmlFile) {
        let parentScope = this.program.getScopeByName(file.pkgPath);
        if (parentScope) {
            this.attachParentScope(parentScope);
        }
    }

    private addParentIfMatch(file: BrsFile | XmlFile) {
        if (
            //xml file has no parent
            !this.xmlFile.parent &&
            //xml file WANTS a parent
            this.xmlFile.parentName &&
            //incoming file is an xml file
            file instanceof XmlFile &&
            //xml file's name matches the desired parent name
            file.componentName === this.xmlFile.parentName
        ) {
            this.isValidated = false;
            this.xmlFile.attachParent(file);
        }
    }

    public validate() {
        if (this.isValidated === false) {
            super.validate();

            //detect when the child imports a script that its ancestor also imports
            this.diagnosticDetectDuplicateAncestorScriptImports();

            //detect script imports to files that are not loaded in this scope
            this.diagnosticValidateScriptImportPaths();
        }
    }

    /**
     * Detect when a child has imported a script that an ancestor also imported
     */
    private diagnosticDetectDuplicateAncestorScriptImports() {
        if (this.xmlFile.parent) {
            //build a lookup of pkg paths -> FileReference so we can more easily look up collisions
            let parentScriptImports = this.xmlFile.parent.getAllScriptImports();
            let lookup = {} as { [pkgPath: string]: FileReference };
            for (let parentScriptImport of parentScriptImports) {
                //keep the first occurance of a pkgPath. Parent imports are first in the array
                if (!lookup[parentScriptImport.pkgPath]) {
                    lookup[parentScriptImport.pkgPath] = parentScriptImport;
                }
            }

            //add warning for every import this file shares with an ancestor
            for (let scriptImport of this.xmlFile.ownScriptImports) {
                let ancestorScriptImport = lookup[scriptImport.pkgPath];
                if (ancestorScriptImport) {
                    let ancestorComponentName = ancestorScriptImport.sourceFile.componentName;
                    this.diagnostics.push({
                        file: this.xmlFile,
                        location: Range.create(scriptImport.lineIndex, scriptImport.columnIndexBegin, scriptImport.lineIndex, scriptImport.columnIndexEnd),
                        ...diagnosticMessages.unnecessaryScriptImportInChildFromParent(ancestorComponentName)
                    });
                }
            }
        }
    }

    /**
     * Get the definition (where was this thing first defined) of the symbol under the position
     */
    public getDefinition(file: BrsFile | XmlFile, position: Position): Location[] {
        let results = [] as Location[];
        //if the position is within the file's parent component name
        if (
            file instanceof XmlFile &&
            file.parent &&
            file.parentNameRange &&
            util.rangeContains(file.parentNameRange, position)
        ) {
            results.push({
                range: Range.create(0, 0, 0, 0),
                uri: util.pathToUri(file.parent.pathAbsolute)
            });
        }
        return results;
    }

    /**
     * Verify that all of the scripts ipmorted by
     */
    private diagnosticValidateScriptImportPaths() {
        //verify every script import
        for (let scriptImport of this.xmlFile.ownScriptImports) {
            let referencedFile = this.getFileByRelativePath(scriptImport.pkgPath);
            //if we can't find the file
            if (!referencedFile) {
                let dInfo: DiagnosticInfo;
                if (scriptImport.text.trim().length === 0) {
                    dInfo = diagnosticMessages.scriptSrcCannotBeEmpty();
                } else {
                    dInfo = diagnosticMessages.referencedFileDoesNotExist();
                }

                this.diagnostics.push({
                    ...dInfo,
                    location: Range.create(
                        scriptImport.lineIndex,
                        scriptImport.columnIndexBegin,
                        scriptImport.lineIndex,
                        scriptImport.columnIndexEnd
                    ),
                    file: this.xmlFile
                });
                //if the character casing of the script import path does not match that of the actual path
            } else if (scriptImport.pkgPath !== referencedFile.file.pkgPath) {
                this.diagnostics.push({
                    ...diagnosticMessages.scriptImportCaseMismatch(referencedFile.file.pkgPath),
                    location: Range.create(
                        scriptImport.lineIndex,
                        scriptImport.columnIndexBegin,
                        scriptImport.lineIndex,
                        scriptImport.columnIndexEnd
                    ),
                    file: this.xmlFile
                });
            }
        }
    }

    private xmlFileHandles = [] as Array<() => void>;

    private xmlFile: XmlFile;

    public dispose() {
        super.dispose();
        for (let disconnect of this.xmlFileHandles) {
            disconnect();
        }
    }
}
