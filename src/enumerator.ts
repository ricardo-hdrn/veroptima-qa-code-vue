/// <reference path="./pug.d.ts" />
// deterministic-specflow-grounding A1/A4 — the Vue/frontend branch enumerator.
//
// NOTE: the triple-slash reference above makes the ambient `pug-lexer` /
// `pug-parser` module declarations (in ./pug.d.ts, no @types shipped) travel
// WITH this source file across package boundaries — so a CONSUMER package
// (e.g. @qa-expert/macro-inventory's code reader) that transitively compiles
// this adapter sees them too, not just grounding's own `include`. Without it,
// per-package tsc in consumers fails TS7016 on the bare pug imports.
//
// Stage 2 adapter: a PARSER-driven (never LLM) walk over `.vue` SFCs that emits
// the FIXED set of path-changing frontend branches with AST provenance. The
// SET is deterministic by contract — the same `CodeSource` yields a
// byte-identical SORTED `branches[]`, every run (the variance the spec kills
// lives at the LLM re-read, NOT here). Downstream the LLM only names/classifies
// each branch (A2/A5); the set is fixed here.
//
// ── What we walk ───────────────────────────────────────────────────────────
// TEMPLATE AST — TWO backends, ONE branch vocabulary:
//   • HTML templates (`descriptor.template.lang` unset): `@vue/compiler-sfc` →
//     descriptor.template.ast, a recursive document-order descent over element
//     nodes. Element nodes carry `.props`; directives are `type:7` nodes with
//     `.name` (the `v-` prefix already stripped by the compiler:
//     `if`/`else-if`/`else`/`show`/`model`/`bind`) + `.exp.content` +
//     `.loc.start.line`. We emit:
//       • `v-if` / `v-show` / `v-else-if` / `v-else` → render-conditional
//       • `<el-select>` / `<el-radio*>` whose v-model value drives a sibling v-if
//         → select-branch
//       • `<el-form :rules>` / `<el-form-item prop>` → validation-rule (element-plus)
//   • PUG templates (`descriptor.template.lang === "pug"`): the compiler does NOT
//     emit a usable element AST for pug, so we parse `descriptor.template.content`
//     with `pug-lexer` + `pug-parser` and walk the Pug AST IN DOCUMENT ORDER (the
//     AST order IS source order). The SAME kinds come out — render-conditional
//     (`v-if`/`v-show`/`v-else`/`v-else-if` attrs), select-branch (el-select /
//     el-radio[-group]), validation-rule (element-plus `:rules`/`prop`). Without
//     this, ~the entire real frontend (pug-syntax SFCs) is INVISIBLE to grounding.
//     Provenance for a pug node: `file` = the SFC path; `line` = the pug node's
//     `.line` mapped back to the ORIGINAL .vue line (the `<template>` tag's line
//     offset is added so the cite resolves against the real file); `node_kind` =
//     `pug-v-if` / `pug-el-select` / `pug-el-form-rules` / …; `node_path` = a
//     deterministic pug-AST path (tag chain + per-parent child ordinals + the
//     directive/role suffix, e.g. `template/div[0]/el-form[1]/section[3]:v-if`).
// SCRIPT AST (`descriptor.script` + `descriptor.scriptSetup`, parsed by
//   `@babel/parser` with the `typescript`+`jsx` plugins so `<script lang="ts">`
//   SFCs — most of a real frontend — parse instead of throwing): a document-order
//   (by source start offset) collection over the JS/TS. We emit:
//     • `defineRule(...)` / `useField(...)` / a `rules`/`validate` config object
//       → validation-rule  (vee-validate)
//     • `beforeEach`/`beforeEnter` calls, and `if` statements whose body calls
//       `next(...)` → router-guard
//   A script lands in `unparsedScripts` ONLY if it STILL fails to parse even with
//   babel+TS (a genuinely malformed script) — the completeness BACKSTOP. A valid
//   TS script's branches are now CAPTURED (the acorn-throws-on-types under-count
//   this fix closes). We keep the per-script try/catch so one broken file can't
//   abort the whole enumeration; a caught failure is recorded honestly (S3's gate
//   goes RED on non-empty `unparsedScripts`).
//
// ── node_path uniqueness ──────────────────────────────────────────────────
// Every branch carries a deterministic `provenance.node_path` (A4 / the
// completeness guard — `assertNodePathsPopulated`). Template paths are the
// document-order element chain with per-parent child ordinals plus the directive
// name, e.g. `template/div[0]/el-form[0]/div[3]:v-if`; two directives on one
// element get distinct paths (different directive suffix). Script paths are
// `script[N]/<construct>[ordinal]` where the ordinal is the construct's rank in
// source-start order within that script, e.g. `script[1]/beforeEach[0]/if[0]`.
// No two distinct AST nodes share a node_path — so the HOST's identity key
// (which folds node_path in) never fuses distinct branches.

import { parse as parseSfc } from "@vue/compiler-sfc";
import { parse as parseBabel } from "@babel/parser";
import _traverse from "@babel/traverse";
import lex from "pug-lexer";
import parsePug from "pug-parser";

// `@babel/traverse` is published as a CJS module with a `.default` export; the
// interop shape differs across bundlers, so normalize to the callable here.
const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ??
  _traverse) as typeof _traverse;

import {
  type BranchEnumerator,
  type BranchKind,
  type CodeSource,
  type RawBranch,
  type RawEnumeratorResult,
  type RawProvenance,
} from "@qa-expert/code-enumerator-spi";

// ---------------------------------------------------------------------------
// Vue compiler AST — the narrow shapes we read (kept local; the compiler types
// are broad). We only touch element/directive fields the parser populates.
// ---------------------------------------------------------------------------

const NODE_ELEMENT = 1;
const NODE_ATTRIBUTE = 6;
const NODE_DIRECTIVE = 7;

interface TplLoc {
  start: { line: number };
  end?: { line: number };
}
interface TplDirective {
  type: 7;
  name: string;
  /** `v-bind` directives (`:rules`) carry the bound name here (`{ content: "rules" }`). */
  arg?: { content?: string } | null;
  exp?: { content?: string } | null;
  loc: TplLoc;
}
interface TplAttribute {
  type: 6;
  name: string;
  value?: { content?: string } | null;
  loc: TplLoc;
}
type TplProp = TplDirective | TplAttribute | { type: number };
interface TplElement {
  type: number;
  tag?: string;
  props?: TplProp[];
  children?: TplNode[];
  loc?: TplLoc;
}
type TplNode = TplElement | { type: number; children?: TplNode[]; loc?: TplLoc };

function isElement(n: TplNode): n is TplElement {
  return (n as TplElement).type === NODE_ELEMENT;
}
function isDirective(p: { type: number }): p is TplDirective {
  return p.type === NODE_DIRECTIVE;
}
function isAttribute(p: { type: number }): p is TplAttribute {
  return p.type === NODE_ATTRIBUTE;
}

// The render-conditional directive names (the `v-` prefix is stripped already).
const RENDER_DIRECTIVES = new Set(["if", "else-if", "else", "show"]);

// el-select / radio component tags whose v-model value can drive a wizard path.
function isSelectBranchTag(tag: string | undefined): boolean {
  if (!tag) return false;
  const t = tag.toLowerCase();
  return t === "el-select" || t === "el-radio" || t === "el-radio-group";
}

// ---------------------------------------------------------------------------
// element-plus validation detection — shared by the HTML path AND the Pug path.
// element-plus is THE dominant Vue UI kit in the wild; its form validation does
// NOT use vee-validate's `defineRule`/`useField` (which the script walk covers).
// Instead it binds a `:rules` object on `<el-form>` and a `prop` on each
// `<el-form-item>` — a path-changing validation branch the adapter was BLIND to.
// These two helpers normalize "is this an element-plus validation site?" so the
// HTML walk (compiler attr names) and the Pug walk (raw attr names) agree.
// ---------------------------------------------------------------------------

/** The `:rules`/`rules` ref bound on an `<el-form>`, normalized; `undefined` if absent. */
function elFormRulesRef(rawAttrName: string): boolean {
  // `:rules` (v-bind shorthand), `v-bind:rules`, or a plain `rules` literal.
  const n = rawAttrName.toLowerCase();
  return n === ":rules" || n === "v-bind:rules" || n === "rules";
}

/** Strip ONE pair of surrounding quotes from a pug attr value (`"\"x\""` → `x`). */
function unquotePug(val: unknown): string {
  if (typeof val !== "string") return "";
  const m = /^(['"])([\s\S]*)\1$/.exec(val.trim());
  return m ? m[2] : val.trim();
}

// ---------------------------------------------------------------------------
// Template walk — recursive, document order; builds node_path per element chain
// ---------------------------------------------------------------------------

interface TemplateHit {
  kind: BranchKind;
  condition: string;
  arms: string[];
  line: number;
  endLine?: number;
  nodeKind: string;
  nodePath: string;
}

function directiveArms(name: string): string[] {
  switch (name) {
    case "if":
      return ["if", "else"];
    case "else-if":
      return ["else-if", "else"];
    case "else":
      return ["else"];
    case "show":
      return ["shown", "hidden"];
    default:
      return [];
  }
}

/**
 * Recursively walk the template AST in document order, emitting a `TemplateHit`
 * per path-changing site. `pathPrefix` is the running node_path of the parent
 * element chain; `childIndex` is this node's ordinal among its parent's children
 * (so sibling elements with the same tag stay distinct).
 */
function walkTemplate(
  node: TplNode,
  pathPrefix: string,
  childIndex: number,
  out: TemplateHit[],
): void {
  let here = pathPrefix;
  if (isElement(node)) {
    const tag = node.tag ?? "el";
    here = `${pathPrefix}/${tag}[${childIndex}]`;

    // render-conditional directives on this element (document order = prop order)
    if (node.props) {
      for (const p of node.props) {
        if (!isDirective(p)) continue;
        if (RENDER_DIRECTIVES.has(p.name)) {
          const exp = p.exp?.content ?? "";
          out.push({
            kind: "render-conditional",
            condition: exp,
            arms: directiveArms(p.name),
            line: p.loc.start.line,
            endLine: p.loc.end?.line,
            nodeKind: `v-${p.name}`,
            // the directive name disambiguates multiple directives on one element
            nodePath: `${here}:v-${p.name}`,
          });
        }
      }
    }

    // select-branch: an el-select / radio whose v-model drives the wizard path
    if (isSelectBranchTag(node.tag)) {
      let model = "";
      if (node.props) {
        for (const p of node.props) {
          if (isDirective(p) && p.name === "model") {
            model = p.exp?.content ?? "";
            break;
          }
        }
      }
      out.push({
        kind: "select-branch",
        condition: model ? `${node.tag}[v-model=${model}]` : (node.tag ?? "el"),
        arms: [],
        line: node.loc?.start.line ?? 0,
        endLine: node.loc?.end?.line,
        nodeKind: node.tag?.toLowerCase() ?? "el-select",
        nodePath: `${here}:select`,
      });
    }

    // element-plus validation: `<el-form :rules>` and `<el-form-item prop>`.
    // ADDED alongside the script-walk's vee-validate detection (does NOT replace
    // it). element-plus is the dominant kit; its `:rules` + `prop` validation was
    // previously invisible.
    const tagLc = node.tag?.toLowerCase();
    if (tagLc === "el-form" && node.props) {
      for (const p of node.props) {
        if (isDirective(p) && p.name === "bind" && elFormRulesRef(`:${p.arg?.content ?? ""}`)) {
          const ref = p.exp?.content ?? "rules";
          out.push({
            kind: "validation-rule",
            condition: `el-form[:rules=${ref}]`,
            arms: ["valid", "invalid"],
            line: p.loc.start.line,
            endLine: p.loc.end?.line,
            nodeKind: "el-form-rules",
            nodePath: `${here}:rules`,
          });
        } else if (isAttribute(p) && p.name.toLowerCase() === "rules") {
          out.push({
            kind: "validation-rule",
            condition: `el-form[rules=${p.value?.content ?? ""}]`,
            arms: ["valid", "invalid"],
            line: p.loc.start.line,
            endLine: p.loc.end?.line,
            nodeKind: "el-form-rules",
            nodePath: `${here}:rules`,
          });
        }
      }
    }
    if (tagLc === "el-form-item" && node.props) {
      for (const p of node.props) {
        let propVal: string | undefined;
        let loc: TplLoc | undefined;
        if (isAttribute(p) && p.name.toLowerCase() === "prop") {
          propVal = p.value?.content ?? "";
          loc = p.loc;
        } else if (isDirective(p) && p.name === "bind" && (p.arg?.content ?? "").toLowerCase() === "prop") {
          propVal = p.exp?.content ?? "";
          loc = p.loc;
        }
        if (propVal !== undefined && loc) {
          out.push({
            kind: "validation-rule",
            condition: `el-form-item[prop=${propVal}]`,
            arms: ["valid", "invalid"],
            line: loc.start.line,
            endLine: loc.end?.line,
            nodeKind: "el-form-item-prop",
            nodePath: `${here}:prop`,
          });
        }
      }
    }
  }

  // descend in document order
  const children = (node as TplElement).children;
  if (children) {
    for (let i = 0; i < children.length; i++) {
      walkTemplate(children[i], here, i, out);
    }
  }
}

// ---------------------------------------------------------------------------
// Pug template walk — pug-lexer + pug-parser, recursive document order.
//
// The Pug AST: the root is a `Block` (`{ type:"Block", nodes:[...] }`); tag nodes
// are `{ type:"Tag", name, line, attrs:[{name,val,line}], block:{ nodes:[...] } }`.
// `attrs[].val` is the RAW attribute source INCLUDING quotes (`"\"a === 'b'\""`)
// for a valued attr, or boolean `true` for a value-less attr (`v-else`). We strip
// one quote pair (`unquotePug`) so the condition text matches the HTML path's
// `exp.content`. The AST node order IS source order, so a recursive descent with
// per-parent child ordinals is deterministic. node_path mirrors the HTML scheme:
// `<tagChain>[childIndex]…:<suffix>` — unique per node so the host's id never fuses.
// ---------------------------------------------------------------------------

interface PugAttr {
  name: string;
  val: unknown; // string (quoted) for a valued attr, `true` for a boolean attr
  line?: number;
}
interface PugTag {
  type: "Tag";
  name: string;
  line?: number;
  attrs?: PugAttr[];
  block?: PugBlock;
}
interface PugBlock {
  type: "Block";
  nodes?: PugNode[];
}
type PugNode = PugTag | PugBlock | { type: string; block?: PugBlock; nodes?: PugNode[] };

function isPugTag(n: PugNode): n is PugTag {
  return n.type === "Tag";
}
function isPugBlock(n: PugNode): n is PugBlock {
  return n.type === "Block";
}

/** The pug attr names that are render-conditional directives (raw `v-*` form). */
const PUG_RENDER_ATTRS = new Set(["v-if", "v-else-if", "v-else", "v-show"]);

function pugDirectiveArms(attrName: string): string[] {
  switch (attrName) {
    case "v-if":
      return ["if", "else"];
    case "v-else-if":
      return ["else-if", "else"];
    case "v-else":
      return ["else"];
    case "v-show":
      return ["shown", "hidden"];
    default:
      return [];
  }
}

/**
 * Recursively walk a Pug AST node in document order. `lineOffset` maps a pug
 * `.line` (1-based, relative to the template CONTENT) back to the original .vue
 * line so the cite resolves against the real file. `pathPrefix`/`childIndex`
 * build the deterministic node_path exactly like the HTML walk.
 */
function walkPug(
  node: PugNode,
  lineOffset: number,
  pathPrefix: string,
  childIndex: number,
  out: TemplateHit[],
): void {
  if (isPugBlock(node)) {
    const kids = node.nodes ?? [];
    for (let i = 0; i < kids.length; i++) {
      walkPug(kids[i], lineOffset, pathPrefix, i, out);
    }
    return;
  }
  if (!isPugTag(node)) {
    // Non-tag (Text/Comment/…): descend into a block child if present, keeping
    // the parent's path (text nodes are not path-changing sites themselves).
    const blk = (node as { block?: PugBlock }).block;
    if (blk) walkPug(blk, lineOffset, pathPrefix, childIndex, out);
    return;
  }

  const tag = node.name || "el";
  const here = `${pathPrefix}/${tag}[${childIndex}]`;
  const line = (node.line ?? 1) + lineOffset;
  const attrs = node.attrs ?? [];
  const tagLc = tag.toLowerCase();

  // render-conditional directives (attr order = document order).
  for (const a of attrs) {
    const an = a.name.toLowerCase();
    if (PUG_RENDER_ATTRS.has(an)) {
      // a boolean attr (`v-else`) has `val === true` → no condition text.
      const cond = a.val === true ? "" : unquotePug(a.val);
      out.push({
        kind: "render-conditional",
        condition: cond,
        arms: pugDirectiveArms(an),
        line: (a.line ?? node.line ?? 1) + lineOffset,
        nodeKind: `pug-${an}`,
        nodePath: `${here}:${an}`,
      });
    }
  }

  // select-branch: el-select / el-radio[-group] whose v-model drives the path.
  if (isSelectBranchTag(tag)) {
    let model = "";
    for (const a of attrs) {
      if (a.name.toLowerCase() === "v-model") {
        model = unquotePug(a.val);
        break;
      }
    }
    out.push({
      kind: "select-branch",
      condition: model ? `${tag}[v-model=${model}]` : tag,
      arms: [],
      line,
      nodeKind: `pug-${tagLc}`,
      nodePath: `${here}:select`,
    });
  }

  // element-plus validation: `<el-form :rules>` / `<el-form-item prop>`.
  if (tagLc === "el-form") {
    for (const a of attrs) {
      if (elFormRulesRef(a.name)) {
        out.push({
          kind: "validation-rule",
          condition: `el-form[:rules=${unquotePug(a.val) || "rules"}]`,
          arms: ["valid", "invalid"],
          line: (a.line ?? node.line ?? 1) + lineOffset,
          nodeKind: "pug-el-form-rules",
          nodePath: `${here}:rules`,
        });
      }
    }
  }
  if (tagLc === "el-form-item") {
    for (const a of attrs) {
      const an = a.name.toLowerCase();
      if (an === "prop" || an === ":prop" || an === "v-bind:prop") {
        out.push({
          kind: "validation-rule",
          condition: `el-form-item[prop=${unquotePug(a.val)}]`,
          arms: ["valid", "invalid"],
          line: (a.line ?? node.line ?? 1) + lineOffset,
          nodeKind: "pug-el-form-item-prop",
          nodePath: `${here}:prop`,
        });
      }
    }
  }

  // descend in document order
  if (node.block) walkPug(node.block, lineOffset, here, 0, out);
}

// ---------------------------------------------------------------------------
// Script walk — @babel/parser (typescript+jsx) parse, document-order (by source
// start) collection. Babel's AST is ESTree-ish; the one divergence we account
// for is the literal node split (`StringLiteral`/`NumericLiteral`/... instead of
// acorn's single `Literal`).
// ---------------------------------------------------------------------------

interface ScriptHit {
  kind: BranchKind;
  condition: string;
  arms: string[];
  line: number;
  nodeKind: string;
  construct: string; // for the node_path ordinal bucket
  start: number; // source offset, for deterministic document order
}

const VALIDATION_CALLS = new Set(["defineRule", "useField"]);
const ROUTER_GUARD_CALLS = new Set(["beforeEach", "beforeEnter", "beforeResolve"]);

/**
 * Babel splits acorn's single `Literal` into `StringLiteral` / `NumericLiteral` /
 * `BooleanLiteral` / `NullLiteral`. This reads the literal text in a babel-aware
 * way (returns `undefined` when the node is not a literal), so the rest of the
 * walk stays the same shape as the acorn version.
 */
function babelLiteral(node: any): { value: unknown; isString: boolean } | undefined {
  if (!node || typeof node !== "object") return undefined;
  switch (node.type) {
    case "StringLiteral":
      return { value: node.value, isString: true };
    case "NumericLiteral":
    case "BooleanLiteral":
      return { value: node.value, isString: false };
    case "NullLiteral":
      return { value: null, isString: false };
    // a TS-as-const or template with no expressions still reads as text
    default:
      return undefined;
  }
}

/** Resolve a CallExpression callee to its leaf identifier name (`a.b.c(` → `c`). */
function calleeName(callee: unknown): string {
  const c = callee as { type?: string; name?: string; property?: { type?: string; name?: string } };
  if (c?.type === "Identifier") return c.name ?? "";
  if (c?.type === "MemberExpression" && c.property?.type === "Identifier") {
    return c.property.name ?? "";
  }
  return "";
}

/** Does an `if` statement's consequent/alternate call `next(...)` anywhere? */
function ifCallsNext(node: any): boolean {
  let found = false;
  const visit = (n: any): void => {
    if (!n || typeof n !== "object" || found) return;
    if (n.type === "CallExpression" && calleeName(n.callee) === "next") {
      found = true;
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object" && typeof v.type === "string") visit(v);
    }
  };
  visit(node.consequent);
  if (node.alternate) visit(node.alternate);
  return found;
}

/**
 * Collect every script branch site as a raw `ScriptHit` (no node_path yet — the
 * caller assigns deterministic per-construct ordinals after sorting by source
 * start so document order is stable regardless of traversal quirks).
 *
 * Driven by `@babel/traverse` over the babel AST (TS+JSX scripts now parse). The
 * per-hit shape and the kinds are UNCHANGED from the acorn version — only the
 * parse backend and the literal-node split differ — so the node_path scheme, and
 * therefore every host-side id, stays stable.
 */
function collectScriptHits(ast: any): ScriptHit[] {
  const hits: ScriptHit[] = [];

  traverse(ast, {
    CallExpression(path: any) {
      const n = path.node;
      const name = calleeName(n.callee);
      if (VALIDATION_CALLS.has(name)) {
        // condition = the rule/field expression text approximation
        const lit = babelLiteral(n.arguments?.[0]);
        const ruleName = lit ? String(lit.value) : name;
        hits.push({
          kind: "validation-rule",
          condition: `${name}(${ruleName})`,
          arms: ["valid", "invalid"],
          line: n.loc?.start.line ?? 0,
          nodeKind: name,
          construct: name,
          start: n.start ?? 0,
        });
      } else if (ROUTER_GUARD_CALLS.has(name)) {
        hits.push({
          kind: "router-guard",
          condition: name,
          arms: ["allow", "redirect"],
          line: n.loc?.start.line ?? 0,
          nodeKind: name,
          construct: name,
          start: n.start ?? 0,
        });
      }
    },
    IfStatement(path: any) {
      const n = path.node;
      if (!ifCallsNext(n)) return;
      hits.push({
        kind: "router-guard",
        condition: exprText(n.test),
        arms: ["allow", "redirect"],
        line: n.loc?.start.line ?? 0,
        nodeKind: "route-if",
        construct: "route-if",
        start: n.start ?? 0,
      });
    },
  });

  return hits;
}

/** A cheap, deterministic source-text approximation of a test expression. */
function exprText(node: any): string {
  if (!node || typeof node !== "object") return "";
  switch (node.type) {
    case "Identifier":
      return node.name ?? "";
    // acorn emitted a single `Literal`; babel splits it — handle both so the
    // condition text (and thus the id) is identical regardless of backend.
    case "Literal":
      return typeof node.value === "string" ? `'${node.value}'` : String(node.value);
    case "StringLiteral":
      return `'${node.value}'`;
    case "NumericLiteral":
    case "BooleanLiteral":
      return String(node.value);
    case "NullLiteral":
      return "null";
    case "MemberExpression":
      return `${exprText(node.object)}.${exprText(node.property)}`;
    case "UnaryExpression":
      return `${node.operator}${exprText(node.argument)}`;
    case "BinaryExpression":
      return `${exprText(node.left)} ${node.operator} ${exprText(node.right)}`;
    case "LogicalExpression":
      return `${exprText(node.left)} ${node.operator} ${exprText(node.right)}`;
    case "CallExpression":
      return `${exprText(node.callee)}(${(node.arguments ?? []).map(exprText).join(", ")})`;
    default:
      return node.type ?? "";
  }
}

// ---------------------------------------------------------------------------
// enumerate — parse each SFC, emit branches, sort by id
// ---------------------------------------------------------------------------

const VUE_FILE = /\.vue$/i;

export interface VueEnumeratorResult extends RawEnumeratorResult {
  /** The completeness BACKSTOP: files whose `<script>` STILL failed to parse even
   *  with `@babel/parser` (`typescript`+`jsx`) — i.e. genuinely malformed scripts.
   *  A valid TS script does NOT land here (its branches are now captured); only a
   *  real parse failure does. Template branches for these files were still emitted;
   *  the host reads this field defensively (its gate goes RED on a non-empty list). */
  unparsedScripts: string[];
}

/** A stable, structural sort key for RAW branches — NO id at all (the host owns
 *  identity). The plugin must emit a DETERMINISTIC order; this folds the cite +
 *  classifier fields into one comparable string so two runs are byte-identical. */
function branchSortKey(b: RawBranch): string {
  const p = b.provenance;
  return [
    p.file,
    String(p.line).padStart(8, "0"),
    p.node_path ?? "",
    p.node_kind,
    b.kind,
    b.condition,
  ].join(" ");
}

function buildBranch(
  file: string,
  hit: { kind: BranchKind; condition: string; arms: string[]; line: number; endLine?: number; nodeKind: string; nodePath: string },
): RawBranch {
  const provenance: RawProvenance = {
    file,
    line: hit.line,
    ...(hit.endLine !== undefined ? { end_line: hit.endLine } : {}),
    node_kind: hit.nodeKind,
    node_path: hit.nodePath,
  };
  // RAW — NO id. The host computes the branch id from (stack,kind,condition,provenance).
  return {
    stack: "vue",
    kind: hit.kind,
    condition: hit.condition,
    arms: hit.arms,
    provenance,
  };
}

function enumerate(source: CodeSource): VueEnumeratorResult {
  const branches: RawBranch[] = [];
  const unparsedScripts: string[] = [];
  let scannedFiles = 0;

  // Deterministic file order — sort by path so traversal is reproducible
  // regardless of how the source was assembled.
  const files = [...source.files]
    .filter((f) => VUE_FILE.test(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const file of files) {
    scannedFiles++;
    let descriptor;
    try {
      ({ descriptor } = parseSfc(file.content, { templateParseOptions: {} }));
    } catch {
      // An unparseable SFC yields no branches but still counts as scanned.
      continue;
    }

    // --- template branches ---
    if (descriptor.template?.lang === "pug" && descriptor.template.content) {
      // PUG path: the compiler does not give us an element AST for pug — parse
      // the raw content with pug-lexer + pug-parser and walk that. The `.line`
      // a pug node carries is relative to the template CONTENT, so add the
      // `<template>` tag's line (minus 1, since pug is 1-based) to recover the
      // ORIGINAL .vue line for the cite.
      const lineOffset = (descriptor.template.loc?.start?.line ?? 1) - 1;
      try {
        const tokens = lex(descriptor.template.content, { filename: file.path });
        const ast = parsePug(tokens, { filename: file.path, src: descriptor.template.content });
        const hits: TemplateHit[] = [];
        walkPug(ast as unknown as PugNode, lineOffset, "template", 0, hits);
        for (const h of hits) branches.push(buildBranch(file.path, h));
      } catch {
        // A malformed pug template yields no template branches but the SFC still
        // counts as scanned (script branches below are still attempted).
      }
    } else if (descriptor.template?.ast) {
      const hits: TemplateHit[] = [];
      walkTemplate(descriptor.template.ast as unknown as TplNode, "template", 0, hits);
      for (const h of hits) branches.push(buildBranch(file.path, h));
    }

    // --- script branches (script + scriptSetup), each guarded for TS throw ---
    const scripts: Array<{ content: string }> = [];
    if (descriptor.script?.content) scripts.push({ content: descriptor.script.content });
    if (descriptor.scriptSetup?.content) scripts.push({ content: descriptor.scriptSetup.content });

    for (let si = 0; si < scripts.length; si++) {
      const content = scripts[si].content;
      let ast: any;
      try {
        ast = parseBabel(content, {
          sourceType: "module",
          plugins: ["typescript", "jsx"],
        });
      } catch {
        // STILL un-parseable even with babel+TS — a genuinely malformed script.
        // This is the completeness BACKSTOP: skip its JS branches, keep the
        // template ones already emitted, and record the failure honestly so
        // S3's gate can go RED. A valid TS script never reaches here.
        if (!unparsedScripts.includes(file.path)) unparsedScripts.push(file.path);
        continue;
      }

      const rawHits = collectScriptHits(ast);
      // Deterministic document order, then per-construct ordinal for node_path.
      rawHits.sort((a, b) => a.start - b.start);
      const ordinals = new Map<string, number>();
      for (const h of rawHits) {
        const bucket = `${si}:${h.construct}`;
        const ord = ordinals.get(bucket) ?? 0;
        ordinals.set(bucket, ord + 1);
        branches.push(
          buildBranch(file.path, {
            kind: h.kind,
            condition: h.condition,
            arms: h.arms,
            line: h.line,
            nodeKind: h.nodeKind,
            nodePath: `script[${si}]/${h.construct}[${ord}]`,
          }),
        );
      }
    }
  }

  // Deterministic emission order — sort by a stable structural key (NO id here;
  // the host owns identity and re-sorts by id after lifting). A tie-break by the
  // full key makes two runs byte-identical.
  branches.sort((a, b) => {
    const ka = branchSortKey(a);
    const kb = branchSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return {
    stack: "vue",
    branches,
    scannedFiles,
    unparsedScripts,
  };
}

// ---------------------------------------------------------------------------
// vueEnumerator — the exported BranchEnumerator
// ---------------------------------------------------------------------------

interface VueBranchEnumerator extends BranchEnumerator {
  readonly stack: "vue";
  enumerate(source: CodeSource): VueEnumeratorResult;
}

export const vueEnumerator: VueBranchEnumerator = {
  stack: "vue",
  enumerate,
};
