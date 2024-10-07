<script setup lang="ts">
import Toolbox from './components/Toolbox.vue';
import { onMounted, onUnmounted } from 'vue';
import { vscode } from './utilities/vscode';
import { ARDUINO_MESSAGES } from '@shared/messages';
import { useVsCodeStore } from './stores/useVsCodeStore';

const vsCodeStore = useVsCodeStore();

function handleMessageFromVsCode(event: MessageEvent) {
  const message = event.data; // The message sent from the extension
  console.log('Received message:', message);

  // Use the store action to handle the message
  vsCodeStore.handleMessage(message);
}

if (!import.meta.env.DEV) {
  onMounted(() => {
    window.addEventListener('message', handleMessageFromVsCode);
    vscode.postMessage({ command: ARDUINO_MESSAGES.CLI_STATUS, errorMessage: "", payload: "" });
    vscode.postMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS, errorMessage: "", payload: "" });
  });

  onUnmounted(() => {
    window.removeEventListener('message', handleMessageFromVsCode);
  });
}
</script>

<template>
  <v-app>
    <Toolbox></Toolbox>
    <v-main>
      <router-view></router-view>
    </v-main>
  </v-app>
</template>
