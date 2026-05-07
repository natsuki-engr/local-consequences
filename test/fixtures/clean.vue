<script setup>
import { ref, computed } from 'vue'

const count = ref(0)
const doubled = computed(() => count.value * 2)
function increment() {
  count.value += 1
}
</script>

<template>
  <div>
    <p>{{ count }} (x2 = {{ doubled }})</p>
    <button @click="increment">+1</button>
    <footer>{{ count }} clicks so far.</footer>
  </div>
</template>
