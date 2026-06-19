/**
 * Conformance proof for veroptima-qa-code-vue.
 *
 * Drives the standalone Vue backend through the contract's own
 * `runConformanceSuite` — the same behavioral bar every code-enumerator backend
 * clears — to PROVE `@qa-expert/code-enumerator-contract` is language-OPEN AND
 * that the ported enumerator is NOT BLIND to Pug templates, element-plus
 * `:rules`/`prop` validation, or vee-validate rules. No core/host file is
 * touched; everything below imports the contract as a dependency.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";
import {
  runConformanceSuite,
  type CodeSource,
  type RequiredBranch,
} from "@qa-expert/code-enumerator-contract";
import type {
  PluginContext,
  SecretResolver,
} from "@qa-expert/plugin-contract";

import factory from "../index.js";
import { vueEnumerator } from "../enumerator.js";

// ── Minimal context stubs (the parser backend ignores them; they only satisfy
//    the types).
const secrets: SecretResolver = {
  async resolve(_ref: string): Promise<string> {
    return "";
  },
};

const ctx: PluginContext = {
  cwd: "/tmp/veroptima-qa-code-vue",
  source: "github:veroptima/veroptima-qa-code-vue@0.1.0",
  resolvedCommit: "0000000000000000000000000000000000000000",
  logger: {
    info() {},
    warn() {},
    error() {},
  },
};

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "vue");

function loadFixture(name: string): { path: string; content: string } {
  return {
    path: `frontend/${name}`,
    content: readFileSync(join(FIXTURE_DIR, name), "utf8"),
  };
}

/**
 * The Vue CodeSource the conformance suite runs over. PugWizard (lang="pug") +
 * ElementPlusForm (HTML element-plus) are included so the suite ASSERTS the pug
 * walk + element-plus detection — a regression to "blind to pug / element-plus"
 * scores RED on required-branch-acceptance.
 */
function vueSource(): CodeSource {
  return {
    files: [
      "CadastroWizard.vue",
      "TsScreen.vue",
      "PugWizard.vue",
      "ElementPlusForm.vue",
    ].map(loadFixture),
  };
}

// The worked-example branches that MUST appear EVERY run — RURAL/URBANO,
// the 100ha vee-validate rule, the router-guard, el-select, the PUG-ONLY
// render-conditional (`pugAreaAcima100` exists only in the pug fixture, so it
// can ONLY come from walking the pug AST), and the element-plus :rules / prop.
const VUE_REQUIRED: RequiredBranch[] = [
  { kind: "render-conditional", conditionIncludes: "RURAL" },
  { kind: "render-conditional", conditionIncludes: "URBANO" },
  { kind: "validation-rule", conditionIncludes: "maxArea" }, // the 100ha rule
  { kind: "router-guard", conditionIncludes: "beforeEach" },
  { kind: "select-branch", conditionIncludes: "el-select" },
  // PUG-derived render-conditional — the pug walk MUST run.
  { kind: "render-conditional", conditionIncludes: "pugAreaAcima100" },
  // element-plus validation (el-form :rules / el-form-item prop) — present on
  // BOTH the pug AND the plain-HTML fixtures.
  { kind: "validation-rule", conditionIncludes: "el-form[:rules" },
  { kind: "validation-rule", conditionIncludes: "el-form-item[prop=" },
];

describe("veroptima-qa-code-vue — standalone-backend conformance", () => {
  it("passes the contract conformance suite (language-OPEN proof + completeness)", async () => {
    const e = await factory.create({ stack: "vue" }, secrets, ctx);

    const report = runConformanceSuite({
      enumerator: e,
      source: vueSource(),
      requiredBranches: VUE_REQUIRED,
    });

    if (!report.passed) {
      // Surface every failing check so the reason is visible.
      console.error(JSON.stringify(report.checks, null, 2));
    }
    expect(report.passed).toBe(true);
    // Non-vacuous: the backend actually emitted branches over the scan.
    expect(e.enumerate(vueSource()).branches.length).toBeGreaterThan(0);
  });

  it("is deterministic — two enumerations are byte-identical", async () => {
    const e = await factory.create({ stack: "vue" }, secrets, ctx);
    const src = vueSource();
    expect(JSON.stringify(e.enumerate(src))).toBe(
      JSON.stringify(e.enumerate(src)),
    );
  });

  it("rejects a non-vue stack at create()", async () => {
    await expect(
      factory.create({ stack: "spring" }, secrets, ctx),
    ).rejects.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // COMPLETENESS FIXTURES — proves the enumerator is NOT blind to pug /
  // element-plus / vee-validate. Each is a distinct shipped fixture exercising a
  // path that a naive HTML-only walk would miss.
  // ──────────────────────────────────────────────────────────────────────────

  it("PUG completeness — el-select/el-radio select-branch + el-form :rules / prop + v-if render-conditional walked from the pug AST", async () => {
    const e = await factory.create({ stack: "vue" }, secrets, ctx);
    const { branches } = e.enumerate({ files: [loadFixture("PugWizard.vue")] });

    const has = (kind: string, sub: string) =>
      branches.some((b) => b.kind === kind && b.condition.includes(sub));

    // pug render-conditionals exist AND carry a pug-* node_kind (proves the pug
    // parser ran, not the HTML path — an HTML walk of a pug SFC finds ZERO).
    const renderConds = branches.filter((b) => b.kind === "render-conditional");
    expect(renderConds.length).toBeGreaterThan(0);
    expect(
      renderConds.every((b) => b.provenance.node_kind.startsWith("pug-")),
    ).toBe(true);
    expect(has("render-conditional", "RURAL")).toBe(true);
    expect(has("render-conditional", "URBANO")).toBe(true);
    // the pug-ONLY marker — can only come from the pug AST
    expect(has("render-conditional", "pugAreaAcima100")).toBe(true);

    // pug select-branch (el-select + el-radio-group)
    expect(has("select-branch", "el-select")).toBe(true);
    expect(has("select-branch", "el-radio")).toBe(true);

    // pug element-plus validation (el-form :rules + el-form-item prop)
    expect(
      branches.some((b) => b.provenance.node_kind === "pug-el-form-rules"),
    ).toBe(true);
    expect(
      branches.some((b) => b.provenance.node_kind === "pug-el-form-item-prop"),
    ).toBe(true);
    expect(has("validation-rule", "el-form[:rules")).toBe(true);
    expect(has("validation-rule", "el-form-item[prop=area]")).toBe(true);
  });

  it("ELEMENT-PLUS completeness — :rules ref + static prop + bound :prop on a PLAIN-HTML SFC → validation-rule", async () => {
    const e = await factory.create({ stack: "vue" }, secrets, ctx);
    const { branches } = e.enumerate({
      files: [loadFixture("ElementPlusForm.vue")],
    });

    const has = (kind: string, sub: string) =>
      branches.some((b) => b.kind === kind && b.condition.includes(sub));

    expect(branches.some((b) => b.provenance.node_kind === "el-form-rules")).toBe(
      true,
    );
    expect(has("validation-rule", "el-form[:rules")).toBe(true);
    expect(has("validation-rule", "el-form-item[prop=nome]")).toBe(true); // static prop
    expect(has("validation-rule", "el-form-item[prop=dynamicProp]")).toBe(true); // bound :prop
    expect(branches.some((b) => b.kind === "render-conditional")).toBe(true);
  });

  it("VEE-VALIDATE completeness — typed defineRule/useField + typed router-guard captured from a <script lang=ts> SFC", async () => {
    // The concrete enumerator exposes `unparsedScripts` (the completeness backstop)
    // on its `VueEnumeratorResult` — assert nothing fell to the backstop.
    const result = vueEnumerator.enumerate({ files: [loadFixture("TsScreen.vue")] });

    // A valid TS script parses (no under-count) — nothing falls to the backstop.
    expect(result.unparsedScripts).toEqual([]);

    const has = (kind: string, sub: string) =>
      result.branches.some((b) => b.kind === kind && b.condition.includes(sub));

    // typed vee-validate rule (defineRule("readyArea", (value: number) ...))
    expect(has("validation-rule", "readyArea")).toBe(true);
    // typed useField<boolean>("ready", ...)
    expect(has("validation-rule", "ready")).toBe(true);
    // typed router-guard (typed beforeEach + typed if-test next())
    expect(has("router-guard", "beforeEach")).toBe(true);
    expect(has("router-guard", "state.ready")).toBe(true);
  });

  it("BACKSTOP — a genuinely-malformed <script> lands in unparsedScripts; its template branches survive", async () => {
    const result = vueEnumerator.enumerate({
      files: [loadFixture("BrokenScript.vue")],
    });

    expect(result.unparsedScripts).toContain("frontend/BrokenScript.vue");
    expect(result.branches.some((b) => b.kind === "render-conditional")).toBe(
      true,
    );
    expect(result.scannedFiles).toBe(1);
  });
});
