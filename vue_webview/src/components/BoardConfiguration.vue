<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, ConfigOptionValue } from '@shared/messages';
import { ref, watch } from 'vue';
import { vscode } from '@/utilities/vscode';

const vsCodeStore = useVsCodeStore();

// Define boardOption as an object indexed by string keys
const boardOption = ref<Record<string, ConfigOptionValue>>({});

watch(
    () => vsCodeStore.boardConfiguration?.boardConfiguration?.config_options,
    (newConfig) => {
        if (newConfig) {
            newConfig.forEach((option) => {
                option.values.forEach((value) => {
                    if (value.selected) {
                        boardOption.value[option.option] = value;
                    }
                });
            });
        }
    },
    { immediate: true }
);

watch(
    boardOption,
    () => {
        let configuration: string = Object.entries(boardOption.value)
            .map(([key, option]) => `${key}=${option.value}`)
            .join(",");

        console.log(configuration);
        vscode.postMessage({ command: ARDUINO_MESSAGES.SET_BOARD_CONFIGURATION, errorMessage: "", payload: configuration });
    },
    { deep: true }
);

</script>

<template>
    <v-container>
        <v-responsive>
            <div class="text-center">
                <h1 class="text-h4 font-weight-bold">Board Configuration</h1>
            </div>
            <v-text-field label="Current Board:" :model-value="vsCodeStore.boardConfiguration?.boardConfiguration?.name"
                readonly>
                <template v-slot:loader>
                    <v-progress-linear :active="!vsCodeStore.boardConfiguration?.boardConfiguration?.name" height="2"
                        indeterminate></v-progress-linear>
                </template>
            </v-text-field>
            <v-card class="pa-4" color="blue-grey-darken-4" rounded="lg">
                <template v-slot:loader>
                    <v-progress-linear :active="!vsCodeStore.boardConfiguration" height="2"
                        indeterminate></v-progress-linear>
                </template>
                <template #title>
                    <h2 class="text-h6 font-weight-bold">Board Options</h2>
                </template>

                <template #subtitle v-if="vsCodeStore.boardConfiguration">
                    <div class="text-subtitle-1"
                        v-if="vsCodeStore.boardConfiguration.boardConfiguration?.config_options">
                        Select your board options
                    </div>
                    <div class="text-subtitle-1" v-else>
                        No options available for your board
                    </div>
                </template>
                <div v-if="vsCodeStore.boardConfiguration?.boardConfiguration?.config_options">
                    <div v-for="(option) in vsCodeStore.boardConfiguration?.boardConfiguration?.config_options"
                        :key="option.option">
                        <v-select v-model="boardOption[option.option]" :label="option.option_label"
                            :items="option.values" item-title="value_label" item-value="value" return-object></v-select>
                    </div>
                </div>
            </v-card>

        </v-responsive>
    </v-container>
</template>