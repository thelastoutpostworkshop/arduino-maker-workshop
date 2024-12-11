<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, LibraryInformation } from '@shared/messages';
import { onMounted, computed, ref, watch } from 'vue';

enum FilterLibraries {
  installed,
  updatable,
  zip,
  deprecated,
  not_installed
}
const store = useVsCodeStore();
const filterLibraries = ref(FilterLibraries.installed);
const selectedLibrary = ref<Record<string, string>>({});
const searchLibrary = ref('');
const filterdLibrariesCount = ref(0);
const zipFile = ref<File | undefined>(undefined);

const headers = [
  { title: 'Name', value: 'name', key: 'name', sortable: true },
  { title: 'Installed', value: 'installedVersion', key: 'installedVersion', align: 'center' as const, sortable: false, width: '15%' },
  { title: 'Latest', value: 'latestVersion', key: 'latestVersion', align: 'center' as const, sortable: false, width: '15%' },
  { title: 'Actions', key: 'actions', align: 'center' as const, sortable: false, width: '10%' },
];


const areLibrariesAvailable = computed(() => {
  return store.libraries !== null && store.librariesInstalled !== null;
});

watch(areLibrariesAvailable, () => {
  updateLibariesInformation();
});

function updateLibariesInformation() {
  if (store.libraries?.libraries) {
    store.libariesInformation = store.libraries?.libraries.map((library) => {
      return {
        name: library.name,
        latestVersion: library.latest.version,
        installedVersion: '',
        author: library.latest.author,
        paragraph: library.latest.paragraph,
        website: library.latest.website,
        sentence: library.latest.sentence,
        dependencies: library.latest.dependencies,
        zipLibrary: false,
        installed: false,
        available_versions: library.available_versions
      } as LibraryInformation
    })
    if (store.librariesInstalled?.installed_libraries) {
      store.librariesInstalled.installed_libraries.forEach((library) => {
        const isLibraryOfficial = store.libariesInformation?.find((lib) => lib.name === library.library.name);
        if (!isLibraryOfficial) {
          // It's a manually installed library
          store.libariesInformation?.push({
            name: library.library.name,
            latestVersion: library.library.version,
            installedVersion: library.library.version,
            author: library.library.author,
            paragraph: library.library.paragraph,
            website: library.library.website,
            sentence: library.library.sentence,
            dependencies: undefined,
            available_versions: [],
            zipLibrary: true,
            installed: true
          })
        } else {
          isLibraryOfficial.installed = true;
          isLibraryOfficial.installedVersion = library.library.version
        }
      })
    }
    store.libariesInformation.forEach((lib) => {
      if (lib.available_versions) {
        if (lib.installed) {
          selectedLibrary.value[lib.name] = lib.installedVersion;
        } else {
          selectedLibrary.value[lib.name] = lib.latestVersion;
        }
      }
    })
  }
}

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH, errorMessage: "", payload: "" });
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED, errorMessage: "", payload: "" });
  // Force recompute when component mounts
  if (areLibrariesAvailable.value) {
    updateLibariesInformation();
  }
});

const updatableLibraryCount = computed(() => {
  let count = 0;
  store.libariesInformation?.forEach((library) => {
    if (isLibraryUpdatable(library) && isLibraryInstalled(library)) {
      count++;
    }
  });
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

function isLibraryInstalled(library: LibraryInformation): boolean {
  return library.installed;
}

function isLibraryUpdatable(library: LibraryInformation): boolean {
  if (library.zipLibrary) {
    return false;
  }
  return library.installedVersion !== library.latestVersion;
}

function isLibraryDeprecated(library: LibraryInformation): boolean {
  const sentence = library.sentence?.toLowerCase() ?? "";
  const paragraph = library.paragraph?.toLowerCase() ?? "";
  return sentence.includes("deprecated") || paragraph.includes("deprecated");
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

function getVersions(library: LibraryInformation): string[] {
  if (library.available_versions) {
    const result = [...library.available_versions].reverse();
    return result;
  }
  return [];
}

function filterLibs(filter: FilterLibraries): LibraryInformation[] {
  let filtered: LibraryInformation[] = [];
  if (store.libariesInformation) {
    switch (filter) {
      case FilterLibraries.installed:
        filtered = store.libariesInformation.filter((library) => isLibraryInstalled(library) && !isLibraryUpdatable(library) && !library.zipLibrary);
        break;
      case FilterLibraries.updatable:
        filtered = store.libariesInformation.filter((library) => isLibraryUpdatable(library) && isLibraryInstalled(library));
        break;
      case FilterLibraries.deprecated:
        filtered = store.libariesInformation.filter((library) => isLibraryDeprecated(library));
        break;
      case FilterLibraries.not_installed:
        filtered = store.libariesInformation.filter((library) => !isLibraryInstalled(library) && !isLibraryDeprecated(library));
        break;
      case FilterLibraries.zip:
        filtered = store.libariesInformation.filter((library) => library.zipLibrary);
        break;
      default:
        filtered = store.libariesInformation;
        break;
    }
  }
  return filtered;
}


watch(zipFile, () => {
  if (!zipFile.value || !(zipFile.value instanceof Blob)) {
    console.error("Selected file is not valid.");
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    const arrayBuffer = reader.result;
    store.libraryUpdating = `Installing Zip library ${zipFile.value?.name}`;
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
      <v-card v-if="!store.libariesInformation" class="mt-5">
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
        <v-chip-group mandatory v-model="filterLibraries">
          <v-chip filter :value="FilterLibraries.installed">Installed & Up to date</v-chip>
          <v-chip :disabled="updatableLibraryCount == 0" filter :value="FilterLibraries.updatable">Updatable
            <v-badge v-if="updatableLibraryCount > 0" color="green" :content="updatableLibraryCount" inline>

            </v-badge>
          </v-chip>
          <v-chip filter :value="FilterLibraries.zip">Zip Installed</v-chip>
          <v-chip filter :value="FilterLibraries.not_installed">Not Installed</v-chip>
          <v-chip filter :value="FilterLibraries.deprecated">Deprecated</v-chip>
        </v-chip-group>
        <v-data-table :items="filteredLibraries" :headers="headers" density="compact" show-expand item-value="name"
          :sort-by="[{ key: 'name', order: 'asc' }]" :search="searchLibrary">
          <template v-slot:expanded-row="{ columns, item }">
            <tr>
              <td :colspan="columns.length" class="text-grey">
                {{ "By " + item.author }}
                <div>
                  {{ item.paragraph }}
                  <span class="text-subtitle-2"> <a :href="item.website" target="_blank">More Info</a></span>
                </div>
                <div v-if="item.dependencies">
                  Dependencies:
                  <span v-for="(dependancy) in item.dependencies">
                    {{ dependancy.name }},
                  </span>
                </div>
                <div v-else>This library has no dependencies</div>
                <div class="pt-2" v-if="!item.zipLibrary">
                  <v-row>
                    <v-col cols="3">
                      <v-select v-model="selectedLibrary[item.name]" :items="getVersions(item)" return-object
                        density="compact" label="Versions available">
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
                  @click="installLibrary(item.name, item.latestVersion)" v-bind="props" variant="text">
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