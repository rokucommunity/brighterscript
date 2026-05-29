import type { XmlFile } from '../../files/XmlFile';
import type { BsDiagnostic } from '../../interfaces';
import { util } from '../../util';

/**
 * Returns the position at which an `extends` attribute should be inserted for
 * a component that is missing one: after the last existing attribute, or after
 * the `<component` tag itself if there are no attributes yet.
 */
export function getMissingExtendsInsertPosition(file: XmlFile) {
    const componentElement = file.parser.ast.componentElement;
    const lastAttribute = componentElement.attributes[componentElement.attributes.length - 1];
    const range = lastAttribute?.location?.range ?? componentElement.tokens.startTagName?.location?.range;
    return range?.end;
}

/**
 * Returns the delete change that removes the return value from a `return <expr>`
 * statement flagged by `voidFunctionMayNotReturnValue`. Leaves the bare `return`
 * keyword in place.
 */
export function getRemoveReturnValueChange(diagnostic: BsDiagnostic, filePath: string) {
    return {
        type: 'delete' as const,
        filePath: filePath,
        range: util.createRange(
            diagnostic.location.range.start.line,
            diagnostic.location.range.start.character + 'return'.length,
            diagnostic.location.range.end.line,
            diagnostic.location.range.end.character
        )
    };
}
