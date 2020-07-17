export interface Type {
    isAssignableTo(targetType: Type): boolean;
    isConvertibleTo(targetType: Type): boolean;
    toString(): string;
}
