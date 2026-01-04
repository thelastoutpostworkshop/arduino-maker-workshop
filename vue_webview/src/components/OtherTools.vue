<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useVsCodeStore } from '@/stores/useVsCodeStore';
import { ARDUINO_MESSAGES } from '@shared/messages';

type ExternalTool = {
  name: string;
  description: string;
  url: string;
  icon: string;
};

const store = useVsCodeStore();
const partitionToolName = 'ESP32 Partition Builder';

const externalTools: ExternalTool[] = [
  {
    name: 'ESPConnect',
    description: 'Explore, back up, and manage your ESP32.',
    url: 'https://thelastoutpostworkshop.github.io/microcontroller_devkit/espconnect/',
    icon: 'mdi-usb',
  },
  {
    name: 'ESP32 Partition Builder',
    description: 'Create custome partitions for the ESP32.',
    url: 'https://thelastoutpostworkshop.github.io/ESP32PartitionBuilder/',
    icon: 'mdi-animation',
  },
];

const partitionBuilderUrl = computed(() => store.partitionBuilderUrl);
const partitionBuilderError = computed(() => store.partitionBuilderError);

const getToolUrl = (tool: ExternalTool) => {
  if (tool.name === partitionToolName && partitionBuilderUrl.value) {
    return partitionBuilderUrl.value;
  }
  return tool.url;
};

const isToolDisabled = (tool: ExternalTool) =>
  tool.name === partitionToolName && !partitionBuilderUrl.value;

const requestPartitionBuilderUrl = () => {
  store.sendMessage({
    command: ARDUINO_MESSAGES.GET_PARTITION_BUILDER_URL,
    errorMessage: "",
    payload: "",
  });
};

onMounted(() => {
  requestPartitionBuilderUrl();
});

watch(() => store.compileInProgress, (current, previous) => {
  if (previous && !current) {
    requestPartitionBuilderUrl();
  }
});

watch(() => store.projectInfo?.compile_profile, () => {
  requestPartitionBuilderUrl();
});

watch(() => store.sketchProject?.buildProfileStatus, () => {
  requestPartitionBuilderUrl();
});
</script>

<template>
  <v-container>
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5 mb-5">
        <v-icon>mdi-tools</v-icon>
        <span class="text-h4 font-weight-bold ml-5">Other Tools</span>
      </v-row>

      <v-card rounded="lg">
        <v-card-text>
          <div class="text-body-2 text-medium-emphasis">
            External tools (links open in a new tab).
          </div>

          <v-list class="mt-3" lines="two">
            <v-list-item v-for="tool in externalTools" :key="tool.name">
              <template #prepend>
                <v-icon size="x-large" :icon="tool.icon" />
              </template>

              <v-list-item-title>{{ tool.name }}</v-list-item-title>
              <v-list-item-subtitle>
                <div>{{ tool.description }}</div>
                <div
                  v-if="tool.name === partitionToolName && partitionBuilderError"
                  class="text-error"
                >
                  {{ partitionBuilderError }}
                </div>
              </v-list-item-subtitle>

              <template #append>
                <v-btn
                  :href="getToolUrl(tool)"
                  :disabled="isToolDisabled(tool)"
                  target="_blank"
                  variant="text"
                  prepend-icon="mdi-open-in-new"
                >
                  Open
                </v-btn>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </v-responsive>
  </v-container>
</template>
