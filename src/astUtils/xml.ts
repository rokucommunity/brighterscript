import type { SGChildren, SGComponent, SGField, SGFunction, SGInterface, SGScript, SGTag } from '../parser/SGTypes';

export function isSGComponent(tag: SGTag): tag is SGComponent {
    return tag?.kind === 'component';
}
export function isSGInterface(tag: SGTag): tag is SGInterface {
    return tag?.kind === 'interface';
}
export function isSGScript(tag: SGTag): tag is SGScript {
    return tag?.kind === 'script';
}
export function isSGChildren(tag: SGTag): tag is SGChildren {
    return tag?.kind === 'children';
}
export function isSGField(tag: SGTag): tag is SGField {
    return tag?.kind === 'field';
}
export function isSGFunction(tag: SGTag): tag is SGFunction {
    return tag?.kind === 'function';
}
