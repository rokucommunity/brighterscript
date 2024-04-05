import { isBrsFile, isXmlScope } from '../../astUtils/reflection';
import type { ProvideCompletionsEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { XmlScope } from '../../XmlScope';
import { util } from '../../util';
import { firstBy } from 'thenby';

export class CompletionsProcessor {
    constructor(
        private event: ProvideCompletionsEvent
    ) {

    }

    public process() {
        let completionsArray = [];
        if (isBrsFile(this.event.file) && this.event.file.isPositionNextToTokenKind(this.event.position, TokenKind.Callfunc)) {
            const xmlScopes = this.event.program.getScopes().filter((s) => isXmlScope(s)) as XmlScope[];
            // is next to a @. callfunc invocation - must be an interface method.
            //TODO refactor this to utilize the actual variable's component type (when available)
            for (const scope of xmlScopes) {
                let fileLinks = this.event.program.getStatementsForXmlFile(scope);
                for (let fileLink of fileLinks) {
                    let pushItem = scope.createCompletionFromFunctionStatement(fileLink.item);
                    if (!completionsArray.includes(pushItem.label)) {
                        completionsArray.push(pushItem.label);
                        this.event.completions.push(pushItem);
                    }
                }
            }
            //no other result is possible in this case
            return;
        }

        //find the scopes for this file (sort by name so these results are always consistent)
        let scopesForFile = this.event.program.getScopesForFile(this.event.file).sort(firstBy(x => x.name));

        //if there are no scopes, include the global scope so we at least get the built-in functions
        scopesForFile = scopesForFile.length > 0 ? scopesForFile : [this.event.program.globalScope];

        // Only process the first few scopes. This might result in missing completions,
        // but it's better than wasting TONS of cycles building essentially the same completions over and over
        const scopesToProcess = scopesForFile.slice(0, 3);

        // always include the source scope if applicable to this file
        let sourceScope = scopesForFile.find(x => x.name === 'source');
        if (!scopesToProcess.includes(sourceScope)) {
            //replace the first scope with the source scope so we always process exactly 3 scopes
            scopesToProcess[0] = sourceScope;
        }

        //get the completions from all scopes for this file
        let allCompletions = util.flatMap(
            scopesToProcess.map(scope => {
                return this.event.file.getCompletions(this.event.position, scope);
            }),
            c => c
        );

        //only keep completions common to every scope for this file
        let keyCounts = new Map<string, number>();
        for (let completion of allCompletions) {
            let key = `${completion.label}-${completion.kind}`;
            keyCounts.set(key, keyCounts.has(key) ? keyCounts.get(key) + 1 : 1);
            if (keyCounts.get(key) === scopesToProcess.length) {
                this.event.completions.push(completion);
            }
        }
    }
}
