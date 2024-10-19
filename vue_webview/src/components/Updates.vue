<script setup lang="ts">
import { computed } from 'vue';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage, OutdatedInformation } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted,ref } from 'vue';
import { vscode } from '@/utilities/vscode';

const vsCodeStore = useVsCodeStore();
const inDevelopment = computed(() => import.meta.env.DEV);
const panels = ref([0, 1]);

const outdatedPlatforms = computed(() => {
  const outdated: OutdatedInformation | null = vsCodeStore.outdated;
  if (!outdated) return [];
  return outdated.platforms.filter(platform => {
    const installedRelease = Object.values(platform.releases).find(release => release.installed);
    if (!installedRelease) return [];
    const latestRelease = Object.values(platform.releases).reduce((latest, current) => {
      return current.version > latest.version ? current : latest;
    }, installedRelease);
    return installedRelease.version !== latestRelease.version;
  });
});

const outdatedLibraries = computed(() => {
  const outdated: OutdatedInformation | null = vsCodeStore.outdated;
  return outdated ? outdated.libraries.filter(library => library.library.version !== library.release.version) : [];
});

function sendTestMessage() {
  const message: WebviewToExtensionMessage = {
    command: ARDUINO_MESSAGES.OUTDATED,
    errorMessage: "",
    payload: import.meta.env.VITE_OUTDATED_TEST
  }
  vsCodeStore.simulateMessage(message);
}

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.OUTDATED, errorMessage: "", payload: "" });
});
</script>

<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Updates for platforms and libraries</h1>
      </div>
      <div v-if="inDevelopment">
        <v-btn @click="sendTestMessage()">Send Test Message</v-btn>
      </div>
      <v-expansion-panels multiple v-model="panels">
        <v-expansion-panel>
          <v-expansion-panel-title>Platform updates</v-expansion-panel-title>
          <v-expansion-panel-text>
            <div v-if="outdatedPlatforms.length">
              <v-list>
                <v-list-item v-for="platform in outdatedPlatforms" :key="platform.id">
                  <v-list-item-content>
                    <v-list-item-title>{{ platform.id }}</v-list-item-title>
                    <v-list-item-subtitle>
                      Maintainer: {{ platform.maintainer }} <br>
                      Installed version: {{ Object.values(platform.releases).find(release => release.installed)?.version }} <br>
                      Latest version: {{ Object.values(platform.releases).reduce((latest, current) => current.version > latest.version ? current : latest).version }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </v-list>
            </div>
            <div v-else>
              <div v-if="vsCodeStore.outdated">
                All your Platforms are up to date
              </div>
              <div v-else>
                Retrieving platform updates...
                <v-progress-linear  height="2" indeterminate></v-progress-linear>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel>
          <v-expansion-panel-title>Library updates</v-expansion-panel-title>
          <v-expansion-panel-text>
            <div v-if="outdatedLibraries.length">
              <v-list>
                <v-list-item v-for="library in outdatedLibraries" :key="library.library.name">
                  <v-list-item-content>
                    <v-list-item-title>{{ library.library.name }}</v-list-item-title>
                    <v-list-item-subtitle>
                      Installed version: {{ library.library.version }} <br>
                      Latest version: {{ library.release.version }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </v-list>
            </div>
            <div v-else>
              <div v-if="vsCodeStore.outdated">
                All your Libraries are up to date
              </div>
              <div v-else>
                Retrieving libraries updates...
                <v-progress-linear  height="2" indeterminate></v-progress-linear>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-responsive>
  </v-container>
</template>
