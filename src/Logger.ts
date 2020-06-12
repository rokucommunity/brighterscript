import chalk from 'chalk';
import * as moment from 'moment';

export class Logger {

    constructor(logLevel?: LogLevel) {
        this.logLevel = logLevel;
    }

    public get logLevel() {
        return this._logLevel;
    }
    public set logLevel(value: LogLevel) {
        if (value) {
            this._logLevel = value;
        }
    }
    private _logLevel = LogLevel.log;

    private getTimestamp() {
        return '[' + chalk.grey(moment().format('hh:mm:ss A')) + ']';
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
     * Log an ingo message to the console
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
}

export enum LogLevel {
    error = 1,
    warn = 2,
    log = 3,
    info = 4,
    debug = 5,
    trace = 6
}
