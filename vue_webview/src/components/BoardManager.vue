<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, BoardConfiguration, Platform } from '@shared/messages';
import { onMounted, watch, computed, ref } from 'vue';

enum FilterBoards {
  installed,
  updatable,
  deprecated,
  all
}
const store = useVsCodeStore();
const boardSelect = ref<(BoardConfiguration | null)[]>([]); // Updated to track selected boards for each platform
const boardSelectBefore = ref<(BoardConfiguration | null)[]>([]);
const filterBoards = ref(FilterBoards.installed);

watch(
  filterBoards,
  (newValue) => {
    console.log(newValue);
  },
);

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

function isPlatformInstalled(platform: Platform): boolean {
  return platform.installed_version.trim().length !== 0
}

function isPlatformUpdatable(platform: Platform): boolean {
  return platform.installed_version !== platform.latest_version
}

function isPlatformDepracated(platform: Platform): boolean {
  return platform.deprecated || false;
}

const filteredPlatforms = computed(() => {
  let filtered;
  switch (filterBoards.value) {
    case FilterBoards.installed:
      filtered = store.platform?.platforms.filter((platform) => {
        return isPlatformInstalled(platform);
      })
      break;
    case FilterBoards.updatable:
      filtered = store.platform?.platforms.filter((platform) => {
        return isPlatformUpdatable(platform) && isPlatformInstalled(platform);
      })
      break;
    case FilterBoards.deprecated:
      filtered = store.platform?.platforms.filter((platform) => {
        return isPlatformDepracated(platform);
      })
      break;
    default:
      filtered = store.platform?.platforms;
      break;
  }
  return filtered;
})

const platformName = (platform_id: string): string => {
  const p = store.platform?.platforms.find((platform) => platform.id === platform_id);
  if (!p || !p.releases) {
    return 'Unknown';
  }

  const relEntries = Object.entries(p.releases).reverse(); // Array of [version, Release] pairs
  const name = relEntries[0]?.[1]?.name || 'Unknown'; // Access the name from the first release entry
  return name;
};

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
        <v-chip-group selected-class="text-primary" mandatory v-model="filterBoards">
          <v-chip filter :value="FilterBoards.installed">Installed</v-chip>
          <v-chip filter :value="FilterBoards.updatable">Updatable</v-chip>
          <v-chip filter :value="FilterBoards.deprecated">Deprecated</v-chip>
          <v-chip filter :value="FilterBoards.all">All</v-chip>
        </v-chip-group>
        <v-card v-for="(platform) in filteredPlatforms" :key="platform.id" color="blue-grey-darken-4" class="mb-5 mt-5">
          <v-card-title>
            {{ platformName(platform.id) }}
          </v-card-title>
          <v-card-subtitle>
            {{ "by " + platform.maintainer }}
            <span class="text-blue">
              {{ platform.installed_version }} installed
            </span>
            <span class="text-green font-weight-bold">
              ({{ platform.latest_version }} is the newest)
            </span>
            <a :href="platform.website" target="_blank">Go to Web Site</a><br />
          </v-card-subtitle>
          <v-card-action>

          </v-card-action>
          <v-card-text>
            <!-- <v-btn @click="updatePlatformVersion(platform.id)" class="mb-2" size="small"
              append-icon="mdi-arrow-down">Install version selected</v-btn> -->
            <!-- <v-select v-if="store.outdated?.platforms.length" v-model="selectedPlatform[platformData.metadata.id]"
              :items="releases(platformData.metadata.id)" item-title="version" item-value="version" return-object
              density="compact">
            </v-select> -->
            <span class="text-blue">
              {{ platform.installed_version }} installed
            </span>
            <span class="text-green font-weight-bold">
              ({{ platform.latest_version }} is the newest)
            </span>
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
