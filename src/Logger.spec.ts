import { expect } from './chai-config.spec';
import type { Logger } from './logging';
import { createLogger } from './logging';
import chalk from 'chalk';
import { createSandbox } from 'sinon';
const sinon = createSandbox();

describe('Logger', () => {
    let logger: Logger;

    beforeEach(() => {
        logger = createLogger({
            logLevel: 'trace'
        });
        sinon.restore();
        //disable chalk colors for testing
        sinon.stub(chalk, 'grey').callsFake((arg) => arg as any);
    });

    it('loglevel setter converts string to enum', () => {
        logger.logLevel = 'error';
        expect(logger.logLevel).to.eql('error');
        logger.logLevel = 'info';
        expect(logger.logLevel).to.eql('info');
    });

    it('uses "log" by default', () => {
        logger = createLogger();
        expect(logger.logLevel).to.eql('log');
    });

    describe('log methods call correct error type', () => {
        it('error', () => {
            const stub = sinon.stub(logger as any, 'write').callsFake(() => { });
            logger.error();
            expect(stub.getCalls()[0].args[0]).to.eql('error');
        });

        it('warn', () => {
            const stub = sinon.stub(logger as any, 'write').callsFake(() => { });
            logger.warn();
            expect(stub.getCalls()[0].args[0]).to.eql('warn');
        });

        it('log', () => {
            const stub = sinon.stub(logger as any, 'write').callsFake(() => { });
            logger.log();
            expect(stub.getCalls()[0].args[0]).to.eql('log');
        });

        it('info', () => {
            const stub = sinon.stub(logger as any, 'write').callsFake(() => { });
            logger.info();
            expect(stub.getCalls()[0].args[0]).to.eql('info');
        });

        it('debug', () => {
            const stub = sinon.stub(logger as any, 'write').callsFake(() => { });
            logger.debug();
            expect(stub.getCalls()[0].args[0]).to.eql('debug');
        });

        it('trace', () => {
            const stub = sinon.stub(logger as any, 'write').callsFake(() => { });
            logger.trace();
            expect(stub.getCalls()[0].args[0]).to.eql('trace');
        });
    });

    it('skips all errors on error level', () => {
        let messages = [];
        logger.subscribe((message) => {
            messages.push(message);
        });
        logger.logLevel = 'off';
        logger.trace();
        logger.debug();
        logger.info();
        logger.log();
        logger.warn();
        logger.error();

        expect(messages).to.eql([]);
    });

    it('does not skip when log level is high enough', () => {
        logger.logLevel = 'trace';
        const stub = sinon.stub(logger as any, 'write').callsFake(() => { });
        logger.trace();
        logger.debug();
        logger.info();
        logger.log();
        logger.warn();
        logger.error();

        expect(
            stub.getCalls().map(x => x.args[0])
        ).to.eql([
            'trace',
            'debug',
            'info',
            'log',
            'warn',
            'error'
        ]);
    });

    describe('time', () => {
        it('calls action even if logLevel is wrong', () => {
            logger.logLevel = 'error';
            const spy = sinon.spy();
            logger.time('info', [], spy);
            expect(spy.called).to.be.true;
        });

        it('runs timer when loglevel is right', () => {
            logger.logLevel = 'log';
            const spy = sinon.spy();
            logger.time('log', [], spy);
            expect(spy.called).to.be.true;
        });

        it('returns value', () => {
            logger.logLevel = 'log';
            const spy = sinon.spy(() => {
                return true;
            });
            expect(
                logger.time('log', [], spy)
            ).to.be.true;
            expect(spy.called).to.be.true;
        });

        it('gives callable pause and resume functions even when not running timer', () => {
            logger.time('info', [], (pause, resume) => {
                pause();
                resume();
            });
        });

        it('waits for and returns a promise when a promise is returned from the action', () => {
            expect(logger.time('info', ['message'], () => {
                return Promise.resolve();
            })).to.be.instanceof(Promise);
        });
    });
});
