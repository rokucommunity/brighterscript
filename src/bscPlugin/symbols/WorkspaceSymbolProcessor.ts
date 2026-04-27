import { isBrsFile, isXmlFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { ProvideWorkspaceSymbolsEvent } from '../../interfaces';
import { getWorkspaceSymbolsFromBrsFile } from './symbolUtils';
import util from '../../util';

export class WorkspaceSymbolProcessor {
    public constructor(
        public event: ProvideWorkspaceSymbolsEvent
    ) {

    }

    public process() {
        const results = Object.values(this.event.program.files).map(file => {
            if (isBrsFile(file) && !file.isSynthetic) {
                return this.getBrsFileWorkspaceSymbols(file);
            } else if (isXmlFile(file)) {
                return this.getXmlFileWorkspaceSymbols(file);
            }
            return [];
        });
        return results.flat();
    }

    private getBrsFileWorkspaceSymbols(file: BrsFile, uriOverride?: string) {
        const symbols = getWorkspaceSymbolsFromBrsFile(file, uriOverride);
        this.event.workspaceSymbols.push(...symbols);
        return this.event.workspaceSymbols;
    }

    private getXmlFileWorkspaceSymbols(file: XmlFile) {
        const xmlUri = util.pathToUri(file.srcPath);
        for (const pkgPath of file.inlineScriptPkgPaths) {
            const brsFile = this.event.program.getFile<BrsFile>(pkgPath);
            if (brsFile) {
                this.getBrsFileWorkspaceSymbols(brsFile, xmlUri);
            }
        }
        return this.event.workspaceSymbols;
    }
}
