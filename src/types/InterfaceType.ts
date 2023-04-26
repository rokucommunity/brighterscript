import { SymbolTypeFlags } from '../SymbolTable';
import { isDynamicType, isInterfaceType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { InheritableType } from './InheritableType';
import type { ReferenceType } from './ReferenceType';

export class InterfaceType extends InheritableType {
    public constructor(
        public name: string,
        public readonly superInterface?: InterfaceType | ReferenceType
    ) {
        super(name, superInterface);
    }

    public isAssignableTo(targetType: BscType) {
        if (isInterfaceType(targetType) && targetType.name === this.name) {
            return true;
        }
        if (isObjectType(targetType) || isDynamicType(targetType)) {
            return true;
        }
        if (isInterfaceType(targetType)) {
            const ancestorTypes = this.getAncestorTypeList();
            if (ancestorTypes?.find(ancestorType => targetType.equals(ancestorType))) {
                return true;
            }
            return this.checkAssignabilityToInterface(targetType, SymbolTypeFlags.runtime);
        }
        return false;
    }

    /**
     * Gets a string representation of the Interface that looks like javascript
     * Useful for debugging
     * @returns {string}
     */
    public toJSString() {
        // eslint-disable-next-line no-bitwise
        const flags = SymbolTypeFlags.runtime | SymbolTypeFlags.typetime;
        let result = '{';
        const memberSymbols = (this.memberTable?.getAllSymbols(flags) || []).sort((a, b) => a.name.localeCompare(b.name));
        for (const symbol of memberSymbols) {
            let symbolTypeString = symbol.type.toString();
            if (isInterfaceType(symbol.type)) {
                symbolTypeString = symbol.type.toJSString();
            }
            result += ' ' + symbol.name + ': ' + symbolTypeString + ';';
        }
        if (memberSymbols.length > 0) {
            result += ' ';
        }
        return result + '}';
    }

    public equals(targetType: BscType): boolean {

        if (isInterfaceType(targetType)) {
            return this.isAssignableTo(targetType) && targetType.isAssignableTo(this);
        }
        return false;
    }
}

