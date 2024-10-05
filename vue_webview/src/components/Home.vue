<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';
import { ARDUINO_MESSAGES } from '@shared/messages';

const vsCodeStore = useVsCodeStore();
const { cliStatus, projectInfo, projectStatus } = storeToRefs(vsCodeStore);

const cliVersionInfo = computed(() => {
  if (cliStatus.value) {
    try {
      if (cliStatus.value.errorMessage !== "") {
        return cliStatus.value.errorMessage;
      } else {
        const cliInfo = JSON.parse(cliStatus.value.payload);
        const version = cliInfo.VersionString;
        const commit = cliInfo.Commit;
        const date = new Date(cliInfo.Date).toLocaleDateString();
        return `Version: ${version}, Commit: ${commit}, Date: ${date}`;
      }
    } catch (error) {
      return "Failed to parse CLI information.";
    }
  } else {
    return "CLI command failed. No data available.";
  }
});

const projectStatusInfo = computed(() => {
  if (projectStatus.value) {
    try {
      if (projectStatus.value.errorMessage !== "") {
        return projectStatus.value.errorMessage;
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

const projectInfoDetails = computed(() => {
  if (projectInfo.value) {
    try {
      if (projectInfo.value.errorMessage !== "") {
        return projectInfo.value.errorMessage;
      } else {
        console.log(projectInfo.value.payload);
        return projectInfo.value.payload;
      }
    } catch (error) {
      return "Failed to parse Project Configuration information.";
    }
  } else {
    return "Project Configuration failed. No data available.";
  }
});

// Watch the cliStatus to handle empty results
watch(cliStatus, (newStatus) => {
  if (!newStatus) {
    console.error("CLI command failed or returned an empty result.");
  }
});
watch(projectStatus, (newProjectStatus) => {
  if (!newProjectStatus) {
    console.error("Project Status failed or returned an empty result.");
  }
});
watch(projectInfo, (newProjectInfo) => {
  if (!newProjectInfo) {
    console.error("Project Info failed or returned an empty result.");
  }
});
</script>


<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h3 font-weight-bold">Arduino Home</h1>
      </div>
      <div>
        <p>Arduino CLI: {{ cliVersionInfo }}</p>
        <p>Project Status: {{ projectStatusInfo }}</p>
        <p>Project Info: {{ projectInfoDetails }}</p>
      </div>
      <div class="py-4" />

      <v-row>
        <v-col cols="12">
          <v-card class="py-4" color="surface-variant" prepend-icon="mdi-cog" rounded="lg" variant="outlined">
            <template #title>
              <h2 class="text-h5 font-weight-bold">Sketch Configuration</h2>
            </template>

            <template #subtitle>
              <div class="text-subtitle-1">
                This is your current configuration
              </div>
            </template>

            <v-text-field label="Board" :model-value="projectInfoDetails.board" readonly></v-text-field>
            <v-text-field label="Port" :model-value="projectInfoDetails.port" readonly></v-text-field>

            <v-overlay opacity=".12" scrim="primary" contained model-value persistent />
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
