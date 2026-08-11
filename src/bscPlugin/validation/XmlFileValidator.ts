import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { XmlFile } from '../../files/XmlFile';
import type { OnFileValidateEvent } from '../../interfaces';
import type { SGAst, SGAttribute, SGNode } from '../../parser/SGTypes';
import util from '../../util';
import { isValidSceneGraphFieldValue } from './XmlFieldTypeValidator';

export class XmlFileValidator {
    constructor(
        public event: OnFileValidateEvent<XmlFile>
    ) {
    }

    public process() {
        util.validateTooDeepFile(this.event.file);
        if (this.event.file.parser.ast.root) {
            this.validateComponent(this.event.file.parser.ast);
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

        //validate the node instances declared in the <children> block
        for (const node of component.children?.children ?? []) {
            this.validateNode(node);
        }
    }

    /**
     * Validate a single node instance and recurse into its children. Flags unknown node types, and (for
     * known types) unknown field names and clearly-invalid field values.
     */
    private validateNode(node: SGNode) {
        const nodeName = node.tag.text;
        if (this.event.program.hasSceneGraphNode(nodeName)) {
            this.validateNodeAttributes(node, nodeName);
        //skip component-library components (e.g. `ComplibName:SomeView`); we can't resolve those yet
        } else if (!nodeName.includes(':')) {
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.xmlUnknownComponentType(nodeName),
                range: node.tag.range,
                file: this.event.file
            });
        }
        //recurse regardless, so nested typos are still reported
        for (const child of node.children ?? []) {
            this.validateNode(child);
        }
    }

    private validateNodeAttributes(node: SGNode, nodeName: string) {
        const fields = this.event.program.getSceneGraphNodeFields(nodeName);
        //if we can't resolve any fields for a known node, don't guess (avoids mass false positives)
        if (fields.length === 0) {
            return;
        }
        const fieldsByLowerName = new Map(fields.map(field => [field.name.toLowerCase(), field]));
        for (const attribute of node.attributes ?? []) {
            //let plugins claim an attribute (e.g. custom/transformed attributes) before we validate it
            if (this.isAttributeHandledByPlugin(node, attribute)) {
                continue;
            }
            const attributeName = attribute.key.text;
            const field = fieldsByLowerName.get(attributeName.toLowerCase());
            if (!field) {
                this.event.file.diagnostics.push({
                    ...DiagnosticMessages.xmlUnknownField(attributeName, nodeName),
                    range: attribute.key.range,
                    file: this.event.file
                });
                continue;
            }
            if (field.type && !isValidSceneGraphFieldValue(attribute.value?.text, field.type)) {
                this.event.file.diagnostics.push({
                    ...DiagnosticMessages.xmlInvalidFieldValue(field.name, field.type),
                    range: attribute.value?.range ?? attribute.key.range,
                    file: this.event.file
                });
            }
        }
    }

    /**
     * Emit the `onValidateXmlAttribute` event so plugins can claim an attribute (returning `handled: true`)
     * to opt it out of brighterscript's built-in field validation.
     */
    private isAttributeHandledByPlugin(node: SGNode, attribute: SGAttribute): boolean {
        const event = {
            program: this.event.program,
            file: this.event.file,
            node: node,
            attribute: attribute,
            handled: false
        };
        this.event.program.plugins.emit('onValidateXmlAttribute', event);
        return event.handled;
    }

}
