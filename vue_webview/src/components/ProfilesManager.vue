<script setup lang="ts">
import { onMounted, computed, ref, watchEffect } from 'vue';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, BuildProfileUpdate, ConfigOptionValue, NO_DEFAULT_PROFILE, PROFILES_STATUS, YAML_FILENAME } from '@shared/messages';
import { en } from 'vuetify/locale';

const store = useVsCodeStore();

const profileName = ref(`profile-${Date.now()}`);
const isProfileValid = ref(false);
const selectedLibraryVersion = ref<Record<string, Record<string, string>>>({});
const selectedPlatformVersion = ref<Record<string, Record<string, string>>>({});
const selectedDefaultProfile = ref<string | null>(null);
const editingProfile = ref<string | null>(null);
const editingNotes = ref<string | null>(null);
const showBoardConfiguration = ref<Record<string, boolean>>({});
const disableShowBoardConfiguration = ref<Record<string, boolean>>({});

function updateConfiguration(config: Record<string, ConfigOptionValue>) {
    if (!store.boardOptions) return;
    // const configString = Object.entries(config)
    //     .map(([key, opt]) => `${key}=${opt.value}`)
    //     .join(',');

    // store.sendMessage({
    //     command: ARDUINO_MESSAGES.SET_BOARD_OPTIONS,
    //     errorMessage: '',
    //     payload: configString
    // });
}

function setVisibilityBoardConfiguration(profile_name: string, fqbn: string) {
    showBoardConfiguration.value[profile_name] = !showBoardConfiguration.value[profile_name];
    if (showBoardConfiguration.value[profile_name]) {
        // Disable all other profiles except the current one if it's open to avoid sending overlapping ARDUINO_MESSAGES.CLI_BOARD_OPTIONS_PROFILE
        Object.keys(showBoardConfiguration.value).forEach((name) => {
            disableShowBoardConfiguration.value[name] =
                showBoardConfiguration.value[profile_name] && name !== profile_name;
        });
        store.sendMessage({
            command: ARDUINO_MESSAGES.CLI_BOARD_OPTIONS_PROFILE,
            errorMessage: "",
            payload: fqbn
        })
    }
}

function enableAllBoardConfigurations() {
    Object.keys(showBoardConfiguration.value).forEach((name) => {
        disableShowBoardConfiguration.value[name] = false;
    });
}

watchEffect(() => {
    if (!store.profileBoardOptions) return;
    console.log("profileBoardOptions" + store.profileBoardOptions);
    store.profileBoardOptions = null;
    enableAllBoardConfigurations();
});
const disabledButton = computed(() => {
    return !isProfileValid.value || store.compileInProgress !== '';
});
function startEditProfileName(profileName: string) {
    editingProfile.value = profileName;
}

function startEditProfileNotes(profileName: string) {
    editingNotes.value = profileName;
}

function stopEditProfileName() {
    editingProfile.value = null;
}

function stopEditProfileNotes() {
    editingNotes.value = null;
}
// Profile name validation rules
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
    store.profileUpdating = `Creating profile ${profileName.value.trim()}`;

    store.sendMessage({
        command: ARDUINO_MESSAGES.CREATE_BUILD_PROFILE,
        errorMessage: '',
        payload: profileName.value.trim(),
    });
}

const defaultProfileOptions = computed(() => {
    const profiles = profilesList.value.map((p) => p.name);
    return [NO_DEFAULT_PROFILE, ...profiles];
});

function parseLibraryEntry(entry: string): { name: string; version: string } {
    const match = entry.match(/^(.*?)\s*\((.*?)\)$/);
    if (!match) {
        return { name: entry, version: '' };
    }
    return { name: match[1].trim(), version: match[2].trim() };
}

function getAvailableLibraryVersions(libraryName: string): string[] {
    const lib = store.libraries?.libraries.find(l => l.name === libraryName);
    return lib?.available_versions || [];
}

function updateLibraryVersion(profileName: string, libraryEntry: string, version: string) {
    // Parse the original entry
    const { name } = parseLibraryEntry(libraryEntry);

    // Get the profile from store
    const profile = store.sketchProject?.yaml?.profiles?.[profileName];
    if (!profile || !profile.libraries) return;

    // Create a new libraries array with the updated entry
    const newLibraries = profile.libraries.map(lib => {
        const { name: libName } = parseLibraryEntry(lib);
        if (libName === name) {
            return `${libName} (${version})`;
        }
        return lib;
    });
    const updates: BuildProfileUpdate = {
        profile_name: profileName,
        libraries: newLibraries
    }
    store.sendMessage({
        command: ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_LIBRARIES,
        errorMessage: '',
        payload: updates,
    });
}

function parsePlatformEntry(entry: string): { name: string; version: string } {
    const match = entry.match(/^(.*?)\s*\((.*?)\)$/);
    if (!match) {
        return { name: entry, version: '' };
    }
    return { name: match[1].trim(), version: match[2].trim() };
}

function getAvailablePlatformVersions(platformName: string): string[] {
    const platform = store.platform?.platforms.find(p => {
        return platformName === p.id;
    });

    if (!platform) return [];
    return Object.keys(platform.releases);
}

function updatePlatformVersion(profileName: string, platformEntry: string, version: string) {
    const { name } = parsePlatformEntry(platformEntry);
    const profile = store.sketchProject?.yaml?.profiles?.[profileName];
    if (!profile || !profile.platforms) return;

    const newPlatforms = profile.platforms.map(p => {
        const { name: platName } = parsePlatformEntry(p.platform);
        if (platName === name) {
            return {
                ...p,
                platform: `${platName} (${version})`
            };
        }
        return p;
    });
    const updates: BuildProfileUpdate = {
        profile_name: profileName,
        platforms: newPlatforms
    }
    store.sendMessage({
        command: ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_PLATFORMS,
        errorMessage: '',
        payload: updates
    });
}
const profilesList = computed(() => {
    if (!store.sketchProject?.yaml?.profiles) return [];

    const profiles = Object.entries(store.sketchProject.yaml.profiles).map(([name, data]) => {
        // Initialize the toggle state for each profile if not already present
        if (!(name in showBoardConfiguration.value)) {
            showBoardConfiguration.value[name] = false;
        }

        return {
            originalName: name, // keep original for renaming
            name,
            notes: data.notes || '',
            ...data,
        };
    });

    return profiles;
});


function renameProfile(oldName: string, newName: string) {
    if (!newName || oldName === newName) return;

    const payload: BuildProfileUpdate = {
        profile_name: oldName,
        new_profile_name: newName,
    };

    store.sendMessage({
        command: ARDUINO_MESSAGES.RENAME_BUILD_PROFILE_NAME,
        errorMessage: '',
        payload,
    });
}

function updateProfileNotes(profileName: string, notes: string) {
    const payload: BuildProfileUpdate = {
        profile_name: profileName,
        notes,
    };

    store.sendMessage({
        command: ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_NOTES,
        errorMessage: '',
        payload,
    });
}


watchEffect(() => {
    if (!store.platform) return;
    selectedPlatformVersion.value = {};

    profilesList.value.forEach(profile => {
        selectedPlatformVersion.value[profile.name] = {};

        (profile.platforms || []).forEach(platEntry => {
            const { name, version } = parsePlatformEntry(platEntry.platform);
            const availableVersions = getAvailablePlatformVersions(name);

            selectedPlatformVersion.value[profile.name][name] =
                version && availableVersions.includes(version)
                    ? version
                    : availableVersions[availableVersions.length - 1] || 'latest';
        });
    });
});

watchEffect(() => {
    if (!store.libraries) return;

    selectedLibraryVersion.value = {};

    profilesList.value.forEach(profile => {
        selectedLibraryVersion.value[profile.name] = {};

        (profile.libraries || []).forEach(libEntry => {
            const { name, version } = parseLibraryEntry(libEntry);
            const availableVersions = getAvailableLibraryVersions(name);

            selectedLibraryVersion.value[profile.name][name] =
                version && availableVersions.includes(version)
                    ? version
                    : availableVersions[availableVersions.length - 1] || 'latest';
        });
    });
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
    store.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH, errorMessage: "", payload: "" });
    store.sendMessage({ command: ARDUINO_MESSAGES.CLI_CORE_SEARCH, errorMessage: "", payload: "" });

    // selectedDefaultProfile.value = store.sketchProject?.yaml?.default_profile || '<none>';
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
                                    <v-tooltip v-if="!store.profileUpdating" location="top">
                                        <template #activator="{ props }">
                                            <v-btn v-bind="props" @click="createProfile" :disabled="disabledButton">
                                                Create a new profile
                                            </v-btn>
                                        </template>
                                        <span>Create a new profile using the current configuration</span>
                                    </v-tooltip>
                                    <div v-else>
                                        <v-card>
                                            <v-card-item :title="store.profileUpdating">
                                                <template v-slot:subtitle>
                                                    Please wait
                                                </template>
                                            </v-card-item>
                                            <v-card-text class="py-0">
                                                <v-progress-linear color="grey" indeterminate />
                                            </v-card-text>
                                        </v-card>
                                    </div>
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
                                                <v-btn @click="changeStatusBuildProfile" v-bind="props"
                                                    :disabled="store.profileUpdating !== ''">
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
                    <v-expansion-panels multiple variant="popout">
                        <v-expansion-panel v-for="profile in profilesList" :key="profile.name">
                            <v-expansion-panel-title>
                                <span>Profile: {{ profile.name }}</span>
                                <v-tooltip location="top">
                                    <template #activator="{ props }">
                                        <v-btn icon variant="text" v-bind="props" size="small"
                                            @click.stop="deleteProfile(profile.name)">
                                            <v-icon>mdi-trash-can</v-icon>
                                        </v-btn>
                                    </template>
                                    <span>Delete this profile</span>
                                </v-tooltip>
                            </v-expansion-panel-title>
                            <v-expansion-panel-text>
                                <v-card rounded="lg" color="primary">
                                    <v-card-title class="d-flex align-center">
                                        <!-- Profile name (readonly until editing) -->
                                        <template v-if="editingProfile === profile.originalName">
                                            <v-text-field v-model="profile.name" label="Profile Name" variant="outlined"
                                                density="compact" class="flex-grow-1 mr-3"
                                                @blur="() => { renameProfile(profile.originalName, profile.name); stopEditProfileName(); }" />
                                        </template>
                                        <template v-else>
                                            <span class="flex-grow-1">{{ profile.name }}</span>
                                            <v-btn icon size="x-small"
                                                @click="startEditProfileName(profile.originalName)">
                                                <v-icon>mdi-pencil</v-icon>
                                            </v-btn>
                                        </template>
                                    </v-card-title>

                                    <v-card-subtitle class="d-flex align-center">
                                        <!-- Profile notes (readonly until editing) -->
                                        <template v-if="editingNotes === profile.name">
                                            <v-textarea v-model="profile.notes" label="Profile Notes" variant="outlined"
                                                density="compact" rows="2" auto-grow class="flex-grow-1 mr-3"
                                                @blur="() => { updateProfileNotes(profile.name, profile.notes); stopEditProfileNotes(); }" />
                                        </template>
                                        <template v-else>
                                            <span class="flex-grow-1">{{ profile.notes || 'No description' }}</span>
                                            <v-btn icon size="x-small" @click="startEditProfileNotes(profile.name)">
                                                <v-icon>mdi-pencil</v-icon>
                                            </v-btn>
                                        </template>
                                    </v-card-subtitle>

                                    <v-card-text>
                                        <div><strong>Programmer:</strong> {{ profile.programmer || '—' }}</div>

                                        <div v-if="profile.platforms?.length" class="mt-4">
                                            <strong>Platforms:</strong>
                                            <v-list density="compact">
                                                <v-list-item v-for="platEntry in profile.platforms"
                                                    :key="platEntry.platform">
                                                    <v-list-item-title class="d-flex align-center">
                                                        <span class="flex-grow-1">{{
                                                            parsePlatformEntry(platEntry.platform).name
                                                            }}</span>

                                                        <v-select v-if="store.platform"
                                                            :items="getAvailablePlatformVersions(parsePlatformEntry(platEntry.platform).name)"
                                                            v-model="selectedPlatformVersion[profile.name][parsePlatformEntry(platEntry.platform).name]"
                                                            density="compact" style="max-width: 150px"
                                                            @update:model-value="val => updatePlatformVersion(profile.name, platEntry.platform, val)" />
                                                    </v-list-item-title>
                                                    <v-list-item-subtitle v-if="platEntry.platform_index_url">
                                                        {{ platEntry.platform_index_url }}
                                                    </v-list-item-subtitle>
                                                </v-list-item>
                                            </v-list>
                                        </div>
                                        <div v-if="profile.libraries?.length" class="mt-4">
                                            <strong>Libraries:</strong>
                                            <v-list density="compact">
                                                <v-list-item v-for="(libEntry) in profile.libraries" :key="libEntry">
                                                    <v-list-item-title class="d-flex align-center">
                                                        <span class="flex-grow-1">{{ parseLibraryEntry(libEntry).name
                                                            }}</span>
                                                        <v-select v-if="store.libraries"
                                                            :items="getAvailableLibraryVersions(parseLibraryEntry(libEntry).name)"
                                                            v-model="selectedLibraryVersion[profile.name][parseLibraryEntry(libEntry).name]"
                                                            density="compact" style="max-width: 150px"
                                                            @update:model-value="val => updateLibraryVersion(profile.name, libEntry, val)" />
                                                    </v-list-item-title>
                                                </v-list-item>
                                            </v-list>
                                        </div>
                                        <v-expand-transition>
                                            <div v-show="showBoardConfiguration[profile.name]" class="mt-5">
                                                <span v-if="store.boardOptions?.config_options">
                                                    <BoardConfigurationForm v-if="store.boardOptions?.config_options"
                                                        :options="store.boardOptions?.config_options"
                                                        :boardName="store.boardOptions?.name"
                                                        @update="updateConfiguration">
                                                        <template #title>
                                                            <h2 class="text-h6 font-weight-bold">Board Options</h2>
                                                        </template>
                                                        <template #subtitle>
                                                            <div class="text-subtitle-1">
                                                                Select your board options
                                                            </div>
                                                        </template>
                                                    </BoardConfigurationForm>

                                                </span>
                                                <span v-else>
                                                    No options available for your board
                                                </span>
                                            </div>
                                        </v-expand-transition>
                                    </v-card-text>
                                    <v-card-actions>
                                        <span>Change board options</span>
                                        <v-spacer></v-spacer>

                                        <v-btn :disabled="disableShowBoardConfiguration[profile.name]"
                                            :icon="showBoardConfiguration[profile.name] ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                                            @click="setVisibilityBoardConfiguration(profile.name, profile.fqbn)"></v-btn>
                                    </v-card-actions>
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
                                    <v-tooltip v-if="!store.profileUpdating" location="top">
                                        <template #activator="{ props }">
                                            <v-btn v-bind="props" @click="createProfile" :disabled="disabledButton">
                                                Create a new profile
                                            </v-btn>
                                        </template>
                                        <span>Create a new profile using the current configuration</span>
                                    </v-tooltip>
                                    <div v-else>
                                        <v-card>
                                            <v-card-item :title="store.profileUpdating">
                                                <template v-slot:subtitle>
                                                    Please wait
                                                </template>
                                            </v-card-item>
                                            <v-card-text class="py-0">
                                                <v-progress-linear color="grey" indeterminate />
                                            </v-card-text>
                                        </v-card>
                                    </div>
                                </v-row>
                            </v-form>
                        </v-card-text>
                    </v-card>

                </div>
            </div>


        </v-responsive>
    </v-container>
</template>
