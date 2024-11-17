<script setup lang="ts">
import arduinoIcon from '@/assets/arduino_icon.webp';
import { useRouter } from 'vue-router'
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted, computed } from 'vue';
import { ARDUINO_MESSAGES } from '@shared/messages';

const store = useVsCodeStore();
const router = useRouter()

onMounted(() => {
    store.sendMessage({ command: ARDUINO_MESSAGES.CLI_UPDATE_INDEX, errorMessage: "", payload: "" });
});

const libraryToUpdate = computed(() => {
    return !!store.outdated?.libraries;
});
const boardToUpdate = computed(() => {
    return !!store.outdated?.platforms;
});

</script>

<template>
    <v-navigation-drawer permanent rail>
        <v-list-item :prepend-avatar="arduinoIcon"></v-list-item>
        <v-divider></v-divider>
        <v-list-item prepend-icon="mdi-home" v-tooltip @click="router.push({ name: 'home' })">Project Home</v-list-item>
        <v-list-item prepend-icon="mdi-bulletin-board" v-tooltip @click="router.push({ name: 'board-selection' })">Board
            Selection</v-list-item>
        <v-list-item prepend-icon="mdi-cog" v-tooltip @click="router.push({ name: 'board-configuration' })">Board
            Configuration</v-list-item>
        <v-list-item v-tooltip @click="router.push({ name: 'board-manager' })">Boards Manager
            <template v-slot:prepend>
                <v-icon>mdi-developer-board</v-icon>
                <v-badge v-if="boardToUpdate" color="yellow" dot></v-badge>
            </template>
        </v-list-item>
        <v-list-item v-tooltip @click="router.push({ name: 'library-manager' })">Library Manager
            <template v-slot:prepend>
                <v-icon>mdi-library</v-icon>
                <v-badge v-if="libraryToUpdate" color="yellow" dot></v-badge>
            </template>
        </v-list-item>
    </v-navigation-drawer>
</template>
