<script setup lang="ts">
import Toolbox from './components/Toolbox.vue';
import { onMounted, onUnmounted } from 'vue';
import { useVsCodeStore } from './stores/useVsCodeStore';
import Theme from './components/Theme.vue';
import DisconnectedView from './components/DisconnectedView.vue';
import { useExtensionConnection } from './composables/useExtensionConnection';
import { ARDUINO_MESSAGES, THEME_COLOR } from '@shared/messages';

const store = useVsCodeStore();
const { connectionState, handleConnectionMessage } = useExtensionConnection();

function handleMessageFromVsCode(event: MessageEvent) {
  const message = event.data; // The message sent from the extension

  if (handleConnectionMessage(message)) {
    return;
  }

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
    <DisconnectedView v-if="connectionState === 'disconnected'"></DisconnectedView>
    <template v-else-if="connectionState === 'connected'">
      <Toolbox></Toolbox>
      <v-main>
        <router-view></router-view>
      </v-main>
    </template>
    <v-main v-else class="d-flex align-center justify-center">
      <v-progress-circular indeterminate></v-progress-circular>
    </v-main>
  </v-app>
  <v-progress-linear v-else color="grey" indeterminate></v-progress-linear>
</template>
