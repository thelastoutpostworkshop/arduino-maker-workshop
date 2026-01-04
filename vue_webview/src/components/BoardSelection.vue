<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, BoardConfiguration, Metadata } from '@shared/messages';
import { onMounted, watch, computed, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter()
const store = useVsCodeStore();
const boardSelect = ref<(BoardConfiguration | null)[]>([]); // Updated to track selected boards for each platform
const boardSelectBefore = ref<(BoardConfiguration | null)[]>([]);

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_SEARCH, errorMessage: "", payload: "" });
});

// Watch for changes in boardSelect
watch(
  boardSelect,
  (newValue) => {
    newValue.forEach((newVal, index) => {
      if (newVal && newVal !== boardSelectBefore.value[index]) {
        store.sendMessage({ command: ARDUINO_MESSAGES.SET_BOARD, errorMessage: "", payload: newVal.fqbn });
        boardSelectBefore.value = [...boardSelect.value];
        store.boardOptions = null;
        store.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_OPTIONS, errorMessage: "", payload: '' })
        store.sendMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO, errorMessage: "", payload: '' })
      }
    });
  },
  { deep: true }
);

// Computed property for grouping boards by platform and filtering only installed boards
const boardStructure = computed<{ [platform: string]: { metadata: Metadata; boards: { name: string, fqbn: string }[] } }>(() => {
  const boards = store.boards?.boards ?? [];

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
      let { name, fqbn } = boardInfo;

      if (!name) {
        name = `${fqbn}`; // Some boards have no name in the object
      }

      // Only add if the fqbn is not a duplicate
      if (!uniqueFqbnSet.has(fqbn)) {
        uniqueFqbnSet.add(fqbn);
        boardStructure[platformName].boards.push({ name, fqbn });
      }
    });
    boardStructure[platformName].boards.sort((a, b) => a.name.localeCompare(b.name));
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
      <v-row align="center" class="mt-1 ml-5 mb-5">
        <v-icon>mdi-format-list-checks</v-icon>
        <span class="text-h4 font-weight-bold ml-5">Board Selection</span>
      </v-row>
      <v-text-field data-testid="board-selection-current-board" :label="!store.boardOptions?.name ? 'Select a board below' : 'Current Board:'"
        :model-value="store.boardOptions?.name" readonly>
        <template v-slot:loader>
          <v-progress-linear :active="!store.boardOptions?.name" height="2" indeterminate></v-progress-linear>
        </template>
      </v-text-field>
      <!-- <v-card v-if="Object.keys(boardStructure).length === 0" class="mt-5"> -->
      <v-card v-if="!store.boards" class="mt-5">
        <v-card-item title="Loading boards">
          <template v-slot:subtitle>
            Please wait
          </template>
        </v-card-item>
        <v-card-text class="py-0">
          <v-progress-linear color="grey" indeterminate></v-progress-linear>
        </v-card-text>
      </v-card>
      <div v-else-if="Object.keys(boardStructure).length > 0">
        <div class="font-weight-bold pl-3 pb-3 text-blue-grey-lighten-3">
          Choose a board from the platforms installed:
        </div>
        <v-expansion-panels multiple>
          <v-expansion-panel v-for="(platformData, platform, index) in boardStructure" :key="platform">
            <v-expansion-panel-title>{{ platform }} by {{ platformData.metadata.maintainer }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <span class="text-subtitle-2">
                <a :href="platformData.metadata.website" target="_blank">Go to Web Site</a><br />
              </span>
              <v-autocomplete class="pt-2" v-model="boardSelect[index]" :items="platformData.boards" item-title="name"
                item-value="fqbn" label="Select a Board" outlined dense return-object></v-autocomplete>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
      <div v-else>
        <v-btn @click="router.push({ name: 'board-manager' })">Install a board first</v-btn>
      </div>
    </v-responsive>
  </v-container>
</template>
