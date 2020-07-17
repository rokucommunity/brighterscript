import { FunctionType } from '../FunctionType';
import { StringType } from '../StringType';

export class ToStrInterface {
    public static methods = [
        new FunctionType('ToStr', false, new StringType())
    ];
}
