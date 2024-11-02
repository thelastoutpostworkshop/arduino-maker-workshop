<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, Platform } from '@shared/messages';
import { onMounted, watch, computed, ref } from 'vue';

enum FilterLibraries {
  installed,
  updatable,
  deprecated,
  not_installed
}
const store = useVsCodeStore();
const filterLibraries = ref(FilterLibraries.installed);
const selectedLibrary = ref<Record<string, string>>({});
const updatableCount = ref(0);

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.LIBRARY_SEARCH, errorMessage: "", payload: "" });
});

watch(
  () => store.libraries,
  (newConfig) => {
    if (newConfig) {
      store.libraries?.libraries.forEach((library) => {
        selectedLibrary.value[library.name] = library.name;
      })
      // updatableCount.value = filterPlatforms(FilterLibraries.updatable).length;
    }
  },
  { immediate: true }
);

function updatePlatformVersion(platformID: string) {
  const toInstall = selectedLibrary.value[platformID];
  const version = `${platformID}@${toInstall}`;
  vscode.postMessage({ command: ARDUINO_MESSAGES.INSTALL_CORE_VERSION, errorMessage: "", payload: version });
  store.boardUpdating = version;
}

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

const filteredLibraries = computed(() => {
  return filterLibs(filterLibraries.value);
})

function filterLibs(filter: FilterLibraries): any {
  let filtered;
  switch (filter) {
    case FilterLibraries.installed:
      // filtered = store.platform?.platforms.filter((platform) => {
      //   return isPlatformInstalled(platform) && !isPlatformUpdatable(platform);
      // })
      filtered = store.libraries?.libraries;
      break;
    case FilterLibraries.updatable:
      filtered = store.platform?.platforms.filter((platform) => {
        return isPlatformUpdatable(platform) && isPlatformInstalled(platform);
      })
      break;
    case FilterLibraries.deprecated:
      filtered = store.platform?.platforms.filter((platform) => {
        return isPlatformDepracated(platform);
      })
      break;
    case FilterLibraries.not_installed:
      filtered = store.platform?.platforms.filter((platform) => {
        return !isPlatformInstalled(platform) && !isPlatformDepracated(platform);
      })
      break;
    default:
      filtered = store.platform?.platforms;
      break;
  }
  return filtered || [];
}

// const platformName = (platform_id: string): string => {
//   const p = store.platform?.platforms.find((platform) => platform.id === platform_id);
//   if (!p || !p.releases) {
//     return 'Unknown';
//   }

//   const relEntries = Object.entries(p.releases).reverse();
//   const name = relEntries[0]?.[1]?.name || 'Unknown';
//   return name;
// };

function sendTestMessage() {
  store.simulateMessage({
    command: ARDUINO_MESSAGES.LIBRARY_SEARCH,
    errorMessage: "",
    payload: import.meta.env.VITE_LIBRARY_SEARCH_TEST
  });
}

const inDevelopment = computed(() => import.meta.env.DEV);
</script>

<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Library Manager</h1>
      </div>
      <div v-if="inDevelopment">
        <v-btn @click="sendTestMessage()">Send Test Message</v-btn>
      </div>
      <div v-if="!store.libraries?.libraries">
        Loading Libraries
        <v-progress-circular :size="25" color="grey" indeterminate></v-progress-circular>
      </div>
      <div v-else-if="!store.libraryUpdating">
        <v-chip-group selected-class="text-primary" mandatory v-model="filterLibraries">
          <v-chip filter :value="FilterLibraries.installed">Installed & Up to date</v-chip>
          <v-chip :disabled="updatableCount == 0" filter :value="FilterLibraries.updatable">Updatable
            <v-badge v-if="updatableCount > 0" color="green" :content="updatableCount" inline>

            </v-badge>
          </v-chip>
          <v-chip filter :value="FilterLibraries.not_installed">Not Installed</v-chip>
          <v-chip filter :value="FilterLibraries.deprecated">Deprecated</v-chip>
        </v-chip-group>
        <v-card v-for="(library,index) in filteredLibraries" :key="index" color="blue-grey-darken-4" class="mb-5 mt-5">
          <v-card-title>
            {{ library.name }}
            <span class="text-subtitle-2 pl-5"> <a :href="library.website" target="_blank">Info</a></span>
          </v-card-title>
          <v-card-subtitle>
            {{ "by " + library.maintainer }}
            <span>
              {{ library.installed_version }} installed
            </span>
            <span class="text-green font-weight-bold">
              ({{ library.latest_version }} is the newest)
            </span>
          </v-card-subtitle>
          <v-card-text>
            <v-row>
              <v-col>
                <v-select v-if="library.releases" v-model="selectedLibrary[library.id]" :items="releases(library)"
                  item-title="version" item-value="version" return-object density="compact">
                </v-select>
              </v-col>
              <v-col v-if="!isPlatformInstalled(library)">
                <v-btn>Install</v-btn>
              </v-col>
              <v-col v-if="isPlatformInstalled(library) && !isPlatformUpdatable(library)">
                <v-btn @click="updatePlatformVersion(library.id)"
                  :disabled="selectedLibrary[library.id] === library.latest_version">Install older
                  version</v-btn>
              </v-col>
              <v-col v-if="isPlatformUpdatable(library) && isPlatformInstalled(library)">
                <v-btn @click="updatePlatformVersion(library.id)"
                  v-if="selectedLibrary[library.id] === library.latest_version">Update</v-btn>
                <v-btn @click="updatePlatformVersion(library.id)"
                  v-if="(selectedLibrary[library.id] !== library.latest_version) && (selectedLibrary[library.id] !== library.installed_version)">Install
                  older version</v-btn>
                <span v-else-if="selectedLibrary[library.id] === library.installed_version">(this version is
                  currently
                  installed)</span>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </div>
      <div v-else>
        Installing board, please wait
        <v-progress-linear  color="grey" indeterminate></v-progress-linear >
      </div>
    </v-responsive>
  </v-container>
</template>
