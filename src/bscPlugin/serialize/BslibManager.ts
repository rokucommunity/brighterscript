import type { BeforeBuildProgramEvent } from '../../interfaces';
import { standardizePath as s } from '../../util';
import { source as bslibSource } from '@rokucommunity/bslib';
import { Cache } from '../../Cache';
import { BrsFile } from '../../files/BrsFile';
import type { FunctionStatement } from '../../parser/Statement';
import type { Editor } from '../../astUtils/Editor';
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
                    destPath: event.program.bslibPkgPath,
                    pkgPath: event.program.bslibPkgPath,
                    program: event.program
                });
                file.parse(bslibSource);
                return file;
            });
            event.files.push(file);
        }
    }

    public static applyPrefixIfMissing(statement: FunctionStatement, editor: Editor, prefix: string) {
        //add the bslib prefix if the function does not start with bslib_ or rokucommunity_bslib_
        if (!/^(rokucommunity_)?bslib_/i.test(statement.tokens.name.text)) {
            editor.setProperty(statement.tokens.name, 'text', `${prefix}_${statement.tokens.name.text}`);
        }
    }

    /**
     * Is the pkgPath a support path to bslib?
     */
    public static isBslibPkgPath(pkgPath: string) {
        return /(source[\\\/]bslib.brs)|(source[\\\/]roku_modules[\\\/](rokucommunity_)?bslib)[\\\/]bslib.brs$/i.test(pkgPath);
    }
}
