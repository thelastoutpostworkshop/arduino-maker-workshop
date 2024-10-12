<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
const vsCodeStore = useVsCodeStore();

</script>

<template>
    <v-container>
        <v-responsive>
            <v-text-field label="Current Board:" :model-value="vsCodeStore.boardConfiguration?.boardName" readonly>
                <template v-slot:loader>
                    <v-progress-linear :active="!vsCodeStore.boardConfiguration?.boardName" height="2"
                        indeterminate></v-progress-linear>
                </template>
            </v-text-field>
        </v-responsive>
    </v-container>
</template>