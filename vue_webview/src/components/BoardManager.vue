<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, BoardConfiguration, Metadata } from '@shared/messages';
import { onMounted, watch, computed, ref } from 'vue';

const store = useVsCodeStore();
const boardSelect = ref<(BoardConfiguration | null)[]>([]); // Updated to track selected boards for each platform
const boardSelectBefore = ref<(BoardConfiguration | null)[]>([]);

// interface PlatformOutdated {
//   version: string;
//   platformId: string;
// }

onMounted(() => {
  store.outdated = null;
  vscode.postMessage({ command: ARDUINO_MESSAGES.CORE_SEARCH, errorMessage: "", payload: "" });
  // vscode.postMessage({ command: ARDUINO_MESSAGES.BOARDS_LIST_ALL, errorMessage: "", payload: "" });
});

// Watch for changes in boardSelect
watch(
  boardSelect,
  (newValue) => {
    newValue.forEach((newVal, index) => {
      if (newVal && newVal !== boardSelectBefore.value[index]) {
        vscode.postMessage({ command: ARDUINO_MESSAGES.SET_BOARD, errorMessage: "", payload: newVal.fqbn });
        boardSelectBefore.value = [...boardSelect.value];
        store.boardConfiguration = null;
      }
    });
  },
  { deep: true }
);

// watch(
//   () => vsCodeStore.boards,
//   (newBoards) => {
//     if (newBoards?.boards) {
//       newBoards.boards.forEach((board) => {
//         if (inDevelopment) {
//           const message: WebviewToExtensionMessage = {
//             command: ARDUINO_MESSAGES.CORE_SEARCH,
//             errorMessage: "",
//             payload: import.meta.env.VITE_SEARCH_CORE_TEST
//           }
//           vsCodeStore.simulateMessage(message);
//         } else {
//           const platformId = board.platform.metadata.id;
//           vscode.postMessage({
//             command: ARDUINO_MESSAGES.CORE_SEARCH,
//             errorMessage: "",
//             payload: platformId,
//           });
//         }
//       });
//     }
//   },
//   { immediate: true }
// );

// const releases = (platformId: string): PlatformOutdated[] => {
//   const release = store.outdated?.platforms.find((platform) => platform.id === platformId);

//   if (release) {
//     console.log(release);
//     const rel = Object.entries(release)
//       .reverse() // Reverse the entries without sorting
//       .map(([version]) => ({
//         version,          // Add version key
//         platformId        // Add platformId to each object
//       }));
//     return rel;
//   } else {
//     return [];
//   }
// };


const platformName = (platform_id: string): string => {
  const p = store.platform?.platforms.find((platform) => platform.id === platform_id);
  if (!p || !p.releases) {
    return 'Unknown';
  }

  const relEntries = Object.entries(p.releases).reverse(); // Array of [version, Release] pairs
  const name = relEntries[0]?.[1]?.name || 'Unknown'; // Access the name from the first release entry
  return name;
};

// Computed property for grouping boards by platform and filtering only installed boards
// const boardStructure = computed<{ [platform: string]: { metadata: Metadata; name: string; boards: { name: string, fqbn: string }[] } }>(() => {
//   const boards = store.boards?.boards ?? [];

//   // Initialize an empty object to hold the structured board data with metadata
//   const boardStructure: { [platformID: string]: { metadata: Metadata; name: string; boards: { name: string, fqbn: string }[] } } = {};
//   const uniqueFqbnSet = new Set<string>();

//   boards.forEach((board) => {

//     const platformName = board.platform.release.name;
//     const plateformID = board.platform.metadata.id;

//     // Initialize the platform in the structure if it doesn't exist, and add metadata
//     if (!boardStructure[plateformID]) {
//       boardStructure[plateformID] = {
//         metadata: board.platform.metadata,
//         name: platformName,
//         boards: []
//       };
//     }

//     // Loop through each board under this platform
//     board.platform.release.boards.forEach((boardInfo: any) => {
//       const { name, fqbn } = boardInfo;

//       // Only add if the fqbn is not a duplicate
//       if (!uniqueFqbnSet.has(fqbn)) {
//         uniqueFqbnSet.add(fqbn);
//         boardStructure[plateformID].boards.push({ name, fqbn });
//       }
//     });
//   });

//   // Ensure boardSelect is initialized properly for each platform
//   const platformCount = Object.keys(boardStructure).length;
//   boardSelect.value = Array(platformCount).fill(null);

//   return boardStructure;
// });


function sendTestMessage() {
  store.simulateMessage({
    command: ARDUINO_MESSAGES.CORE_SEARCH,
    errorMessage: "",
    payload: import.meta.env.VITE_SEARCH_CORE_TEST
  });
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
      <div v-if="!store.platform?.platforms">
        Loading Boards
        <v-progress-circular :size="25" color="grey" indeterminate></v-progress-circular>
      </div>
      <div v-else>
        Boards Available:
        <v-card v-for="(platform) in store.platform.platforms" :key="platform.id" :title="platformName(platform.id)"
          :subtitle="'by ' + platform.maintainer" color="blue-grey-darken-4">
          <v-card-text>
            <!-- <v-btn @click="updatePlatformVersion(platform.id)" class="mb-2" size="small"
              append-icon="mdi-arrow-down">Install version selected</v-btn> -->
            <!-- <v-select v-if="store.outdated?.platforms.length" v-model="selectedPlatform[platformData.metadata.id]"
              :items="releases(platformData.metadata.id)" item-title="version" item-value="version" return-object
              density="compact">
            </v-select> -->
          </v-card-text>
        </v-card>
        <!-- <v-expansion-panels multiple>
          <v-expansion-panel v-for="(platformData) in boardStructure" :key="platformData.metadata.id">
            <v-expansion-panel-title>{{ platformData.name }} by {{ platformData.metadata.maintainer
              }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <span class="text-subtitle-2">
                <a :href="platformData.metadata.website" target="_blank">Go to Web Site</a><br />
              </span>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels> -->
      </div>
    </v-responsive>
  </v-container>
</template>
