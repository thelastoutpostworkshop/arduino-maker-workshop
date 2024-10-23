<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { computed, watch } from 'vue';
import { ARDUINO_MESSAGES } from '@shared/messages';
import { useRouter } from 'vue-router'

const router = useRouter()
const vsCodeStore = useVsCodeStore();

const projectStatusInfo = computed(() => {
  if (vsCodeStore.projectStatus) {
    try {
      if (vsCodeStore.projectStatus.errorMessage !== "") {
        return vsCodeStore.projectStatus.errorMessage;
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


watch(() => vsCodeStore.projectInfo, (newProjectInfo, oldProjectInfo) => {
  if (newProjectInfo) {
    vscode.postMessage({ command: ARDUINO_MESSAGES.BOARD_CONFIGURATION, errorMessage: "", payload: vsCodeStore.projectInfo?.board });
  }
}, { immediate: true });

watch([() => vsCodeStore.cliStatus, () => vsCodeStore.projectStatus], () => { }, { immediate: true });

</script>


<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Arduino Home</h1>
      </div>
      <div>
        <p>Arduino CLI: v{{ vsCodeStore.cliStatus?.version }} ({{ vsCodeStore.cliStatus?.date }})</p>
        <p>Project Status: {{ projectStatusInfo }}</p>
      </div>
      <div class="py-4" />

      <v-row>
        <v-col cols="12">
          <v-card class="pa-4" color="blue-grey-darken-4"  prepend-icon="mdi-cog" rounded="lg">
            <template #title>
              <h2 class="text-h6 font-weight-bold">Sketch Configuration</h2>
            </template>

            <template #subtitle>
              <div class="text-subtitle-1">
                This is your current configuration
              </div>
            </template>

            <v-text-field label="Board" :model-value="vsCodeStore.boardConfiguration?.boardConfiguration?.name" readonly>
              <template v-slot:loader>
                <v-progress-linear :active="!vsCodeStore.boardConfiguration?.boardConfiguration?.name" height="2"
                  indeterminate></v-progress-linear>
              </template>
              <template v-if="vsCodeStore.boardConfiguration?.boardConfiguration?.name" v-slot:append>
                <v-btn @click="router.push({ name: 'boards' })" icon="mdi-pencil" variant="text"></v-btn>
              </template>
            </v-text-field>
            <v-text-field label="Port" :model-value="vsCodeStore.projectInfo?.port" readonly>
              <template v-slot:loader>
                <v-progress-linear :active="!vsCodeStore.projectInfo?.port" height="2"
                  indeterminate></v-progress-linear>
              </template>
              <template v-if="vsCodeStore.projectInfo?.port" v-slot:append>
                <v-btn  icon="mdi-pencil" variant="text"></v-btn>
              </template>
            </v-text-field>

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
