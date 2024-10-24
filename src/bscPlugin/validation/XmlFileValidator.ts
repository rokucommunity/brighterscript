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


        //catch script imports with same path as the auto-imported codebehind file
        const scriptTagImports = this.event.file.parser.references.scriptTagImports;
        let explicitCodebehindScriptTag = this.event.file.program.options.autoImportComponentScript === true
            ? scriptTagImports.find(x => this.event.file.possibleCodebehindDestPaths.includes(x.destPath))
            : undefined;
        if (explicitCodebehindScriptTag) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.unnecessaryCodebehindScriptImport(),
                location: util.createLocationFromFileRange(this.event.file, explicitCodebehindScriptTag.filePathRange)
            });
        }
    }
}
