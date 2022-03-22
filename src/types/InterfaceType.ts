import { isDynamicType, isInterfaceType, isObjectType } from '../astUtils/reflection';
import type { SymbolTable } from '../SymbolTable';
import type { BscType, SymbolContainer, TypeContext } from './BscType';
import { checkAssignabilityToInterface } from './BscType';

export class InterfaceType implements BscType, SymbolContainer {
    public constructor(
        public name: string, public memberTable: SymbolTable = null
    ) {

    }

    public isAssignableTo(targetType: BscType, context?: TypeContext) {
        const ancestorTypes = context?.scope?.getAncestorTypeListByContext(this, context);
        if (ancestorTypes?.find(ancestorType => targetType.equals(ancestorType, context))) {
            return true;
        }
        if (this.memberTable && targetType.memberTable) {
            // both have symbol tables, so check if this interface has all the members of the target
            return checkAssignabilityToInterface(this, targetType, context);
        }
        return (
            this.equals(targetType, context) ||
            isObjectType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString(): string {
        return this.name;
    }

    /**
     * Gets a string representation of the Interface that looks like javascript
     * @returns {string}
     */
    public toJsString() {
        let result = '{';
        const memberSymbols = (this.memberTable?.getAllSymbols() || []).sort((a, b) => a.name.localeCompare(b.name));
        for (const symbol of memberSymbols) {
            let symbolTypeString = symbol.type.toString();
            if (isInterfaceType(symbol.type)) {
                symbolTypeString = symbol.type.toJsString();
            }
            result += ' ' + symbol.name + ': ' + symbolTypeString + ';';
        }
        if (memberSymbols.length > 0) {
            result += ' ';
        }
        return result + '}';
    }

    public toTypeString(): string {
        return 'object';
    }

    public equals(targetType: BscType, context?: TypeContext): boolean {

        if (isInterfaceType(targetType)) {
            return this.isAssignableTo(targetType, context) && targetType.isAssignableTo(this, context);
        }
        return false;
    }

}
