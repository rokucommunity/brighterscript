import { BscType } from './BscType';
import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { BscTypeKind } from './BscTypeKind';
import { isCallableType } from '../astUtils/reflection';

export class TypeStatementType extends BscType {

    public kind: BscTypeKind = BscTypeKind.TypeStatementType;

    constructor(public name: string, public wrappedType: BscType) {
        super();
    }

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            this.wrappedType.isTypeCompatible(targetType, data)
        );
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return this.wrappedType.toTypeString();
    }

    public isEqual(targetType: BscType) {
        return this.wrappedType.isEqual(targetType);
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        return this.wrappedType.getMemberType(memberName, options);
    }

    getMemberTable() {
        return this.wrappedType.getMemberTable();
    }

    addBuiltInInterfaces() {
        if (!this.hasAddedBuiltInInterfaces) {
            this.wrappedType.addBuiltInInterfaces();
            this.hasAddedBuiltInInterfaces = true;
        }
    }

    getCallFuncType(name: string, options: GetTypeOptions): BscType {
        return this.wrappedType.getCallFuncType(name, options);
    }


    getCallFuncTable() {
        return this.wrappedType.getCallFuncTable();
    }

    get returnType() {
        if (isCallableType(this.wrappedType)) {
            return this.wrappedType.returnType;
        }
        return undefined;
    }

}

