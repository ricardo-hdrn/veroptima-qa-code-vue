/**
 * RAW-emission proof for veroptima-qa-code-vue (0c model split).
 *
 * The conformance suite is PRIVATE host IP now, so this plugin CANNOT import it.
 * These tests instead assert the plugin's PUBLIC contract directly: it emits
 * `RawBranch`es (NO `id`) against `@qa-expert/code-enumerator-spi`, the pug walk +
 * element-plus + vee-validate detection are intact, and two enumerations are
 * byte-identical (determinism). Branch identity is the HOST's job, asserted
 * host-side — never here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";
import type { CodeSource, RawBranch } from "@qa-expert/code-enumerator-spi";

import factory from "../index.js";
import { vueEnumerator } from "../enumerator.js";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "vue");

function loadFixture(name: string): { path: string; content: string } {
  return {
    path: `frontend/${name}`,
    content: readFileSync(join(FIXTURE_DIR, name), "utf8"),
  };
}

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

const has = (branches: RawBranch[], kind: string, sub: string): boolean =>
  branches.some((b) => b.kind === kind && b.condition.includes(sub));

describe("veroptima-qa-code-vue — RAW emission against code-enumerator-spi", () => {
  it("factory.create() returns a vue enumerator that emits RawBranches", async () => {
    const e = await factory.create({ stack: "vue" });
    const result = e.enumerate(vueSource());

    expect(result.stack).toBe("vue");
    expect(result.scannedFiles).toBe(4);
    expect(result.branches.length).toBeGreaterThan(0);
  });

  it("emits RAW branches — NO `id` field (the host computes identity)", async () => {
    const e = await factory.create({ stack: "vue" });
    const { branches } = e.enumerate(vueSource());

    for (const b of branches) {
      // RawBranch carries NO id — only structural fields.
      expect((b as unknown as Record<string, unknown>).id).toBeUndefined();
      expect(typeof b.stack).toBe("string");
      expect(typeof b.kind).toBe("string");
      expect(typeof b.condition).toBe("string");
      expect(typeof b.provenance.file).toBe("string");
      expect(typeof b.provenance.line).toBe("number");
      expect(typeof b.provenance.node_kind).toBe("string");
      // AST nodes-only backend (no edges) → no plugin-local key.
      expect(b.key).toBeUndefined();
    }
  });

  it("an SFC with a v-if yields a render-conditional RawBranch (no id)", async () => {
    const e = await factory.create({ stack: "vue" });
    const { branches } = e.enumerate({ files: [loadFixture("CadastroWizard.vue")] });

    const rc = branches.find((b) => b.kind === "render-conditional");
    expect(rc).toBeDefined();
    expect((rc as unknown as Record<string, unknown>).id).toBeUndefined();
    expect(rc!.stack).toBe("vue");
    expect(rc!.provenance.node_kind.startsWith("v-")).toBe(true);
    expect(has(branches, "render-conditional", "RURAL")).toBe(true);
    expect(has(branches, "render-conditional", "URBANO")).toBe(true);
  });

  it("rejects a non-vue stack at create()", async () => {
    await expect(factory.create({ stack: "spring" })).rejects.toThrow();
  });

  it("PUG path preserved — el-select/el-radio + el-form :rules/prop + v-if walked from the pug AST", async () => {
    const e = await factory.create({ stack: "vue" });
    const { branches } = e.enumerate({ files: [loadFixture("PugWizard.vue")] });

    // pug render-conditionals exist AND carry a pug-* node_kind (proves the pug
    // parser ran, not the HTML path — an HTML walk of a pug SFC finds ZERO).
    const renderConds = branches.filter((b) => b.kind === "render-conditional");
    expect(renderConds.length).toBeGreaterThan(0);
    expect(renderConds.every((b) => b.provenance.node_kind.startsWith("pug-"))).toBe(true);
    expect(has(branches, "render-conditional", "RURAL")).toBe(true);
    expect(has(branches, "render-conditional", "URBANO")).toBe(true);
    // the pug-ONLY marker — can only come from the pug AST
    expect(has(branches, "render-conditional", "pugAreaAcima100")).toBe(true);

    // pug select-branch (el-select + el-radio-group)
    expect(has(branches, "select-branch", "el-select")).toBe(true);
    expect(has(branches, "select-branch", "el-radio")).toBe(true);

    // pug element-plus validation (el-form :rules + el-form-item prop)
    expect(branches.some((b) => b.provenance.node_kind === "pug-el-form-rules")).toBe(true);
    expect(branches.some((b) => b.provenance.node_kind === "pug-el-form-item-prop")).toBe(true);
    expect(has(branches, "validation-rule", "el-form[:rules")).toBe(true);
    expect(has(branches, "validation-rule", "el-form-item[prop=area]")).toBe(true);
  });

  it("ELEMENT-PLUS — :rules ref + static prop + bound :prop on a PLAIN-HTML SFC → validation-rule RawBranches", async () => {
    const e = await factory.create({ stack: "vue" });
    const { branches } = e.enumerate({ files: [loadFixture("ElementPlusForm.vue")] });

    expect(branches.some((b) => b.provenance.node_kind === "el-form-rules")).toBe(true);
    expect(has(branches, "validation-rule", "el-form[:rules")).toBe(true);
    expect(has(branches, "validation-rule", "el-form-item[prop=nome]")).toBe(true); // static prop
    expect(has(branches, "validation-rule", "el-form-item[prop=dynamicProp]")).toBe(true); // bound :prop
    expect(branches.some((b) => b.kind === "render-conditional")).toBe(true);
  });

  it("VEE-VALIDATE — typed defineRule/useField + typed router-guard captured from a <script lang=ts> SFC", () => {
    // The concrete enumerator exposes `unparsedScripts` (the completeness backstop)
    // as an extra field on its `VueEnumeratorResult`; the host reads it defensively.
    const result = vueEnumerator.enumerate({ files: [loadFixture("TsScreen.vue")] });

    // A valid TS script parses (no under-count) — nothing falls to the backstop.
    expect(result.unparsedScripts).toEqual([]);

    expect(has(result.branches, "validation-rule", "readyArea")).toBe(true); // defineRule
    expect(has(result.branches, "validation-rule", "ready")).toBe(true); // useField<boolean>
    expect(has(result.branches, "router-guard", "beforeEach")).toBe(true);
    expect(has(result.branches, "router-guard", "state.ready")).toBe(true);
  });

  it("BACKSTOP — a genuinely-malformed <script> lands in unparsedScripts; its template branches survive", () => {
    const result = vueEnumerator.enumerate({ files: [loadFixture("BrokenScript.vue")] });

    expect(result.unparsedScripts).toContain("frontend/BrokenScript.vue");
    expect(result.branches.some((b) => b.kind === "render-conditional")).toBe(true);
    expect(result.scannedFiles).toBe(1);
  });

  it("DETERMINISM — two enumerate calls are JSON-identical", async () => {
    const e = await factory.create({ stack: "vue" });
    const src = vueSource();
    expect(JSON.stringify(e.enumerate(src))).toBe(JSON.stringify(e.enumerate(src)));
  });
});
