import type { CompilerPlugin } from './interfaces';
import type { Logger } from './Logger';
import { LogLevel } from './Logger';

// inspiration: https://github.com/andywer/typed-emitter/blob/master/index.d.ts
export type Arguments<T> = [T] extends [(...args: infer U) => any]
    ? U
    : [T] extends [void] ? [] : [T];

export default class PluginInterface<T extends CompilerPlugin = CompilerPlugin> {
    constructor(
        plugins: CompilerPlugin[],
        options: {
            logger: Logger;
            suppressErrors?: boolean;
        }
    ) {
        this.logger = options?.logger;
        this.suppressErrors = (options as any)?.suppressErrors === false ? false : true;
        for (const plugin of plugins) {
            this.add(plugin);
        }
    }

    private plugins: CompilerPlugin[] = [];
    private logger: Logger;

    /**
     * Should plugin errors cause the program to fail, or should they be caught and simply logged
     */
    private suppressErrors: boolean | undefined;

    /**
     * Call `event` on plugins
     */
    public emit<K extends keyof T & string>(event: K, ...args: Arguments<T[K]>): Arguments<T[K]>[0] {
        for (let plugin of this.plugins) {
            if ((plugin as any)[event]) {
                try {
                    this.logger?.time(LogLevel.debug, [plugin.name, event], () => {
                        (plugin as any)[event](...args);
                    });
                } catch (err) {
                    this.logger?.error(`Error when calling plugin ${plugin.name}.${event}:`, err);
                    if (!this.suppressErrors) {
                        throw err;
                    }
                }
            }
        }
        return args[0];
    }

    /**
     * Call `event` on plugins, but allow the plugins to return promises that will be awaited before the next plugin is notified
     */
    public async emitAsync<K extends keyof T & string>(event: K, ...args: Arguments<T[K]>): Promise<Arguments<T[K]>[0]> {
        for (let plugin of this.plugins) {
            if ((plugin as any)[event]) {
                try {
                    await this.logger?.time(LogLevel.debug, [plugin.name, event], async () => {
                        await Promise.resolve(
                            (plugin as any)[event](...args)
                        );
                    });
                } catch (err) {
                    this.logger?.error(`Error when calling plugin ${plugin.name}.${event}:`, err);
                }
            }
        }
        return args[0];
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
            this.sanitizePlugin(plugin);
            this.plugins.push(plugin);
        }
        return plugin;
    }

    /**
     * Find deprecated or removed historic plugin hooks, and warn about them.
     * Some events can be forwards-converted
     */
    private sanitizePlugin(plugin: CompilerPlugin) {
        const removedHooks = [
            'beforePrepublish',
            'afterPrepublish'
        ];
        for (const removedHook of removedHooks) {
            if (plugin[removedHook]) {
                this.logger?.error(`Plugin "${plugin.name}": event ${removedHook} is no longer supported and will never be called`);
            }
        }

        const upgradeWithWarn = {
            beforePublish: 'beforeSerializeProgram',
            afterPublish: 'afterSerializeProgram',
            beforeProgramTranspile: 'beforeBuildProgram',
            afterProgramTranspile: 'afterBuildProgram',
            beforeFileParse: 'beforeProvideFile',
            afterFileParse: 'afterProvideFile',
            beforeFileTranspile: 'beforePrepareFile',
            afterFileTranspile: 'afterPrepareFile',
            beforeFileDispose: 'beforeFileRemove',
            afterFileDispose: 'afterFileRemove'
        };

        for (const [oldEvent, newEvent] of Object.entries(upgradeWithWarn)) {
            if (plugin[oldEvent]) {
                if (!plugin[newEvent]) {
                    plugin[newEvent] = plugin[oldEvent];
                    this.logger?.warn(`Plugin '${plugin.name}': event '${oldEvent}' is no longer supported. It has been converted to '${newEvent}' but you may encounter issues as their signatures do not match.`);
                } else {
                    this.logger?.warn(`Plugin "${plugin.name}": event '${oldEvent}' is no longer supported and will never be called`);
                }
            }
        }
    }

    public has(plugin: CompilerPlugin) {
        return this.plugins.includes(plugin);
    }

    public remove<T extends CompilerPlugin = CompilerPlugin>(plugin: T) {
        if (this.has(plugin)) {
            this.plugins.splice(this.plugins.indexOf(plugin), 1);
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
