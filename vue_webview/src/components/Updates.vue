<script setup lang="ts">
import { computed } from 'vue';
import { ARDUINO_MESSAGES, Release, WebviewToExtensionMessage } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted, ref } from 'vue';
import { vscode } from '@/utilities/vscode';

const vsCodeStore = useVsCodeStore();
const inDevelopment = computed(() => import.meta.env.DEV);
const panels = ref([0, 1]);
const selectedPlatform = ref<Release | null>(null);

function sendTestMessage() {
  const message: WebviewToExtensionMessage = {
    command: ARDUINO_MESSAGES.OUTDATED,
    errorMessage: "",
    payload: import.meta.env.VITE_OUTDATED_TEST
  }
  vsCodeStore.simulateMessage(message);
}

const releases = (release: Record<string, Release>) => {
  const rel = Object.entries(release)
    .reverse() // Reverse the entries without sorting
    .map(([, releaseObject]) => ({
      ...releaseObject, // Spread all properties from the release object
    }));
  return rel;
};

onMounted(() => {
  vsCodeStore.outdated = null;
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
        <v-btn v-if="vsCodeStore.outdated">Update Everything</v-btn>
        <v-expansion-panel>
          <v-expansion-panel-title>Board updates</v-expansion-panel-title>
          <v-btn>Update All</v-btn>
          <v-expansion-panel-text>
            <div v-if="vsCodeStore.outdated?.platforms.length">
              <!-- <v-list>
                <v-list-item v-for="platform in vsCodeStore.outdated.platforms" :key="platform.id">
                  <template v-slot:prepend>
                    <v-avatar>
                      <v-icon color="white">mdi-developer-board</v-icon>
                    </v-avatar>
                  </template>
                  <template v-slot:append>
                    <v-btn color="grey-lighten-1" icon="mdi-update" variant="text"></v-btn>
                  </template>
                  <v-list-item-title>{{ platform.releases[platform.latest_version].name }} by {{ platform.maintainer
                    }}</v-list-item-title>
                  <v-list-item-subtitle>
                    Installed version: {{ platform.installed_version }}
                    Latest version: {{ platform.latest_version }}
                  </v-list-item-subtitle>
                </v-list-item>
              </v-list> -->
              <v-card v-for="platform in vsCodeStore.outdated.platforms" :key="platform.id" class="mt-2" color="blue-grey-darken-4"
              :title="platform.releases[platform.latest_version].name" :subtitle="'by '+platform.maintainer">
                <template v-slot:prepend>
                    <v-avatar>
                      <v-icon color="white">mdi-developer-board</v-icon>
                    </v-avatar>
                  </template>
                <v-card-text>
                  <div class="text-green font-weight-bold">
                    {{ platform.installed_version }} installed
                  </div>
                  Latest version: {{ platform.latest_version }}
                  <v-select v-model="selectedPlatform"
                  :items="releases(platform.releases)" item-title="version" item-value="version" return-object>
                </v-select>
                </v-card-text>
              </v-card>
            </div>
            <div v-else>
              <div v-if="vsCodeStore.outdated">
                All your Boards are up to date
              </div>
              <div v-else>
                Retrieving boards updates...
                <v-progress-linear height="2" indeterminate></v-progress-linear>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel>
          <v-expansion-panel-title>Library updates</v-expansion-panel-title>
          <v-btn>Update All</v-btn>
          <v-expansion-panel-text>
            <div v-if="vsCodeStore.outdated?.libraries.length">
              <v-list>
                <v-list-item v-for="library in vsCodeStore.outdated.libraries" :key="library.library.name">
                  <template v-slot:prepend>
                    <v-avatar>
                      <v-icon color="white">mdi-library</v-icon>
                    </v-avatar>
                  </template>
                  <template v-slot:append>
                    <v-btn color="grey-lighten-1" icon="mdi-update" variant="text"></v-btn>
                  </template>
                  <v-list-item-title>{{ library.library.name }}</v-list-item-title>
                  <v-list-item-subtitle>
                    Installed version: {{ library.library.version }}
                    Latest version: {{ library.release.version }}
                  </v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </div>
            <div v-else>
              <div v-if="vsCodeStore.outdated">
                All your Libraries are up to date
              </div>
              <div v-else>
                Retrieving libraries updates...
                <v-progress-linear height="2" indeterminate></v-progress-linear>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-responsive>
  </v-container>
</template>
