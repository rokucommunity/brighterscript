import type { BrsComponent } from './components/BrsComponent';
import type { BrsValue } from '.';

export interface Boxable {
    box(): BrsComponent;
}

export interface Unboxable {
    unbox(): BrsValue;
}
