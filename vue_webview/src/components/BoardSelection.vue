<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage, BoardConfiguration } from '@shared/messages';
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

// const boardStructure = computed<BoardList[]>(() => {
//   const boards = vsCodeStore.boards?.boards ?? [];
//   // Filter only boards that are installed
//   return boards.filter(board => board.platform?.release?.installed);
// });

const boardStructure = computed<{ [platform: string]: { name: string, fqbn: string }[] }>(() => {
  const boards = vsCodeStore.boards?.boards ?? [];
  
  // Initialize an empty object to hold the structured board data
  const boardStructure: { [platform: string]: { name: string, fqbn: string }[] } = {};
  const uniqueFqbnSet = new Set<string>();

  boards.forEach((board) => {
    // Filter out boards that are not installed
    if (!board.platform?.release?.installed) {
      return;
    }

    const platformName = board.platform.release.name;

    // Initialize the platform in the structure if it doesn't exist
    if (!boardStructure[platformName]) {
      boardStructure[platformName] = [];
    }

    // Loop through each board under this platform
    board.platform.release.boards.forEach((boardInfo: any) => {
      const { name, fqbn } = boardInfo;

      // Only add if the fqbn is not a duplicate
      if (!uniqueFqbnSet.has(fqbn)) {
        uniqueFqbnSet.add(fqbn);
        boardStructure[platformName].push({ name, fqbn });
      }
    });
  });

  return boardStructure;
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
      <v-text-field label="Current Board:" :model-value="vsCodeStore.boardConfiguration?.boardConfiguration?.name" readonly>
        <template v-slot:loader>
          <v-progress-linear :active="!vsCodeStore.boardConfiguration?.boardConfiguration?.name" height="2" indeterminate></v-progress-linear>
        </template>
      </v-text-field>
      <div v-if="Object.keys(boardStructure).length === 0">
        Loading Boards
        <v-progress-circular :size="25" color="grey" indeterminate></v-progress-circular>
      </div>
      <div v-else>
        Choose a board from the platforms:
        <v-expansion-panels multiple>
          <v-expansion-panel
            v-for="(boards, platform) in boardStructure"
            :key="platform"
          >
            <v-expansion-panel-title>{{ platform }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-autocomplete
                :items="boards"
                item-title="name"
                item-value="fqbn"
                label="Select a Board"
                outlined
                dense
                return-object
              ></v-autocomplete>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
    </v-responsive>
  </v-container>
</template>
