import { isXmlFile } from '../../astUtils/reflection';
import type { ProvideDocumentLinksEvent } from '../../interfaces';
import type { XmlFile } from '../../files/XmlFile';
import util from '../../util';

export class DocumentLinksProvider {
    constructor(
        private event: ProvideDocumentLinksEvent
    ) { }

    public process(): void {
        if (isXmlFile(this.event.file)) {
            this.xmlFileGetDocumentLinks(this.event.file);
        }
    }

    private xmlFileGetDocumentLinks(file: XmlFile): void {
        for (const scriptImport of file.scriptTagImports) {
            if (scriptImport.filePathRange) {
                const scriptFile = this.event.program.getFile(scriptImport.pkgPath);
                this.event.documentLinks.push({
                    range: scriptImport.filePathRange,
                    target: scriptFile ? util.pathToUri(scriptFile.srcPath) : undefined
                });
            }
        }
    }
}
