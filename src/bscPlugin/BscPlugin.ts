import type { OnGetCodeActionsEvent, CompilerPlugin, OnGetHoverEvent } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { HoverProcessor } from './hover/HoverProcessor';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }

    public onGetHover(event: OnGetHoverEvent) {
        return new HoverProcessor(event).process();
    }
}
