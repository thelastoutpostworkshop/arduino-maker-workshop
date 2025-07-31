<script setup lang="ts">
import { onMounted, computed, ref, watchEffect } from 'vue';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, NO_DEFAULT_PROFILE, PROFILES_STATUS, YAML_FILENAME } from '@shared/messages';

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

function deleteProfile(name: string) {
    store.sendMessage({
        command: ARDUINO_MESSAGES.DELETE_BUILD_PROFILE,
        errorMessage: '',
        payload: name,
    });
}
function createProfile() {
    store.sendMessage({
        command: ARDUINO_MESSAGES.CREATE_BUILD_PROFILE,
        errorMessage: '',
        payload: profileName.value.trim(),
    });
}
const selectedDefaultProfile = ref<string | null>(null);

const defaultProfileOptions = computed(() => {
    const profiles = profilesList.value.map((p) => p.name);
    return [NO_DEFAULT_PROFILE, ...profiles];
});

watchEffect(() => {
    const defaultProfile = store.sketchProject?.yaml?.default_profile;
    if (defaultProfile) {
        selectedDefaultProfile.value = defaultProfile;
    } else {
        selectedDefaultProfile.value = NO_DEFAULT_PROFILE;
    }
});

function updateDefaultProfile() {
    const profileName = selectedDefaultProfile.value;
    store.sendMessage({
        command: ARDUINO_MESSAGES.SET_DEFAULT_PROFILE,
        errorMessage: '',
        payload: profileName,
    });
}

const profileStatusInformation = computed(() => {
    const status = store.sketchProject?.buildProfileStatus;
    switch (status) {
        case PROFILES_STATUS.ACTIVE:
            return {
                color: 'success',
                text: `The build profiles are active and will be used for compilation`,
                button: 'Deactivate',
                tooltip: 'Deactivate the build profiles'
            };
        case PROFILES_STATUS.INACTIVE:
            return {
                color: 'warning',
                text: `The build profiles are inactive and will not be used for compilation`,
                button: 'Activate',
                tooltip: 'Activate the build profiles'
            };
        default:
            return null;
    }
});

function changeStatusBuildProfile() {
    const status = store.sketchProject?.buildProfileStatus;
    switch (status) {
        case PROFILES_STATUS.ACTIVE:
            store.sendMessage({ command: ARDUINO_MESSAGES.SET_STATUS_BUILD_PROFILE, errorMessage: '', payload: PROFILES_STATUS.INACTIVE });
            break;
        case PROFILES_STATUS.INACTIVE:
            store.sendMessage({ command: ARDUINO_MESSAGES.SET_STATUS_BUILD_PROFILE, errorMessage: '', payload: PROFILES_STATUS.ACTIVE });
            break;
    }
}
onMounted(() => {
    store.sendMessage({ command: ARDUINO_MESSAGES.GET_BUILD_PROFILES, errorMessage: '', payload: '' });
    // selectedDefaultProfile.value = store.sketchProject?.yaml?.default_profile || '<none>';
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
                                <v-row class="mb-4" align="center">
                                    <v-select v-model="selectedDefaultProfile" :items="defaultProfileOptions"
                                        label="Select a default Profile" style="max-width: 300px" density="comfortable"
                                        @update:modelValue="updateDefaultProfile" />
                                </v-row>
                            </v-form>
                        </v-card-text>
                        <v-row class="mb-2">
                            <v-col cols="12" v-if="profileStatusInformation">
                                <v-alert variant="tonal" icon="mdi-application-array-outline"
                                    title="Build Profiles Information" border="start"
                                    :border-color="profileStatusInformation.color">
                                    {{ profileStatusInformation.text }}
                                    <template #append>
                                        <v-tooltip location="top">
                                            <template #activator="{ props }">
                                                <v-btn @click="changeStatusBuildProfile" v-bind="props">
                                                    {{ profileStatusInformation.button }}
                                                </v-btn>
                                            </template>
                                            <span>{{ profileStatusInformation.tooltip }}</span>
                                        </v-tooltip>
                                    </template>
                                </v-alert>
                            </v-col>
                        </v-row>
                    </v-card>
                    <div>You have {{ profilesList.length }} build profiles:</div>
                    <v-expansion-panels multiple variant="inset">
                        <v-expansion-panel v-for="profile in profilesList" :key="profile.name">
                            <v-expansion-panel-title>
                                <div class="d-flex align-center">
                                    <span>Profile: {{ profile.name }}</span>
                                    <v-tooltip location="top">
                                        <template #activator="{ props }">
                                            <v-btn icon variant="text" v-bind="props"
                                                @click.stop="deleteProfile(profile.name)">
                                                <v-icon>mdi-trash-can</v-icon>
                                            </v-btn>
                                        </template>
                                        <span>Delete this profile</span>
                                    </v-tooltip>
                                </div>
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
                    <v-card class="mb-5 pl-5">
                        <v-card-title>
                            <span>Create your first profile</span>
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

                </div>
            </div>


        </v-responsive>
    </v-container>
</template>
