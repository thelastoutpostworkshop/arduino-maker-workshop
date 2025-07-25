<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES } from '@shared/messages';

const store = useVsCodeStore();

function createProfile() {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_INSTALL_LIBRARY, errorMessage: "", payload: "" });
}

</script>

<template>
    <v-container>
        <v-responsive>
            <v-row align="center" class="mt-1 ml-5 mb-5">
                <v-icon>mdi-application-array-outline</v-icon>
                <span class="text-h4 font-weight-bold ml-5">Profiles Manager</span>
            </v-row>
            <v-btn @click="createProfile">Create a profile based on the current configuration</v-btn>
        </v-responsive>
    </v-container>
</template>