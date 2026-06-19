// veroptima-qa-code-vue — THE EXTERNAL-LOAD PROOF.
//
// The standalone Vue backend loads through the SAME `{ref, integrity}` path as
// every other code-enumerator via `loadPluginsFromConfig`, REGISTERS into the
// shared `globalCodeEnumeratorRegistry` (as `vue:vue-compiler`), is selectable
// per-stack with NO core change, and PASSES `runConformanceSuite`. A TAMPERED
// integrity FAILS the load (the security property holds).
//
// Mirrors the host load proof shape
// (packages/shared/src/plugins/__tests__/load-code-enumerator.proof.test.ts) but
// imports the load machinery from the published `@qa-expert/shared` barrel — this
// repo is OUTSIDE the monorepo.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PluginContext, SecretResolver } from "@qa-expert/plugin-contract";
import { runConformanceSuite } from "@qa-expert/code-enumerator-contract";
import {
  computeDirectoryIntegrity,
  PluginsConfig,
  loadPluginsFromConfig,
  globalCodeEnumeratorRegistry,
  resolveEnumerator,
  type LoadPluginsContext,
} from "@qa-expert/shared";

// src/__tests__ → src → <plugin repo root>.
const PLUGIN_DIR = join(import.meta.dir, "..", "..");

// Minimal meta-contract create() args — a parser backend ignores them.
const noSecrets = { resolve: async () => "" } as unknown as SecretResolver;
const ctx = {
  cwd: "/tmp",
  source: "external",
  resolvedCommit: "0".repeat(40),
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

const loadCtx: LoadPluginsContext = { engineerId: "proof", runTag: "proof-run" };

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "vue");
function loadFixture(name: string): { path: string; content: string } {
  return {
    path: `frontend/${name}`,
    content: readFileSync(join(FIXTURE_DIR, name), "utf8"),
  };
}

// A small Vue source the loaded backend enumerates into render-conditional +
// select-branch + validation-rule + router-guard branches.
const VUE_SOURCE = {
  files: [
    loadFixture("CadastroWizard.vue"),
    loadFixture("PugWizard.vue"),
    loadFixture("ElementPlusForm.vue"),
  ],
};

describe("external-load proof — the standalone Vue backend loads via {ref, integrity} + passes conformance", () => {
  test("loads through loadPluginsFromConfig, registers as vue:vue-compiler, and passes runConformanceSuite", async () => {
    const integrity = await computeDirectoryIntegrity(PLUGIN_DIR);
    expect(integrity.length).toBeGreaterThan(0);

    const plugins = PluginsConfig.parse({
      "code-enumerators": [
        {
          id: "vue",
          ref: `file:${PLUGIN_DIR}`,
          integrity,
          config: { stack: "vue" },
        },
      ],
    });

    const summary = await loadPluginsFromConfig(plugins, loadCtx);

    // Registered with NO errors, under the code-enumerator family.
    expect(summary.errors).toEqual([]);
    const reg = summary.registered.find((r) => r.family === "code-enumerator");
    expect(reg, "the Vue backend must register as a code-enumerator").toBeDefined();
    expect(reg!.id).toBe("vue");
    expect(reg!.subkind).toBe("vue-compiler");

    // It landed in the SHARED global registry, selectable per-stack with no core change.
    const entry = globalCodeEnumeratorRegistry.select({ stack: "vue" });
    expect(entry.id).toBe("vue:vue-compiler");

    // The loaded backend clears the contract's behavioral bar.
    const enumerator = await resolveEnumerator(
      globalCodeEnumeratorRegistry,
      { stack: "vue" },
      noSecrets,
      ctx,
    );
    const report = runConformanceSuite({
      enumerator,
      source: VUE_SOURCE,
      requiredBranches: [
        { kind: "render-conditional", conditionIncludes: "RURAL" },
        { kind: "render-conditional", conditionIncludes: "pugAreaAcima100" },
        { kind: "select-branch", conditionIncludes: "el-select" },
        { kind: "validation-rule", conditionIncludes: "el-form[:rules" },
      ],
    });
    if (!report.passed) {
      console.error(report.checks.filter((c) => !c.passed));
    }
    expect(report.passed).toBe(true);
    // Non-vacuous: the loaded backend actually emitted branches over the scan.
    expect(enumerator.enumerate(VUE_SOURCE).branches.length).toBeGreaterThan(0);
  });

  test("a TAMPERED integrity fails the load (the lock holds; no registration happens)", async () => {
    const plugins = PluginsConfig.parse({
      "code-enumerators": [
        {
          id: "vue-tampered",
          ref: `file:${PLUGIN_DIR}`,
          integrity:
            "sha256-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          config: { stack: "vue" },
        },
      ],
    });

    const summary = await loadPluginsFromConfig(plugins, loadCtx);

    expect(
      summary.registered.find((r) => r.family === "code-enumerator"),
    ).toBeUndefined();
    expect(summary.errors.length).toBe(1);
    expect(summary.errors[0]!.family).toBe("code-enumerator");
    expect(summary.errors[0]!.message.toLowerCase()).toContain("integrity");
  });
});
