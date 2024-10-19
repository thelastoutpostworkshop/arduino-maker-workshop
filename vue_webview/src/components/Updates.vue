<script setup lang="ts">
import { computed } from 'vue';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage, Platform } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted,ref } from 'vue';
import { vscode } from '@/utilities/vscode';

const vsCodeStore = useVsCodeStore();
const inDevelopment = computed(() => import.meta.env.DEV);
const panels = ref([0, 1]);

// const platformName = computed((platform : Platform,version:string) => {
//  return plat
// });

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
        <h1 class="text-h4 font-weight-bold">Updates for Boards and Libraries</h1>
      </div>
      <div v-if="inDevelopment">
        <v-btn @click="sendTestMessage()">Send Test Message</v-btn>
      </div>
      <v-expansion-panels multiple v-model="panels">
        <v-expansion-panel>
          <v-expansion-panel-title>Board updates</v-expansion-panel-title>
          <v-expansion-panel-text>
            <div v-if="vsCodeStore.outdated?.platforms.length">
              <v-list>
                <v-list-item v-for="platform in vsCodeStore.outdated.platforms" :key="platform.id">
                  <v-list-item-content>
                    <v-list-item-title>{{ platform.releases[platform.latest_version].name }}</v-list-item-title>
                    <v-list-item-subtitle>
                      Installed version: {{ platform.installed_version }} 
                      Latest version: {{ platform.latest_version }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </v-list>
            </div>
            <div v-else>
              <div v-if="vsCodeStore.outdated">
                All your Boards are up to date
              </div>
              <div v-else>
                Retrieving boards updates...
                <v-progress-linear  height="2" indeterminate></v-progress-linear>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel>
          <v-expansion-panel-title>Library updates</v-expansion-panel-title>
          <v-expansion-panel-text>
            <div v-if="vsCodeStore.outdated?.libraries.length">
              <v-list>
                <v-list-item v-for="library in vsCodeStore.outdated.libraries" :key="library.library.name">
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
