/**
 * build.ts — self-contained bundle wrapper for veroptima-qa-code-vue.
 *
 * Why this exists (and a bare `bun build ./src/index.ts` does NOT suffice):
 * `@vue/compiler-sfc` transitively pulls `consolidate.js`, which carries ~40
 * LAZY `require('<engine>')` calls for optional template engines (marko, ejs,
 * vash, twing, react-dom/server, …). None of them is on a path our enumerator
 * ever executes — we only call `@vue/compiler-sfc`'s `parse()` for HTML SFCs and
 * `pug-lexer`/`pug-parser` DIRECTLY for Pug SFCs — but `bun build` still tries to
 * RESOLVE every `require()` it sees and fails on these uninstalled engines.
 *
 * Fix: a Bun build plugin aliases each optional consolidate engine to an EMPTY
 * stub module (a tiny `export default {}` virtual module), so the bundle stays
 * FULLY self-contained — NO npm dependency is left `--external`. The engines are
 * dead code in our usage; stubbing them keeps the bundle honest (zero externals)
 * without shipping ~40 template engines we never call.
 *
 * NOT stubbed: `pug-lexer` / `pug-parser` — those are REAL deps we import and
 * call, so they are genuinely bundled into dist/index.js (proven by the conformance
 * check that a Pug SFC still yields `pug-*` branches).
 *
 * Determinism / IP boundary are unaffected: the bundle inlines only the PUBLIC
 * `@qa-expert/code-enumerator-spi` runtime (zod schemas + constants) + the public
 * parsers (vue/babel/pug/zod). Zero core model IP (no branchId, no id-bearing
 * Branch, no model, no conformance suite) lands in dist.
 */

// The consolidate.js optional template engines that `@vue/compiler-sfc` lazily
// `require()`s but which our parser-driven enumeration never executes. Aliased to
// an empty stub so the bundle resolves with NO external left dangling.
const CONSOLIDATE_STUBBED_ENGINES = [
  "atpl",
  "babel-core",
  "bracket-template",
  "coffee-script",
  "dot",
  "dustjs-linkedin",
  "eco",
  "ect",
  "ejs",
  "haml-coffee",
  "hamlet",
  "hamljs",
  "handlebars",
  "hogan.js",
  "htmling",
  "jazz",
  "jqtpl",
  "just",
  "liquor",
  "marko",
  "mote",
  "mustache",
  "plates",
  "ractive",
  "react",
  "react-dom/server",
  "slm",
  "squirrelly",
  "teacup/lib/express",
  "templayed",
  "toffee",
  "twig",
  "twing",
  "underscore",
  "vash",
  "velocityjs",
  "walrus",
  "whiskers",
] as const;

const stubbed = new Set<string>(CONSOLIDATE_STUBBED_ENGINES);

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  plugins: [
    {
      name: "stub-consolidate-engines",
      setup(build) {
        // Match the bare engine specifiers consolidate.js lazily requires.
        const filter = /^(?:atpl|babel-core|bracket-template|coffee-script|dot|dustjs-linkedin|eco|ect|ejs|haml-coffee|hamlet|hamljs|handlebars|hogan\.js|htmling|jazz|jqtpl|just|liquor|marko|mote|mustache|plates|ractive|react|react-dom\/server|slm|squirrelly|teacup\/lib\/express|templayed|toffee|twig|twing|underscore|vash|velocityjs|walrus|whiskers)$/;
        build.onResolve({ filter }, (args) => {
          if (!stubbed.has(args.path)) return undefined;
          return { path: args.path, namespace: "consolidate-stub" };
        });
        build.onLoad(
          { filter: /.*/, namespace: "consolidate-stub" },
          () => ({ contents: "export default {};", loader: "js" }),
        );
      },
    },
  ],
});

if (!result.success) {
  console.error("Bundle FAILED:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`Bundle OK — ${result.outputs.length} output(s):`);
for (const o of result.outputs) console.log(`  ${o.path}`);
console.log(`Stubbed ${CONSOLIDATE_STUBBED_ENGINES.length} optional consolidate.js engines (dead code in our usage).`);
