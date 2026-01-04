<script setup lang="ts">
import arduinoIcon from '@/assets/extension_icon.png';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted, computed } from 'vue';
import { ARDUINO_MESSAGES,ARDUINO_ERRORS } from '@shared/messages';

const store = useVsCodeStore();

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
        <v-list-item :prepend-avatar="arduinoIcon" />
        <v-divider />

        <v-tooltip location="right">
            <template #activator="{ props }">
                <v-list-item v-bind="props" prepend-icon="mdi-home" :to="{ name: 'home' }" router>
                    Project Home
                </v-list-item>
            </template>
            <span>Project Home</span>
        </v-tooltip>

        <v-tooltip location="right">
            <template #activator="{ props }">
                <v-list-item :disabled="store.projectStatus?.status != ARDUINO_ERRORS.NO_ERRORS" v-bind="props" data-testid="nav-board-selection" prepend-icon="mdi-format-list-checks" :to="{ name: 'board-selection' }"
                    router>
                    Board Selection
                </v-list-item>
            </template>
            <span>Select your board</span>
        </v-tooltip>

        <v-tooltip location="right">
            <template #activator="{ props }">
                <v-list-item :disabled="store.projectStatus?.status != ARDUINO_ERRORS.NO_ERRORS" v-bind="props" prepend-icon="mdi-cog" :to="{ name: 'board-configuration' }" router>
                    Board Configuration
                </v-list-item>
            </template>
            <span>Board Configuration</span>
        </v-tooltip>

        <v-tooltip location="right">
            <template #activator="{ props }">
                <v-list-item v-bind="props" :to="{ name: 'board-manager' }" router>
                    Boards Manager
                    <template #prepend>
                        <v-icon>mdi-developer-board</v-icon>
                        <v-badge v-if="boardToUpdate" color="yellow" dot />
                    </template>
                </v-list-item>
            </template>
            <span>Boards Manager</span>
        </v-tooltip>

        <v-tooltip location="right">
            <template #activator="{ props }">
                <v-list-item v-bind="props" :to="{ name: 'library-manager' }" router>
                    Library Manager
                    <template #prepend>
                        <v-icon>mdi-library</v-icon>
                        <v-badge v-if="libraryToUpdate" color="yellow" dot />
                    </template>
                </v-list-item>
            </template>
            <span>Library Manager</span>
        </v-tooltip>

        <v-tooltip location="right">
            <template #activator="{ props }">
                <v-list-item :disabled="store.projectStatus?.status != ARDUINO_ERRORS.NO_ERRORS" v-bind="props" prepend-icon="mdi-application-array-outline"
                    :to="{ name: 'profiles-manager' }" router>
                    Profiles Manager
                </v-list-item>
            </template>
            <span>Profiles Manager</span>
        </v-tooltip>

        <v-tooltip location="right">
            <template #activator="{ props }">
                <v-list-item v-bind="props" prepend-icon="mdi-test-tube" :to="{ name: 'library-examples' }" router>
                    Library Examples
                </v-list-item>
            </template>
            <span>Library Examples</span>
        </v-tooltip>

        <v-tooltip location="right">
            <template #activator="{ props }">
                <v-list-item v-bind="props" data-testid="nav-other-tools" prepend-icon="mdi-tools" :to="{ name: 'other-tools' }" router>
                    Other Tools
                </v-list-item>
            </template>
            <span>External tools and resources</span>
        </v-tooltip>
    </v-navigation-drawer>

</template>
