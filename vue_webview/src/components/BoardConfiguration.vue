<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage } from '@shared/messages';
import { computed } from 'vue';

const vsCodeStore = useVsCodeStore();

const inDevelopment = computed(() => import.meta.env.DEV);

function sendTestMessage() {
  const message: WebviewToExtensionMessage = {
    command: ARDUINO_MESSAGES.BOARD_CONFIGURATION,
    errorMessage: "",
    payload: import.meta.env.VITE_BOARDS_LISTALL_TEST
  }
  vsCodeStore.simulateMessage(message);
}
</script>

<template>
    <v-container>
        <v-responsive>
            <div v-if="inDevelopment">
                <v-btn @click="sendTestMessage()">Send Test Message</v-btn>
            </div>
            <div class="text-center">
                <h1 class="text-h4 font-weight-bold">Board Configuration</h1>
            </div>
            <v-text-field label="Current Board:" :model-value="vsCodeStore.boardConfiguration?.boardName" readonly>
                <template v-slot:loader>
                    <v-progress-linear :active="!vsCodeStore.boardConfiguration?.boardName" height="2"
                        indeterminate></v-progress-linear>
                </template>
            </v-text-field>
        </v-responsive>
    </v-container>
</template>