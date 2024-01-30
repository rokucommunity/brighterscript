import type { CompilerPlugin } from './interfaces';
import type { Logger } from './Logger';
import { LogLevel } from './Logger';

/*
 * we use `Required` everywhere here because we expect that the methods on plugin objects will
 * be optional, and we don't want to deal with `undefined`.
 * `extends (...args: any[]) => any` determines whether the thing we're dealing with is a function.
 * Returning `never` in the `as` clause of the `[key in object]` step deletes that key from the
 * resultant object.
 * on the right-hand side of the mapped type we are forced to use a conditional type a second time,
 * in order to be able to use the `Parameters` utility type on `Required<T>[K]`. This will always
 * be true because of the filtering done by the `[key in object]` clause, but TS requires the duplication.
 *
 * so put together: we iterate over all of the fields in T, deleting ones which are not (potentially
 * optional) functions. For the ones that are, we replace them with their parameters.
 *
 * this returns the type of an object whose keys are the names of the methods of T and whose values
 * are tuples containing the arguments that each method accepts.
 */
export type PluginEventArgs<T> = {
    [K in keyof Required<T> as Required<T>[K] extends (...args: any[]) => any ? K : never]:
    Required<T>[K] extends (...args: any[]) => any ? Parameters<Required<T>[K]> : never
};

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
    public emit<K extends keyof PluginEventArgs<T> & string>(event: K, ...args: PluginEventArgs<T>[K]) {
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
    public async emitAsync<K extends keyof PluginEventArgs<T> & string>(event: K, ...args: PluginEventArgs<T>[K]): Promise< PluginEventArgs<T>[K][0]> {
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
