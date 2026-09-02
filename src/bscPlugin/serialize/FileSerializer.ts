import { isAssetFile, isBrsFile, isXmlFile } from '../../astUtils/reflection';
import type { AssetFile } from '../../files/AssetFile';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { SerializedFile, SerializeFileEvent } from '../../interfaces';
import { util } from '../../util';

export class FileSerializer {
    constructor(
        private event: SerializeFileEvent
    ) {

    }

    public async process() {
        //if there's already a result for this file, do nothing
        if (this.event.result.has(this.event.file)) {
            return;
        }
        this.event.scope?.linkSymbolTable();
        if (isBrsFile(this.event.file)) {
            await this.serializeBrsFile(this.event.file);
        } else if (isXmlFile(this.event.file)) {
            await this.serializeXmlFile(this.event.file);
        } else if (isAssetFile(this.event.file)) {
            this.serializeAssetFile(this.event.file);
        }
        this.event.scope?.unlinkSymbolTable();
    }

    private async serializeBrsFile(file: BrsFile) {
        const result: SerializedFile[] = [];
        const serialized = file.serialize();

        if (typeof serialized.code === 'string') {
            result.push({
                pkgPath: file.pkgPath,
                data: Buffer.from(serialized.code)
            });
        }
        if (serialized.map) {
            //chain a prebuild input map (co-located .map or sourceMappingURL comment) onto the
            //output map so positions trace all the way back to the original source
            const chainedMap = await util.chainInputSourceMap(serialized.map, file);
            result.push({
                pkgPath: file.pkgPath + '.map',
                data: Buffer.from(chainedMap)
            });
        }
        if (typeof serialized.typedef === 'string') {
            result.push({
                pkgPath: file.pkgPath.replace(/\.brs$/i, '.d.bs'),
                data: Buffer.from(serialized.typedef)
            });
        }

        this.event.result.set(file, result);
    }

    private async serializeXmlFile(file: XmlFile) {
        const result: SerializedFile[] = [];
        const serialized = file.serialize();
        if (typeof serialized.code === 'string') {
            result.push({
                pkgPath: file.pkgPath,
                data: Buffer.from(serialized.code)
            });
        }
        if (serialized.map) {
            const chainedMap = await util.chainInputSourceMap(serialized.map, file);
            result.push({
                pkgPath: file.pkgPath + '.map',
                data: Buffer.from(chainedMap)
            });
        }
        this.event.result.set(file, result);
    }

    private serializeAssetFile(file: AssetFile) {
        this.event.result.set(file, [{
            pkgPath: file.pkgPath,
            data: file.data.value
        }]);
    }
}
