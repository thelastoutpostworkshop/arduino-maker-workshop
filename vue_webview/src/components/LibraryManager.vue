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
const filterdLibrariesCount = ref(0);

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.LIBRARY_SEARCH, errorMessage: "", payload: "" });
  vscode.postMessage({ command: ARDUINO_MESSAGES.LIBRARY_INSTALLED, errorMessage: "", payload: "" });
});

const headers = [
  { title: 'Name', value: 'name', key: 'name', sortable: true },
  { title: 'Version', value: 'latest.version', key: 'latest.version', align: 'center' as const, sortable: false, width: '15%' },
  { title: 'Actions', key: 'actions', align: 'center' as const, sortable: false, width: '10%' },
];

watch(
  () => store.libraries,
  (newConfig) => {
    if (newConfig) {
      updatableCount.value = 0;
      store.libraries?.libraries.forEach((library) => {
        selectedLibrary.value[library.name] = library.latest.version;
        if (isLibraryUpdatable(library) && isLibraryInstalled(library)) {
          updatableCount.value++;
        }
      })
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
  const filtered = filterLibs(filterLibraries.value);
  filterdLibrariesCount.value = filtered.length;
  return filtered
})

const filteredLibrariesCountText = computed(() => {
  if (filterdLibrariesCount.value <= 1) {
    return `${filterdLibrariesCount.value} Library`;
  } else {
    return `${filterdLibrariesCount.value} Libraries`;
  }
})

function getVersions(library: LibraryAvailable): string[] {
  return [...library.available_versions].reverse();
}

function filterLibs(filter: FilterLibraries): LibraryAvailable[] {
  let filtered: LibraryAvailable[] = [];
  switch (filter) {
    case FilterLibraries.installed:
      filtered = (store.libraries?.libraries ?? []).filter((library) => isLibraryInstalled(library) && !isLibraryUpdatable(library));
      break;
    case FilterLibraries.updatable:
      filtered = (store.libraries?.libraries ?? []).filter((library) => isLibraryUpdatable(library) && isLibraryInstalled(library));
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
                <div class="pt-2">
                  <v-row>
                    <v-col cols="3">
                      <v-select v-if="item.available_versions" v-model="selectedLibrary[item.name]"
                        :items="getVersions(item)" return-object density="compact" label="Versions available">
                      </v-select>
                    </v-col>
                    <v-col>
                      <v-tooltip>
                        <template v-slot:activator="{ props }">
                          <v-btn icon v-bind="props" variant="text">
                            <v-icon>
                              mdi-tray-arrow-down
                            </v-icon>
                          </v-btn>
                        </template>
                        <span> Install version {{ selectedLibrary[item.name] }}</span>
                      </v-tooltip>
                    </v-col>
                  </v-row>
                </div>
              </td>
            </tr>
          </template>
          <template v-slot:item.actions="{ item }">
            <v-tooltip>
              <template v-slot:activator="{ props }">
                <v-btn icon v-bind="props" variant="text">
                  <v-icon v-if="!isLibraryInstalled(item) || isLibraryUpdatable(item)">
                    mdi-tray-arrow-down
                  </v-icon>
                  <v-icon v-if="isLibraryInstalled(item) && !isLibraryUpdatable(item)">
                    mdi-trash-can
                  </v-icon>
                </v-btn>
              </template>
              <span v-if="!isLibraryInstalled(item) || isLibraryUpdatable(item)"> Install latest {{ item.name }}</span>
              <span v-if="isLibraryInstalled(item) && !isLibraryUpdatable(item)"> Uninstall {{ item.name }}</span>
            </v-tooltip>
          </template>
          <template v-slot:top>
            <v-card :title="filteredLibrariesCountText" flat>
              <template v-slot:text>
                <v-text-field v-if="filterdLibrariesCount > 10" v-model="searchLibrary" label="Search" prepend-inner-icon="mdi-magnify" variant="outlined"
                  hide-details single-line clearable></v-text-field>
              </template>
            </v-card>

          </template>
        </v-data-table>
      </div>
      <div v-else>
        Installing board, please wait
        <v-progress-linear color="grey" indeterminate></v-progress-linear>
      </div>
    </v-responsive>
  </v-container>
</template>