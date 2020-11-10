import type { Location, Position } from 'vscode-languageserver';
import { Scope } from './Scope';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { XmlFile } from './files/XmlFile';
import type { BscFile, CallableContainerMap, FileReference } from './interfaces';
import type { Program } from './Program';
import util from './util';
import { isXmlFile } from './astUtils/reflection';
import { SGFieldTypes } from './parser/SGTypes';
import type { SGTag } from './parser/SGTypes';

export class XmlScope extends Scope {
    constructor(
        public xmlFile: XmlFile,
        public program: Program
    ) {
        super(xmlFile.pkgPath, xmlFile.dependencyGraphKey, program);
    }

    /**
     * Get the parent scope of this scope. If we could find the scope for our parentComponent, use that.
     * Otherwise default to global scope
     */
    public getParentScope() {
        return this.cache.getOrAdd('parentScope', () => {
            let scope: Scope;
            let parentComponentName = this.xmlFile.parentComponentName;
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

    protected _validate(callableContainerMap: CallableContainerMap) {
        //validate brs files
        super._validate(callableContainerMap);

        //detect when the child imports a script that its ancestor also imports
        this.diagnosticDetectDuplicateAncestorScriptImports();

        //validate component interface
        this.diagnosticValidateInterface(callableContainerMap);
    }

    private diagnosticValidateInterface(callableContainerMap: CallableContainerMap) {
        const { api } = this.xmlFile.parser.ast?.component;
        if (api) {
            //functions
            api.functions.forEach(fun => {
                const name = fun.name;
                if (!name) {
                    this.diagnosticMissingAttribute(fun, 'name');
                } else if (!callableContainerMap.has(name.toLowerCase())) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.xmlFunctionNotFound(name),
                        range: fun.getSGAttribute('name').value.range,
                        file: this.xmlFile
                    });
                }
            });
            //fields
            api.fields.forEach(field => {
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
                        range: field.getSGAttribute('type').value.range,
                        file: this.xmlFile
                    });
                }
            });
        }
    }

    private diagnosticMissingAttribute(tag: SGTag, name: string) {
        const { text, range } = tag.tag;
        this.diagnostics.push({
            ...DiagnosticMessages.xmlTagMissingAttribute(text, name),
            range: range,
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
                    let ancestorComponentName = (ancestorScriptImport.sourceFile as XmlFile).componentName;
                    this.diagnostics.push({
                        file: this.xmlFile,
                        range: scriptImport.filePathRange,
                        ...DiagnosticMessages.unnecessaryScriptImportInChildFromParent(ancestorComponentName)
                    });
                }
            }
        }
    }

    /**
     * Get the list of files referenced by this scope that are actually loaded in the program.
     * This does not account for parent scope.
     */
    public getFiles() {
        return this.cache.getOrAdd('files', () => {
            let result = [
                this.xmlFile
            ] as BscFile[];
            let scriptPkgPaths = this.xmlFile.getAllDependencies();
            for (let scriptPkgPath of scriptPkgPaths) {
                let file = this.program.getFileByPkgPath(scriptPkgPath);
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
            file.parentNameRange &&
            util.rangeContains(file.parentNameRange, position)
        ) {
            results.push({
                range: util.createRange(0, 0, 0, 0),
                uri: util.pathToUri(file.parentComponent.pathAbsolute)
            });
        }
        return results;
    }
}
