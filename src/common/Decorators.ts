/* eslint-disable @typescript-eslint/ban-types */
import type { Logger } from '../logging';
import { LogLevel } from '../logging';

/**
 * Decorator that wraps a method or all class methods, which will write a log entry anytime a method is called. Optionally specify the log level.
 * @param logLevel the loglevel to use. Default is LogLevel.trace
 */
export function Trace(logLevel = LogLevel.trace) {
    return function Trace(target: any, propertyKey?: string, descriptor?: PropertyDescriptor): any {
        //method decorator
        if (propertyKey) {
            const originalMethod = descriptor.value;
            descriptor.value = function value(this: { logger: Logger }, ...args: any[]) {
                this.logger?.write?.(logLevel, propertyKey, ...args);
                return originalMethod.apply(this, args);
            };
            return descriptor;
        }

        //class decorator
        // Get all properties of the class
        const props = Object.getOwnPropertyNames(target.prototype);

        // Loop over all properties
        props.forEach((methodName) => {
            const methodDescriptor = Object.getOwnPropertyDescriptor(target.prototype, methodName);
            //only wrap methods. getter/setters don't have a `.value` that is a function
            const isMethod = methodName !== 'constructor' && typeof methodDescriptor?.value === 'function';

            if (isMethod) {
                // Get the original method
                const originalMethod = target.prototype[methodName];

                // Create a new method that wraps the original method
                const wrappedMethod = function wrappedMethod(this: { logger: Logger }, ...args: any[]) {
                    this.logger?.write?.(logLevel, methodName, ...args);
                    return originalMethod.apply(this, args);
                };

                // Replace the original method with the wrapped method
                target.prototype[methodName] = wrappedMethod;
            }
        });

    };
}
