<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES } from '@shared/messages';

const store = useVsCodeStore();

function createProfile() {
  store.sendMessage({ command: ARDUINO_MESSAGES.CREATE_BUILD_PROFILE, errorMessage: "", payload: "" });
}

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.GET_BUILD_PROFILES, errorMessage: '', payload: '' });
});

// Convert SketchYaml.profiles object to an array for display
const profilesList = computed(() => {
  if (!store.profiles?.profiles) return [];
  return Object.entries(store.profiles.profiles).map(([name, data]) => ({
    name,
    ...data,
  }));
});
</script>

<template>
  <v-container>
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5 mb-5">
        <v-icon>mdi-application-array-outline</v-icon>
        <span class="text-h4 font-weight-bold ml-5">Profiles Manager</span>
      </v-row>

      <v-btn class="mb-4" @click="createProfile">
        Create a profile based on the current configuration
      </v-btn>

      <v-list v-if="profilesList.length">
        <v-list-item
          v-for="profile in profilesList"
          :key="profile.name"
          class="border mb-2 rounded"
        >
          <v-list-item-content>
            <v-list-item-title class="font-weight-bold">
              {{ profile.name }}
            </v-list-item-title>
            <v-list-item-subtitle>
              FQBN: {{ profile.fqbn }}<br />
              Port: {{ profile.port || '—' }}<br />
              Notes: {{ profile.notes || 'No description' }}
            </v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>
      </v-list>

      <v-alert v-else type="info" class="mt-4">
        No profiles found. Create one to get started.
      </v-alert>
    </v-responsive>
  </v-container>
</template>
