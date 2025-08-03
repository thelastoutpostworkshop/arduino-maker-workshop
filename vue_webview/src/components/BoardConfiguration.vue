<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, ConfigOptionValue } from '@shared/messages';
import { useRouter } from 'vue-router';

const router = useRouter()
const store = useVsCodeStore();

function updateConfiguration(config: Record<string, ConfigOptionValue>) {
    if (!store.boardOptions) return;

    // Update the store.boardOptions.config_options selected values
    store.boardOptions.config_options.forEach(option => {
        const selectedValue = config[option.option];
        option.values.forEach(value => {
            value.selected = selectedValue ? value.value === selectedValue.value : false;
        });
    });

    // Optionally still notify the extension with the config string
    const configString = Object.entries(config)
        .map(([key, opt]) => `${key}=${opt.value}`)
        .join(',');

    store.sendMessage({
        command: ARDUINO_MESSAGES.SET_BOARD_OPTIONS,
        errorMessage: '',
        payload: configString
    });
}
</script>

<template>
    <v-container>
        <v-responsive>
            <v-row align="center" class="mt-1 ml-5 mb-5">
                <v-icon>mdi-cog</v-icon>
                <span class="text-h4 font-weight-bold ml-5">Board Configuration</span>
            </v-row>
            <div v-if="store.projectInfo?.board">
                <v-text-field label="Current Board:" :model-value="store.boardOptions?.name" readonly>
                    <template v-slot:loader>
                        <v-progress-linear :active="!store.boardOptions?.name" height="2"
                            indeterminate></v-progress-linear>
                    </template>
                </v-text-field>
                <v-card class="pa-4" color="primary" rounded="lg">
                    <span v-if="store.boardOptions?.config_options">
                        <BoardConfigurationForm :options="store.boardOptions.config_options"
                            :boardName="store.boardOptions?.name" @update="updateConfiguration">
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
                        <v-card-text>
                            No options available for your board
                        </v-card-text>
                    </span>
                </v-card>
            </div>
            <div v-else>
                <v-btn @click="router.push({ name: 'board-selection' })">Select a board first</v-btn>
            </div>

        </v-responsive>
    </v-container>
</template>