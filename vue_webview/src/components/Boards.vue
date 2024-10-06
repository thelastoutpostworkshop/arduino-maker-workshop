<script setup lang="ts">
import { vscode } from '@/utilities/vscode';
// import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES } from '@shared/messages';
import { onMounted } from 'vue';

// const vsCodeStore = useVsCodeStore();

onMounted(() => {
  vscode.postMessage({ command: ARDUINO_MESSAGES.BOARDS_LIST_ALL, errorMessage: "", payload: "" });
});
</script>


<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold">Boards</h1>
      </div>
 
    </v-responsive>
  </v-container>
</template>
