<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES } from '@shared/messages';
import { onMounted, watch, computed } from 'vue';

const vsCodeStore = useVsCodeStore();

// Send a message to request the boards list when the component is mounted
onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.BOARDS_LIST_ALL, errorMessage: "", payload: "" });
});

// Watch for changes in boards data and update accordingly
watch([() => vsCodeStore.boards], () => { }, { immediate: true });

// Compute the board structure from the store
const boardStructure = computed(() => vsCodeStore.boards?.boardStructure || {});

</script>

<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Boards</h1>
      </div>
      <v-expansion-panels multiple>
        <v-expansion-panel v-for="(boards, platform) in boardStructure" :key="platform">
          <v-expansion-panel-title>{{ platform }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-list>
              <v-list-item v-for="board in boards" :key="board.fqbn">
                  <v-list-item-title>{{ board.name }}</v-list-item-title>
                  <v-list-item-subtitle>{{ board.fqbn }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-responsive>
  </v-container>
</template>
