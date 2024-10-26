<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage, BoardConfiguration } from '@shared/messages';
import { onMounted, watch, computed, ref } from 'vue';

const vsCodeStore = useVsCodeStore();
const boardSelect = ref<(BoardConfiguration | null)[]>([]); // Updated to track selected boards for each platform
const boardSelectBefore = ref<(BoardConfiguration | null)[]>([]);

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.BOARDS_LIST_ALL, errorMessage: "", payload: "" });
});

// Watch for changes in boardSelect
watch(
  boardSelect,
  (newValue) => {
    newValue.forEach((newVal, index) => {
      if (newVal && newVal !== boardSelectBefore.value[index]) {
        vscode.postMessage({ command: ARDUINO_MESSAGES.SET_BOARD, errorMessage: "", payload: newVal.fqbn });
        boardSelectBefore.value = [...boardSelect.value];
        vsCodeStore.boardConfiguration = null;
      }
    });
  },
  { deep: true }
);

// Computed property for grouping boards by platform and filtering only installed boards
const boardStructure = computed<{ [platform: string]: { name: string, fqbn: string }[] }>(() => {
  const boards = vsCodeStore.boards?.boards ?? [];

  // Initialize an empty object to hold the structured board data
  const boardStructure: { [platform: string]: { name: string, fqbn: string }[] } = {};
  const uniqueFqbnSet = new Set<string>();

  boards.forEach((board) => {

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

  // Ensure boardSelect is initialized properly for each platform
  const platformCount = Object.keys(boardStructure).length;
  boardSelect.value = Array(platformCount).fill(null);

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
        <h1 class="text-h4 font-weight-bold">Boards Manager</h1>
      </div>
      <div v-if="inDevelopment">
        <v-btn @click="sendTestMessage()">Send Test Message</v-btn>
      </div>
      <div v-if="Object.keys(boardStructure).length === 0">
        Loading Boards
        <v-progress-circular :size="25" color="grey" indeterminate></v-progress-circular>
      </div>
      <div v-else>
        Available Boards:
        <v-expansion-panels multiple>
          <v-expansion-panel
            v-for="(boards, platform, index) in boardStructure"
            :key="platform"
          >
            <v-expansion-panel-title>{{ platform }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-autocomplete
                v-model="boardSelect[index]"
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
