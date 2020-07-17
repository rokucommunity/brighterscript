import { Type } from './BrsType';

export class NamespaceType implements Type {
    public isAssignableTo(targetType: Type) {
        //namespaces are not assignable to anything
        return false;
    }

    public isConvertibleTo(targetType: Type) {
        //namespaces are not convertable to anything
        return false;
    }
    public toString() {
        return 'namespace';
    }
    public static instance = new NamespaceType();
}
