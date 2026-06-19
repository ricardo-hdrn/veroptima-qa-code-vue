/**
 * veroptima-qa-code-vue — the standalone public-MIT Vue (`vue-compiler`)
 * `code-enumerator` backend.
 *
 * A PARSER-driven (never LLM) branch enumerator for `.vue` SFCs: `@vue/compiler-sfc`
 * for HTML templates, `pug-lexer` + `pug-parser` for `<template lang="pug">`, and
 * `@babel/parser` (typescript+jsx) for the `<script>` / `<script setup>` bodies. It
 * emits the FIXED set of path-changing frontend branches — render-conditionals
 * (`v-if`/`v-show`/`v-else-if`/`v-else`), select-branches (`el-select`/`el-radio*`),
 * validation-rules (element-plus `:rules`/`prop` AND vee-validate
 * `defineRule`/`useField`), and router-guards (`beforeEach`/`beforeEnter` + `next()`).
 *
 * It implements `BranchEnumerator` and emits RAW branches (NO id) against the
 * PUBLIC `@qa-expert/code-enumerator-spi` ONLY — ZERO core model IP (no branch
 * id, no id-bearing Branch, no model, no conformance suite). The HOST lifts
 * RawBranch→Branch and computes identity. The `stack` is the open string `"vue"`.
 *
 * DETERMINISM (the load-bearing property): no clock, no Math.random, no LLM. The
 * RAW branch SET is a pure function of `source` alone, emitted in a stable sort
 * order, so two enumerations are byte-identical (the LLM naming/classification
 * overlay rides on the emitted set AFTER, never inside `enumerate`).
 *
 * Author: Ricardo Gusmao / Veroptima
 * License: MIT
 */
import {
  CODE_ENUMERATOR_FAMILY,
  type BranchEnumerator,
  type CodeEnumeratorCapabilities,
  type CodeEnumeratorFactory,
  type EnumeratorConfig,
} from "@qa-expert/code-enumerator-spi";

import { vueEnumerator } from "./enumerator.js";

// ────────────────────────────────────────────────────────────────────────────
// The factory (default export — the contract entry point)
// ────────────────────────────────────────────────────────────────────────────

// Typed via `satisfies` (not an annotation): `CodeEnumeratorCapabilities` is a
// closed interface and so is NOT assignable to the meta-contract's
// `capabilities?: Record<string, unknown>` slot, but an inferred object literal
// IS. `satisfies` gives us the contract's shape-check without losing the
// Record-compatible literal type.
const capabilities = {
  stack: "vue",
  interProcedural: false,
} satisfies CodeEnumeratorCapabilities;

/**
 * `vue-compiler` — the Vue (frontend) enumerator factory. `create()` validates
 * `config.stack === "vue"` and returns the deterministic `vueEnumerator`.
 */
const factory = {
  family: CODE_ENUMERATOR_FAMILY,
  subkind: "vue-compiler",
  contractVersion: "0.1.0",
  capabilities,
  // `config`/`_secrets`/`_ctx` param types are inferred from the contextual
  // `CodeEnumeratorFactory` type below — so this file imports NOTHING from the
  // private host (no plugin-contract import for SecretResolver/PluginContext).
  async create(config: EnumeratorConfig): Promise<BranchEnumerator> {
    if (config.stack !== "vue") {
      return Promise.reject(
        new Error(
          `veroptima-qa-code-vue serves stack "vue", not "${config.stack}"`,
        ),
      );
    }
    return vueEnumerator;
  },
} satisfies CodeEnumeratorFactory;

export default factory;
