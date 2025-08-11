<script setup lang="ts">
import { onMounted, computed, ref, watchEffect } from 'vue';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, BoardConfiguration, BuildProfileUpdate, ConfigOptionValue, NO_DEFAULT_PROFILE, NO_PROGRAMMER, PortSettings, YAML_FILENAME } from '@shared/messages';
import { useRouter } from 'vue-router';
import { getAvailablePorts } from '@/utilities/utils';
import { VForm } from 'vuetify/components';
type VFormInstance = InstanceType<typeof VForm>

const router = useRouter()
const store = useVsCodeStore();
store.profileBoardOptions = null;

const profileName = ref(`profile-${Date.now()}`);
const isProfileValid = ref(false);
const selectedLibraryVersion = ref<Record<string, Record<string, string>>>({});
const selectedPlatformVersion = ref<Record<string, Record<string, string>>>({});
const selectedProgrammer = ref<Record<string, string>>({});
const selectedDefaultProfile = ref<string | null>(null);
const newProfileName = ref<Record<string, string>>({});
const editProfileName = ref<Record<string, boolean>>({});
const addLibrariesFlag = ref<Record<string, boolean>>({});
const editingNotes = ref<string | null>(null);
const showBoardConfiguration = ref<Record<string, boolean>>({});
const disableShowBoardConfiguration = ref<Record<string, boolean>>({});
const profileBoardOptions = ref<Record<string, BoardConfiguration>>({});
const profileBoardOptionsError = ref<Record<string, boolean>>({});
const profileBoardOptionsRetrieving = ref<Record<string, boolean>>({});
const profileMonitorSettings = ref<Record<string, PortSettings>>({});
const portsAvailable = computed(() => getAvailablePorts(store));
const forms = ref<Record<number, InstanceType<typeof VForm> | null>>({})

// state for the inline "add library" UI
const addLibrarySelection = ref<Record<string, string>>({})
const libraryNames = computed(() =>
    store.libraries?.libraries?.map(l => l.name) ?? []
)

function libraryAlreadyInProfile(profileName: string, libName: string) {
    const libs = store.sketchProject?.yaml?.profiles?.[profileName]?.libraries ?? []
    return libs.some(entry => parseLibraryEntry(entry).name === libName)
}

function addLibraryToProfile(profileName: string) {
    const libName = addLibrarySelection.value[profileName]
    if (!libName) return

    if (libraryAlreadyInProfile(profileName, libName)) {
        // optionally toast/snackbar here; we'll just no-op
        return
    }

    const versions = getAvailableLibraryVersions(libName)
    // default to latest known version, or 'latest' if none listed
    const version = versions[versions.length - 1] || 'latest'
    const newEntry = `${libName} (${version})`

    const profile = store.sketchProject?.yaml?.profiles?.[profileName]
    const updated = [...(profile?.libraries ?? []), newEntry]

    const updates: BuildProfileUpdate = {
        profile_name: profileName,
        libraries: updated
    }

    store.sendMessage({
        command: ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_LIBRARIES,
        errorMessage: '',
        payload: updates,
    })

    // keep the picker open, but clear the selection
    addLibrarySelection.value[profileName] = ''
}

function removeLibraryFromProfile(profileName: string, libEntry: string) {
    const profile = store.sketchProject?.yaml?.profiles?.[profileName]
    if (!profile?.libraries) return

    const updated = profile.libraries.filter(l => l !== libEntry)

    const updates: BuildProfileUpdate = {
        profile_name: profileName,
        libraries: updated
    }

    store.sendMessage({
        command: ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_LIBRARIES,
        errorMessage: '',
        payload: updates
    })
}


async function validateAndRename(originalName: string, newName: string, index: number) {
    if (originalName === newName) {
        editProfileName.value[originalName] = false
        return;
    }
    const form = forms.value[index]
    if (!form) return
    const res = await form.validate()
    if (res.valid) {
        renameProfile(originalName, newName)
        editProfileName.value[originalName] = false
    }
}
function uniqueCopyName(base: string): string {
    const profiles = Object.keys(store.sketchProject?.yaml?.profiles || {});
    // e.g. "MyProfile (copy)" or "MyProfile (copy 2)"
    const baseCopy = `${base}-copy`;
    if (!profiles.includes(baseCopy)) return baseCopy;
    let i = 2;
    while (profiles.includes(`${base}-copy-${i}`)) i++;
    return `${base} (copy-${i})`;
}

function duplicateProfile(profile_name: string) {
    const newName = uniqueCopyName(profile_name);
    const update: BuildProfileUpdate = {
        profile_name: profile_name,
        new_profile_name: newName
    }
    store.sendMessage({
        command: ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_DUPLICATE,
        errorMessage: "",
        payload: update,
    });;
    return;
}


function updatePortSettings({ settings, profile_name }: { settings: PortSettings; profile_name: string }) {
    const safeSettings: PortSettings = {
        port: settings.port,
        baudRate: settings.baudRate,
        lineEnding: settings.lineEnding,
        dataBits: settings.dataBits,
        parity: settings.parity,
        stopBits: settings.stopBits
    }
    const updates: BuildProfileUpdate = {
        profile_name: profile_name,
        port_settings: safeSettings
    }
    store.sendMessage({
        command: ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_PORT_SETTINGS,
        errorMessage: "",
        payload: updates,
    });;
}
function refreshPorts() {
    store.boardConnected = null;
    store.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_CONNECTED, errorMessage: "", payload: "" });
}
function getProgrammerOptions(profileName: string) {
    const opts = profileBoardOptions.value[profileName]?.programmers || [];
    return [{ name: NO_PROGRAMMER, id: NO_PROGRAMMER }, ...opts];
}

function updateProfileProgrammer(profileName: string, programmer: string) {
    const update: BuildProfileUpdate = {
        profile_name: profileName,
        programmer
    };
    store.sendMessage({
        command: ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_PROGRAMMER,
        errorMessage: '',
        payload: update
    });
}

function updateConfiguration({ profile_name, options }: { profile_name?: string, options: Record<string, ConfigOptionValue> }) {
    const configString = Object.entries(options)
        .map(([key, opt]) => `${key}=${opt.value}`)
        .join(',');

    if (profile_name) {
        const updates: BuildProfileUpdate = {
            profile_name: profile_name,
            fqbn: configString
        }
        store.sendMessage({
            command: ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_FQBN,
            errorMessage: '',
            payload: updates
        });
    }
}

function setVisibilityBoardConfiguration(profile_name: string, fqbn: string) {
    showBoardConfiguration.value[profile_name] = !showBoardConfiguration.value[profile_name];
    if (showBoardConfiguration.value[profile_name]) {
        if (!profileBoardOptions.value[profile_name]) {
            // Disable all other profiles except the current one if it's open to avoid sending overlapping ARDUINO_MESSAGES.CLI_BOARD_OPTIONS_PROFILE
            Object.keys(showBoardConfiguration.value).forEach((name) => {
                disableShowBoardConfiguration.value[name] =
                    showBoardConfiguration.value[profile_name] && name !== profile_name;
            });
            store.profileBoardOptionsName = profile_name;
            store.profileBoardOptionsError = ""
            profileBoardOptionsRetrieving.value[profile_name] = true;

            store.sendMessage({
                command: ARDUINO_MESSAGES.CLI_BOARD_OPTIONS_PROFILE,
                errorMessage: "",
                payload: fqbn
            })
        }
    }
}

function enableAllBoardConfigurations() {
    Object.keys(showBoardConfiguration.value).forEach((name) => {
        disableShowBoardConfiguration.value[name] = false;
    });
}

watchEffect(() => {
    const opts = store.profileBoardOptions;
    if (!opts) return;
    // Assume store also has lastProfileName 
    const profileName = store.profileBoardOptionsName;
    if (profileName) {
        profileBoardOptions.value[profileName] = opts;
        profileBoardOptionsRetrieving.value[profileName] = false;

        profilesList.value.forEach(profile => {

            if (profile.programmer) {
                selectedProgrammer.value[profile.name] = profile.programmer;
            } else {
                selectedProgrammer.value[profile.name] = NO_PROGRAMMER;
            }
        });
    }

    // Clear to avoid overwriting on next change
    store.profileBoardOptions = null;
    enableAllBoardConfigurations();
});
watchEffect(() => {
    const error = store.profileBoardOptionsError;
    // Assume store also has lastProfileName 
    const profileName = store.profileBoardOptionsName;
    if (profileName) {
        if (error) {
            profileBoardOptionsRetrieving.value[profileName] = false;
            profileBoardOptionsError.value[profileName] = true;
        } else {
            profileBoardOptionsError.value[profileName] = false;
        }
    }
    store.profileBoardOptionsError = "";
    enableAllBoardConfigurations();
});

const disabledButton = computed(() => {
    return !isProfileValid.value || store.compileInProgress !== '';
});

function startEditProfileNotes(profileName: string) {
    editingNotes.value = profileName;
}

function stopEditProfileNotes() {
    editingNotes.value = null;
}

// Optional helper for reuse
const isValidProfileName = (s: unknown) => /^[A-Za-z0-9_.-]+$/.test(String(s ?? ''));

const profileNameRule = (newname: string) => {
    if (!newname) return 'Name is required.';
    if (!isValidProfileName(newname)) {
        return 'Allowed: letters, numbers, underscore (_), dot (.), dash (-)';
    }
    return true;
}
const profileNameExistRule = (newname: string, originalName?: string) => {
    if (originalName) {
        if (originalName == newname) {
            return true;
        }
    }
    const profiles = store.sketchProject?.yaml?.profiles || {};
    return !(newname in profiles) || `Profile "${newname}" already exists.`;
}

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
        if (!(name in newProfileName.value)) {
            newProfileName.value[name] = name;
            editProfileName.value[name] = false
        }
        if (!profileMonitorSettings.value[name]) {
            profileMonitorSettings.value[name] = {
                port: data.port || "",
                baudRate: parseInt(data.port_config?.baudrate ?? "115200"),
                lineEnding: data.port_config?.lineEnding ?? "\r\n",
                dataBits: parseInt(data.port_config?.bits ?? "8"),
                parity: data.port_config?.parity ?? "none",
                stopBits: data.port_config?.stop_bits ?? "one",
            };
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
        addLibrariesFlag.value[profile.name] = false;

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
                                    <v-text-field v-model="profileName" label="New Profile name" clearable
                                        :rules="[profileNameRule(profileName), profileNameExistRule(profileName)]"
                                        hide-details="auto" density="comfortable" class="mr-4"
                                        style="max-width: 300px;" />
                                    <v-tooltip v-if="!store.profileUpdating" location="top">
                                        <template #activator="{ props }">
                                            <div
                                                v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_ERRORS && !store.projectInfo?.board">
                                                <v-btn @click="router.push({ name: 'board-selection' })">Select your
                                                    board first</v-btn>
                                            </div>
                                            <div v-else>
                                                <v-btn v-bind="props" @click="createProfile" :disabled="disabledButton">
                                                    Create a new profile
                                                </v-btn>
                                            </div>
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
                    </v-card>
                    <div>You have {{ profilesList.length }} build profiles:</div>
                    <v-expansion-panels multiple variant="popout">
                        <v-expansion-panel v-for="(profile, index) in profilesList" :key="profile.name">
                            <v-expansion-panel-title>
                                <span>Profile: {{ profile.name }}</span>
                                <v-tooltip location="top">
                                    <template #activator="{ props }">
                                        <v-btn icon variant="text" v-bind="props" size="small" class="mr-4"
                                            @click.stop="duplicateProfile(profile.name)">
                                            <v-icon>mdi-content-copy</v-icon>
                                        </v-btn>
                                    </template>
                                    <span>Duplicate this profile</span>
                                </v-tooltip>
                                <v-spacer></v-spacer>
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
                                <v-card rounded="lg" variant="tonal">
                                    <v-card-title class="d-flex align-center">
                                        <template v-if="editProfileName[profile.name]">
                                            <v-form
                                                :ref="(el) => (forms[index] = (el as unknown as VFormInstance) ?? null)"
                                                validate-on="input" class="w-100"
                                                @submit.prevent="validateAndRename(profile.name, newProfileName[profile.name], index)">
                                                <v-text-field v-model="newProfileName[profile.name]"
                                                    label="Profile Name" variant="outlined" density="compact"
                                                    class="flex-grow-1" clearable
                                                    :rules="[profileNameRule(newProfileName[profile.name]), profileNameExistRule(newProfileName[profile.name], profile.name)]"
                                                    @blur="validateAndRename(profile.name, newProfileName[profile.name], index)">

                                                </v-text-field>
                                            </v-form>
                                        </template>
                                        <template v-else>
                                            <span class="flex-grow-1">{{ profile.name }}</span>
                                            <v-btn icon size="x-small"
                                                @click="editProfileName[profile.name] = !editProfileName[profile.name]">
                                                <v-icon>mdi-pencil</v-icon>
                                            </v-btn>
                                        </template>
                                    </v-card-title>

                                    <v-card-subtitle class="d-flex align-center">
                                        <template v-if="editingNotes === profile.name">
                                            <v-textarea v-model="profile.notes" label="Profile Notes" variant="outlined"
                                                density="compact" rows="2" auto-grow class="flex-grow-1 mr-3 mt-3"
                                                clearable
                                                @blur="() => { updateProfileNotes(profile.name, profile.notes); stopEditProfileNotes(); }" />
                                        </template>
                                        <template v-else>
                                            <pre class="flex-grow-1">{{ profile.notes || 'No description' }}</pre>
                                            <v-btn icon size="x-small" @click="startEditProfileNotes(profile.name)">
                                                <v-icon>mdi-pencil</v-icon>
                                            </v-btn>
                                        </template>
                                    </v-card-subtitle>

                                    <v-card-text>
                                        <span v-if="profile.platforms?.length" class="mt-4">
                                            <strong>Platforms:</strong>
                                            <v-list density="compact" variant="tonal">
                                                <v-list-item v-for="platEntry in profile.platforms"
                                                    :key="platEntry.platform">
                                                    <v-list-item-title>
                                                        {{ parsePlatformEntry(platEntry.platform).name }}

                                                    </v-list-item-title>
                                                    <v-list-item-subtitle v-if="platEntry.platform_index_url">
                                                        {{ platEntry.platform_index_url }}
                                                    </v-list-item-subtitle>
                                                    <template v-slot:append>
                                                        <v-select v-if="store.platform" hide-details
                                                            :items="getAvailablePlatformVersions(parsePlatformEntry(platEntry.platform).name)"
                                                            v-model="selectedPlatformVersion[profile.name][parsePlatformEntry(platEntry.platform).name]"
                                                            density="compact"
                                                            @update:model-value="val => updatePlatformVersion(profile.name, platEntry.platform, val)" />
                                                    </template>
                                                </v-list-item>
                                            </v-list>
                                        </span>
                                        <strong>Libraries:</strong>
                                        <v-tooltip v-if="store.libraries" location="top">
                                            <template #activator="{ props }">
                                                <v-btn icon variant="text" v-bind="props" size="small"
                                                    @click="addLibrariesFlag[profile.name] = true">
                                                    <v-icon>mdi-plus-box</v-icon>
                                                </v-btn>
                                            </template>
                                            <span>Add libraries</span>
                                        </v-tooltip>
                                        <div v-if="addLibrariesFlag[profile.name]" class="mt-2">
                                            <v-row class="align-center" no-gutters>
                                                <v-col cols="12" md="8">
                                                    <v-autocomplete v-model="addLibrarySelection[profile.name]"
                                                        :items="libraryNames" label="Search libraries" hide-details
                                                        clearable density="compact" variant="outlined"
                                                        :disabled="!store.libraries" />
                                                </v-col>
                                                <v-col cols="12" md="4" class="pl-md-3 mt-2 mt-md-0">
                                                    <v-btn :disabled="!addLibrarySelection[profile.name]"
                                                        @click="addLibraryToProfile(profile.name)">
                                                        Add
                                                    </v-btn>
                                                    <v-btn variant="text" class="ml-2"
                                                        @click="() => { addLibrariesFlag[profile.name] = false; addLibrarySelection[profile.name] = '' }">
                                                        Cancel
                                                    </v-btn>
                                                </v-col>
                                            </v-row>
                                        </div>

                                        <span v-if="profile.libraries?.length" class="mt-4">
                                            <v-list density="compact" variant="tonal">
                                                <v-list-item v-for="(libEntry) in profile.libraries" :key="libEntry">
                                                    <v-list-item-title>
                                                        {{ parseLibraryEntry(libEntry).name }}
                                                    </v-list-item-title>
                                                    <template v-slot:append>
                                                        <v-select v-if="store.libraries" hide-details
                                                            :items="getAvailableLibraryVersions(parseLibraryEntry(libEntry).name)"
                                                            v-model="selectedLibraryVersion[profile.name][parseLibraryEntry(libEntry).name]"
                                                            density="compact"
                                                            @update:model-value="val => updateLibraryVersion(profile.name, libEntry, val)" />
                                                        <v-tooltip location="top">
                                                            <template #activator="{ props }">
                                                                <v-btn icon variant="text" size="small" v-bind="props"
                                                                    @click="removeLibraryFromProfile(profile.name, libEntry)">
                                                                    <v-icon>mdi-trash-can</v-icon>
                                                                </v-btn>
                                                            </template>
                                                            <span>Remove this library</span>
                                                        </v-tooltip>
                                                    </template>
                                                </v-list-item>
                                            </v-list>
                                        </span>
                                        <div class="ml-3" v-else>
                                            No libraries
                                        </div>
                                        <div class="mt-2">
                                            <span>
                                                <strong>Port Settings:</strong>
                                            </span>
                                            <SerialMonitorSettings
                                                v-model:monitorPortSettings="profileMonitorSettings[profile.name]"
                                                :profile_name="profile.name" :serialPortsAvailable="portsAvailable"
                                                @update="updatePortSettings" @refreshPorts="refreshPorts" />
                                        </div>
                                        <v-expand-transition>
                                            <span v-show="showBoardConfiguration[profile.name]" class="mt-5">
                                                <v-alert v-if="profileBoardOptionsError[profile.name]" type="error"
                                                    border="start" icon="mdi-alert" class="mb-3">
                                                    Install the board to change options
                                                </v-alert>
                                                <v-divider thickness="2" class="mb-3 mt-3" color="success"></v-divider>
                                                <span v-if="profileBoardOptions[profile.name]">
                                                    <span>
                                                        <strong> Programmer</strong>
                                                    </span>
                                                    <v-select v-model="selectedProgrammer[profile.name]"
                                                        :items="getProgrammerOptions(profile.name)" item-title="name"
                                                        item-value="id"
                                                        @update:model-value="val => updateProfileProgrammer(profile.name, val)"></v-select>
                                                    <BoardConfigurationForm
                                                        v-if="profileBoardOptions[profile.name].config_options"
                                                        :options="profileBoardOptions[profile.name].config_options"
                                                        :board_name="profileBoardOptions[profile.name].name"
                                                        :profile_name="profile.name" @update="updateConfiguration">
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
                                                <span v-if="profileBoardOptionsRetrieving[profile.name]">
                                                    Retrieving board options
                                                    <v-progress-linear color="grey" indeterminate></v-progress-linear>
                                                </span>
                                            </span>
                                        </v-expand-transition>
                                    </v-card-text>
                                    <v-card-actions>
                                        <span>Change board options</span>

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
                                    <v-text-field v-model="profileName" label="New Profile name"
                                        :rules="[profileNameRule(profileName), profileNameExistRule(profileName)]"
                                        hide-details="auto" density="comfortable" class="mr-4" clearable
                                        style="max-width: 300px;" />
                                    <v-tooltip v-if="!store.profileUpdating" location="top">
                                        <template #activator="{ props }">
                                            <div
                                                v-if="store.projectStatus?.status == ARDUINO_ERRORS.NO_ERRORS && !store.projectInfo?.board">
                                                <v-btn @click="router.push({ name: 'board-selection' })">Select your
                                                    board to create a profile</v-btn>
                                            </div>
                                            <div v-else>
                                                <v-btn v-bind="props" @click="createProfile" :disabled="disabledButton">
                                                    Create a new profile
                                                </v-btn>
                                            </div>
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
