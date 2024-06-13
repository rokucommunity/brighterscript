import { createLogger } from '@rokucommunity/logger';
import { Trace } from './Decorators';
import { createSandbox } from 'sinon';
import { expect } from '../chai-config.spec';
import { LogLevel } from '../logging';
const sinon = createSandbox();

describe('decorators', () => {

    beforeEach(() => {
        sinon.restore();
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('@Trace()', () => {
        it('calls logger.trace on every method', () => {
            @Trace()
            class TestClass {
                public logger = createLogger();
                test1(arg1: any) { }
                test2(arg1: any) { }
            }
            const instance = new TestClass();
            const stub = sinon.stub(instance.logger, 'write').callsFake(() => { });
            instance.test1('arg1');
            instance.test2('arg1');
            expect(
                stub.getCalls().map(x => x.args)
            ).to.eql([
                [LogLevel.trace, 'test1', 'arg1'],
                [LogLevel.trace, 'test2', 'arg1']
            ]);
        });

        it('calls logger.log (overridden) on every method', () => {
            @Trace(LogLevel.log)
            class TestClass {
                public logger = createLogger();
                test1(arg1: any) { }
                test2(arg1: any) { }
            }
            const instance = new TestClass();
            const stub = sinon.stub(instance.logger, 'write').callsFake(() => { });
            instance.test1('arg1');
            instance.test2('arg1');
            expect(
                stub.getCalls().map(x => x.args)
            ).to.eql([
                [LogLevel.log, 'test1', 'arg1'],
                [LogLevel.log, 'test2', 'arg1']
            ]);
        });

        it('works for a single decorated method', () => {
            class TestClass {
                public logger = createLogger();
                test1(arg1: any) { }
                @Trace()
                test2(arg1: any) { }
            }
            const instance = new TestClass();
            const stub = sinon.stub(instance.logger, 'write').callsFake(() => { });
            instance.test1('arg1');
            instance.test2('arg1');
            expect(
                stub.getCalls().map(x => x.args)
            ).to.eql([
                [LogLevel.trace, 'test2', 'arg1']
            ]);
        });

        it('does not wrap getters or setters', () => {
            @Trace()
            class TestClass {
                public logger = createLogger();
                private _test1: any;
                get test1() {
                    return this._test1;
                }
                set test1(value: any) {
                    this._test1 = value;
                }
            }
            const instance = new TestClass();
            const stub = sinon.stub(instance.logger, 'write').callsFake(() => { });
            const value = instance.test1;
            instance.test1 = value;

            expect(
                stub.getCalls().map(x => x.args)
            ).to.eql([]);
        });
    });
});
