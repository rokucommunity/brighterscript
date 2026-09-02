import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { XmlFile } from '../../files/XmlFile';
import type { ValidateFileEvent } from '../../interfaces';
import type { SGAst, SGElement } from '../../parser/SGTypes';
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
