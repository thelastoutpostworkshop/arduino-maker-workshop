<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { ConfigOptionValue } from '@shared/messages';

const props = defineProps<{
    options?: { option: string; option_label: string; values: ConfigOptionValue[] }[];
    boardName?: string;
}>();

const emit = defineEmits<{
    (e: 'update', value: Record<string, ConfigOptionValue>): void;
}>();

const boardOption = ref<Record<string, ConfigOptionValue>>({});

// Initialize selection
onMounted(() => {
    if (props.options) {
        props.options.forEach((option) => {
            option.values.forEach((value) => {
                if (value.selected) {
                    boardOption.value[option.option] = value;
                }
            });
        });
    }
});

// Watch for changes and emit config string
watch(
    boardOption,
    () => {
        // Emit the selected option objects instead of string
        emit('update', boardOption.value);
    },
    { deep: true }
);
</script>

<template>
    <!-- Use a slot for parent to control the layout -->
    <slot name="header" />
    <slot name="title" />
    <slot name="loader" />

    <!-- Default form -->
    <div v-if="options?.length">
        <div v-for="option in options" :key="option.option" class="mb-2">
            <v-select v-model="boardOption[option.option]" :label="option.option_label" :items="option.values"
                item-title="value_label" item-value="value" density="compact" hide-details return-object />
        </div>
    </div>

    <!-- Slot for footer or extra content -->
    <slot name="footer" />
</template>