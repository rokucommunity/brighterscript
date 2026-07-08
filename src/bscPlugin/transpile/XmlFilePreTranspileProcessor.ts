import { createSGScript } from '../../astUtils/creators';
import { isXmlFile } from '../../astUtils/reflection';
import { isSGScript } from '../../astUtils/xml';
import type { XmlFile } from '../../files/XmlFile';
import type { AfterPrepareFileEvent } from '../../interfaces';
import type { SGScript } from '../../parser/SGTypes';
import util from '../../util';

export class XmlFilePreTranspileProcessor {
    public constructor(
        private event: AfterPrepareFileEvent<XmlFile>
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

        // eslint-disable-next-line @typescript-eslint/dot-notation
        const [, publishableScripts] = this.checkScriptsForPublishableImports([
            ...this.event.file.ast.componentElement?.scriptElements ?? [],
            ...extraImportScripts
        ]);

        //force bslib to be the last script in the list
        const idx = publishableScripts.findIndex(x => x.uri?.endsWith('bslib.brs'));
        if (idx > -1) {
            const [bslib] = publishableScripts.splice(idx, 1);
            publishableScripts.push(bslib);
        }

        const elements = this.event.file.ast.componentElement.elements;
        //remove any unreferenced scripts
        let set = new Set(publishableScripts);
        for (let i = elements.length - 1; i >= 0; i--) {
            const element = elements[i];
            if (isSGScript(element)) {
                if (set.has(element as SGScript)) {
                    set.delete(element as SGScript);
                } else {
                    this.event.editor.arraySplice(elements, i, 1);
                }
            }
        }

        //add new scripts after the LAST `<script>` tag that was created explicitly by the user, or at the top of the component if it has no scripts
        let lastScriptIndex = util.findLastIndex(this.event.file.ast.componentElement.elements, x => x.tokens.startTagName.text.toLowerCase() === 'script');
        lastScriptIndex = lastScriptIndex >= 0
            ? lastScriptIndex + 1
            : 0;
        for (const element of set) {
            this.event.editor.arraySplice(elements, lastScriptIndex++, 0, element);
        }
    }

    private checkScriptsForPublishableImports(scripts: SGScript[]): [boolean, SGScript[]] {
        const { program } = this.event;
        if (!program.options.pruneEmptyCodeFiles) {
            return [false, scripts];
        }
        const publishableScripts = scripts.filter(script => {
            const uriAttributeValue = script.uri || '';
            const pkgMapPath = util.getPkgPathFromTarget(this.event.file.pkgPath, uriAttributeValue);
            let file = program.getFile(pkgMapPath);
            if (!file && pkgMapPath.endsWith(program.bslibPkgPath)) {
                return true;
            }
            if (!file && pkgMapPath.endsWith('.brs')) {
                file = program.getFile(pkgMapPath.replace(/\.brs$/, '.bs'));
            }
            return !(file?.canBePruned);
        });
        return [publishableScripts.length !== scripts.length, publishableScripts];
    }

}
