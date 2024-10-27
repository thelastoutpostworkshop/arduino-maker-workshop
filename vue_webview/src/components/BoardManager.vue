<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage, BoardConfiguration, Metadata, Release } from '@shared/messages';
import { onMounted, watch, computed, ref } from 'vue';

const vsCodeStore = useVsCodeStore();
const boardSelect = ref<(BoardConfiguration | null)[]>([]); // Updated to track selected boards for each platform
const boardSelectBefore = ref<(BoardConfiguration | null)[]>([]);
const selectedPlatform = ref<Record<string, PlatformOutdated>>({});

interface PlatformOutdated {
  version: string;
  platformId: string;
}

onMounted(() => {
  vsCodeStore.outdated = null;
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

const releases = (platformId: string): PlatformOutdated[] => {
  const release = vsCodeStore.outdated?.platforms.find((platform) => platform.id === platformId);

  if (release) {
    console.log(release);
    const rel = Object.entries(release)
      .reverse() // Reverse the entries without sorting
      .map(([version]) => ({
        version,          // Add version key
        platformId        // Add platformId to each object
      }));
    return rel;
  } else {
    return [];
  }
};

// Computed property for grouping boards by platform and filtering only installed boards
const boardStructure = computed<{ [platform: string]: { metadata: Metadata; name: string; boards: { name: string, fqbn: string }[] } }>(() => {
  const boards = vsCodeStore.boards?.boards ?? [];

  // Initialize an empty object to hold the structured board data with metadata
  const boardStructure: { [platformID: string]: { metadata: Metadata; name: string; boards: { name: string, fqbn: string }[] } } = {};
  const uniqueFqbnSet = new Set<string>();

  boards.forEach((board) => {

    const platformName = board.platform.release.name;
    const plateformID = board.platform.metadata.id;

    // Initialize the platform in the structure if it doesn't exist, and add metadata
    if (!boardStructure[plateformID]) {
      boardStructure[plateformID] = {
        metadata: board.platform.metadata,
        name: platformName,
        boards: []
      };
    }

    // Loop through each board under this platform
    board.platform.release.boards.forEach((boardInfo: any) => {
      const { name, fqbn } = boardInfo;

      // Only add if the fqbn is not a duplicate
      if (!uniqueFqbnSet.has(fqbn)) {
        uniqueFqbnSet.add(fqbn);
        boardStructure[plateformID].boards.push({ name, fqbn });
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
        Boards Available:
        <v-card v-for="(platformData) in boardStructure" :key="platformData.metadata.id" :title="platformData.name"
          :subtitle="'by ' + platformData.metadata.maintainer" color="blue-grey-darken-4">
          <v-card-text>
            <!-- <v-btn @click="updatePlatformVersion(platform.id)" class="mb-2" size="small"
              append-icon="mdi-arrow-down">Install version selected</v-btn> -->
            <v-select v-if="vsCodeStore.outdated?.platforms.length" v-model="selectedPlatform[platformData.metadata.id]"
              :items="releases(platformData.metadata.id)" item-title="version" item-value="version" return-object
              density="compact">
            </v-select>
          </v-card-text>
        </v-card>
        <v-expansion-panels multiple>
          <v-expansion-panel v-for="(platformData) in boardStructure" :key="platformData.metadata.id">
            <v-expansion-panel-title>{{ platformData.name }} by {{ platformData.metadata.maintainer
              }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <span class="text-subtitle-2">
                <a :href="platformData.metadata.website" target="_blank">Go to Web Site</a><br />
              </span>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
    </v-responsive>
  </v-container>
</template>
