import chalk from 'chalk';
import * as moment from 'moment';

export class Logger {

    public logLevel = LogLevel.log;

    private getTimestamp() {
        return '[' + chalk.grey(moment().format('hh:mm:ss A')) + ']';
    }

    /**
     * Log an error message to the console
     */
    error(...messages) {
        if (this.logLevel >= LogLevel.error) {
            console.debug(this.getTimestamp(), ...messages);
        }
    }

    /**
     * Log a warning message to the console
     */
    warn(...messages) {
        if (this.logLevel >= LogLevel.warn) {
            console.debug(this.getTimestamp(), ...messages);
        }
    }

    /**
     * Log a standard log message to the console
     */
    log(...messages) {
        if (this.logLevel >= LogLevel.log) {
            console.debug(this.getTimestamp(), ...messages);
        }
    }
    /**
     * Log an ingo message to the console
     */
    info(...messages) {
        if (this.logLevel >= LogLevel.info) {
            console.debug(this.getTimestamp(), ...messages);
        }
    }

    /**
     * Log a debug message to the console
     */
    debug(...messages) {
        if (this.logLevel >= LogLevel.debug) {
            console.debug(this.getTimestamp(), ...messages);
        }
    }
}

export enum LogLevel {
    error = 1,
    warn = 2,
    log = 3,
    info = 4,
    debug = 5
}

//default logger
export const logger = new Logger();
