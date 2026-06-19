<template>
  <div class="ep-form">
    <!-- element-plus validation on the HTML path: an el-form with a :rules ref -->
    <el-form :rules="formRules" :model="form">
      <!-- element-plus validation: a form-item with a static prop -->
      <el-form-item prop="nome" label="Nome">
        <input v-model="form.nome" />
      </el-form-item>

      <!-- element-plus validation: a form-item with a bound :prop -->
      <el-form-item :prop="dynamicProp">
        <input v-model="form.email" />
      </el-form-item>

      <!-- a render-conditional so the HTML walk still emits non-validation kinds -->
      <section v-if="form.nome">
        <p>Olá</p>
      </section>
    </el-form>
  </div>
</template>

<script>
export default {
  name: "ElementPlusForm",
  data() {
    return {
      dynamicProp: "email",
      form: { nome: "", email: "" },
      formRules: {
        nome: [{ required: true, message: "Informe o nome" }],
        email: [{ required: true, message: "Informe o e-mail" }],
      },
    };
  },
};
</script>
