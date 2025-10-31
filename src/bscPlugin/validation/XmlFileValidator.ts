import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { XmlFile } from '../../files/XmlFile';
import type { OnFileValidateEvent } from '../../interfaces';
import type { SGAst, SGComponent, SGInterface } from '../../parser/SGTypes';
import util from '../../util';

export class XmlFileValidator {
    constructor(
        public event: OnFileValidateEvent<XmlFile>
    ) {
    }

    public process() {
        util.validateTooDeepFile(this.event.file);
        if (this.event.file.parser.ast.root) {
            this.validateComponent(this.event.file.parser.ast);
            this.validateTagCasing(this.event.file.parser.ast);
        } else {
            //skip empty XML
        }
    }

    private validateComponent(ast: SGAst) {
        const { root, component } = ast;
        if (!component) {
            //not a SG component
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingComponentDeclaration(),
                range: root.range,
                file: this.event.file
            });
            return;
        }

        //component name/extends
        if (!component.name) {
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingNameAttribute(),
                range: component.tag.range,
                file: this.event.file
            });
        }
        if (!component.extends) {
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingExtendsAttribute(),
                range: component.tag.range,
                file: this.event.file
            });
        }


        //catch script imports with same path as the auto-imported codebehind file
        const scriptTagImports = this.event.file.parser.references.scriptTagImports;
        let explicitCodebehindScriptTag = this.event.file.program.options.autoImportComponentScript === true
            ? scriptTagImports.find(x => this.event.file.possibleCodebehindPkgPaths.includes(x.pkgPath))
            : undefined;
        if (explicitCodebehindScriptTag) {
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.unnecessaryCodebehindScriptImport(),
                file: this.event.file,
                range: explicitCodebehindScriptTag.filePathRange
            });
        }
    }

    private validateTagCasing(ast: SGAst) {
        const { component } = ast;
        if (!component) {
            return;
        }

        this.validateComponentTagCasing(component);
    }

    private validateComponentTagCasing(component: SGComponent) {
        // Validate component-level tags
        const componentLevelTags = ['children', 'interface', 'script', 'customization'];

        // Check interface tag
        if (component.api) {
            this.validateTagNameCasing(component.api.tag, componentLevelTags);
            this.validateInterfaceTagCasing(component.api);
        }

        // Check script tags
        for (const script of component.scripts) {
            this.validateTagNameCasing(script.tag, componentLevelTags);
        }

        // Check children tag
        if (component.children) {
            this.validateTagNameCasing(component.children.tag, componentLevelTags);
        }

        // Check customization tags
        for (const customization of component.customizations) {
            this.validateTagNameCasing(customization.tag, componentLevelTags);
        }
    }

    private validateInterfaceTagCasing(interfaceTag: SGInterface) {
        const interfaceLevelTags = ['field', 'function'];

        // Check field tags
        for (const field of interfaceTag.fields) {
            this.validateTagNameCasing(field.tag, interfaceLevelTags);
        }

        // Check function tags
        for (const func of interfaceTag.functions) {
            this.validateTagNameCasing(func.tag, interfaceLevelTags);
        }
    }

    private validateTagNameCasing(tag: { text: string; range?: any }, allowedTags: string[]) {
        const tagName = tag.text;
        const lowerCaseTag = tagName.toLowerCase();
        const matchingAllowedTag = allowedTags.find(allowedTag => allowedTag.toLowerCase() === lowerCaseTag);

        if (matchingAllowedTag && matchingAllowedTag !== tagName) {
            // Case mismatch for a known tag
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.xmlTagCaseMismatch(tagName, matchingAllowedTag),
                range: tag.range,
                file: this.event.file
            });
        }
    }

}
