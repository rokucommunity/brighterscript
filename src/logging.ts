import { default as defaultLogger } from '@rokucommunity/logger';
import { Logger } from '@rokucommunity/logger';
const logger = defaultLogger.createLogger();

//force log levels to be same width
logger.consistentLogLevelWidth = true;
logger.printLogLevel = false;
logger.timestampFormat = 'hh:mm:ss:SSS aa';
logger.logLevel = 'log';
logger.prefix = '';

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


export const createLogger = logger.createLogger.bind(logger);
export { logger, Logger };
export { LogLevel } from './Logger';
