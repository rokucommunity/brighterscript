import { isAssetFile, isBrsFile, isXmlFile } from '../astUtils/reflection';
import type { AssetFile } from '../files/AssetFile';
import type { BrsFile } from '../files/BrsFile';
import type { XmlFile } from '../files/XmlFile';
import type { SerializedFile, SerializeFileEvent } from '../interfaces';

export class FileSerializer {
    constructor(
        private event: SerializeFileEvent
    ) {

    }

    public process() {
        //if there's already a result for this file, do nothing
        if (this.event.result.has(this.event.file)) {
            return;
        }
        if (isBrsFile(this.event.file)) {
            this.serializeBrsFile(this.event.file);
        } else if (isXmlFile(this.event.file)) {
            this.serializeXmlFile(this.event.file);
        } else if (isAssetFile(this.event.file)) {
            this.serializeAssetFile(this.event.file);
        }
    }

    private serializeBrsFile(file: BrsFile) {
        const result: SerializedFile[] = [];
        const serialized = file.serialize();

        const afterTranspileEvent = {
            program: this.event.program,
            file: file,
            code: serialized.code,
            outputPath: this.event.program['getOutputPath'](file), // eslint-disable-line
            map: serialized.map,
            typedef: serialized.typedef
        };

        //TODO remove `afterFileTranspile` in v1
        this.event.program.plugins.emit('afterFileTranspile', afterTranspileEvent);

        if (afterTranspileEvent.code) {
            result.push({
                pkgPath: file.pkgPath,
                data: Buffer.from(afterTranspileEvent.code)
            });
        }
        if (afterTranspileEvent.map) {
            result.push({
                pkgPath: file.pkgPath + '.map',
                data: Buffer.from(afterTranspileEvent.map.toString())
            });
        }
        if (afterTranspileEvent.typedef) {
            result.push({
                pkgPath: file.pkgPath.replace(/\.brs$/i, '.d.bs'),
                data: Buffer.from(afterTranspileEvent.typedef)
            });
        }

        this.event.result.set(file, result);
    }

    private serializeXmlFile(file: XmlFile) {
        const result: SerializedFile[] = [];
        const serialized = file.serialize();
        if (serialized.code) {
            result.push({
                pkgPath: file.pkgPath,
                data: Buffer.from(serialized.code)
            });
        }
        if (serialized.map) {
            result.push({
                pkgPath: file.pkgPath + '.map',
                data: Buffer.from(serialized.map.toString())
            });
        }
        this.event.result.set(file, result);
    }

    private serializeAssetFile(file: AssetFile) {
        this.event.result.set(file, [{
            pkgPath: file.pkgPath,
            data: file.data
        }]);
    }
}
