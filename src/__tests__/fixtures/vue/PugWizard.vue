<template lang="pug">
  div.wizard
    el-form(:rules="formRules" :model="form")
      //- select-branch: kind drives the RURAL / URBANO path
      el-select(v-model="form.tipo")
        el-option(label="Rural" value="RURAL")
        el-option(label="Urbano" value="URBANO")

      //- select-branch: a radio group whose value also gates the wizard
      el-radio-group(v-model="form.modo")
        el-radio(label="SIMPLES")
        el-radio(label="COMPLETO")

      //- element-plus validation: a form-item with a bound prop
      el-form-item(prop="area" label="Área (ha)")
        input(v-model.number="form.area")

      //- render-conditional: RURAL / URBANO branch
      section(v-if="form.tipo === 'RURAL'")
        //- render-conditional: 100ha threshold (pug-only marker: pugAreaAcima100)
        span(v-show="form.area <= 100") Pequena propriedade
        span(v-if="form.pugAreaAcima100") Grande propriedade — análise especial
      section(v-else-if="form.tipo === 'URBANO'")
        input(v-model="form.lote")
      section(v-else)
        p Selecione o tipo
</template>

<script>
export default {
  name: "PugWizard",
  data() {
    return {
      form: { tipo: "", modo: "SIMPLES", area: 0, lote: "" },
      formRules: {
        area: [{ required: true, message: "Informe a área" }],
      },
    };
  },
};
</script>
