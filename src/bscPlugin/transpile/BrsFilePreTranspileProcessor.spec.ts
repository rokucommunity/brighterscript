import { createSandbox } from 'sinon';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import { tempDir, rootDir } from '../../testHelpers.spec';
import { LogLevel, createLogger } from '../../logging';
import PluginInterface from '../../PluginInterface';
const sinon = createSandbox();

describe('BrsFile', () => {

    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        const logger = createLogger({
            logLevel: LogLevel.warn
        });
        program = new Program({ rootDir: rootDir, sourceMap: true }, logger, new PluginInterface([], {
            logger: logger,
            suppressErrors: false
        }));
    });

    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('BrsFilePreTranspileProcessor', () => {
        it('does not crash when operating on a file not included by any scope', async () => {
            program.setFile('components/lib.brs', `
                enum Direction
                    up
                    down
                    left
                    right
                end enum
                sub doSomething()
                    a = { b: "c"}
                    print a.b
                    print Direction.up
                end sub
            `);
            await program.transpile([], s`${tempDir}/out`);
        });
    });
});
