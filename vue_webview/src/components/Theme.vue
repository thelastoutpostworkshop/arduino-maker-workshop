<script setup lang="ts">
import { watch } from 'vue';
import { useTheme } from 'vuetify';
import { useVsCodeStore } from '@/stores/useVsCodeStore';

const store = useVsCodeStore();
const theme = useTheme();

watch(
    () => store.currentTheme,
    (newTheme) => {
        if(newTheme) {
            theme.global.name.value = newTheme;
        }
    }
);
</script>

<template>
    <!-- No UI needed; this component just handles theme changes -->
</template>
