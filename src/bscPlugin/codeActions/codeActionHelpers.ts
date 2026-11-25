import type { BsDiagnostic } from '../../interfaces';
import { util } from '../../util';

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
