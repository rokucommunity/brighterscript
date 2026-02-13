import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { isDynamicType, isEnumMemberType, isEnumType, isObjectType, isTypeStatementType } from '../astUtils/reflection';
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
        while (isTypeStatementType(targetType)) {
            targetType = targetType.wrappedType;
        }
        return (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            this.isEqual(targetType) ||
            (isEnumMemberType(targetType) &&
                (targetType.parentEnumType === this ||
                    targetType.enumName.toLowerCase() === this.name.toLowerCase())) ||
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

    private _defaultMemberType: EnumMemberType;

    public get defaultMemberType() {
        if (this._defaultMemberType) {
            return this._defaultMemberType;
        }
        const defaultMember = new EnumMemberType(this.name, 'default', this.underlyingType);
        defaultMember.parentEnumType = this;
        this._defaultMemberType = defaultMember;
        return this._defaultMemberType;
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

    public parentEnumType: EnumType;

    public isAssignableTo(targetType: BscType) {
        return (
            this.isEqual(targetType) ||
            (isEnumType(targetType) &&
                targetType?.name.toLowerCase() === this.enumName.toLowerCase()) ||
            isDynamicType(targetType)
        );
    }

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {


        if (isEnumMemberType(targetType)) {
            if (this.enumName.toLowerCase() === targetType.enumName.toLowerCase()) {
                return true;
            }
        } else if (isEnumType(targetType)) {
            if (this.enumName.toLowerCase() === targetType.toString().toLowerCase()) {
                return true;
            }
        }

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
