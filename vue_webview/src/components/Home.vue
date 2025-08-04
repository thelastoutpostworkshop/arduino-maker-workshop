<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { computed, watch, onMounted, ref, reactive } from 'vue';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, ArduinoExtensionChannelName, DEFAULT_PROFILE, PROFILES_STATUS, YAML_FILENAME } from '@shared/messages';
import { useRouter } from 'vue-router'
import { routerBoardSelectionName } from '@/router';
import arduinoImage from '@/assets/extension_icon.png';
import { getAvailablePorts } from '@/utilities/utils';

const router = useRouter()
const store = useVsCodeStore();
const portSelected = ref('');
const sketchName = ref("");
const useProgrammer = ref(store.projectInfo?.useProgrammer ?? false);
const programmer = ref("");
const optimize_for_debug = ref(false);
const monitorPortSettings = reactive({ port: "", baudRate: 115200, lineEnding: "\r\n", dataBits: 8, parity: "none", stopBits: "one" });
const selectedBuildProfile = ref<string | null>(
  store.projectInfo?.compile_profile ?? null
);
const portsAvailable = computed(() => getAvailablePorts(store));

// This is a macOS-specific thing. The upload port is on /dev/cu.* and the serial port is on /dev/tty.*
const serialPortsAvailable = computed(() => getAvailablePorts(store).map((p: any) => p.replace("/dev/cu.", "/dev/tty.")));

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
const lineEndings = [
  { title: "CR", value: "\r" },
  { title: "CRLF", value: "\r\n" },
  { title: "LF", value: "\n" },
  { title: "None", value: "none" },
];
const parity = [
  { title: "None", value: "none" },
  { title: "Odd", value: "odd" },
  { title: "Even", value: "even" },
  { title: "Mark", value: "mark" },
  { title: "Space", value: "space" }
];
const stopBits = [
  { title: "One", value: "one" },
  { title: "Onepointfive", value: "onepointfive" },
  { title: "Two", value: "two" }
];

function getStoredMonitorPortSettings() {
  if (store.projectInfo?.monitorPortSettings) {
    monitorPortSettings.port = store.projectInfo?.monitorPortSettings.port ?? "";
    monitorPortSettings.baudRate = store.projectInfo?.monitorPortSettings.baudRate ?? 115200;
    monitorPortSettings.lineEnding = store.projectInfo?.monitorPortSettings.lineEnding ?? "\r\n";
    monitorPortSettings.dataBits = store.projectInfo?.monitorPortSettings.dataBits ?? 8;
    monitorPortSettings.parity = store.projectInfo?.monitorPortSettings.parity ?? "none";
    monitorPortSettings.stopBits = store.projectInfo?.monitorPortSettings.stopBits ?? "one";
  }
}

function createNewSketch() {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_CREATE_NEW_SKETCH, errorMessage: "", payload: sketchName.value });
}

function refreshPorts() {
  store.boardConnected = null;
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_CONNECTED, errorMessage: "", payload: "" });
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

watch(() => store.boardOptions?.programmers, (newStatus) => {
  if (newStatus && newStatus?.length > 0) {
    programmer.value = newStatus[0].name
  }
}, { deep: true });

watch(programmer, (newStatus) => {
  if (newStatus) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_PROGRAMMER, errorMessage: "", payload: newStatus });
  }
});
watch(useProgrammer, (newStatus) => {
  if (newStatus != undefined) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_USE_PROGRAMMER, errorMessage: "", payload: newStatus });
  }
});
watch(optimize_for_debug, (newStatus) => {
  if (newStatus != undefined) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_OPTIMIZE_FOR_DEBUG, errorMessage: "", payload: newStatus });
  }
});

watch(
  [() => store.boardConnected, () => store.projectInfo],
  ([boardConnected, projectInfo]) => {
    if (boardConnected) {
      const projectPort = projectInfo?.port;

      // Check if projectPort is in the detected_ports array
      if (projectPort && boardConnected.detected_ports.some(detectedPort => detectedPort.port.label === projectPort) && projectPort !== "COM1") {
        portSelected.value = projectPort;
      } else {
        // Set portSelected to the first detected port, if available
        if (boardConnected.detected_ports.length > 0) {
          if (boardConnected.detected_ports[1].port.label) {
            portSelected.value = boardConnected.detected_ports[1].port.label;
            store.sendMessage({ command: ARDUINO_MESSAGES.SET_PORT, errorMessage: "", payload: portSelected.value });
          } else
            if (boardConnected.detected_ports[0].port.label) {
              portSelected.value = boardConnected.detected_ports[0].port.label;
            }
        }
      }
    }
    if (projectInfo) {
      useProgrammer.value = projectInfo.useProgrammer;
      programmer.value = projectInfo.programmer;
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

    // If no compile_profile is set or it's not in the list, select the first
    if (!compileProfile || !options.includes(compileProfile)) {
      selectedBuildProfile.value = options[0];

      // Notify the extension of the new profile
      store.sendMessage({
        command: ARDUINO_MESSAGES.SET_COMPILE_PROFILE,
        errorMessage: '',
        payload: selectedBuildProfile.value,
      });
    } else {
      selectedBuildProfile.value = compileProfile;
    }
  },
  { immediate: true }
);
watch(selectedBuildProfile, (newProfile) => {
  if (newProfile) {
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
  if (newPort && store.projectInfo) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_PORT, errorMessage: "", payload: newPort });
  }
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
          <div v-if="store.projectStatus?.status != ARDUINO_ERRORS.CLI_NOT_WORKING" class="text-right">
            Built-in CLI v{{ store.projectStatus?.cli_status?.VersionString }} ({{ store.projectStatus?.cli_status?.Date
            }})
          </div>
          <v-alert v-if="store.projectStatus?.status == ARDUINO_ERRORS.CONFIG_FILE_PROBLEM" type="error">
            <v-alert-title>Arduino Config File Problem</v-alert-title>
            A problem occured initializing the Arduino config file, see the "{{ ArduinoExtensionChannelName }}" output
            window for more information
          </v-alert>
          <v-row class="mb-2">
            <v-col cols="12" v-if="profileStatusInformation">
              <v-card color="primary" prepend-icon="mdi-application-array-outline" rounded="lg" class="pa-4">
                <template #title>
                  <h2 class="text-h6 font-weight-bold">Sketch Project File</h2>
                </template>
                <template #subtitle>
                  <div class="text-subtitle-1">
                    Provides support for reproducible builds through the use of build profile
                  </div>
                  <div class="text-subtitle-2">
                    A profile is a complete description of all the resources needed to build a sketch. The sketch
                  </div>
                </template>
                <v-alert variant="tonal" :title="profileStatusInformation.title" border="start"
                  :border-color="profileStatusInformation.color">
                  {{ profileStatusInformation.text }}

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
                    <v-tooltip location="top">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon variant="text" @click="$router.push({ name: 'profiles-manager' })">
                          <v-icon>mdi-arrow-right</v-icon>
                        </v-btn>
                      </template>
                      <span>Open Profiles Manager</span>
                    </v-tooltip>
                  </template>
                </v-alert>

              </v-card>
            </v-col>
          </v-row>

          <v-card v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_ERRORS && store.projectInfo?.board"
            class="pa-4" color="primary" prepend-icon="mdi-cog" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Sketch Configuration</h2>
            </template>

            <template #subtitle>
              <div class="text-subtitle-1">
                This is your current Arduino standard configuration (without build profiles)
              </div>
              <div class="text-subtitle-1">
                It is helpful to create build profiles easily
              </div>
            </template>
            <v-text-field label="Board" :model-value="store.boardOptions?.name" readonly>
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardOptions?.name" height="2" indeterminate></v-progress-linear>
              </template>
              <template v-if="store.boardOptions?.name" v-slot:append>
                <v-btn @click="router.push({ name: routerBoardSelectionName })" icon="mdi-pencil"
                  variant="text"></v-btn>
              </template>
            </v-text-field>
            <v-select :disabled="!store.boardConnected?.detected_ports" v-model="portSelected" :items="portsAvailable"
              density="compact" label="Upload Port">
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
                    :items="store.boardOptions.programmers" item-title="name" item-value="id">

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
          <v-card v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_INO_FILES" class="pa-4"
            color="blue-grey-darken-3" prepend-icon="mdi-folder-plus-outline" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Create a new sketch</h2>
            </template>
            <v-text-field label="Sketch Name" v-model="sketchName">

            </v-text-field>

            <v-card-actions>
              <v-btn @click="createNewSketch" :disabled="sketchName.trim().length == 0">New Sketch</v-btn>
            </v-card-actions>
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
                    <v-alert-title>Standard Arduino Configuration</v-alert-title>
                    <div>
                      The standard Arduino configuration is also helpful to create build profiles easily.
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
            <template #title>
              <h2 class="text-h6 font-weight-bold">Serial Monitor Settings</h2>
            </template>

            <v-select :disabled="!store.boardConnected?.detected_ports" v-model="monitorPortSettings.port"
              :items="serialPortsAvailable" density="compact" label="Serial Port">
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardConnected?.detected_ports" height="2"
                  indeterminate></v-progress-linear>
              </template>
              <template v-if="store.boardConnected?.detected_ports" v-slot:append>
                <v-btn @click="refreshPorts" icon="mdi-refresh" variant="text"></v-btn>
              </template>
            </v-select>
            <v-select :disabled="!store.boardConnected?.detected_ports" v-model="monitorPortSettings.baudRate" :items="[
              300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000
            ]" density="compact" label="Baud Rate">
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardConnected?.detected_ports" height="2"
                  indeterminate></v-progress-linear>
              </template>
            </v-select>
            <v-select :disabled="!store.boardConnected?.detected_ports" v-model="monitorPortSettings.lineEnding"
              :items="lineEndings" item-title="title" item-value="value" density="compact" label="Line Ending">
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardConnected?.detected_ports" height="2"
                  indeterminate></v-progress-linear>
              </template>
            </v-select>
            <v-select :disabled="!store.boardConnected?.detected_ports" v-model="monitorPortSettings.dataBits"
              :items="[5, 6, 7, 8]" density="compact" label="Data Bits">
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardConnected?.detected_ports" height="2"
                  indeterminate></v-progress-linear>
              </template>
            </v-select>
            <v-select :disabled="!store.boardConnected?.detected_ports" v-model="monitorPortSettings.stopBits"
              :items="stopBits" item-title="title" item-value="value" density="compact" label="Stop Bits">
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardConnected?.detected_ports" height="2"
                  indeterminate></v-progress-linear>
              </template>
            </v-select>
            <v-select :disabled="!store.boardConnected?.detected_ports" v-model="monitorPortSettings.parity"
              :items="parity" item-title="title" item-value="value" density="compact" label="Parity">
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardConnected?.detected_ports" height="2"
                  indeterminate></v-progress-linear>
              </template>
            </v-select>
          </v-card>
        </v-col>
      </v-row>
    </v-responsive>
  </v-container>
</template>
