<template>
  <div class="wizard">
    <el-form :model="form">
      <!-- select-branch: tipo drives the RURAL/URBANO path -->
      <el-select v-model="form.tipo">
        <el-option label="Rural" value="RURAL" />
        <el-option label="Urbano" value="URBANO" />
      </el-select>

      <!-- select-branch: a radio whose value also gates the wizard -->
      <el-radio-group v-model="form.modo">
        <el-radio label="SIMPLES" />
        <el-radio label="COMPLETO" />
      </el-radio-group>

      <!-- render-conditional: RURAL / URBANO branch -->
      <section v-if="form.tipo === 'RURAL'">
        <label>Área (ha)</label>
        <input v-model.number="form.area" />
        <!-- render-conditional: 100ha threshold -->
        <span v-show="form.area <= 100">Pequena propriedade</span>
        <span v-if="form.area > 100">Grande propriedade — análise especial</span>
      </section>
      <section v-else-if="form.tipo === 'URBANO'">
        <input v-model="form.lote" />
      </section>
      <section v-else>
        <p>Selecione o tipo</p>
      </section>
    </el-form>
  </div>
</template>

<script>
import { defineRule, useField } from "vee-validate";
import router from "../router";

// vee-validate validation-rule: the 100ha threshold as a field rule
defineRule("maxArea", (value) => {
  if (value <= 100) {
    return true;
  }
  return "Área não pode exceder 100 hectares";
});

// vee-validate validation-rule: required tipo
const tipoField = useField("tipo", { required: true });

export default {
  name: "CadastroWizard",
  data() {
    return { form: { tipo: "", modo: "SIMPLES", area: 0, lote: "" } };
  },
  setup() {
    // router-guard: global beforeEach with conditional next()
    router.beforeEach((to, from, next) => {
      if (to.meta.requiresAuth && !store.isLoggedIn) {
        next("/login");
      } else {
        next();
      }
    });
    return { tipoField };
  },
};
</script>
