<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { computed, watch, onMounted, ref } from 'vue';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, ArduinoExtensionChannelName, THEME_COLOR } from '@shared/messages';
import { useRouter } from 'vue-router'
import { routerBoardSelectionName } from '@/router';
import arduinoImage from '@/assets/arduino_icon.webp';

const router = useRouter()
const store = useVsCodeStore();
const portSelected = ref('');
const sketchName = ref("");
const useProgrammer = ref(false);
const programmer = ref("");

const portsAvailable = computed(() => {
  const filtered = store.boardConnected?.detected_ports.map((detectedPort) => {
    return detectedPort.port.label ?? 'Unknown'; // Provide a default if label is undefined
  }) ?? [];
  return filtered;
});

function createNewSkecth() {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_CREATE_NEW_SKETCH, errorMessage: "", payload: sketchName.value });
}

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
    if(projectInfo) {
      useProgrammer.value = projectInfo.useProgrammer;
      programmer.value = projectInfo.programmer;
    }
  },
  { immediate: true }
);



watch((portSelected), (newPort) => {
  if (newPort && store.projectInfo) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_PORT, errorMessage: "", payload: newPort });
  }
});

watch([() => store.cliStatus, () => store.projectStatus], () => { }, { immediate: true });

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS, errorMessage: "", payload: "" });
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_CONNECTED, errorMessage: "", payload: "" });
  store.sendMessage({ command: ARDUINO_MESSAGES.CHANGE_THEME_COLOR, errorMessage: "", payload: THEME_COLOR.dark });
});

</script>


<template>
  <v-container>
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5">
        <img :src="arduinoImage" height="75" alt="Arduino Home" />
        <span class="text-h4 font-weight-bold ml-5">Arduino Home</span>
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
          <v-card v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_ERRORS && store.projectInfo?.board"
            class="pa-4" color="primary" prepend-icon="mdi-cog" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Sketch Configuration</h2>
            </template>

            <template #subtitle>
              <div class="text-subtitle-1">
                This is your current configuration
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
              density="compact" label="Port">
              <template v-slot:loader>
                <v-progress-linear :active="!store.boardConnected?.detected_ports" height="2"
                  indeterminate></v-progress-linear>
              </template>
            </v-select>
            <div v-if="store.boardOptions?.programmers">
              <v-row align="center" class="pt-3 ml-2">
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
            </div>
          </v-card>
          <v-card v-if="store.projectStatus?.status == ARDUINO_ERRORS.WRONG_FOLDER_NAME" class="pa-4"
            color="blue-grey-darken-3" prepend-icon="mdi-alert-circle-outline" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Sketch name and folder name do not match</h2>
            </template>
          </v-card>
          <v-card v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_INO_FILES" class="pa-4"
            color="blue-grey-darken-3" prepend-icon="mdi-folder-plus-outline" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Create a new sketch</h2>
            </template>
            <v-text-field label="Sketch Name" v-model="sketchName">

            </v-text-field>

            <v-card-actions>
              <v-btn @click="createNewSkecth" :disabled="sketchName.trim().length == 0">New Sketch</v-btn>
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
              <v-btn @click="router.push({ name: 'board-selection' })">Select a board first</v-btn>
            </div>
          </div>
        </v-col>
      </v-row>
    </v-responsive>
  </v-container>
</template>
