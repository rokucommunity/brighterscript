/**
 * A map of plugin names to the type of factory each plugin registers. Plugins can extend this interface through
 * declaration merging so that `program.factory.plugins.get()` returns the correct type:
 *
 * ```typescript
 * declare module 'brighterscript' {
 *     interface PluginFactories {
 *         'bsc-plugin-example': ExampleFactory;
 *     }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PluginFactories { }

/**
 * A registry where plugins can contribute their own factories, so that other plugins can create that plugin's objects
 * without depending on a specific version of it.
 *
 * The plugin that owns the factory registers it (i.e. in `afterProvideProgram`), and other plugins look it up whenever they need it.
 * Consumers should only import the factory's _types_ (`import type { ... }`) from the owning plugin, so that the objects
 * are always created by the copy of the plugin that is actually running.
 */
export class PluginFactoryRegistry {
    private factories = new Map<string, unknown>();

    /**
     * Register a factory for a plugin. The name should be unique (the npm package name of the plugin is recommended).
     * @throws if a factory has already been registered with this name
     */
    public register<K extends keyof PluginFactories>(name: K, factory: PluginFactories[K]): void;
    public register(name: string, factory: unknown): void;
    public register(name: string, factory: unknown) {
        const key = name?.toLowerCase();
        if (this.factories.has(key)) {
            throw new Error(`A plugin factory named '${name}' has already been registered`);
        }
        this.factories.set(key, factory);
    }

    /**
     * Remove the factory registered under this name
     */
    public unregister(name: string) {
        this.factories.delete(name?.toLowerCase());
    }

    /**
     * Get the factory registered under this name, or `undefined` if no plugin has registered one
     */
    public get<K extends keyof PluginFactories>(name: K): PluginFactories[K] | undefined;
    public get<T = unknown>(name: string): T | undefined;
    public get(name: string) {
        return this.factories.get(name?.toLowerCase());
    }

    /**
     * Determine whether a factory has been registered under this name
     */
    public has(name: string) {
        return this.factories.has(name?.toLowerCase());
    }
}
