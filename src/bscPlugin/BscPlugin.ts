import type { OnGetCodeActionsEvent, CompilerPlugin, OnGetHoverEvent, OnGetReferencesEvent } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';
import { HoverProcessor } from './hover/HoverProcessor';
import { ReferencesProcessor } from './references/ReferencesProcessor';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        return new CodeActionsProcessor(event).process();
    }

    public onGetHover(event: OnGetHoverEvent) {
        return new HoverProcessor(event).process();
    }

    public onGetReferences(event: OnGetReferencesEvent) {
        return new ReferencesProcessor(event).process();
    }
}
