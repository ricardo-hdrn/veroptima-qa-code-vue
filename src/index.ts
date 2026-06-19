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
 * It implements `BranchEnumerator`, typechecks against
 * `@qa-expert/code-enumerator-contract`, and passes its CONFORMANCE SUITE — with
 * ZERO edits to any core/host file. The `stack` is the open string `"vue"`.
 *
 * DETERMINISM (the load-bearing property): no clock, no Math.random, no LLM. The
 * branch SET — and so the id set — is a pure function of `source` alone, so two
 * enumerations are byte-identical (the LLM naming/classification overlay rides on
 * the emitted set AFTER, never inside `enumerate`).
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
} from "@qa-expert/code-enumerator-contract";
import {
  type PluginContext,
  type SecretResolver,
} from "@qa-expert/plugin-contract";

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
const factory: CodeEnumeratorFactory = {
  family: CODE_ENUMERATOR_FAMILY,
  subkind: "vue-compiler",
  contractVersion: "0.1.0",
  capabilities,
  async create(
    config: EnumeratorConfig,
    _secrets: SecretResolver,
    _ctx: PluginContext,
  ): Promise<BranchEnumerator> {
    if (config.stack !== "vue") {
      return Promise.reject(
        new Error(
          `veroptima-qa-code-vue serves stack "vue", not "${config.stack}"`,
        ),
      );
    }
    return vueEnumerator;
  },
};

export default factory;
