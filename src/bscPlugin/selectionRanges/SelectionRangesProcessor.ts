import { SelectionRange } from 'vscode-languageserver-types';
import type { Range, Position } from 'vscode-languageserver-protocol';
import { isBrsFile } from '../../astUtils/reflection';
import type { ProvideSelectionRangesEvent } from '../../interfaces';
import type { AstNode } from '../../parser/AstNode';

export class SelectionRangesProcessor {
    public constructor(
        public event: ProvideSelectionRangesEvent
    ) { }

    public process() {
        if (!isBrsFile(this.event.file)) {
            return;
        }

        for (const position of this.event.positions) {
            const selectionRange = this.buildSelectionRange(position);
            if (selectionRange) {
                this.event.selectionRanges.push(selectionRange);
            }
        }
    }

    private buildSelectionRange(position: Position): SelectionRange | undefined {
        const file = this.event.file;
        if (!isBrsFile(file)) {
            return undefined;
        }

        // Find the deepest AST node containing this position
        const innerNode = file.ast.findChildAtPosition(position);
        if (!innerNode?.range) {
            return undefined;
        }

        const ranges: Range[] = [];

        // Many BrightScript AST nodes store identifier names as raw Tokens (not child
        // AstNodes), so findChildAtPosition stops at the enclosing statement/expression.
        // To give the first expansion step a tight "identifier only" range — matching
        // the JS/TS smart-select behaviour — we look up the exact lexer token at the
        // cursor position and use its range as the initial step.
        const token = file.getTokenAt(position);
        if (token?.range && !rangesEqual(token.range, innerNode.range)) {
            ranges.push(token.range);
        }

        // Walk up the AST parent chain, collecting each node's range.
        // Skip duplicate consecutive ranges (e.g. a Block whose range equals its
        // only child statement, or an ExpressionStatement === its expression).
        let node: AstNode | undefined = innerNode;
        while (node) {
            const nodeRange = node.range;
            if (nodeRange && !rangesEqual(nodeRange, ranges[ranges.length - 1])) {
                ranges.push(nodeRange);
            }
            node = node.parent;
        }

        if (ranges.length === 0) {
            return undefined;
        }

        // Build the SelectionRange linked list from outermost → innermost.
        // LSP: the innermost range has `.parent` pointing outward.
        let selectionRange: SelectionRange | undefined;
        for (let i = ranges.length - 1; i >= 0; i--) {
            selectionRange = SelectionRange.create(ranges[i], selectionRange);
        }
        return selectionRange;
    }
}

function rangesEqual(a: Range | undefined, b: Range | undefined): boolean {
    if (!a || !b) {
        return false;
    }
    return a.start.line === b.start.line &&
        a.start.character === b.start.character &&
        a.end.line === b.end.line &&
        a.end.character === b.end.character;
}
