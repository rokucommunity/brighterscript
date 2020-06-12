import chalk from 'chalk';
import * as moment from 'moment';
import { EventEmitter } from 'eventemitter3';

export class Logger {

    public static subscribe(callback) {
        this.emitter.on('log', callback);
        return () => {
            this.emitter.off('log', callback);
        };
    }
    private static emitter = new EventEmitter();

    constructor(logLevel?: LogLevel) {
        this.logLevel = logLevel;
    }

    public get logLevel() {
        return this._logLevel;
    }
    public set logLevel(value: LogLevel) {
        this._logLevel = value ?? LogLevel.log;
    }
    private _logLevel = LogLevel.log;

    private getTimestamp() {
        let milliseconds: string;
        //show milliseconds when in the more chatty log levels
        if (this._logLevel === LogLevel.info || this._logLevel === LogLevel.debug || this._logLevel === LogLevel.trace) {
            milliseconds = ':SSSS';
        }
        return '[' + chalk.grey(moment().format(`hh:mm:ss${milliseconds} A`)) + ']';
    }

    private writeToLog(method: (...consoleArgs: any[]) => void, ...args: any[]) {
        if (this._logLevel === LogLevel.trace) {
            method = console.trace;
        }
        let finalArgs = [];
        //evaluate any functions to get their values.
        //This allows more complicated values to only be evaluated if this log level is active
        for (let arg of args) {
            if (arg instanceof Function) {
                arg = arg();
            }
            finalArgs.push(arg);
        }
        method.call(console, this.getTimestamp(), ...finalArgs);
        if (Logger.emitter.listenerCount('log') > 0) {
            Logger.emitter.emit('log', finalArgs.join(' '));
        }
    }

    /**
     * Log an error message to the console
     */
    error(...messages) {
        if (this._logLevel >= LogLevel.error) {
            this.writeToLog(console.error, ...messages);
        }
    }

    /**
     * Log a warning message to the console
     */
    warn(...messages) {
        if (this._logLevel >= LogLevel.warn) {
            this.writeToLog(console.warn, ...messages);
        }
    }

    /**
     * Log a standard log message to the console
     */
    log(...messages) {
        if (this._logLevel >= LogLevel.log) {
            this.writeToLog(console.log, ...messages);
        }
    }
    /**
     * Log an info message to the console
     */
    info(...messages) {
        if (this._logLevel >= LogLevel.info) {
            this.writeToLog(console.info, ...messages);
        }
    }

    /**
     * Log a debug message to the console
     */
    debug(...messages) {
        if (this._logLevel >= LogLevel.debug) {
            this.writeToLog(console.debug, ...messages);
        }
    }

    /**
     * Log a debug message to the console
     */
    trace(...messages) {
        if (this._logLevel >= LogLevel.trace) {
            this.writeToLog(console.trace, ...messages);
        }
    }

    time(logLevel: LogLevel, ...messages) {
        if (this._logLevel >= logLevel) {
            let start = Date.now();
            let logLevelString = LogLevel[logLevel];
            this[logLevelString](...messages);
            //return a function to call when the timer is complete
            return () => {
                let diffDate = new Date(Date.now() - start);
                let timeString = '';
                if (diffDate.getMinutes() > 0) {
                    timeString = `${diffDate.getMinutes()}m${diffDate.getSeconds()}s${diffDate.getMilliseconds()}ms`;
                } else if (diffDate.getSeconds() > 0) {
                    timeString += `${diffDate.getSeconds()}s${diffDate.getMilliseconds()}ms`;
                } else {
                    timeString = `${diffDate.getMilliseconds()}ms`;
                }
                this[logLevelString](...messages, ` finished. (${chalk.blue(timeString)})`);
            };
        } else {
            return noop;
        }
    }
}

function noop() {

}

export enum LogLevel {
    error = 1,
    warn = 2,
    log = 3,
    info = 4,
    debug = 5,
    trace = 6
}
