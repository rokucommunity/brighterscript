import { default as logger, createLogger } from '@rokucommunity/logger';
import { Logger } from '@rokucommunity/logger';

//force log levels to be same width
logger.consistentLogLevelWidth = true;
//by default, disable printing the logLevel in the console.
logger.printLogLevel = false;
logger.logLevel = 'log';

/**
 * Set the logger properties to be used when running in language server mode. It's a function so we can share the logic between LanguageServer and
 * the workerThread projects that don't inherit the same logger instance
 */
export function setLspLoggerProps() {
    //disable logger color when running the LSP (i.e. anytime we create a LanguageServer instance)
    logger.enableColor = false;
    //include the logLevel text in all log messages when running in LSP mode
    logger.printLogLevel = true;
}

export { logger, Logger, createLogger };
export { LogLevel } from './Logger';
