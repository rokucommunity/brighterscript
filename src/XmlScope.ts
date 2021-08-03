import type { Location, Position } from 'vscode-languageserver';
import { Scope } from './Scope';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { XmlFile } from './files/XmlFile';
import type { BscFile, CallableContainerMap, FileReference } from './interfaces';
import type { Program } from './Program';
import util from './util';
import { isSGInterfaceField, isSGInterfaceFunction, isXmlFile, isXmlScope } from './astUtils/reflection';
import { SGFieldTypes } from './parser/SGTypes';
import type { SGTag } from './parser/SGTypes';
import { SymbolTable } from './SymbolTable';
import { ObjectType } from './types/ObjectType';

export class XmlScope extends Scope {
    constructor(
        public xmlFile: XmlFile,
        public program: Program
    ) {
        super(xmlFile.pkgPath, program);
    }

    public get dependencyGraphKey() {
        return this.xmlFile.dependencyGraphKey;
    }

    /**
     * Get the parent scope of this scope. If we could find the scope for our parentComponent, use that.
     * Otherwise default to global scope
     */
    public getParentScope() {
        return this.cache.getOrAdd('parentScope', () => {
            let scope: Scope;
            let parentComponentName = this.xmlFile.parentComponentName?.text;
            if (parentComponentName) {
                scope = this.program.getComponentScope(parentComponentName);
            }
            if (scope) {
                return scope;
            } else {
                return this.program.globalScope;
            }
        });
    }
    private _topTable: SymbolTable;

    protected clearSymbolTable() {
        super.clearSymbolTable();
        this._topTable = null;
    }

    public get topTable() {
        if (!this._topTable) {
            const parentScope = this.getParentScope();
            this._topTable = new SymbolTable();
            if (isXmlScope(parentScope)) {
                this._topTable.setParent(parentScope.topTable);
            }
        }
        return this._topTable;
    }

    public get memberTable() {
        if (!this._memberTable) {
            this._memberTable = new SymbolTable(this.getParentScope()?.memberTable);
            const interfaceMembers = this.xmlFile.parser.ast?.component?.interfaceMembers ?? [];

            for (const member of interfaceMembers) {
                //validate functions
                if (isSGInterfaceFunction(member)) {
                    if (member.name) {
                        this.topTable.addSymbol(member.name, member.range, member.functionType);
                    }
                } else if (isSGInterfaceField(member) && member?.id) {
                    this.topTable.addSymbol(member.id, member.range, member.bscType);
                }
            }
            this._memberTable.addSymbol('top', this.xmlFile.fileRange, new ObjectType(this.topTable));
        }
        return this._memberTable;
    }

    protected _validate(callableContainerMap: CallableContainerMap) {
        //validate brs files
        super._validate(callableContainerMap);

        //detect when the child imports a script that its ancestor also imports
        this.diagnosticDetectDuplicateAncestorScriptImports();

        //validate component interface
        this.diagnosticValidateInterface(callableContainerMap);
    }

    private diagnosticValidateInterface(callableContainerMap: CallableContainerMap) {
        const interfaceMembers = this.xmlFile.parser.ast?.component?.interfaceMembers ?? [];

        if (interfaceMembers.length === 0) {
            return;
        }
        for (const member of interfaceMembers) {
            //validate functions
            if (isSGInterfaceFunction(member)) {
                const name = member.name;
                if (!name) {
                    this.diagnosticMissingAttribute(member, 'name');
                } else if (!callableContainerMap.has(name.toLowerCase())) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.xmlFunctionNotFound(name),
                        range: member.getAttribute('name').tokens.value.range,
                        file: this.xmlFile
                    });
                }
                //validate fields
            } else {
                if (!member.id) {
                    this.diagnosticMissingAttribute(member, 'id');
                }
                const type = member.type;
                if (!type) {
                    if (!member.alias) {
                        this.diagnosticMissingAttribute(member, 'type');
                    }
                } else if (!SGFieldTypes.includes(type.toLowerCase())) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.xmlInvalidFieldType(type),
                        range: member.getAttribute('type').tokens.value.range,
                        file: this.xmlFile
                    });
                }
            }
        }
    }

    private diagnosticMissingAttribute(tag: SGTag, name: string) {
        this.diagnostics.push({
            ...DiagnosticMessages.xmlTagMissingAttribute(
                tag.tokens.startTagName.text,
                name
            ),
            range: tag.tokens.startTagName.range,
            file: this.xmlFile
        });
    }

    /**
     * Detect when a child has imported a script that an ancestor also imported
     */
    private diagnosticDetectDuplicateAncestorScriptImports() {
        if (this.xmlFile.parentComponent) {
            //build a lookup of pkg paths -> FileReference so we can more easily look up collisions
            let parentScriptImports = this.xmlFile.getAncestorScriptTagImports();
            let lookup = {} as Record<string, FileReference>;
            for (let parentScriptImport of parentScriptImports) {
                //keep the first occurance of a pkgPath. Parent imports are first in the array
                if (!lookup[parentScriptImport.pkgPath]) {
                    lookup[parentScriptImport.pkgPath] = parentScriptImport;
                }
            }

            //add warning for every script tag that this file shares with an ancestor
            for (let scriptImport of this.xmlFile.scriptTagImports) {
                let ancestorScriptImport = lookup[scriptImport.pkgPath];
                if (ancestorScriptImport) {
                    let ancestorComponent = ancestorScriptImport.sourceFile as XmlFile;
                    let ancestorComponentName = ancestorComponent.componentName?.text ?? ancestorComponent.pkgPath;
                    this.diagnostics.push({
                        file: this.xmlFile,
                        range: scriptImport.filePathRange,
                        ...DiagnosticMessages.unnecessaryScriptImportInChildFromParent(ancestorComponentName)
                    });
                }
            }
        }
    }

    public getAllFiles() {
        return this.cache.getOrAdd('getAllFiles-xmlScope', () => {
            const allFiles = super.getAllFiles();
            allFiles.push(this.xmlFile);
            return allFiles;
        });
    }

    /**
     * Get the list of files referenced by this scope that are actually loaded in the program.
     * This does not account for parent scope.
     */
    public getOwnFiles() {
        return this.cache.getOrAdd('getOwnFiles', () => {
            let result = [
                this.xmlFile
            ] as BscFile[];
            let scriptPkgPaths = this.xmlFile.getOwnDependencies();
            for (let scriptPkgPath of scriptPkgPaths) {
                let file = this.program.getFile(scriptPkgPath);
                if (file) {
                    result.push(file);
                }
            }
            return result;
        });
    }

    /**
     * Get the definition (where was this thing first defined) of the symbol under the position
     */
    public getDefinition(file: BscFile, position: Position): Location[] {
        let results = [] as Location[];
        //if the position is within the file's parent component name
        if (
            isXmlFile(file) &&
            file.parentComponent &&
            file.parentComponentName &&
            util.rangeContains(file.parentComponentName.range, position)
        ) {
            results.push({
                range: util.createRange(0, 0, 0, 0),
                uri: util.pathToUri(file.parentComponent.srcPath)
            });
        }
        return results;
    }
}
