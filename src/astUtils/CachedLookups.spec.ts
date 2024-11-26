import { expect } from '../chai-config.spec';
import type { BrsFile } from '../files/BrsFile';
import * as sinon from 'sinon';
import { Program } from '../Program';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { CachedLookups } from './CachedLookups';

describe('CachedLookups', () => {
    const rootDir = process.cwd();
    let program: Program;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        program.dispose();
    });

    it('doesnt complain with nested grouping expressions in a call chain', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `
            sub test(bookmark)
                print ((bookmark.duration - bookmark.position) \\ 60).toStr()
            end sub
        `);
        const loggerDebug = sinon.stub(program.logger, 'debug');
        program.validate();
        expectZeroDiagnostics(program);
        const cache = new CachedLookups({ program: program, _parser: file.parser });

        expect(file.ast).to.exist;
        expect(cache.expressions.size).to.be.greaterThan(0);
        const loggerCalls = loggerDebug.getCalls();
        const unknownExpressionCall = loggerCalls.find((call) => {
            if (call.args.length > 0 && typeof call.args[0] === 'string') {
                return !!call.args[0].includes('Encountered unknown expression');
            }
            return false;
        });
        expect(unknownExpressionCall).to.be.undefined;
    });
});
