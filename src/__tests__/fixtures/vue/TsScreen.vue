<template>
  <div>
    <!-- render-conditional that MUST survive AND now coexists with parsed TS -->
    <div v-if="ready">Pronto</div>
    <div v-else>Carregando…</div>
  </div>
</template>

<script lang="ts">
// Deliberately TS with TYPE ANNOTATIONS: acorn THREW on these (its scripts were
// skipped + flagged). With @babel/parser (typescript plugin) they now parse, so
// the router-guard + vee-validate rule below ARE captured — the exact
// under-count this fix closes.
import { defineRule, useField } from "vee-validate";
import router from "../router";
import type { Router, RouteLocationNormalized, NavigationGuardNext } from "vue-router";

interface FormState {
  ready: boolean;
  area: number;
}

const state: FormState = { ready: false, area: 0 };

// vee-validate validation-rule on a TS script — typed value param.
defineRule("readyArea", (value: number): boolean | string => {
  if (value <= 100) {
    return true;
  }
  return "Área não pode exceder 100 hectares";
});

const readyField = useField<boolean>("ready", { required: true });

// router-guard on a TS script — fully typed guard signature + typed if-test.
const typedRouter: Router = router;
typedRouter.beforeEach(
  (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext): void => {
    if (to.meta.requiresReady && !state.ready) {
      next("/loading");
    } else {
      next();
    }
  },
);
</script>
