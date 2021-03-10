import type { OnGetCodeActionsEvent, CompilerPlugin } from '../interfaces';
import { CodeActionsProcessor } from './codeActions/CodeActionsProcessor';

export class BscPlugin implements CompilerPlugin {
    public name = 'BscPlugin';

    public onGetCodeActions(event: OnGetCodeActionsEvent) {
        new CodeActionsProcessor(event).process();
    }
}
