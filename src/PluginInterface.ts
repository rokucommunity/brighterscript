import type { CompilerPlugin } from './interfaces';
import type { Logger } from './Logger';
import { LogLevel } from './Logger';

// inspiration: https://github.com/andywer/typed-emitter/blob/master/index.d.ts
export type Arguments<T> = [T] extends [(...args: infer U) => any]
    ? U
    : [T] extends [void] ? [] : [T];

export default class PluginInterface<T extends CompilerPlugin = CompilerPlugin> {

    constructor(
        private plugins: CompilerPlugin[],
        options: {
            logger: Logger;
            suppressErrors?: boolean;
        }
    ) {
        if (options?.constructor.name === 'Logger') {
            this.logger = options as unknown as Logger;
        } else {
            this.logger = options?.logger;
            this.suppressErrors = options?.suppressErrors === false ? false : true;
        }
    }

    private logger: Logger;

    /**
     * Should plugin errors cause the program to fail, or should they be caught and simply logged
     */
    private suppressErrors: boolean;

    /**
     * Call `event` on plugins
     */
    public emit<K extends keyof T & string>(event: K, ...args: Arguments<T[K]>) {
        for (let plugin of this.plugins) {
            if ((plugin as any)[event]) {
                try {
                    this.logger.time(LogLevel.debug, [plugin.name, event], () => {
                        (plugin as any)[event](...args);
                    });
                } catch (err) {
                    this.logger.error(`Error when calling plugin ${plugin.name}.${event}:`, err);
                    if (!this.suppressErrors) {
                        throw err;
                    }
                }
            }
        }
    }

    /**
     * Add a plugin to the beginning of the list of plugins
     */
    public addFirst<T extends CompilerPlugin = CompilerPlugin>(plugin: T) {
        if (!this.has(plugin)) {
            this.plugins.unshift(plugin);
        }
        return plugin;
    }

    /**
     * Add a plugin to the end of the list of plugins
     */
    public add<T extends CompilerPlugin = CompilerPlugin>(plugin: T) {
        if (!this.has(plugin)) {
            this.plugins.push(plugin);
        }
        return plugin;
    }

    public has(plugin: CompilerPlugin) {
        return this.plugins.includes(plugin);
    }

    public remove<T extends CompilerPlugin = CompilerPlugin>(plugin: T) {
        if (this.has(plugin)) {
            this.plugins.splice(this.plugins.indexOf(plugin));
        }
        return plugin;
    }

    /**
     * Remove all plugins
     */
    public clear() {
        this.plugins = [];
    }
}
