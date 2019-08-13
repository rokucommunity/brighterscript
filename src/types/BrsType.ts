export interface BrsType {
    isAssignableTo(targetType: BrsType): boolean;
    isConvertibleTo(targetType: BrsType): boolean;
    toString(): string;
}
