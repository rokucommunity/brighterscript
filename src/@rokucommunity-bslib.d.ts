//`@rokucommunity/bslib` ships no type declarations, so `source` would otherwise be `any` at every
//call site. Both exports are plain strings (see that package's index.js).
declare module '@rokucommunity/bslib' {
    export const version: string;
    export const source: string;
}
