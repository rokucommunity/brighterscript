import { BrsFile } from './BrsFile';
import { XmlFile } from './XmlFile';
import { AssetFile } from './AssetFile';
import type { Program } from '../Program';

export class FileFactory {

    public constructor(
        public program: Program
    ) {
    }

    BrsFile(options: { srcPath: string; destPath: string; pkgPath?: string }) {
        return new BrsFile({ ...options, program: this.program });
    }

    XmlFile(options: { srcPath: string; destPath: string; pkgPath?: string }) {
        return new XmlFile({ ...options, program: this.program });
    }

    AssetFile(options: { srcPath: string; destPath: string; pkgPath?: string }) {
        return new AssetFile(options);
    }
}
