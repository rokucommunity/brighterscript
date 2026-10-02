import { BrsFile } from '../files/BrsFile';
import { XmlFile } from '../files/XmlFile';
import { AssetFile } from '../files/AssetFile';
import type { FileData } from '../files/LazyFileData';
import type { Program } from '../Program';

/**
 * A factory for creating files
 */
export class FileFactory {
    public constructor(
        /**
         * The program that files created by this factory will belong to (unless a different program is passed to the create method)
         */
        public readonly program?: Program
    ) {
    }

    /**
     * Create a new `BrsFile` (for `.brs`, `.bs`, and `.d.bs` files)
     */
    public createBrsFile(options: { srcPath: string; destPath: string; pkgPath?: string; program?: Program }): BrsFile {
        return new BrsFile({ ...options, program: options.program ?? this.program });
    }

    /**
     * Create a new `XmlFile`
     */
    public createXmlFile(options: { srcPath: string; destPath: string; pkgPath?: string; program?: Program }): XmlFile {
        return new XmlFile({ ...options, program: options.program ?? this.program });
    }

    /**
     * Create a new `AssetFile` (for any file that brighterscript does not handle directly, like images or fonts)
     */
    public createAssetFile(options: { srcPath: string; destPath: string; pkgPath?: string; data?: FileData }): AssetFile {
        return new AssetFile(options);
    }
}
