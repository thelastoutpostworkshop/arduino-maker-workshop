<script setup lang="ts">
import { watch } from "vue";
import { useVsCodeStore } from "@/stores/useVsCodeStore";
import { ARDUINO_MESSAGES } from "@shared/messages";

const props = defineProps<{
  monitorPortSettings: {
    port: string;
    baudRate: number;
    lineEnding: string;
    dataBits: number;
    parity: string;
    stopBits: string;
  };
  serialPortsAvailable:any
}>();

const emit = defineEmits<{
  (e: "update:monitorPortSettings", value: typeof props.monitorPortSettings): void;
  (e: "refreshPorts"): void;
}>();

const store = useVsCodeStore();


const lineEndings = [
  { title: "CR", value: "\r" },
  { title: "CRLF", value: "\r\n" },
  { title: "LF", value: "\n" },
  { title: "None", value: "none" },
];
const parity = [
  { title: "None", value: "none" },
  { title: "Odd", value: "odd" },
  { title: "Even", value: "even" },
  { title: "Mark", value: "mark" },
  { title: "Space", value: "space" },
];
const stopBits = [
  { title: "One", value: "one" },
  { title: "Onepointfive", value: "onepointfive" },
  { title: "Two", value: "two" },
];

watch(
  () => props.monitorPortSettings,
  (newVal) => {
    // Notify parent to save settings
    emit("update:monitorPortSettings", newVal);
    store.sendMessage({
      command: ARDUINO_MESSAGES.SET_MONITOR_PORT_SETTINGS,
      errorMessage: "",
      payload: JSON.stringify(newVal),
    });
  },
  { deep: true }
);
</script>

<template>
    <slot name="header" />
    <slot name="title" />

    <!-- Serial Port -->
    <v-select
      :disabled="!store.boardConnected?.detected_ports"
      v-model="props.monitorPortSettings.port"
      :items="serialPortsAvailable"
      density="compact"
      label="Serial Port"
      class="mb-3" hide-details
    > 
      <template #loader>
        <v-progress-linear
          :active="!store.boardConnected?.detected_ports"
          height="2"
          indeterminate
        />
      </template>
      <template v-if="store.boardConnected?.detected_ports" #append>
        <v-btn @click="$emit('refreshPorts')" icon="mdi-refresh" variant="text"></v-btn>
      </template>
    </v-select>

    <!-- Baud Rate -->
    <v-select
      :disabled="!store.boardConnected?.detected_ports"
      v-model="props.monitorPortSettings.baudRate"
      :items="[300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000]"
      density="compact"
      label="Baud Rate"
      class="mb-3" hide-details
    />

    <!-- Line Ending -->
    <v-select
      :disabled="!store.boardConnected?.detected_ports"
      v-model="props.monitorPortSettings.lineEnding"
      :items="lineEndings"
      item-title="title"
      item-value="value"
      density="compact"
      label="Line Ending"
      class="mb-3" hide-details
    />

    <!-- Data Bits -->
    <v-select
      :disabled="!store.boardConnected?.detected_ports"
      v-model="props.monitorPortSettings.dataBits"
      :items="[5, 6, 7, 8]"
      density="compact"
      label="Data Bits"
      class="mb-3" hide-details
    />

    <!-- Stop Bits -->
    <v-select
      :disabled="!store.boardConnected?.detected_ports"
      v-model="props.monitorPortSettings.stopBits"
      :items="stopBits"
      item-title="title"
      item-value="value"
      density="compact"
      label="Stop Bits"
      class="mb-3" hide-details
    />

    <!-- Parity -->
    <v-select
      :disabled="!store.boardConnected?.detected_ports"
      v-model="props.monitorPortSettings.parity"
      :items="parity"
      item-title="title"
      item-value="value"
      density="compact"
      label="Parity" hide-details
    />
</template>
