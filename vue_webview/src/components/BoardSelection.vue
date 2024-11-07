<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, BoardConfiguration, Metadata } from '@shared/messages';
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
const boardStructure = computed<{ [platform: string]: { metadata: Metadata; boards: { name: string, fqbn: string }[] } }>(() => {
  const boards = vsCodeStore.boards?.boards ?? [];

  // Initialize an empty object to hold the structured board data with metadata
  const boardStructure: { [platform: string]: { metadata: Metadata; boards: { name: string, fqbn: string }[] } } = {};
  const uniqueFqbnSet = new Set<string>();

  boards.forEach((board) => {
    // Filter out boards that are not installed
    if (!board.platform?.release?.installed) {
      return;
    }

    const platformName = board.platform.release.name;

    // Initialize the platform in the structure if it doesn't exist, and add metadata
    if (!boardStructure[platformName]) {
      boardStructure[platformName] = {
        metadata: board.platform.metadata,
        boards: []
      };
    }

    // Loop through each board under this platform
    board.platform.release.boards.forEach((boardInfo: any) => {
      const { name, fqbn } = boardInfo;

      // Only add if the fqbn is not a duplicate
      if (!uniqueFqbnSet.has(fqbn)) {
        uniqueFqbnSet.add(fqbn);
        boardStructure[platformName].boards.push({ name, fqbn });
      }
    });
  });

  // Ensure boardSelect is initialized properly for each platform
  const platformCount = Object.keys(boardStructure).length;
  boardSelect.value = Array(platformCount).fill(null);

  return boardStructure;
});

</script>

<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Boards Available</h1>
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
        Choose a board from the platforms installed:
        <v-expansion-panels multiple>
          <v-expansion-panel
            v-for="(platformData, platform,index) in boardStructure"
            :key="platform"
          >
            <v-expansion-panel-title>{{ platform }} by {{ platformData.metadata.maintainer }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <span class="text-subtitle-2">
                <a :href="platformData.metadata.website" target="_blank">Go to Web Site</a><br />
              </span>
              <v-autocomplete class="pt-2"
                v-model="boardSelect[index]"
                :items="platformData.boards"
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

