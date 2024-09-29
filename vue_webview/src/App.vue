<script setup lang="ts">
import Toolbox from './components/Toolbox.vue';
import { onMounted, onUnmounted } from 'vue';
import { vscode } from './utilities/vscode';
import { MESSAGE_COMMANDS } from '@shared/messages';

function handleMessageFromVsCode(event: MessageEvent) {
  const message = event.data; // The message sent from the extension
  console.log('Received message:', message);

  // Handle the message based on its content
  switch (message.command) {
    case MESSAGE_COMMANDS.ARDUINO_PROJECT_INFO:
      break;
    case MESSAGE_COMMANDS.ARDUINO_PROJECT_STATUT:
      break;
    default:
      console.warn('Unknown command received from extension:', message.command);
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessageFromVsCode);
  vscode.postMessage({command:MESSAGE_COMMANDS.ARDUINO_PROJECT_STATUT,payload:"test"})
});

onUnmounted(() => {
  window.removeEventListener('message', handleMessageFromVsCode);
});

</script>

<template>
  <v-app>
    <Toolbox></Toolbox>
    <v-main>
      <HelloWorld />
    </v-main>
  </v-app>
</template>
