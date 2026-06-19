// Minimal ambient declarations for `pug-lexer` + `pug-parser` (no @types shipped).
// The Vue adapter parses pug-syntax `<template lang="pug">` SFCs with these; we
// only need the call signatures (the AST is read structurally via local shapes).

declare module "pug-lexer" {
  interface LexOptions {
    filename?: string;
  }
  /** Tokenize pug `src` into a token array consumable by `pug-parser`. */
  function lex(src: string, options?: LexOptions): unknown[];
  export = lex;
}

declare module "pug-parser" {
  interface ParseOptions {
    filename?: string;
    src?: string;
  }
  /** Parse a pug token array into a pug AST (`{ type: "Block", nodes: [...] }`). */
  function parse(tokens: unknown[], options?: ParseOptions): unknown;
  export = parse;
}
