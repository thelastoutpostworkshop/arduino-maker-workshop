<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage,BoardConfiguration } from '@shared/messages';
import { onMounted, watch, computed, ref } from 'vue';

const vsCodeStore = useVsCodeStore();
const boardSelect = ref<BoardConfiguration[]>([]);
const boardSelectBefore = ref<BoardConfiguration[]>([])

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.BOARDS_LIST_ALL, errorMessage: "", payload: "" });
});


watch([() => vsCodeStore.boards], () => { }, { immediate: true });

watch(
  boardSelect, (newValue) => {
    newValue.forEach((newVal, index) => {
      if (newVal !== boardSelectBefore.value[index]) {
        vscode.postMessage({ command: ARDUINO_MESSAGES.SET_BOARD, errorMessage: "", payload: newVal.fqbn })
        boardSelectBefore.value = { ...boardSelect.value };
        vsCodeStore.boardConfiguration = null;
      }
    });
  }, { deep: true }
);

const boardStructure = computed(() => vsCodeStore.boards?.boardStructure || undefined);

function sendTestMessage() {
  const message: WebviewToExtensionMessage = {
    command: ARDUINO_MESSAGES.BOARDS_LIST_ALL,
    errorMessage: "",
    payload: import.meta.env.VITE_BOARDS_LISTALL_TEST
  }
  vsCodeStore.simulateMessage(message);
}

const inDevelopment = computed(() => import.meta.env.DEV);

</script>

<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Boards Available</h1>
      </div>
      <div v-if="inDevelopment">
        <v-btn @click="sendTestMessage()">Send Test Message</v-btn>
      </div>
      <v-text-field label="Current Board:" :model-value="vsCodeStore.boardConfiguration?.boardConfiguration?.name" readonly>
        <template v-slot:loader>
          <v-progress-linear :active="!vsCodeStore.boardConfiguration?.boardConfiguration?.name" height="2"
            indeterminate></v-progress-linear>
        </template>
      </v-text-field>
      <div v-if="boardStructure == undefined">
        Loading Boards
        <v-progress-circular :size="25" color="grey" indeterminate></v-progress-circular>
      </div>
      <div v-else>
        Choose a board from the platforms:
      </div>
      <v-expansion-panels multiple>
        <v-expansion-panel v-for="(boards, platform, index) in boardStructure" :key="platform">
          <v-expansion-panel-title>{{ platform }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-autocomplete v-model="boardSelect[index]" :items="boards" item-title="name" item-value="fqbn"
              label="Select a Board" outlined dense return-object></v-autocomplete>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-responsive>
  </v-container>
</template>
