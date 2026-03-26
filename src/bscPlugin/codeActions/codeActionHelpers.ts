import type { Diagnostic } from 'vscode-languageserver';
import type { XmlFile } from '../../files/XmlFile';
import { util } from '../../util';

/**
 * Returns the position at which an `extends` attribute should be inserted for
 * a component that is missing one: after the last existing attribute, or after
 * the `<component` tag itself if there are no attributes yet.
 */
export function getMissingExtendsInsertPosition(file: XmlFile) {
    const { component } = file.parser.ast;
    return (component.attributes[component.attributes.length - 1] ?? component.tag).range.end;
}

/**
 * Returns the delete change that removes the return value from a `return <expr>`
 * statement flagged by `voidFunctionMayNotReturnValue`. Leaves the bare `return`
 * keyword in place.
 */
export function getRemoveReturnValueChange(diagnostic: Diagnostic, filePath: string) {
    return {
        type: 'delete' as const,
        filePath: filePath,
        range: util.createRange(
            diagnostic.range.start.line,
            diagnostic.range.start.character + 'return'.length,
            diagnostic.range.end.line,
            diagnostic.range.end.character
        )
    };
}
