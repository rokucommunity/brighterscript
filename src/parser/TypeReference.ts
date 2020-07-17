import { Type } from '../types/BrsType';
import { DynamicType } from '../types/DynamicType';
import { UnionType } from '../types/UnionType';
import { TokenKind } from '../lexer';
import util from '../util';

/**
 * Represents an unchanging reference to the type for a given expression. As the compiler dynamically
 * links and unlinks objects, this class reference will remain the same for as long as the item it references
 * is still in scope (i.e. we didn't scrap the file).
 *
 * This class will dynamically generate types on the fly based on what is currently attached.
 */
export class TypeReference {

    public links = [] as Array<TypeReference | Type>;

    /**
     * Add a new link
     * @returns a function that will remove the link.
     */
    public addLink(link: TypeReference | Type | TokenKind) {
        let finalLink: TypeReference | Type;
        if (typeof link === 'string') {
            finalLink = util.tokenKindToType(link);
        } else {
            finalLink = link;
        }

        this.links.push(finalLink);

        //return a function that will remove this link
        return () => {
            let idx = this.links.indexOf(finalLink);
            if (idx > -1) {
                this.links.splice(idx, 1);
            }
        };
    }

    /**
     * Returns the BrsType at this exact moment in time.
     * The type may change every time the compiler runs a linking phase, so the return value should be promptly discarded after use
     */
    public getType(): Type {
        const types = [];
        //gather up all of the types
        for (let link of this.links) {
            if (link instanceof TypeReference) {
                types.push(link.getType());
            } else {
                types.push(link);
            }
        }

        //if there's only one type, return it
        if (types.length < 2) {
            return types[0] ?? new DynamicType();
        } else {
            //there is more than one type..return a union of the types.
            //TODO reduce duplicate types in this union
            return new UnionType(types);
        }
    }
}
