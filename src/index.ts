export * from './ProgramBuilder';
export * from './Program';
export * from './Scope';
export * from './files/BrsFile';
export * from './files/XmlFile';
export * from './util';
export * from './Watcher';
export * from './interfaces';
export * from './LanguageServer';
export * from './XmlScope';
export * from './lexer/TokenKind';
export * from './lexer/Token';
export * from './lexer/Lexer';
export * from './parser/Parser';
export * from './parser/AstNode';
export * from './parser/Expression';
export * from './parser/Statement';
export * from './parser/BrightScriptDocParser';
export * from './BsConfig';
export * from './deferred';
export * from './astUtils/visitors';
export * from './astUtils/stackedVisitor';
export * from './astUtils/reflection';
export * from './astUtils/creators';
export * from './astUtils/xml';
export * from './astUtils/Editor';
export * from './files/BscFile';
export * from './parser/BrsTranspileState';
export * from './astUtils/Editor';
export * from './SymbolTable';
export * from './types';
export * from './Cache';
export * from './BusyStatusTracker';
export * from './Logger';
export * from './parser/SGTypes';
export * from './parser/SGParser';
export * from './SymbolTypeFlag';
export * from './CodeActionUtil';
export * from './DependencyGraph';
export * from './PluginInterface';

// convenience exports from related libraries
export {
    Diagnostic,
    Range,
    Location,
    Position,
    CancellationToken, CancellationTokenSource,
    DiagnosticRelatedInformation,
    DiagnosticSeverity, DiagnosticTag,
    SemanticTokenTypes,
    CodeAction,
    CodeDescription,
    URI
} from 'vscode-languageserver';
export type {
    RawSourceMap,
    StartOfSourceMap,
    CodeWithSourceMap
} from 'source-map';
export {
    SourceNode,
    SourceMapConsumer
} from 'source-map';
