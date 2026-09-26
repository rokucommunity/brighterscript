import type { Program } from '../Program';
import { BrsFactory } from './BrsFactory';
import { SGFactory } from './SGFactory';
import { FileFactory } from './FileFactory';
import { PluginFactoryRegistry } from './PluginFactoryRegistry';

/**
 * A factory for creating everything in BrighterScript, grouped by domain:
 *  - `brs`: BrightScript/BrighterScript tokens and AST nodes (i.e. `factory.brs.createCallExpression(...)`)
 *  - `sg`: SceneGraph component nodes (i.e. `factory.sg.createSGComponent(...)`)
 *  - `files`: files (i.e. `factory.files.createBrsFile(...)`)
 *  - `plugins`: factories contributed by plugins (i.e. `factory.plugins.get('bsc-plugin-example')`)
 *
 * Plugins should use the factory provided by the program (`program.factory`) instead of calling constructors directly
 * (i.e. `program.factory.brs.createCallExpression(...)` instead of `new CallExpression(...)`). A plugin may be bundled with a
 * different version of brighterscript than the one actually running it (the cli or the language server). Objects created
 * from the plugin's own copy of brighterscript would miss any bug fixes or new fields from the running version, while objects
 * created through `program.factory` always come from the running version.
 *
 * The method signatures are a stable contract. The constructors may change over time, but these methods will continue to
 * accept the same options. Methods and groups may be added in future versions, so plugins that need to support older versions
 * of brighterscript can check for them before calling (i.e. `if (program.factory.brs.createTypeStatement) {...}`).
 */
export class BscFactory {
    public constructor(
        /**
         * The program that this factory belongs to
         */
        public readonly program?: Program
    ) {
        this.files = new FileFactory(program);
    }

    /**
     * Create BrightScript/BrighterScript tokens and AST nodes
     */
    public readonly brs = new BrsFactory();

    /**
     * Create SceneGraph component nodes (the contents of a component `.xml` file)
     */
    public readonly sg = new SGFactory();

    /**
     * Create files
     */
    public readonly files: FileFactory;

    /**
     * Factories contributed by plugins
     */
    public readonly plugins = new PluginFactoryRegistry();
}

/**
 * A shared factory used internally by brighterscript.
 *
 * Plugins should NOT use this. Use `program.factory` instead, which ensures that objects are created by the version of
 * brighterscript that is actually running the plugin.
 */
export const bscFactory = new BscFactory();
