/**
 * Generic item/parent visitor providing a stack of the parents,
 * and callbacks when pushing/popping the stack.
 */
export function createStackedVisitor<T>(
    visitor: (item: T, stack: T[]) => void,
    onPush?: (item: T, stack: T[]) => void,
    onPop?: (item: T, stack: T[]) => void
) {
    const stack: T[] = [];
    let curr: T;
    return (item: T, parent: T) => {
        // stack/de-stack
        if (parent !== undefined && parent === curr) {
            stack.push(parent);
            onPush?.(parent, stack);
        } else {
            let last = stack.length;
            while (last > 0 && stack[--last] !== parent) {
                const closed = stack.pop();
                onPop?.(closed, stack);
            }
        }
        curr = item;
        visitor(item, stack);
    };
}
