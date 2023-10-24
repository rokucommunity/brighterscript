import { v4 as uuid } from 'uuid';
import type { Scope } from './Scope';

export class CacheVerifier {

    private currentTokens = new Map<string, string>();

    generateToken(scopeName?: string) {
        const lowerScopeName = scopeName?.toLowerCase() ?? this.activeScope?.name.toLowerCase();
        if (!lowerScopeName) {
            return;
        }
        this.currentTokens.set(scopeName, uuid());
    }

    getToken(): string {
        const scopeName = this.activeScope?.name.toLowerCase();
        if (!scopeName) {
            return;
        }
        return this.currentTokens.get(scopeName);
    }

    checkToken(token: string): boolean {
        const scopeName = this.activeScope?.name.toLowerCase();
        return token === this.currentTokens.get(scopeName);
    }

    activeScope: Scope;
}
