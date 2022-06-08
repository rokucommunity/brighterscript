import { expect } from 'chai';
import { Logger, LogLevel, noop } from './Logger';
import chalk from 'chalk';
import { createSandbox } from 'sinon';
const sinon = createSandbox();

describe('Logger', () => {
    let logger: Logger;

    beforeEach(() => {
        logger = new Logger(LogLevel.trace);
        sinon.restore();
        //disable chalk colors for testing
        sinon.stub(chalk, 'grey').callsFake((arg) => arg as any);
    });

    it('noop does nothing', () => {
        noop();
    });

    it('loglevel setter converts string to enum', () => {
        (logger as any).logLevel = 'error';
        expect(logger.logLevel).to.eql(LogLevel.error);
        (logger as any).logLevel = 'info';
        expect(logger.logLevel).to.eql(LogLevel.info);
    });

    it('uses LogLevel.log by default', () => {
        logger = new Logger();
        expect(logger.logLevel).to.eql(LogLevel.log);
    });

    describe('log methods call correct error type', () => {
        it('error', () => {
            const stub = sinon.stub(logger as any, 'writeToLog').callsFake(() => { });
            logger.error();
            expect(stub.getCalls()[0].args[0]).to.eql(console.error);
        });

        it('warn', () => {
            const stub = sinon.stub(logger as any, 'writeToLog').callsFake(() => { });
            logger.warn();
            expect(stub.getCalls()[0].args[0]).to.eql(console.warn);
        });

        it('log', () => {
            const stub = sinon.stub(logger as any, 'writeToLog').callsFake(() => { });
            logger.log();
            expect(stub.getCalls()[0].args[0]).to.eql(console.log);
        });

        it('info', () => {
            const stub = sinon.stub(logger as any, 'writeToLog').callsFake(() => { });
            logger.info();
            expect(stub.getCalls()[0].args[0]).to.eql(console.info);
        });

        it('debug', () => {
            const stub = sinon.stub(logger as any, 'writeToLog').callsFake(() => { });
            logger.debug();
            expect(stub.getCalls()[0].args[0]).to.eql(console.debug);
        });

        it('trace', () => {
            const stub = sinon.stub(logger as any, 'writeToLog').callsFake(() => { });
            logger.trace();
            expect(stub.getCalls()[0].args[0]).to.eql(console.trace);
        });
    });

    it('skips all errors on error level', () => {
        logger.logLevel = LogLevel.off;
        const stub = sinon.stub(logger as any, 'writeToLog').callsFake(() => { });
        logger.trace();
        logger.debug();
        logger.info();
        logger.log();
        logger.warn();
        logger.error();

        expect(
            stub.getCalls().map(x => x.args[0])
        ).to.eql([]);
    });

    it('does not skip when log level is high enough', () => {
        logger.logLevel = LogLevel.trace;
        const stub = sinon.stub(logger as any, 'writeToLog').callsFake(() => { });
        logger.trace();
        logger.debug();
        logger.info();
        logger.log();
        logger.warn();
        logger.error();

        expect(
            stub.getCalls().map(x => x.args[0])
        ).to.eql([
            console.trace,
            console.debug,
            console.info,
            console.log,
            console.warn,
            console.error
        ]);
    });

    describe('time', () => {
        it('calls action even if logLevel is wrong', () => {
            logger.logLevel = LogLevel.error;
            const spy = sinon.spy();
            logger.time(LogLevel.info, null, spy);
            expect(spy.called).to.be.true;
        });

        it('runs timer when loglevel is right', () => {
            logger.logLevel = LogLevel.log;
            const spy = sinon.spy();
            logger.time(LogLevel.log, null, spy);
            expect(spy.called).to.be.true;
        });

        it('returns value', () => {
            logger.logLevel = LogLevel.log;
            const spy = sinon.spy(() => {
                return true;
            });
            expect(
                logger.time(LogLevel.log, null, spy)
            ).to.be.true;
            expect(spy.called).to.be.true;
        });

        it('gives callable pause and resume functions even when not running timer', () => {
            logger.time(LogLevel.info, null, (pause, resume) => {
                pause();
                resume();
            });
        });

        it('waits for and returns a promise when a promise is returned from the action', () => {
            expect(logger.time(LogLevel.info, ['message'], () => {
                return Promise.resolve();
            })).to.be.instanceof(Promise);
        });
    });
});
