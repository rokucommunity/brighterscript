import { Scope } from './Scope';
import type { XmlFile } from './files/XmlFile';
import type { Program } from './Program';
import util from './util';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import type { BscFile } from './files/BscFile';
import { DynamicType } from './types/DynamicType';
import type { BaseFunctionType } from './types/BaseFunctionType';
import { ComponentType } from './types/ComponentType';

export class XmlScope extends Scope {
    constructor(
        public xmlFile: XmlFile,
        public program: Program
    ) {
        super(xmlFile.destPath, program);
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
            let scope: Scope | undefined;
            let parentComponentName = this.xmlFile.parentComponentName?.text;
            if (parentComponentName) {
                scope = this.program.getComponentScope(parentComponentName);
            }
            if (scope) {
                return scope;
            } else {
                return this.program.globalScope ?? null;
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
        result.addBuiltInInterfaces();
        const iface = componentElement.interfaceElement;
        if (!iface) {
            return result;
        }
        //add functions
        for (const func of iface.functions ?? []) {
            if (func.name) {
                const componentFuncType = this.symbolTable.getSymbolType(func.name, { flags: SymbolTypeFlag.runtime, fullName: func.name, tableProvider: () => this.symbolTable });
                // TODO: Get correct function type, and fully resolve all param and return types of function
                // eg.:
                // callFuncType = new CallFuncType(componentFuncType) // does something to fully resolve & store all associated types

                //TODO: add documentation - need to get previous comment from XML
                result.addCallFuncMember(func.name, {}, componentFuncType as BaseFunctionType, SymbolTypeFlag.runtime);
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
            let scriptDestPaths = this.xmlFile.getOwnDependencies();
            for (let destPath of scriptDestPaths) {
                let file = this.program.getFile(destPath, false);
                if (file) {
                    result.push(file);
                }
            }
            return result;
        });
    }
}
