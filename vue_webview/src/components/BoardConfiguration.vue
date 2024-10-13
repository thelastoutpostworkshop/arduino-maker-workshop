<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage } from '@shared/messages';
import { computed, ref, watch } from 'vue';

const vsCodeStore = useVsCodeStore();

const inDevelopment = computed(() => import.meta.env.DEV);

const boardOption = ref<string[]>([]);

watch(() => vsCodeStore.boardConfiguration?.boardConfiguration?.config_options, (newConfig) => {
    if (newConfig) {
        console.log(newConfig);
        newConfig.forEach((option,indexOption)=> {
            option.values.forEach((value,index)=>{
                if(value.selected) {
                    boardOption.value[indexOption] = value.value;
                }
            })
            console.log(option);
        })
    }
}, { immediate: true });

function sendTestMessagewWithConfigOptions() {
    const message: WebviewToExtensionMessage = {
        command: ARDUINO_MESSAGES.BOARD_CONFIGURATION,
        errorMessage: "",
        payload: import.meta.env.VITE_BOARDS_CONFIG_WITH_OPTIONS
    }
    vsCodeStore.simulateMessage(message);
}
function sendTestMessagewWithNoConfigOptions() {
    const message: WebviewToExtensionMessage = {
        command: ARDUINO_MESSAGES.BOARD_CONFIGURATION,
        errorMessage: "",
        payload: import.meta.env.VITE_BOARDS_CONFIG_WITH_NO_OPTIONS
    }
    vsCodeStore.simulateMessage(message);
}
</script>

<template>
    <v-container>
        <v-responsive>
            <div v-if="inDevelopment">
                <v-btn @click="sendTestMessagewWithConfigOptions()">Test With Config Options</v-btn>
                <v-btn @click="sendTestMessagewWithNoConfigOptions()">Test With No Config Options</v-btn>
            </div>
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
                    <div v-for="(option, index) in vsCodeStore.boardConfiguration?.boardConfiguration?.config_options"
                        :key="option.option">
                        <v-select v-model="boardOption[index]" :label="option.option_label" :items="option.values"
                            item-title="value_label" item-value="value"></v-select>
                    </div>
                </div>
            </v-card>

        </v-responsive>
    </v-container>
</template>