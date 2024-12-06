<script setup lang="ts">
import Toolbox from './components/Toolbox.vue';
import { onMounted, onUnmounted } from 'vue';
import { useVsCodeStore } from './stores/useVsCodeStore';
import Theme from './components/Theme.vue';
import { ARDUINO_MESSAGES, THEME_COLOR } from '@shared/messages';

const store = useVsCodeStore();

function handleMessageFromVsCode(event: MessageEvent) {
  const message = event.data; // The message sent from the extension

  // Use the store action to handle the message
  if (import.meta.env.DEV) {
    store.mockMessage(message);
  } else {
    store.handleMessage(message);
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessageFromVsCode);
  if (import.meta.env.DEV) {
    store.sendMessage({ command: ARDUINO_MESSAGES.CHANGE_THEME_COLOR, errorMessage: "", payload: THEME_COLOR.dark });
  }
});

onUnmounted(() => {
  window.removeEventListener('message', handleMessageFromVsCode);
});

</script>

<template>
  <Theme></Theme>
  <v-app v-if="store.currentTheme">
    <Toolbox></Toolbox>
    <v-main>
      <router-view></router-view>
    </v-main>
  </v-app>
</template>
