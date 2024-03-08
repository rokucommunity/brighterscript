import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { isDynamicType, isEnumMemberType, isEnumType, isObjectType } from '../astUtils/reflection';
import type { TypeCompatibilityData } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';
import { isUnionTypeCompatible } from './helpers';

export class EnumType extends BscType {
    constructor(
        public name: string,
        /**
         * The runtime type for this enum (i.e. what type the value will be transpiled into)
         */
        public underlyingType: BscType = DynamicType.instance
    ) {
        super(name);
    }

    public readonly kind = BscTypeKind.EnumType;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            this.isEqual(targetType) ||
            (isEnumMemberType(targetType) && targetType?.enumName.toLowerCase() === this.name.toLowerCase()) ||
            isUnionTypeCompatible(this, targetType, data)
        );
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    public isEqual(targetType: BscType, data?: TypeCompatibilityData): boolean {
        return isEnumType(targetType) &&
            targetType?.name.toLowerCase() === this.name.toLowerCase() &&
            this.underlyingType.isEqual(targetType.underlyingType, data) &&
            this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data) &&
            targetType.checkCompatibilityBasedOnMembers(this, SymbolTypeFlag.runtime, data);
    }

    public get defaultMemberType() {
        return new EnumMemberType(this.name, 'default', this.underlyingType);
    }
}


export class EnumMemberType extends BscType {
    constructor(
        public enumName: string,
        public memberName: string,
        /**
         * The runtime type for this enum (i.e. what type the value will be transpiled into)
         */
        public underlyingType: BscType = DynamicType.instance
    ) {
        super(`${enumName}.${memberName}`);
    }

    public readonly kind = BscTypeKind.EnumMemberType;

    public isAssignableTo(targetType: BscType) {
        return (
            this.isEqual(targetType) ||
            (isEnumType(targetType) &&
                targetType?.name.toLowerCase() === this.enumName.toLowerCase()) ||
            isDynamicType(targetType)
        );
    }

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            this.isEqual(targetType) ||
            isDynamicType(targetType)
        );
    }

    public toString() {
        return this.enumName;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    public isEqual(targetType: BscType): boolean {
        return isEnumMemberType(targetType) &&
            targetType?.enumName.toLowerCase() === this.enumName.toLowerCase() &&
            targetType?.memberName.toLowerCase() === this.memberName.toLowerCase();
    }
}
