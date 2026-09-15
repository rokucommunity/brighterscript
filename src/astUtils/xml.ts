import type { SGChildren, SGComponent, SGInterfaceField, SGInterfaceFunction, SGInterface, SGNode, SGScript, SGElement } from '../parser/SGTypes';

export function isSGComponent(tag: SGElement): tag is SGComponent {
    return tag?.constructor.name === 'SGComponent';
}
export function isSGInterface(tag: SGElement): tag is SGInterface {
    return tag?.constructor.name === 'SGInterface';
}
export function isSGScript(tag: SGElement): tag is SGScript {
    return tag?.constructor.name === 'SGScript';
}
export function isSGChildren(tag: SGElement): tag is SGChildren {
    return tag?.constructor.name === 'SGChildren';
}
export function isSGInterfaceField(tag: SGElement): tag is SGInterfaceField {
    return tag?.constructor.name === 'SGField';
}
export function isSGInterfaceFunction(tag: SGElement): tag is SGInterfaceFunction {
    return tag?.constructor.name === 'SGFunction';
}
export function isSGNode(tag: SGElement): tag is SGNode {
    return tag?.constructor.name === 'SGNode';
}
export function isSGCustomization(tag: SGElement): tag is SGNode {
    return isSGNode(tag) && tag.tokens.startTagName?.text?.toLowerCase() === 'customization';
}
