<template>
  <div>
    <!-- a render-conditional that MUST still be emitted even when the script
         below is unparseable — proves template branches survive the backstop -->
    <div v-if="visible">Visível</div>
    <div v-else>Oculto</div>
  </div>
</template>

<script>
// Genuinely MALFORMED — neither acorn nor @babel/parser can parse this. The
// enumerator must CATCH, still emit the template branches above, and record this
// file in `unparsedScripts` (the completeness BACKSTOP; S3's gate goes RED).
const broken = {{{ this is not valid javascript or typescript @@@ ;
function ((() => {
</script>
