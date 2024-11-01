<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, Platform } from '@shared/messages';
import { onMounted, watch, computed, ref } from 'vue';

enum FilterBoards {
  installed,
  updatable,
  deprecated,
  not_installed
}
const store = useVsCodeStore();
const filterBoards = ref(FilterBoards.installed);
const selectedPlatform = ref<Record<string, string>>({});

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.CORE_SEARCH, errorMessage: "", payload: "" });
});

watch(
  () => store.platform,
  (newConfig) => {
    if (newConfig) {
      store.platform?.platforms.forEach((platform) => {
        selectedPlatform.value[platform.id] = platform.latest_version;
      })
    }
  },
  { immediate: true }
);

function releases(platform: Platform): string[] {
  const relEntries = Object.entries(platform.releases)
    .reverse()
    .map(([version]) => version); // Map to only the version string
  return relEntries;
}

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
        return isPlatformInstalled(platform) && !isPlatformUpdatable(platform);
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
    case FilterBoards.not_installed:
      filtered = store.platform?.platforms.filter((platform) => {
        return !isPlatformInstalled(platform) && !isPlatformDepracated(platform);
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

  const relEntries = Object.entries(p.releases).reverse(); 
  const name = relEntries[0]?.[1]?.name || 'Unknown'; 
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
          <v-chip filter :value="FilterBoards.installed">Installed & Up to date</v-chip>
          <v-chip filter :value="FilterBoards.updatable">Updatable</v-chip>
          <v-chip filter :value="FilterBoards.not_installed">Not Installed</v-chip>
          <v-chip filter :value="FilterBoards.deprecated">Deprecated</v-chip>
        </v-chip-group>
        <v-card v-for="(platform) in filteredPlatforms" :key="platform.id" color="blue-grey-darken-4" class="mb-5 mt-5">
          <v-card-title>
            {{ platformName(platform.id) }}
          </v-card-title>
          <v-card-subtitle>
            {{ "by " + platform.maintainer }}
            <span>
              {{ platform.installed_version }} installed
            </span>
            <span class="text-green font-weight-bold">
              ({{ platform.latest_version }} is the newest)
            </span>
            <a :href="platform.website" target="_blank">Go to Web Site</a><br />
          </v-card-subtitle>
          <v-card-text>
            <!-- <v-btn @click="updatePlatformVersion(platform.id)" class="mb-2" size="small"
            append-icon="mdi-arrow-down">Install version selected</v-btn> -->
            <v-row>
              <v-col>
                <v-select v-if="platform.releases" v-model="selectedPlatform[platform.id]" :items="releases(platform)"
                  item-title="version" item-value="version" return-object density="compact">
                </v-select>
              </v-col>
              <v-col v-if="!isPlatformInstalled(platform)">
                <v-btn>Install</v-btn>
              </v-col>
              <v-col v-if="isPlatformInstalled(platform) && !isPlatformUpdatable(platform)">
                <!-- <v-btn :disabled="selectedPlatform[platform.id] !== platform.latest_version">Update</v-btn> -->
                <v-btn :disabled="selectedPlatform[platform.id] === platform.latest_version">Install older
                  version</v-btn>
              </v-col>
              <v-col v-if="isPlatformUpdatable(platform) && isPlatformInstalled(platform)">
                <!-- <v-btn :disabled="selectedPlatform[platform.id] !== platform.latest_version">Update</v-btn> -->
                <v-btn v-if="selectedPlatform[platform.id] === platform.latest_version">Update</v-btn>
                <v-btn
                  v-if="(selectedPlatform[platform.id] !== platform.latest_version) && (selectedPlatform[platform.id] !== platform.installed_version)">Install
                  older version</v-btn>
                <span v-else-if="selectedPlatform[platform.id] === platform.installed_version">(this version is
                  currently
                  installed)</span>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </div>
    </v-responsive>
  </v-container>
</template>
