import { BrsFile } from './BrsFile';
import { XmlFile } from './XmlFile';
import { AssetFile } from './AssetFile';
import type { Program } from '../Program';

export class FileFactory {

    public constructor(
        public program: Program
    ) {
    }

    BrsFile(srcPath: string, pkgPath: string) {
        return new BrsFile(srcPath, pkgPath, this.program);
    }

    XmlFile(srcPath: string, pkgPath: string) {
        return new XmlFile(srcPath, pkgPath, this.program);
    }

    AssetFile(srcPath: string, pkgPath: string) {
        return new AssetFile(srcPath, pkgPath);
    }
}
