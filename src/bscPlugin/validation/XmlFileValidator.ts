import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { XmlFile } from '../../files/XmlFile';
import type { OnFileValidateEvent } from '../../interfaces';
import type { SGAst, SGTag } from '../../parser/SGTypes';
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
            this.validateTagClosings(this.event.file.parser.ast.root);
        } else {
            //skip empty XML
        }
    }

    /**
     * Walk the SG tag tree and report any tag whose closing tag name does not
     * match its opening tag name (e.g. `<Group></LayoutGroup>`). This runs at
     * validation time (rather than parse time) so it also catches mismatches in
     * AST injected by plugins, not just AST produced by the parser.
     */
    private validateTagClosings(tag: SGTag) {
        const closingTagText = tag.closingTag?.text;
        //only validate when a closing tag was actually present (self-closing and
        //programmatically-built tags omit it, and must remain valid)
        if (closingTagText !== undefined && closingTagText !== tag.tag.text) {
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.xmlTagMismatch(tag.tag.text, closingTagText),
                range: tag.closingTag.range,
                file: this.event.file
            });
        }
        for (const child of tag.getChildren()) {
            this.validateTagClosings(child);
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

}
