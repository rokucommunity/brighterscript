import { BrsComponent } from './components/BrsComponent';
import { BrsValue, BrsType } from './';

export interface Boxable {
    box(): BrsComponent;
}

export interface Unboxable {
    unbox(): BrsValue;
}

export function isBoxable(value: BrsType): value is BrsType & Boxable {
    return 'box' in value;
}

export function isUnboxable(value: BrsType): value is BrsType & Unboxable {
    return 'unbox' in value;
}
