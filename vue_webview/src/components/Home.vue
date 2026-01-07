<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { computed, watch, onMounted, ref } from 'vue';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, ArduinoExtensionChannelName, DEFAULT_PROFILE, PortSettings, PROFILES_STATUS, YAML_FILENAME } from '@shared/messages';
import { useRouter } from 'vue-router'
import { routerBoardSelectionName } from '@/router';
import arduinoImage from '@/assets/extension_icon.png';
import { getAvailablePorts } from '@/utilities/utils';

const router = useRouter()
const store = useVsCodeStore();
const portSelected = ref('');
const shouldSyncPort = ref(false);
const sketchName = ref("");
const useProgrammer = ref(store.projectInfo?.useProgrammer ?? false);
type ProgrammerOption = { id: string; name: string; platform?: string };
const programmer = ref<ProgrammerOption | null>(null);
const optimize_for_debug = ref(false);
const monitorPortSettings = ref({ port: "", baudRate: 115200, lineEnding: "\r\n", dataBits: 8, parity: "none", stopBits: "one" });
const selectedBuildProfile = ref("");
const portsAvailable = computed(() => getAvailablePorts(store));
const isProfileActive = computed(() => store.sketchProject?.buildProfileStatus === PROFILES_STATUS.ACTIVE);

// This is a macOS-specific thing. The upload port is on /dev/cu.* and the serial port is on /dev/tty.*
const serialPortsAvailable = computed(() => getAvailablePorts(store).map((p: any) => p.replace("/dev/cu.", "/dev/tty.")));

function updatePortSettings(settings: PortSettings) {
  store.sendMessage({
    command: ARDUINO_MESSAGES.SET_MONITOR_PORT_SETTINGS,
    errorMessage: "",
    payload: JSON.stringify(settings),
  });;
}
function changeStatusBuildProfile() {
  const status = store.sketchProject?.buildProfileStatus;
  switch (status) {
    case PROFILES_STATUS.ACTIVE:
      store.sendMessage({ command: ARDUINO_MESSAGES.SET_STATUS_BUILD_PROFILE, errorMessage: '', payload: PROFILES_STATUS.INACTIVE });
      break;
    case PROFILES_STATUS.INACTIVE:
      store.sendMessage({ command: ARDUINO_MESSAGES.SET_STATUS_BUILD_PROFILE, errorMessage: '', payload: PROFILES_STATUS.ACTIVE });
      break;
  }
}

function getStoredMonitorPortSettings() {
  if (store.projectInfo?.monitorPortSettings) {
    monitorPortSettings.value.port = store.projectInfo?.monitorPortSettings.port ?? "";
    monitorPortSettings.value.baudRate = store.projectInfo?.monitorPortSettings.baudRate ?? 115200;
    monitorPortSettings.value.lineEnding = store.projectInfo?.monitorPortSettings.lineEnding ?? "\r\n";
    monitorPortSettings.value.dataBits = store.projectInfo?.monitorPortSettings.dataBits ?? 8;
    monitorPortSettings.value.parity = store.projectInfo?.monitorPortSettings.parity ?? "none";
    monitorPortSettings.value.stopBits = store.projectInfo?.monitorPortSettings.stopBits ?? "one";
  }
}

function createNewSketch() {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_CREATE_NEW_SKETCH, errorMessage: "", payload: sketchName.value });
}

function openWorkspaceFolder() {
  store.sendMessage({ command: ARDUINO_MESSAGES.OPEN_WORKSPACE_FOLDER, errorMessage: "", payload: "" });
}

function refreshPorts() {
  store.boardConnected = null;
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_CONNECTED, errorMessage: "", payload: "" });
}

function setPortSelected(value: string, syncToProject: boolean) {
  shouldSyncPort.value = syncToProject;
  portSelected.value = value;
}

function onPortSelected() {
  shouldSyncPort.value = true;
}

const profileStatusInformation = computed(() => {
  const status = store.sketchProject?.buildProfileStatus;
  switch (status) {
    case PROFILES_STATUS.ACTIVE:
      return {
        title: 'Build Profiles Active',
        color: 'success',
        text: `The build profiles ${YAML_FILENAME} are active, it will be used in the compilation/build process`,
        button: 'Deactivate',
        tooltip: 'Deactivate the build profiles',
        showAppend: true,
      };
    case PROFILES_STATUS.INACTIVE:
      return {
        title: 'Build Profiles Inactive',
        color: 'warning',
        text: `The build profiles ${YAML_FILENAME} are inactive`,
        button: 'Activate',
        tooltip: 'Activate the build profiles',
        showAppend: true,
      };
    case PROFILES_STATUS.NOT_AVAILABLE:
      return {
        title: 'No Build Profile defined',
        color: 'error',
        text: `No build profiles (${YAML_FILENAME}) found`,
        showAppend: true,
      };
    default:
      return null;
  }
});

watch(() => store.projectStatus?.status, (newStatus) => {
  if (newStatus == ARDUINO_ERRORS.NO_ERRORS) {
    store.sendMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO, errorMessage: "", payload: "" });
  }
}, { deep: true });

watch(() => store.boardOptions?.programmers, (list) => {
  if (list && list.length > 0) {
    const savedId = store.projectInfo?.programmer;
    const match = savedId ? list.find((p: any) => p.id === savedId) : null;
    programmer.value = match ?? list[0];
  }
}, { deep: true });

watch(programmer, (newStatus) => {
  if (newStatus && (newStatus as ProgrammerOption).id) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_PROGRAMMER, errorMessage: "", payload: (newStatus as ProgrammerOption).id });
  }
});
watch(useProgrammer, (newStatus) => {
  if (newStatus != undefined) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_USE_PROGRAMMER, errorMessage: "", payload: newStatus });
  }
});
watch(() => store.projectInfo?.programmer, (newId) => {
  const list: any[] | undefined = store.boardOptions?.programmers as any;
  if (newId && list && list.length > 0) {
    const match = list.find((p: any) => p.id === newId);
    if (match) {
      programmer.value = match;
    }
  }
});
watch(optimize_for_debug, (newStatus) => {
  if (newStatus != undefined) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_OPTIMIZE_FOR_DEBUG, errorMessage: "", payload: newStatus });
  }
});

watch(
  [() => store.boardConnected, () => store.projectInfo, () => store.sketchProject?.buildProfileStatus],
  ([boardConnected, projectInfo]) => {
    if (boardConnected) {
      const availablePorts = boardConnected.detected_ports
        .map((detectedPort) => detectedPort.port.label)
        .filter((label): label is string => !!label);
      const projectPort = projectInfo?.port ?? "";
      const monitorPort = projectInfo?.monitorPortSettings?.port ?? "";
      const preferredPort = projectPort || monitorPort;
      const preferredPortIsValid = !!preferredPort && availablePorts.includes(preferredPort) && preferredPort !== "COM1";
      const preferFromMonitor = !projectPort && !!monitorPort;

      if (isProfileActive.value) {
        if (preferredPort && portSelected.value !== preferredPort) {
          setPortSelected(preferredPort, false);
        }
      } else {
        if (preferredPortIsValid) {
          if (portSelected.value !== preferredPort) {
            setPortSelected(preferredPort, preferFromMonitor);
          }
        } else {
          const currentSelected = portSelected.value;
          const currentIsValid = !!currentSelected && availablePorts.includes(currentSelected);
          if (!currentIsValid) {
            if (availablePorts.length > 0) {
              const defaultPort = availablePorts.find((port) => port !== "COM1") || availablePorts[0];
              setPortSelected(defaultPort, true);
            } else {
              setPortSelected("", false);
            }
          }
        }
      }
    }
    if (projectInfo) {
      useProgrammer.value = projectInfo.useProgrammer;
      optimize_for_debug.value = projectInfo.optimize_for_debug;
      selectedBuildProfile.value = projectInfo.compile_profile;

    }
    if (projectInfo?.monitorPortSettings) {
      getStoredMonitorPortSettings();
    }
  },
  { immediate: true }
);

const buildProfileOptions = computed(() => {
  const profiles = store.sketchProject?.yaml?.profiles || {};
  const names = Object.keys(profiles);
  return store.sketchProject?.yaml?.default_profile
    ? [DEFAULT_PROFILE, ...names]
    : names;
});

watch(
  [buildProfileOptions, () => store.projectInfo?.compile_profile],
  ([options, compileProfile]) => {
    if (!options.length) return;

    // Exit early if compileProfile is not yet set (undefined/null)
    if (compileProfile === undefined || compileProfile === null) return;
    selectedBuildProfile.value = compileProfile;
  },
  { immediate: true }
);

watch(selectedBuildProfile, (newProfile) => {
  if (!newProfile) return;
  if (newProfile !== store.projectInfo?.compile_profile) {
    store.sendMessage({
      command: ARDUINO_MESSAGES.SET_COMPILE_PROFILE,
      errorMessage: '',
      payload: newProfile,
    });
  }
});


watch(monitorPortSettings, (newMonitorPortSettings) => {
  store.sendMessage({
    command: ARDUINO_MESSAGES.SET_MONITOR_PORT_SETTINGS, errorMessage: "", payload: JSON.stringify(newMonitorPortSettings)
  });
});

watch(() => store.projectInfo?.monitorPortSettings, (newMonitorPortSettings) => {
  getStoredMonitorPortSettings();
});

watch((portSelected), (newPort) => {
  if (!store.projectInfo || isProfileActive.value) {
    shouldSyncPort.value = false;
    return;
  }
  if (newPort && shouldSyncPort.value && newPort !== store.projectInfo.port) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_PORT, errorMessage: "", payload: newPort });
  }
  shouldSyncPort.value = false;
});

watch([() => store.cliStatus, () => store.projectStatus], () => { }, { immediate: true });

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS, errorMessage: "", payload: "" });
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_CONNECTED, errorMessage: "", payload: "" });
  store.sendMessage({ command: ARDUINO_MESSAGES.GET_BUILD_PROFILES, errorMessage: '', payload: '' });

  getStoredMonitorPortSettings();
});
</script>
<template>
  <v-container>
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5">
        <img :src="arduinoImage" height="75" alt="Arduino Home" />
        <span class="text-h4 font-weight-bold ml-5">Arduino Maker Workshop</span>
      </v-row>
      <v-row class="mt-4">
        <v-col cols="12">
          <v-alert v-if="store.projectStatus?.status == ARDUINO_ERRORS.CLI_NOT_WORKING" type="error">
            <v-alert-title>CLI Not working</v-alert-title>
            The built-in CLI is not responding, see the "{{ ArduinoExtensionChannelName }}" output window for more
            information
          </v-alert>
          <div v-if="store.projectStatus?.status != ARDUINO_ERRORS.CLI_NOT_WORKING" class="text-right" data-testid="cli-version">
            Built-in CLI v{{ store.projectStatus?.cli_status?.VersionString }} ({{ store.projectStatus?.cli_status?.Date
            }})
          </div>
          <v-alert v-if="store.projectStatus?.status == ARDUINO_ERRORS.CONFIG_FILE_PROBLEM" type="error">
            <v-alert-title>Arduino Config File Problem</v-alert-title>
            A problem occured initializing the Arduino config file, see the "{{ ArduinoExtensionChannelName }}" output
            window for more information
          </v-alert>
          <v-alert
            v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_INO_FILES"
            type="info"
            variant="tonal"
            class="mb-4"
          >
            <v-alert-title>No sketch folder found</v-alert-title>
            Compile, upload, and board actions stay disabled until you open a sketch folder
            (the `.ino` file name must match the folder name) or create one here.
            <template #text>
              <div class="mt-3">
                <v-text-field label="Sketch Name" v-model="sketchName" />
                <v-btn @click="createNewSketch" :disabled="sketchName.trim().length == 0">
                  Create New Sketch
                </v-btn>
                <v-btn variant="text" class="ml-2" @click="openWorkspaceFolder">
                  Open Folder
                </v-btn>
              </div>
            </template>
          </v-alert>
          <v-row class="mb-2" v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_ERRORS">
            <v-col cols="12" v-if="profileStatusInformation">
              <v-card color="primary" prepend-icon="mdi-application-array-outline" rounded="lg" class="pa-4">
                <template #title>
                  <span class="text-h6 font-weight-bold">Sketch Project File</span>
                </template>
                <template #subtitle>
                  <div class="text-wrap">
                    Provides support for reproducible builds through the use of build profile
                  </div>
                  <div text-class="text-wrap">
                    A profile is a complete description of all the resources needed to build a sketch. The sketch
                  </div>
                </template>
                <v-alert variant="tonal" border="start" :border-color="profileStatusInformation.color">
                  {{ profileStatusInformation.text }}

                  <template #title>
                    {{ profileStatusInformation.title }}
                    <v-tooltip location="top">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon variant="text" @click="$router.push({ name: 'profiles-manager' })">
                          <v-icon>mdi-arrow-right</v-icon>
                        </v-btn>
                      </template>
                      <span>Open Profiles Manager</span>
                    </v-tooltip>
                  </template>

                  <template #text>
                    <div class="mt-3" v-if="store.sketchProject?.buildProfileStatus === PROFILES_STATUS.ACTIVE">
                      <v-select v-model="selectedBuildProfile" :items="buildProfileOptions"
                        label="Compile/Build with Profile" style="max-width: 300px" density="comfortable" />
                    </div>
                  </template>

                  <template v-if="profileStatusInformation.showAppend" #append>
                    <v-tooltip location="top" v-if="profileStatusInformation.button">
                      <template #activator="{ props }">
                        <v-btn @click="changeStatusBuildProfile" v-bind="props" 
                          :disabled="store.profileUpdating !== ''">
                          {{ profileStatusInformation.button }}
                        </v-btn>
                      </template>
                      <span>{{ profileStatusInformation.tooltip }}</span>
                    </v-tooltip>
                    <!-- Tutorial Icon -->
                    <v-tooltip location="top">
                      <template #activator="{ props }">
                        <v-btn icon variant="text" v-bind="props" :href="'https://youtu.be/i0gzop0k6yY'"
                          target="_blank" class="ml-2">
                          <v-icon>mdi-open-in-new</v-icon>
                        </v-btn>
                      </template>
                      <span>See the tutorial</span>
                    </v-tooltip>
                  </template>
                </v-alert>

              </v-card>
            </v-col>
          </v-row>

          <v-card v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_ERRORS && store.projectInfo?.board"
            class="pa-4" color="primary" prepend-icon="mdi-cog" rounded="lg">
            <template #title>
              <span class="text-h6 font-weight-bold">Sketch Configuration</span>
            </template>

            <template #subtitle>
              <div class="text-wrap">
                This is your current Arduino standard configuration (without build profiles)
              </div>
              <div text-class="text-wrap">
                It is helpful to create build profiles easily
              </div>
            </template>
            <v-text-field data-testid="board-name" label="Board" :model-value="store.boardOptions?.name" readonly>
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardOptions?.name" height="2" indeterminate></v-progress-linear>
              </template>
              <template v-if="store.boardOptions?.name" v-slot:append>
                <v-btn @click="router.push({ name: routerBoardSelectionName })" icon="mdi-pencil"
                  variant="text"></v-btn>
              </template>
            </v-text-field>
            <v-select data-testid="upload-port" :disabled="!store.boardConnected?.detected_ports || isProfileActive"
              v-model="portSelected" @update:modelValue="onPortSelected"
              :items="portsAvailable" density="compact" label="Upload Port"
              :hint="isProfileActive ? 'Upload port is managed by the active build profile.' : ''" :persistent-hint="isProfileActive">
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardConnected?.detected_ports" height="2"
                  indeterminate></v-progress-linear>
              </template>
              <template v-if="store.boardConnected?.detected_ports" v-slot:append>
                <v-btn @click="refreshPorts" icon="mdi-refresh" variant="text"></v-btn>
              </template>
            </v-select>
            <div v-if="store.boardOptions?.programmers">
              <v-row class="pt-3 ml-2">
                <span>
                  <v-checkbox v-model="useProgrammer" label="Use programmer">

                  </v-checkbox>

                </span>
                <span class="pl-5">
                  <v-select width="250" v-model="programmer" :disabled="!useProgrammer"
                    :items="store.boardOptions.programmers" item-title="name" item-value="id" return-object>

                  </v-select>
                </span>
              </v-row>
              <v-row class="ml-2">
                <div>
                  <v-checkbox v-model="optimize_for_debug"
                    label="Optimize compile output for debugging, rather than for release">

                  </v-checkbox>

                </div>
              </v-row>
            </div>
          </v-card>

          <v-card v-if="store.projectStatus?.status == ARDUINO_ERRORS.WRONG_FOLDER_NAME" class="pa-4"
            color="red-darken-3" prepend-icon="mdi-alert-circle-outline" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Sketch name and folder name do not match</h2>
            </template>
            <v-card-text>
              Your sketch name is '{{ store.projectStatus?.sketchName }}' and folder name is '{{
                store.projectStatus?.folderName }}', they must have the same name.
            </v-card-text>
          </v-card>
          <div v-if="store.projectStatus == null && !store.projectInfo?.board == null">
            <v-card class="mt-5">
              <v-card-item title="Getting Project Information">
                <template v-slot:subtitle>
                  Please wait
                </template>
              </v-card-item>
              <v-card-text class="py-0">
                <v-progress-linear color="grey" indeterminate></v-progress-linear>
              </v-card-text>
            </v-card>
          </div>
          <div v-else>
            <div v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_ERRORS && !store.projectInfo?.board">
              <v-row>
                <v-col cols="12">
                  <v-alert type="info" variant="tonal">
                    <v-alert-title>Sketch Configuration</v-alert-title>
                    <div>
                      The standard Arduino Sketch configuration is also helpful to create build profiles easily for
                      beginners.
                    </div>
                    <v-btn class="mt-5" @click="router.push({ name: 'board-selection' })">Select your board</v-btn>
                  </v-alert>
                </v-col>
              </v-row>
            </div>
          </div>
          <v-card class="mt-5 pa-4"
            v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_ERRORS && store.projectInfo?.board" color="primary"
            prepend-icon="mdi-serial-port" rounded="lg">
            <SerialMonitorSettings v-model:monitorPortSettings="monitorPortSettings" profile_name=""
              :serialPortsAvailable="serialPortsAvailable" @update="updatePortSettings" @refreshPorts="refreshPorts" />

            <template #title>
              <h2 class="text-h6 font-weight-bold">Serial Monitor Extension Settings</h2>
            </template>
            <template #subtitle>
              <div class="text-wrap">
                Settings to use when opening the serial monitor extension after an upload
              </div>
            </template>

          </v-card>
        </v-col>
      </v-row>
    </v-responsive>
  </v-container>
</template>
