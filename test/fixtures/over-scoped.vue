<script setup>
import { ref } from 'vue'

const title = ref('Hello')
const isExpanded = ref(false)
const detailText = ref('lorem ipsum')
function toggle() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <article>
    <h1>{{ title }}</h1>
    <details>
      <summary @click="toggle">{{ isExpanded ? 'Hide' : 'Show' }}</summary>
      <p>{{ detailText }}</p>
    </details>
    <footer>{{ title }}</footer>
  </article>
</template>
