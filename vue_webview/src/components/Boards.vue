<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage } from '@shared/messages';
import { onMounted, watch, computed } from 'vue';

const vsCodeStore = useVsCodeStore();

// Send a message to request the boards list when the component is mounted
onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.BOARDS_LIST_ALL, errorMessage: "", payload: "" });
});

// Watch for changes in boards data and update accordingly
watch([() => vsCodeStore.boards], () => { }, { immediate: true });

// Compute the board structure from the store
const boardStructure = computed(() => vsCodeStore.boards?.boardStructure || {});

function onBoardSelect(value: string) {
  console.log("Selected Board FQBN:", value);
}

function sendTestMessage() {
  const message:WebviewToExtensionMessage = {
    command:ARDUINO_MESSAGES.BOARDS_LIST_ALL,
    errorMessage:"",
    payload:import.meta.env.VITE_BOARDS_LISTALL_TEST
  }
  vsCodeStore.simulateMessage(message);
}

const inDevelopment = computed(() => import.meta.env.DEV);

</script>

<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Boards</h1>
      </div>
      <div v-if="inDevelopment">
        <v-btn @click="sendTestMessage()">Send Test Message</v-btn>
      </div>
      <v-text-field label="Current Board:" :model-value="vsCodeStore.boardConfiguration?.boardName" readonly>
        <template v-slot:loader>
          <v-progress-linear :active="!vsCodeStore.boardConfiguration?.boardName" height="2" indeterminate></v-progress-linear>
        </template>
      </v-text-field>

      <v-expansion-panels multiple>
        <!-- Loop over each platform in the board structure -->
        <v-expansion-panel v-for="(boards, platform) in boardStructure" :key="platform">
          <v-expansion-panel-title>{{ platform }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <!-- Autocomplete for selecting a board -->
            <v-autocomplete
              :items="boards"
              item-title="name"
              item-value="fqbn"
              label="Select a Board"
              @change="onBoardSelect"
              outlined
              dense
              return-object
            ></v-autocomplete>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-responsive>
  </v-container>
</template>
