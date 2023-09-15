import type { Location, Position } from 'vscode-languageserver';
import { Scope } from './Scope';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { XmlFile } from './files/XmlFile';
import type { BscFile, CallableContainerMap, FileReference } from './interfaces';
import type { Program } from './Program';
import util from './util';
import { isXmlFile } from './astUtils/reflection';
import { SGFieldTypes } from './parser/SGTypes';
import type { SGElement } from './parser/SGTypes';
import { SymbolTypeFlag } from './SymbolTable';
import { DynamicType } from './types';
import type { BaseFunctionType } from './types/BaseFunctionType';
import { ComponentType } from './types/ComponentType';

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

    public getComponentType() {
        let componentElement = this.xmlFile.ast.componentElement;
        if (!componentElement?.name) {
            return;
        }
        const parentComponentType = componentElement?.extends
            ? this.symbolTable.getSymbolType(util.getSgNodeTypeName(componentElement?.extends), { flags: SymbolTypeFlag.typetime, fullName: componentElement?.extends, tableProvider: () => this.symbolTable })
            : undefined;
        const result = new ComponentType(componentElement.name, parentComponentType as ComponentType);
        const iface = componentElement.interfaceElement;
        if (!iface) {
            return result;
        }
        //add functions
        for (const func of iface.functions ?? []) {
            if (func.name) {
                const actualFuncType = this.symbolTable.getSymbolType(func.name, { flags: SymbolTypeFlag.runtime, fullName: func.name, tableProvider: () => this.symbolTable });
                //TODO: add documentation - need to get previous comment from XML
                result.addCallFuncMember(func.name, {}, actualFuncType as BaseFunctionType, SymbolTypeFlag.runtime);
            }
        }
        //add fields
        for (const field of iface.fields ?? []) {
            if (field.id) {
                const actualFieldType = field.type ? util.getNodeFieldType(field.type, this.symbolTable) : DynamicType.instance;
                //TODO: add documentation - need to get previous comment from XML
                result.addMember(field.id, {}, actualFieldType, SymbolTypeFlag.runtime);
            }
        }
        return result;
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
        if (!this.xmlFile.parser.ast?.componentElement?.interfaceElement) {
            return;
        }
        const iface = this.xmlFile.parser.ast.componentElement.interfaceElement;

        //validate functions
        for (const func of iface.functions) {
            const name = func.name;
            if (!name) {
                this.diagnosticMissingAttribute(func, 'name');
            } else if (!callableContainerMap.has(name.toLowerCase())) {
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlFunctionNotFound(name),
                    range: func.getAttribute('name').tokens.value.range,
                    file: this.xmlFile
                });
            }
        }
        //validate fields
        for (const field of iface.fields) {
            const { id, type } = field;
            if (!id) {
                this.diagnosticMissingAttribute(field, 'id');
            }
            if (!type) {
                if (!field.alias) {
                    this.diagnosticMissingAttribute(field, 'type');
                }
            } else if (!SGFieldTypes.includes(type.toLowerCase())) {
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlInvalidFieldType(type),
                    range: field.getAttribute('type').tokens.value.range,
                    file: this.xmlFile
                });
            }
        }
    }

    private diagnosticMissingAttribute(tag: SGElement, name: string) {
        this.diagnostics.push({
            ...DiagnosticMessages.xmlTagMissingAttribute(tag.tokens.startTagName.text, name),
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
            for (const scriptPkgPath of scriptPkgPaths) {
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
