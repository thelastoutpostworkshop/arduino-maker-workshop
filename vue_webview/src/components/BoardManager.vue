<script setup lang="ts">
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
const updatableCount = ref(0);
const searchBoards = ref('');
const filterdBoardsCount = ref(0);

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_CORE_SEARCH, errorMessage: "", payload: "" });
});

const headers = [
  { title: 'Name', value: 'name', key: 'name', sortable: true },
  { title: 'Installed', value: 'installed_version', key: 'installed_version', align: 'center' as const, sortable: false, width: '15%' },
  { title: 'Latest', value: 'latest_version', key: 'latest_version', align: 'center' as const, sortable: false, width: '15%' },
  { title: 'Actions', key: 'actions', align: 'center' as const, sortable: false, width: '10%' },
];

watch(
  () => store.platform,
  (newConfig) => {
    if (newConfig) {
      store.platform?.platforms.forEach((platform) => {
        selectedPlatform.value[platform.id] = platform.latest_version;
        platform.name = platformName(platform.id); // Patch because name is not provided by the CLI
      })
      updatableCount.value = filterPlatforms(FilterBoards.updatable).length;
    }
  },
);

function updatePlatformVersion(platformID: string) {
  const toInstall = selectedPlatform.value[platformID];
  const version = `${platformID}@${toInstall}`;
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_INSTALL_CORE_VERSION, errorMessage: "", payload: version });
  store.boardUpdating = `Installing board ${platformID} version ${toInstall}`
}
function uninstallPlatform(platformID: string) {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_UNINSTALL_CORE, errorMessage: "", payload: platformID });
  store.boardUpdating = `Removing board ${platformID}`;
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

const filteredBoardsCountText = computed(() => {
  if (filterdBoardsCount.value <= 1) {
    return `${filterdBoardsCount.value} Board`;
  } else {
    return `${filterdBoardsCount.value} Boards`;
  }
})

const filteredPlatforms = computed(() => {
  const filtered = filterPlatforms(filterBoards.value);
  filterdBoardsCount.value = filtered.length;
  return filtered;
})

function filterPlatforms(filter: FilterBoards): Platform[] {
  let filtered: Platform[] = [];
  switch (filter) {
    case FilterBoards.installed:
      filtered = (store.platform?.platforms ?? []).filter((platform) =>
        isPlatformInstalled(platform) && !isPlatformUpdatable(platform))
      break;
    case FilterBoards.updatable:
      filtered = (store.platform?.platforms ?? []).filter((platform) =>
        isPlatformUpdatable(platform) && isPlatformInstalled(platform))
      break;
    case FilterBoards.deprecated:
      filtered = (store.platform?.platforms ?? []).filter((platform) =>
        isPlatformDepracated(platform))
      break;
    case FilterBoards.not_installed:
      filtered = (store.platform?.platforms ?? []).filter((platform) =>
        !isPlatformInstalled(platform) && !isPlatformDepracated(platform))
      break;
    default:
      filtered = store.platform?.platforms ?? [];
      break;
  }
  return filtered || [];
}

const platformName = (platform_id: string): string => {
  const p = store.platform?.platforms.find((platform) => platform.id === platform_id);
  if (!p || !p.releases) {
    return 'Unknown';
  }

  const relEntries = Object.entries(p.releases).reverse();
  const name = relEntries[0]?.[1]?.name || 'Unknown';
  return name;
};
</script>

<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Boards Manager</h1>
      </div>
      <v-card v-if="!store.platform?.platforms" class="mt-5">
          <v-card-item title="Loading Boards">
            <template v-slot:subtitle>
              Please wait
            </template>
          </v-card-item>
          <v-card-text class="py-0">
            <v-progress-linear color="grey" indeterminate></v-progress-linear>
          </v-card-text>
        </v-card>
      <div v-else-if="!store.boardUpdating">
        <v-chip-group selected-class="text-primary" mandatory v-model="filterBoards">
          <v-chip filter :value="FilterBoards.installed">Installed & Up to date</v-chip>
          <v-chip :disabled="updatableCount == 0" filter :value="FilterBoards.updatable">Updatable
            <v-badge v-if="updatableCount > 0" color="green" :content="updatableCount" inline>

            </v-badge>
          </v-chip>
          <v-chip filter :value="FilterBoards.not_installed">Not Installed</v-chip>
          <v-chip filter :value="FilterBoards.deprecated">Deprecated</v-chip>
        </v-chip-group>
        <v-data-table :items="filteredPlatforms" :headers="headers" density="compact" show-expand item-value="name"
          :sort-by="[{ key: 'name', order: 'asc' }]" :search="searchBoards">

          <template v-slot:expanded-row="{ columns, item }">
            <tr>
              <td :colspan="columns.length" class="text-grey">
                {{ "By " + item.maintainer }}
                <span class="text-subtitle-2"> <a :href="item.website" target="_blank">More Info</a></span>
                <div class="pt-2">
                  <v-row>
                    <v-col cols="3">
                      <v-select v-if="item.releases" v-model="selectedPlatform[item.id]" :items="releases(item)"
                        return-object density="compact" label="Versions available">
                      </v-select>
                    </v-col>
                    <v-col>
                      <v-tooltip>
                        <template v-slot:activator="{ props }">
                          <v-btn @click="updatePlatformVersion(item.id)" icon v-bind="props" variant="text">
                            <v-icon>
                              mdi-tray-arrow-down
                            </v-icon>
                          </v-btn>
                        </template>
                        <span> Install version {{ selectedPlatform[item.id] }}</span>
                      </v-tooltip>
                    </v-col>
                  </v-row>
                </div>
              </td>
            </tr>
          </template>
          <template v-slot:top>
            <v-card :title="filteredBoardsCountText" flat>
              <template v-slot:text>
                <v-text-field v-if="filterdBoardsCount > 10" v-model="searchBoards" label="Search"
                  prepend-inner-icon="mdi-magnify" variant="outlined" hide-details single-line clearable></v-text-field>
              </template>
            </v-card>
          </template>
          <template v-slot:item.actions="{ item }">
            <v-tooltip v-if="!isPlatformInstalled(item) || isPlatformUpdatable(item)">
              <template v-slot:activator="{ props }">
                <v-btn @click="updatePlatformVersion(item.id)" icon v-bind="props" variant="text">
                  <v-icon v-if="!isPlatformInstalled(item) || isPlatformUpdatable(item)">
                    mdi-tray-arrow-down
                  </v-icon>
                </v-btn>
              </template>
              <span> Install latest {{ item.name }}</span>
            </v-tooltip>
            <v-tooltip v-if="isPlatformInstalled(item) && !isPlatformUpdatable(item)">
              <template v-slot:activator="{ props }">
                <v-btn @click="uninstallPlatform(item.id)" icon v-bind="props" variant="text">
                  <v-icon v-if="isPlatformInstalled(item) && !isPlatformUpdatable(item)">
                    mdi-trash-can
                  </v-icon>
                </v-btn>
              </template>
              <span v-if="isPlatformInstalled(item) && !isPlatformUpdatable(item)"> Uninstall {{ item.name }}</span>
            </v-tooltip>
          </template>
        </v-data-table>
      </div>
      <div v-else>
        <v-card class="mt-5">
          <v-card-item :title="store.boardUpdating">
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