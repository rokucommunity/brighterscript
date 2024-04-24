import { default as logger, createLogger } from '@rokucommunity/logger';
import { Logger } from '@rokucommunity/logger';

//force log levels to be same width
logger.consistentLogLevelWidth = true;
logger.logLevel = 'log';

export { logger, Logger, createLogger };
export { LogLevel } from './Logger';
