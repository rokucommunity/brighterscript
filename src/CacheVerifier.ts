import { v4 as uuid } from 'uuid';

export class CacheVerifier {

    private currentToken: string;

    constructor() {
        this.generateToken();
    }

    generateToken() {
        this.currentToken = uuid();
    }

    getToken(): string {
        return this.currentToken;
    }

    checkToken(token: string): boolean {
        return token === this.currentToken;
    }
}


export type CacheVerifierProvider = () => CacheVerifier;
