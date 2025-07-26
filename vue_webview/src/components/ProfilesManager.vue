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

            <v-card v-if="store.profiles == null" class="mt-5">
                <v-card-item title="Loading profiles">
                    <template v-slot:subtitle>
                        Please wait
                    </template>
                </v-card-item>
                <v-card-text class="py-0">
                    <v-progress-linear color="grey" indeterminate></v-progress-linear>
                </v-card-text>
            </v-card>
            <div v-if="store.profiles">
                <v-btn class="mb-4" @click="createProfile">
                    Add a profile based on the current configuration
                </v-btn>
                <v-expansion-panels multiple variant="inset">
                    <v-expansion-panel v-for="profile in profilesList" :key="profile.name">
                        <v-expansion-panel-title>
                            Profile: {{ profile.name }}
                        </v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <v-card rounded="lg" color="primary">
                                <v-card-title>
                                    {{ profile.name }}
                                </v-card-title>
                                <v-card-subtitle>
                                    {{ profile.notes }}
                                </v-card-subtitle>
                                <v-card-text>
                                    <span>FQBN: {{ profile.fqbn }}</span>
                                </v-card-text>
                            </v-card>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                </v-expansion-panels>

                <v-list v-if="profilesList.length">
                    <v-list-item v-for="profile in profilesList" :key="profile.name" class="border mb-2 rounded">
                        <template #title>
                            <span class="font-weight-bold">{{ profile.name }}</span>
                        </template>
                        <template #subtitle>
                            FQBN: {{ profile.fqbn }}<br />
                            Port: {{ profile.port || '—' }}<br />
                            Notes: {{ profile.notes || 'No description' }}
                        </template>
                    </v-list-item>
                </v-list>
            </div>
            <div v-else>
                <v-card class="mt-5" rounded="lg">
                    <v-card-item title="No profiles">
                    </v-card-item>
                    <v-card-actions>
                        <v-btn class="mb-4" @click="createProfile">
                            Add a profile based on the current configuration
                        </v-btn>
                    </v-card-actions>
                </v-card>
            </div>

        </v-responsive>
    </v-container>
</template>
