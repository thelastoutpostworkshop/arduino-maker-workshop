<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, InstalledLibrary, LibraryAvailable } from '@shared/messages';
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
const searchLibrary = ref('');

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.LIBRARY_SEARCH, errorMessage: "", payload: "" });
  vscode.postMessage({ command: ARDUINO_MESSAGES.LIBRARY_INSTALLED, errorMessage: "", payload: "" });
});

const headers = [
  { title: 'Name', value: 'name', key: 'name', sortable: true },
  { title: 'Version', value: 'latest.version', key: 'latest.version', sortable: false },
]

watch(
  () => store.libraries,
  (newConfig) => {
    if (newConfig) {
      store.libraries?.libraries.forEach((library) => {
        selectedLibrary.value[library.name] = library.latest.version;
      })
      // updatableCount.value = filterPlatforms(FilterLibraries.updatable).length;
    }
  },
  { immediate: true }
);

// function updatePlatformVersion(platformID: string) {
//   const toInstall = selectedLibrary.value[platformID];
//   const version = `${platformID}@${toInstall}`;
//   vscode.postMessage({ command: ARDUINO_MESSAGES.INSTALL_CORE_VERSION, errorMessage: "", payload: version });
//   store.boardUpdating = version;
// }

function isLibraryInstalled(library: LibraryAvailable): boolean {
  const installedLibrary = findLibrary(library.name);
  return installedLibrary !== undefined;
}

function isLibraryUpdatable(library: LibraryAvailable): boolean {
  const installedLibrary = findLibrary(library.name);
  return installedLibrary?.library.version !== library.latest.version
}

function isLibraryDeprecated(library: LibraryAvailable): boolean {
  const sentence = library.latest.sentence?.toLowerCase() ?? "";
  const paragraph = library.latest.paragraph?.toLowerCase() ?? "";
  return sentence.includes("deprecated") || paragraph.includes("deprecated");
}
// function installedVersion(library: LibraryAvailable): string {
//   const installedLibrary = findLibrary(library.name);
//   return installedLibrary?.library.version ?? '';
// }

function findLibrary(name: string): InstalledLibrary | undefined {
  const foundLibrary = store.librariesInstalled?.installed_libraries.find(
    (installedLibrary) => installedLibrary.library.name === name
  );
  return foundLibrary;
}

const filteredLibraries = computed(() => {
  return filterLibs(filterLibraries.value);
})

function filterLibs(filter: FilterLibraries): LibraryAvailable[] {
  let filtered: LibraryAvailable[] = [];
  switch (filter) {
    case FilterLibraries.installed:
      filtered = (store.libraries?.libraries ?? []).filter((library) => isLibraryInstalled(library) && !isLibraryUpdatable(library));
      break;
    case FilterLibraries.updatable:
      filtered = (store.libraries?.libraries ?? []).filter((library) => isLibraryInstalled(library) && isLibraryUpdatable(library));
      break;
    case FilterLibraries.deprecated:
      filtered = (store.libraries?.libraries ?? []).filter((library) => isLibraryDeprecated(library));
      break;
    case FilterLibraries.not_installed:
      filtered = (store.libraries?.libraries ?? []).filter((library) => !isLibraryInstalled(library) && !isLibraryDeprecated(library));
      break;
    default:
      filtered = store.libraries?.libraries ?? [];
      break;
  }
  // return filtered.sort((a, b) => a.name.localeCompare(b.name)) || [];
  return filtered || [];
}

function sendTestMessage() {
  store.simulateMessage({
    command: ARDUINO_MESSAGES.LIBRARY_SEARCH,
    errorMessage: "",
    payload: import.meta.env.VITE_LIBRARY_SEARCH_TEST
  });
  store.simulateMessage({
    command: ARDUINO_MESSAGES.LIBRARY_INSTALLED,
    errorMessage: "",
    payload: import.meta.env.VITE_LIBRARY_INSTALLED_TEST
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
        <v-card title="Libraries" flat>
          <template v-slot:text>
            <v-text-field v-model="searchLibrary" label="Search" prepend-inner-icon="mdi-magnify" variant="outlined"
              hide-details single-line></v-text-field>
          </template>
          <v-data-table :items="filteredLibraries" :headers="headers" density="compact" show-expand item-value="name"
            :sort-by="[{ key: 'name', order: 'asc' }]" :search="searchLibrary">
            <template v-slot:expanded-row="{ columns, item }">
              <tr>
                <td :colspan="columns.length" class="text-grey">
                  {{ "By " + item.latest.author }}
                  <div>
                    {{ item.latest.paragraph }}
                    <span class="text-subtitle-2"> <a :href="item.latest.website" target="_blank">More Info</a></span>
                  </div>
                </td>
              </tr>
            </template>
          </v-data-table>
        </v-card>
        <!-- <v-card v-for="(library, index) in filteredLibraries" :key="index" color="blue-grey-darken-4" class="mb-5 mt-5">
          <v-card-title>
            {{ library.name }}
            <span class="text-subtitle-2 pl-5"> <a :href="library.latest.website" target="_blank">Info</a></span>
          </v-card-title>
          <v-card-subtitle>
            {{ "by " + library.latest.author }}
            <span>
              {{ installedVersion(library) }} installed
            </span>
            <span class="text-green font-weight-bold">
              ({{ library.latest.version }} is the newest)
            </span>
          </v-card-subtitle>
          <v-card-text>
            {{ library.latest.paragraph }}
            <v-row>
              <v-col>
                <v-select v-if="library.available_versions" v-model="selectedLibrary[library.name]"
                  :items="library.available_versions" return-object density="compact">
                </v-select>
              </v-col>
              <v-col v-if="!isLibraryInstalled(library)">
                <v-btn>Install</v-btn>
              </v-col>
              <v-col v-if="isLibraryInstalled(library) && !isLibraryUpdatable(library)">
                <v-btn @click="updatePlatformVersion(library.name)"
                  :disabled="selectedLibrary[library.id] === library.latest_version">Install older
                  version</v-btn>
              </v-col>
              <v-col v-if="isLibraryUpdatable(library) && isLibraryInstalled(library)">
                <v-btn @click="updatePlatformVersion(library.name)"
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
        </v-card> -->
      </div>
      <div v-else>
        Installing board, please wait
        <v-progress-linear color="grey" indeterminate></v-progress-linear>
      </div>
    </v-responsive>
  </v-container>
</template>
