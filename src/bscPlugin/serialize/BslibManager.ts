import type { BeforeBuildProgramEvent } from '../../interfaces';
import { standardizePath as s } from '../../util';
import { source as bslibSource } from '@rokucommunity/bslib';
import { Cache } from '../../Cache';
import { BrsFile } from '../../files/BrsFile';
const bslibSrcPath = s`${require.resolve('@rokucommunity/bslib')}/dist/source/bslib.brs`;
export class BslibManager {

    private cache = new Cache();

    public addBslibFileIfMissing(event: BeforeBuildProgramEvent) {
        //is bslib present in the program? If not, add it now just for this build cycle
        const exists = !!event.files.find(x => {
            return BslibManager.isBslibPkgPath(x.pkgPath);
        });
        if (!exists) {
            const file = this.cache.getOrAdd('bslib', () => {
                const file = new BrsFile({
                    srcPath: bslibSrcPath,
                    destPath: s`source/bslib.brs`,
                    pkgPath: s`source/bslib.brs`,
                    program: event.program
                });
                file.parse(bslibSource);
                return file;
            });
            event.files.push(file);
        }
    }

    /**
     * Is the pkgPath a support path to bslib?
     */
    public static isBslibPkgPath(pkgPath: string) {
        return /(source[\\\/]bslib.brs)|(source[\\\/]roku_modules[\\\/]bslib[\\\/]bslib.brs)$/i.test(pkgPath);
    }
}
