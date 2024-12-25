<script setup lang="ts">
import { isValidUrl, isValidUrlRule } from '@/utilities/utils';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, Platform } from '@shared/messages';
import { onMounted, computed, ref } from 'vue';

enum FilterBoards {
  installed,
  updatable,
  deprecated,
  not_installed
}
const store = useVsCodeStore();
const filterBoards = ref(FilterBoards.installed);
const selectedPlatform = ref<Record<string, string>>({});

const searchBoards = ref('');
const filterdBoardsCount = ref(0);
const dialogURL = ref(false);
const additionalURL = ref('');
const editMode = ref(false);
const editItemOriginalURL = ref({});
const postSaveURL = ref(false); // New dialog for the user message

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_CORE_SEARCH, errorMessage: "", payload: "" });
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_GET_CONFIG, errorMessage: "", payload: "" });
});

const boardHeaders = [
  { title: 'Name', value: 'name', key: 'name', sortable: true },
  { title: 'Installed', value: 'installed_version', key: 'installed_version', align: 'center' as const, sortable: false, width: '15%' },
  { title: 'Latest', value: 'latest_version', key: 'latest_version', align: 'center' as const, sortable: false, width: '15%' },
  { title: 'Actions', key: 'actions', align: 'center' as const, sortable: false, width: '10%' },
];
const urlHeaders = [
  { title: 'URLs', value: 'title' },
  { title: 'Actions', key: 'actions', align: 'center' as const, sortable: false, width: '20%' },
];

const additionalBoardURLs = computed(() => {
  return store.cliConfig?.config.board_manager?.additional_urls
    ? store.cliConfig.config.board_manager.additional_urls.map((url) => ({
      title: url.trim(),
    }))
    : [];
});

function NoDataToShow(): string {
  let message: string = '';
  switch (filterBoards.value) {
    case FilterBoards.installed:
      message = "No Boards are installed!";
      break;

    default:
      message = "No Boards available";
      break;
  }
  return message;
}

const updatableBoardCount = computed(() => {
  let count = 0;
  if (store.platform?.platforms) {
    store.platform?.platforms.forEach((platform) => {
      selectedPlatform.value[platform.id] = platform.latest_version;
      platform.name = platformName(platform.id);
    })
    count = filterPlatforms(FilterBoards.updatable).length
  };
  return count;
});

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
    .map(([version]) => version);
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
  searchBoards.value = "";
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

function saveURL() {
  if (store.cliConfig?.config?.board_manager) {
    if (!editMode.value) {
      store.sendMessage({ command: ARDUINO_MESSAGES.CLI_CONFIG_ADD_ADDITIONAL_URL, errorMessage: "", payload: additionalURL.value });
    } else {
      store.sendMessage({ command: ARDUINO_MESSAGES.CLI_CONFIG_SET_ADDITIONAL_URL, errorMessage: "", payload: `${editItemOriginalURL.value} ${additionalURL.value}` });
    }
  }
  dialogURL.value = false;
  editMode.value = false;
  additionalURL.value = '';
  postSaveURL.value = true; 
}

function goToNotInstalledTab() {
  filterBoards.value = FilterBoards.not_installed; 
  postSaveURL.value = false; 
}

function editURL(item: any) {
  editItemOriginalURL.value = item.title;
  editMode.value = true;
  dialogURL.value = true;
  additionalURL.value = item.title;
}

function deleteURL(item: any) {
  if (store.cliConfig?.config?.board_manager) {
    store.cliConfig = null;
    store.sendMessage({ command: ARDUINO_MESSAGES.CLI_CONFIG_REMOVE_ADDITIONAL_URL, errorMessage: "", payload: item.title });
  }
}

function openAddURLDialog() {
  editMode.value = false;
  additionalURL.value = '';
  dialogURL.value = true;
}
const isURLInvalid = computed(() => {
  return !isValidUrl(additionalURL.value)
});
</script>

<template>
  <v-container>
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5 mb-5">
        <v-icon>mdi-developer-board</v-icon>
        <span class="text-h4 font-weight-bold ml-5">Boards Manager</span>
      </v-row>
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
        <v-chip-group mandatory v-model="filterBoards">
          <v-chip filter :value="FilterBoards.installed">Installed & Up to date</v-chip>
          <v-chip :disabled="updatableBoardCount == 0" filter :value="FilterBoards.updatable">Updatable
            <v-badge v-if="updatableBoardCount > 0" color="green" :content="updatableBoardCount" inline />
          </v-chip>
          <v-chip filter :value="FilterBoards.not_installed">Not Installed</v-chip>
          <v-chip filter :value="FilterBoards.deprecated">Deprecated</v-chip>
        </v-chip-group>
        <v-data-table :items="filteredPlatforms" :headers="boardHeaders" density="compact" show-expand item-value="name"
          :sort-by="[{ key: 'name', order: 'asc' }]" :search="searchBoards" :no-data-text="NoDataToShow()">
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
                  prepend-inner-icon="mdi-magnify" variant="outlined" hide-details single-line clearable />
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
            <v-progress-linear color="grey" indeterminate />
          </v-card-text>
        </v-card>
      </div>
      <v-card class="mt-5">
        <v-card-title>
          Additional Boards URLs
        </v-card-title>
        <v-card-subtitle>
          Once a board URL is added, go to the "Not Installed" tab to search for the board to install it
        </v-card-subtitle>
        <v-card-text>
          <v-data-table :items="additionalBoardURLs" :headers="urlHeaders" density="compact" item-value="name"
            :loading="store.cliConfig?.config.board_manager?.additional_urls == null">
            <template v-slot:loading>
              <v-skeleton-loader>Processing changes</v-skeleton-loader>
            </template>
            <template v-slot:top>
              <div>
                <v-dialog v-model="dialogURL" max-width="500px">
                  <template v-slot:activator="{ props }">
                    <v-btn v-bind="props" @click="openAddURLDialog"
                      :disabled="store.cliConfig?.config.board_manager?.additional_urls == null">
                      Add URL
                    </v-btn>
                  </template>
                  <v-card>
                    <v-card-title>
                      {{ editMode ? 'Edit URL' : 'Add URL' }}
                    </v-card-title>

                    <v-card-text>
                      <v-text-field v-model="additionalURL" label="URL" :rules="[isValidUrlRule]"
                        clearable></v-text-field>
                    </v-card-text>

                    <v-card-actions>
                      <v-spacer />
                      <v-btn @click="dialogURL = false" color="blue-darken-1" variant="text">
                        Cancel
                      </v-btn>
                      <v-btn @click="saveURL()" color="blue-darken-1" variant="text" :disabled="isURLInvalid">
                        Save
                      </v-btn>
                    </v-card-actions>
                  </v-card>
                </v-dialog>
              </div>
            </template>
            <template v-slot:item.actions="{ item }">
              <v-tooltip>
                <template v-slot:activator="{ props }">
                  <v-btn @click="editURL(item)" icon v-bind="props" variant="text">
                    <v-icon>
                      mdi-pencil
                    </v-icon>
                  </v-btn>
                </template>
                <span>Edit</span>
              </v-tooltip>
              <v-tooltip>
                <template v-slot:activator="{ props }">
                  <v-btn @click="deleteURL(item)" icon v-bind="props" variant="text">
                    <v-icon>
                      mdi-trash-can
                    </v-icon>
                  </v-btn>
                </template>
                <span>Remove</span>
              </v-tooltip>
            </template>
          </v-data-table>
        </v-card-text>
      </v-card>
      <v-dialog v-model="postSaveURL" max-width="500px">
        <v-card>
          <v-card-title>Board Installation</v-card-title>
          <v-card-text>
            Install the board by searching for it in the "Not Installed" tab.
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn color="blue-darken-1" @click="postSaveURL = false">Close</v-btn>
            <v-btn color="blue-darken-1" @click="goToNotInstalledTab">Go to Not Installed Tab</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-responsive>
  </v-container>
</template>
