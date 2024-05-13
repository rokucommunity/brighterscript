import { default as defaultLogger } from '@rokucommunity/logger';
import type { Logger } from '@rokucommunity/logger';
const logger = defaultLogger.createLogger();

//force log levels to be same width
logger.consistentLogLevelWidth = true;
logger.printLogLevel = false;
logger.timestampFormat = 'hh:mm:ss:SSS aa';
logger.logLevel = 'log';
logger.prefix = '';

export const createLogger = logger.createLogger.bind(logger);
export { logger, Logger };
export { LogLevel } from './Logger';
