<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, InstalledLibrary, LibraryAvailable } from '@shared/messages';
import { onMounted, computed, ref, watch } from 'vue';

enum FilterLibraries {
  installed,
  updatable,
  deprecated,
  not_installed
}
const store = useVsCodeStore();
const filterLibraries = ref(FilterLibraries.installed);
const selectedLibrary = ref<Record<string, string>>({});
const searchLibrary = ref('');
const filterdLibrariesCount = ref(0);
const zipFile = ref<File[]>([]);

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH, errorMessage: "", payload: "" });
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED, errorMessage: "", payload: "" });
});


const headers = [
  { title: 'Name', value: 'name', key: 'name', sortable: true },
  { title: 'Installed', value: 'installedVersion', key: 'installedVersion', align: 'center' as const, sortable: false, width: '15%' },
  { title: 'Latest', value: 'latest.version', key: 'latest.version', align: 'center' as const, sortable: false, width: '15%' },
  { title: 'Actions', key: 'actions', align: 'center' as const, sortable: false, width: '10%' },
];

const updatableLibraryCount = computed(() => {
  let count = 0;
  if (store.libraries?.libraries) {
    store.libraries.libraries.forEach((library) => {
      if (isLibraryUpdatable(library) && isLibraryInstalled(library)) {
        count++;
      }
    });
  }
  return count;
});

function installLibrary(name: string, version: string) {
  const toInstall = `${name}@${version}`;
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_INSTALL_LIBRARY, errorMessage: "", payload: toInstall });
  store.libraryUpdating = `Installing library ${toInstall}`;
}

function uninstallLibrary(name: string) {
  const toUnInstall = `${name}`;
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_UNINSTALL_LIBRARY, errorMessage: "", payload: toUnInstall });
  store.libraryUpdating = `Removing library ${toUnInstall}`;
}

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

function findLibrary(name: string): InstalledLibrary | undefined {
  const foundLibrary = store.librariesInstalled?.installed_libraries.find(
    (installedLibrary) => installedLibrary.library.name === name
  );
  return foundLibrary;
}

const filteredLibraries = computed(() => {
  const filtered = filterLibs(filterLibraries.value);
  filtered.forEach((library) => {
    const lib = findLibrary(library.name);
    if (lib) {
      library.installedVersion = lib.library.version;
    }
  })
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
  const result = [...library.available_versions].reverse();
  const libInstalled = findLibrary(library.name);
  if (libInstalled) {
    selectedLibrary.value[libInstalled.library.name] = libInstalled.library.version;
  } else {
    selectedLibrary.value[library.name] = result[0];
  }
  return result;
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
  return filtered || [];
}


watch(zipFile, () => {
  if (!zipFile.value || !(zipFile.value instanceof Blob)) {
    console.error("Selected file is not valid.");
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    const arrayBuffer = reader.result;
    store.sendMessage({ command: ARDUINO_MESSAGES.INSTALL_ZIP_LIBRARY, payload: arrayBuffer, errorMessage: "" });
  };
  reader.onerror = function () {
    console.error('Error reading the file.');
  };

  // Read the file as an ArrayBuffer
  reader.readAsArrayBuffer(zipFile.value);
}, { deep: true }
);


</script>

<template>
  <v-container>
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5 mb-5">
        <v-icon>mdi-library</v-icon>
        <span class="text-h4 font-weight-bold ml-5">Library Manager</span>
      </v-row>
      <v-card v-if="!store.libraries?.libraries" class="mt-5">
        <v-card-item title="Loading Libraries">
          <template v-slot:subtitle>
            Please wait
          </template>
        </v-card-item>
        <v-card-text class="py-0">
          <v-progress-linear color="grey" indeterminate></v-progress-linear>
        </v-card-text>
      </v-card>
      <div v-else-if="!store.libraryUpdating">
        <v-file-input v-model="zipFile" label="Install library from zip file" accept="application/x-zip-compressed">

        </v-file-input>
        <!-- <input type="file" ref="fileInput" accept=".zip" style="display: none" @change="installFromZip" /> -->
        <v-chip-group selected-class="text-primary" mandatory v-model="filterLibraries">
          <v-chip filter :value="FilterLibraries.installed">Installed & Up to date</v-chip>
          <v-chip :disabled="updatableLibraryCount == 0" filter :value="FilterLibraries.updatable">Updatable
            <v-badge v-if="updatableLibraryCount > 0" color="green" :content="updatableLibraryCount" inline>

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
                <div v-if="item.latest.dependencies">
                  Dependencies:
                  <span v-for="(dependancy) in item.latest.dependencies">
                    {{ dependancy.name }},
                  </span>
                </div>
                <div v-else>This library has no dependencies</div>
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
                          <v-btn @click="installLibrary(item.name, selectedLibrary[item.name])" icon v-bind="props"
                            variant="text">
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
                <v-btn v-if="!isLibraryInstalled(item) || isLibraryUpdatable(item)" icon
                  @click="installLibrary(item.name, item.latest.version)" v-bind="props" variant="text">
                  <v-icon>
                    mdi-tray-arrow-down
                  </v-icon>
                </v-btn>
                <v-btn v-if="isLibraryInstalled(item) && !isLibraryUpdatable(item)" icon
                  @click="uninstallLibrary(item.name)" v-bind="props" variant="text">
                  <v-icon>
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
                <v-text-field v-if="filterdLibrariesCount > 10" v-model="searchLibrary" label="Search"
                  prepend-inner-icon="mdi-magnify" variant="outlined" hide-details single-line clearable></v-text-field>
              </template>
            </v-card>

          </template>
        </v-data-table>
      </div>
      <div v-else>
        <v-card class="mt-5">
          <v-card-item :title="store.libraryUpdating">
            <template v-slot:subtitle>
              Please wait
            </template>
          </v-card-item>
          <v-card-text class="py-0">
            <v-progress-linear color="grey" indeterminate></v-progress-linear>
          </v-card-text>
        </v-card>
      </div>
    </v-responsive>
  </v-container>
</template>