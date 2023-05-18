export class CacheVerifier {

    private currentToken: string;
    private tokenCount = 0;


    constructor() {
        this.generateToken();
    }

    generateToken() {
        this.tokenCount++;
        this.currentToken = this.tokenCount.toString();
    }

    getToken(): string {
        return this.currentToken;
    }

    checkToken(token: string): boolean {
        return token === this.currentToken;
    }
}


export type CacheVerifierProvider = () => CacheVerifier;
