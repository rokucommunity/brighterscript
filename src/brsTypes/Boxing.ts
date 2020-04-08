import { BrsComponent } from './components/BrsComponent';
import { BrsValue } from '.';

export interface Boxable {
    box(): BrsComponent;
}

export interface Unboxable {
    unbox(): BrsValue;
}
