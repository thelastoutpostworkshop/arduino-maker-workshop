<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, YAML_FILENAME } from '@shared/messages';

const store = useVsCodeStore();

const profileName = ref(`profile-${Date.now()}`);
const isProfileValid = ref(false);

// Vuetify validation rules
const profileRules = [
    (v: string) => !!v || 'Name is required.',
    (v: string) => {
        const profiles = store.sketchProject?.yaml?.profiles || {};
        return !(v in profiles) || `Profile "${v}" already exists.`;
    },
];


function createProfile() {
    store.sendMessage({
        command: ARDUINO_MESSAGES.CREATE_BUILD_PROFILE,
        errorMessage: '',
        payload: profileName.value.trim(),
    });

    // profileName.value = `profile-${Date.now()}`; // generate next default name
}

onMounted(() => {
    store.sendMessage({ command: ARDUINO_MESSAGES.GET_BUILD_PROFILES, errorMessage: '', payload: '' });
});

// Convert SketchYaml.profiles object to an array for display
const profilesList = computed(() => {
    if (!store.sketchProject?.yaml?.profiles) return [];
    return Object.entries(store.sketchProject.yaml.profiles).map(([name, data]) => ({
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

            <v-card v-if="store.sketchProject == null" class="mt-5">
                <v-card-item title="Loading profiles">
                    <template v-slot:subtitle>
                        Please wait
                    </template>
                </v-card-item>
                <v-card-text class="py-0">
                    <v-progress-linear color="grey" indeterminate></v-progress-linear>
                </v-card-text>
            </v-card>
            <div v-if="store.sketchProject">
                <div v-if="store.sketchProject.error">
                    <v-alert type="error">
                        <v-alert-title>Failed to parse {{ YAML_FILENAME }}</v-alert-title>
                        There was a problem parsing {{ YAML_FILENAME }} — the file might be incorrectly formatted:
                        <div>
                            {{ store.sketchProject.error }}
                        </div>
                    </v-alert>
                </div>
                <div v-else-if="store.sketchProject.yaml">
                    <v-card class="mb-5 pl-5">
                        <v-card-title>
                            <span>Tools</span>
                        </v-card-title>
                        <v-card-text class="pt-4">
                            <v-form v-model="isProfileValid">
                                <v-row class="mb-4" align="center">
                                    <v-text-field v-model="profileName" label="New Profile name" :rules="profileRules"
                                        hide-details="auto" density="comfortable" class="mr-4" clearable
                                        style="max-width: 300px;" />
                                    <v-tooltip location="top">
                                        <template #activator="{ props }">
                                            <v-btn v-bind="props" @click="createProfile" :disabled="!isProfileValid">
                                                Create a new profile
                                            </v-btn>
                                        </template>
                                        <span>Create a new profile using the current configuration</span>
                                    </v-tooltip>
                                </v-row>
                            </v-form>
                        </v-card-text>
                    </v-card>
                    <div>Your Build Profiles:</div>
                    <v-expansion-panels multiple variant="inset">
                        <v-expansion-panel v-for="profile in profilesList" :key="profile.name">
                            <v-expansion-panel-title>
                                Profile: {{ profile.name }}
                            </v-expansion-panel-title>
                            <v-expansion-panel-text>
                                <v-card rounded="lg" color="primary">
                                    <v-card-title>{{ profile.name }}</v-card-title>
                                    <v-card-subtitle>{{ profile.notes || 'No description' }}</v-card-subtitle>
                                    <v-card-text>
                                        <div><strong>FQBN:</strong> {{ profile.fqbn }}</div>
                                        <div><strong>Programmer:</strong> {{ profile.programmer || '—' }}</div>

                                        <div v-if="profile.platforms?.length" class="mt-4">
                                            <strong>Platforms:</strong>
                                            <v-list density="compact">
                                                <v-list-item v-for="(platform, idx) in profile.platforms"
                                                    :key="`platform-${idx}`">
                                                    <v-list-item-title>
                                                        {{ platform.platform }}
                                                        <v-list-item-subtitle v-if="platform.platform_index_url">
                                                            {{ platform.platform_index_url }}
                                                        </v-list-item-subtitle>
                                                    </v-list-item-title>
                                                </v-list-item>
                                            </v-list>
                                        </div>
                                        <div v-if="profile.libraries?.length" class="mt-4">
                                            <strong>Libraries:</strong>
                                            <v-list density="compact">
                                                <v-list-item v-for="(lib) in profile.libraries">
                                                    <v-list-item-title>
                                                        {{ lib }}
                                                    </v-list-item-title>
                                                </v-list-item>
                                            </v-list>
                                        </div>
                                    </v-card-text>
                                </v-card>
                            </v-expansion-panel-text>

                        </v-expansion-panel>
                    </v-expansion-panels>
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
            </div>


        </v-responsive>
    </v-container>
</template>
