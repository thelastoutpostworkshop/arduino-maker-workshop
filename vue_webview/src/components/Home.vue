<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { computed, watch, onMounted, ref } from 'vue';
import { ARDUINO_MESSAGES } from '@shared/messages';
import { useRouter } from 'vue-router'
import { routerBoardSelectionName } from '@/router';

const router = useRouter()
const store = useVsCodeStore();
const portSelected = ref('');

const projectStatusInfo = computed(() => {
  if (store.projectStatus) {
    try {
      if (store.projectStatus.errorMessage !== "") {
        return store.projectStatus.errorMessage;
      } else {
        vscode.postMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO, errorMessage: "", payload: "" });
        return `Ready`;
      }
    } catch (error) {
      return "Failed to parse Project Status information.";
    }
  } else {
    return "Project Status failed. No data available.";
  }
});

const portsAvailable = computed(() => {
  const filtered = store.boardConnected?.detected_ports.map((detectedPort) => {
    return detectedPort.port.label ?? 'Unknown'; // Provide a default if label is undefined
  }) ?? []; // Ensure it returns an empty array if detected_ports is undefined
  return filtered;
});

watch(() => store.projectInfo, (newProjectInfo) => {
  if (newProjectInfo) {
    vscode.postMessage({ command: ARDUINO_MESSAGES.BOARD_CONFIGURATION, errorMessage: "", payload: store.projectInfo?.board });
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
    vscode.postMessage({ command: ARDUINO_MESSAGES.SET_PORT, errorMessage: "", payload: newPort });
  }
});

watch([() => store.cliStatus, () => store.projectStatus], () => { }, { immediate: true });

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.BOARD_CONNECTED, errorMessage: "", payload: "" });
});

</script>


<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Arduino Home</h1>
      </div>
      <div>
        <p>Arduino CLI: v{{ store.cliStatus?.version }} ({{ store.cliStatus?.date }})</p>
        <p>Project Status: {{ projectStatusInfo }}</p>
      </div>
      <div class="py-4" />

      <v-row>
        <v-col cols="12">
          <v-card class="pa-4" color="blue-grey-darken-4" prepend-icon="mdi-cog" rounded="lg">
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
        </v-col>

        <v-col cols="6">
          <v-card append-icon="mdi-open-in-new" class="py-4" color="surface-variant" href="https://vuetifyjs.com/"
            prepend-icon="mdi-text-box-outline" rel="noopener noreferrer" rounded="lg"
            subtitle="Learn about all things Vuetify in our documentation." target="_blank" title="Documentation"
            variant="text">
            <v-overlay opacity=".06" scrim="primary" contained model-value persistent />
          </v-card>
        </v-col>

        <v-col cols="6">
          <v-card append-icon="mdi-open-in-new" class="py-4" color="surface-variant"
            href="https://vuetifyjs.com/introduction/why-vuetify/#feature-guides" prepend-icon="mdi-star-circle-outline"
            rel="noopener noreferrer" rounded="lg" subtitle="Explore available framework Features." target="_blank"
            title="Features" variant="text">
            <v-overlay opacity=".06" scrim="primary" contained model-value persistent />
          </v-card>
        </v-col>

        <v-col cols="6">
          <v-card append-icon="mdi-open-in-new" class="py-4" color="surface-variant"
            href="https://vuetifyjs.com/components/all" prepend-icon="mdi-widgets-outline" rel="noopener noreferrer"
            rounded="lg" subtitle="Discover components in the API Explorer." target="_blank" title="Components"
            variant="text">
            <v-overlay opacity=".06" scrim="primary" contained model-value persistent />
          </v-card>
        </v-col>

        <v-col cols="6">
          <v-card append-icon="mdi-open-in-new" class="py-4" color="surface-variant"
            href="https://discord.vuetifyjs.com" prepend-icon="mdi-account-group-outline" rel="noopener noreferrer"
            rounded="lg" subtitle="Connect with Vuetify developers." target="_blank" title="Community" variant="text">
            <v-overlay opacity=".06" scrim="primary" contained model-value persistent />
          </v-card>
        </v-col>
      </v-row>
    </v-responsive>
  </v-container>
</template>
