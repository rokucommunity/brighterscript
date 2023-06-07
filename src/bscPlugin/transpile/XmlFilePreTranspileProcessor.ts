import { createSGScript } from '../../astUtils/creators';
import { isXmlFile } from '../../astUtils/reflection';
import type { XmlFile } from '../../files/XmlFile';
import type { BeforeFileTranspileEvent } from '../../interfaces';
import util from '../../util';

export class XmlFilePreTranspileProcessor {
    public constructor(
        private event: BeforeFileTranspileEvent<XmlFile>
    ) {
    }

    public process() {
        if (!isXmlFile(this.event.file)) {
            return;
        }

        //insert any missing script imports
        this.injectScriptImports();

        //transform any brighterscript `type` attributes to `brightscript`
        for (const script of this.event.file.ast?.componentElement?.scriptElements ?? []) {
            const type = script.getAttribute('type');
            if (/text\/brighterscript/i.test(type?.value)) {
                this.event.editor.setProperty(
                    type,
                    'value',
                    type.value.replace(/text\/brighterscript/i, 'text/brightscript')
                );
            }

            //replace `.bs` extensions with `.brs`
            const uri = script.getAttribute('uri');
            if (/\.bs/i.test(uri?.value)) {
                this.event.editor.setProperty(
                    uri,
                    'value',
                    uri.value.replace(/\.bs/i, '.brs')
                );
            }
        }
    }

    /**
     * Inject any missing scripts into the xml file
     */
    private injectScriptImports() {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const extraImportScripts = this.event.file['getMissingImportsForTranspile']().map(uri => {
            return createSGScript({
                type: 'text/brightscript',
                uri: util.sanitizePkgPath(uri.replace(/\.bs$/, '.brs'))
            });
        });

        if (extraImportScripts) {
            //add new scripts after the LAST `<script>` tag that was created explicitly by the user, or at the top of the component if it has no scripts
            let lastScriptIndex = util.findLastIndex(this.event.file.ast.componentElement.elements, x => x.tokens.startTagName.text.toLowerCase() === 'script');
            lastScriptIndex = lastScriptIndex >= 0
                ? lastScriptIndex + 1
                : 0;

            this.event.editor.arraySplice(this.event.file.ast.componentElement.elements, lastScriptIndex, 0, ...extraImportScripts);
        }
    }
}
