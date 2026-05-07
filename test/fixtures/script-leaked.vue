<script setup>
import { ref, watch } from 'vue'

const query = ref('')
const results = ref([])

watch(query, async (q) => {
  results.value = await fetch('/api/search?q=' + q).then((r) => r.json())
})
</script>

<template>
  <section class="search">
    <input v-model="query" />
    <ul>
      <li v-for="r in results" :key="r.id">{{ r.label }}</li>
    </ul>
  </section>
</template>
