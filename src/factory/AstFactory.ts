import { BrsFactory } from './BrsFactory';
import { SGXmlFactory } from './SGXmlFactory';

/**
 * A factory for creating the syntax (tokens and AST nodes) of each file format, grouped by format
 */
export class AstFactory {
    /**
     * Create BrightScript/BrighterScript tokens and AST nodes (for `.brs`, `.bs`, and `.d.bs` files)
     */
    public readonly brs = new BrsFactory();

    /**
     * Create SceneGraph component nodes (the contents of a component `.xml` file)
     */
    public readonly sgXml = new SGXmlFactory();
}
