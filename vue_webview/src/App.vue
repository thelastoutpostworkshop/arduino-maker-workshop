<script setup lang="ts">
import Toolbox from './components/Toolbox.vue';
import { onMounted, onUnmounted } from 'vue';
import { useVsCodeStore } from './stores/useVsCodeStore';

const vsCodeStore = useVsCodeStore();

function handleMessageFromVsCode(event: MessageEvent) {
  const message = event.data; // The message sent from the extension

  // Use the store action to handle the message
  if (import.meta.env.DEV) {
    vsCodeStore.mockMessage(message);
  } else {
    vsCodeStore.handleMessage(message);
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessageFromVsCode);
});

onUnmounted(() => {
  window.removeEventListener('message', handleMessageFromVsCode);
});

</script>

<template>
  <v-app>
    <Toolbox></Toolbox>
    <v-main>
      <router-view></router-view>
    </v-main>
  </v-app>
</template>
