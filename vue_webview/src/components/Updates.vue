<script setup lang="ts">
import { computed } from 'vue';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';

const vsCodeStore = useVsCodeStore();
const inDevelopment = computed(() => import.meta.env.DEV);

function sendTestMessage() {
  const message: WebviewToExtensionMessage = {
    command: ARDUINO_MESSAGES.OUTDATED,
    errorMessage: "",
    payload: import.meta.env.VITE_OUTDATED_TEST
  }
  vsCodeStore.simulateMessage(message);
}

</script>

<template>
    <v-container>
      <v-responsive>
        <div class="text-center">
          <h1 class="text-h4 font-weight-bold">Updates for platforms and libraries</h1>
        </div>
        <div v-if="inDevelopment">
          <v-btn @click="sendTestMessage()">Send Test Message</v-btn>
        </div>
        <v-expansion-panels multiple>
        <v-expansion-panel>
          <v-expansion-panel-title>Platform updates</v-expansion-panel-title>
          <v-expansion-panel-text>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel>
          <v-expansion-panel-title>Library updates</v-expansion-panel-title>
          <v-expansion-panel-text>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
       </v-responsive>
    </v-container>
  </template>