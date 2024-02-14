import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { XmlFile } from '../../files/XmlFile';
import type { OnFileValidateEvent } from '../../interfaces';
import type { SGAst } from '../../parser/SGTypes';
import util from '../../util';

export class XmlFileValidator {
    constructor(
        public event: OnFileValidateEvent<XmlFile>
    ) {
    }

    public process() {
        util.validateTooDeepFile(this.event.file);
        if (this.event.file.parser.ast.rootElement) {
            this.validateComponent(this.event.file.parser.ast);
        } else {
            //skip empty XML
        }
    }

    private validateComponent(ast: SGAst) {
        const { rootElement: rootElement, componentElement: componentElement } = ast;
        if (!componentElement) {
            //not a SG component
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingComponentDeclaration(),
                range: rootElement.range,
                file: this.event.file
            });
            return;
        }

        //component name/extends
        if (!componentElement.name) {
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingNameAttribute(),
                range: componentElement.tokens.startTagName.range,
                file: this.event.file
            });
        }
        if (!componentElement.extends) {
            this.event.file.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingExtendsAttribute(),
                range: componentElement.tokens.startTagName.range,
                file: this.event.file
            });
        }


        //catch script imports with same path as the auto-imported codebehind file
        const scriptTagImports = this.event.file.parser.references.scriptTagImports;
        let explicitCodebehindScriptTag = this.event.file.program.options.autoImportComponentScript === true
            ? scriptTagImports.find(x => this.event.file.possibleCodebehindDestPaths.includes(x.destPath))
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
