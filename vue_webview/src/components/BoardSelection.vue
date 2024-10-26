<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage, BoardConfiguration, BoardList } from '@shared/messages';
import { onMounted, watch, computed, ref } from 'vue';

const vsCodeStore = useVsCodeStore();
const boardSelect = ref<BoardConfiguration[]>([]);
const boardSelectBefore = ref<BoardConfiguration[]>([])

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.BOARDS_LIST_ALL, errorMessage: "", payload: "" });
});


// watch([() => vsCodeStore.boards?.boards], () => { }, { immediate: true });

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

const boardStructure = computed<BoardList[]>(() => {
  const boards = vsCodeStore.boards?.boards ?? [];
  // Filter only boards that are installed
  return boards.filter(board => board.platform?.release?.installed);
});


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
      <v-text-field label="Current Board:" :model-value="vsCodeStore.boardConfiguration?.boardConfiguration?.name"
        readonly>
        <template v-slot:loader>
          <v-progress-linear :active="!vsCodeStore.boardConfiguration?.boardConfiguration?.name" height="2"
            indeterminate></v-progress-linear>
        </template>
      </v-text-field>
      <div v-if="boardStructure.length == 0">
        Loading Boards
        <v-progress-circular :size="25" color="grey" indeterminate></v-progress-circular>
      </div>
      <div v-else>
        Choose a board from the platforms:
        <v-expansion-panels multiple>
          <v-expansion-panel v-for="(board) in boardStructure" :key="board.fqbn">
            <v-expansion-panel-title>{{ board.name }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-autocomplete  :items="board.platform.release.boards" item-title="name" item-value="fqbn"
                label="Select a Board" outlined dense return-object></v-autocomplete>
              <!-- <v-autocomplete v-model="boardSelect[index]" :items="board.platform.release.boards" item-title="name" item-value="fqbn"
                label="Select a Board" outlined dense return-object></v-autocomplete> -->
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
    </v-responsive>
  </v-container>
</template>
