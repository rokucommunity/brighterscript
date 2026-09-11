import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { XmlFile } from '../../files/XmlFile';
import type { ValidateFileEvent } from '../../interfaces';
import type { SGAst, SGElement } from '../../parser/SGTypes';
import { isSGInterface } from '../../astUtils/xml';
import util from '../../util';

export class XmlFileValidator {
    constructor(
        public event: ValidateFileEvent<XmlFile>
    ) {
    }

    public process() {
        util.validateTooDeepFile(this.event.file);
        if (this.event.file.parser.ast.rootElement) {
            this.validateComponent(this.event.file.parser.ast);
            this.validateTagClosings(this.event.file.parser.ast.rootElement);
            this.validateTagCasing(this.event.file.parser.ast.rootElement);
        } else {
            //skip empty XML
        }
    }

    /**
     * Walk the element tree and report any element whose closing tag name doesn't match its
     * opening tag name (i.e. `<Group></LayoutGroup>`), which is a compile error on device.
     * This runs at validation time (rather than parse time) so it also catches AST injected
     * or mutated by plugins.
     */
    private validateTagClosings(element: SGElement) {
        const endTagName = element.tokens.endTagName;
        //only validate when a closing tag is actually present. Self-closing tags and
        //programmatically-built elements omit it, and must remain valid.
        if (endTagName && endTagName.text !== element.tokens.startTagName?.text) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.xmlTagMismatch(element.tokens.startTagName?.text, endTagName.text),
                location: endTagName.location
            });
        }
        for (const child of element.elements) {
            this.validateTagClosings(child);
        }
    }

    /**
     * Report any structural tag that isn't all lower case (e.g. `<Children>` instead of
     * `<children>`). Roku requires these tags to be lower case, but the parser matches them
     * case-insensitively so we can emit this specific diagnostic instead of a generic
     * "unexpected tag" error.
     *
     * Only the structural spine is walked (the component tag, its direct children, and the
     * members of `<interface>`). Tags inside `<children>` are node/component names (like
     * `<Label>`) whose casing is author-defined, so they're intentionally not validated.
     */
    private validateTagCasing(rootElement: SGElement) {
        const validate = (element: SGElement) => {
            const startTagName = element.tokens.startTagName;
            const tagText = startTagName?.text;
            if (tagText && tagText !== tagText.toLowerCase()) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.xmlTagWrongCase(tagText, tagText.toLowerCase()),
                    location: startTagName.location
                });
            }
        };

        validate(rootElement);
        //`<children>` holds author-cased node names, so validate the tag itself but not its contents
        for (const child of rootElement.elements) {
            validate(child);
            if (isSGInterface(child)) {
                //`<field>` and `<function>` members are structural too
                for (const member of child.elements) {
                    validate(member);
                }
            }
        }
    }

    private validateComponent(ast: SGAst) {
        const { rootElement, componentElement } = ast;
        if (!componentElement) {
            //not a SG component
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.xmlComponentMissingComponentDeclaration(),
                location: rootElement.location
            });
            return;
        }

        //component name/extends
        if (!componentElement.name) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.xmlComponentMissingNameAttribute(),
                location: componentElement.tokens.startTagName.location
            });
        }
        if (!componentElement.extends) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.xmlComponentMissingExtendsAttribute(),
                location: componentElement.tokens.startTagName.location
            });
        }

        //flag explicit script imports that match the auto-imported codebehind file
        const file = this.event.file;
        if (file.program?.options?.autoImportComponentScript === true) {
            const codebehindPaths = file.possibleCodebehindDestPaths ?? [];
            for (const scriptImport of file.parser.references.scriptTagImports) {
                if (!scriptImport.destPath || !scriptImport.filePathRange) {
                    continue;
                }
                if (codebehindPaths.includes(scriptImport.destPath)) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.unnecessaryCodebehindScriptImport(),
                        location: util.createLocationFromFileRange(file, scriptImport.filePathRange)
                    });
                }
            }
        }
    }
}
