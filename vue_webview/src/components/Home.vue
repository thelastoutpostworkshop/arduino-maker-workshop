<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { computed, watch, onMounted, ref } from 'vue';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES } from '@shared/messages';
import { useRouter } from 'vue-router'
import { routerBoardSelectionName } from '@/router';

const router = useRouter()
const store = useVsCodeStore();
const portSelected = ref('');
const sketchName = ref("");

const portsAvailable = computed(() => {
  const filtered = store.boardConnected?.detected_ports.map((detectedPort) => {
    return detectedPort.port.label ?? 'Unknown'; // Provide a default if label is undefined
  }) ?? []; // Ensure it returns an empty array if detected_ports is undefined
  return filtered;
});

function createNewSkecth() {
  store.sendMessage({ command: ARDUINO_MESSAGES.CREATE_NEW_SKETCH, errorMessage: "", payload: sketchName.value });
}

watch(() => store.projectStatus, (newStatus) => {
  if (newStatus === ARDUINO_ERRORS.NO_ERRORS) {
    store.sendMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO, errorMessage: "", payload: "" });
  }
});


watch(() => store.projectInfo, (newProjectInfo) => {
  if (newProjectInfo) {
    store.sendMessage({ command: ARDUINO_MESSAGES.BOARD_OPTIONS, errorMessage: "", payload: store.projectInfo?.board });
  }
});

watch(() => store.boardConnected, (boardConnected) => {
  if (boardConnected) {
    const projectPort = store.projectInfo?.port;

    // Check if projectPort is in the detected_ports array
    if (projectPort && boardConnected.detected_ports.some(detectedPort => detectedPort.port.label === projectPort)) {
      portSelected.value = projectPort;
    }
  }
});


watch((portSelected), (newPort) => {
  if (newPort && store.projectInfo) {
    store.sendMessage({ command: ARDUINO_MESSAGES.SET_PORT, errorMessage: "", payload: newPort });
  }
});

watch([() => store.cliStatus, () => store.projectStatus], () => { }, { immediate: true });

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_STATUS, errorMessage: "", payload: "" });
  store.sendMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS, errorMessage: "", payload: "" });
  // vscode.postMessage({ command: ARDUINO_MESSAGES.BOARD_CONNECTED, errorMessage: "", payload: "" });
});

</script>


<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Arduino Home</h1>
      </div>
      <v-row class="mt-4">
        <v-col cols="12">
          <v-card v-if="store.projectStatus == ARDUINO_ERRORS.NO_ERRORS && store.projectInfo?.board" class="pa-4"
            color="blue-grey-darken-3" prepend-icon="mdi-cog" rounded="lg">
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
          </v-card>
          <v-card v-if="store.projectStatus == ARDUINO_ERRORS.WRONG_FOLDER_NAME" class="pa-4" color="blue-grey-darken-3"
            prepend-icon="mdi-alert-circle-outline" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Sketch name and folder name do not match</h2>
            </template>
          </v-card>
          <v-card v-if="store.projectStatus == ARDUINO_ERRORS.NO_INO_FILES" class="pa-4" color="blue-grey-darken-3"
            prepend-icon="mdi-folder-plus-outline" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Create a new sketch</h2>
            </template>
            <v-text-field label="Sketch Name" v-model="sketchName">

            </v-text-field>

            <v-card-actions>
              <v-btn @click="createNewSkecth" :disabled="sketchName.trim().length == 0">New Sketch</v-btn>
            </v-card-actions>
          </v-card>
          <div v-if="!store.projectInfo?.board">
            <v-btn @click="router.push({ name: 'board-selection' })">Select a board first</v-btn>
          </div>
          <v-card class="pa-4 mt-4" color="blue-grey-darken-4" prepend-icon="mdi-console" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Built-in CLI</h2>
            </template>

            <template #subtitle>
              <div class="text-subtitle-1">
                v{{ store.cliStatus?.version }} ({{ store.cliStatus?.date }})
              </div>
            </template>
          </v-card>
        </v-col>
      </v-row>
    </v-responsive>
  </v-container>
</template>
