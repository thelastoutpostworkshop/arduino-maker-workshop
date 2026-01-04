<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useVsCodeStore } from '@/stores/useVsCodeStore';
import { ARDUINO_MESSAGES, ESP32_PARTITION_BUILDER_BASE_URL } from '@shared/messages';

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
    url: ESP32_PARTITION_BUILDER_BASE_URL,
    icon: 'mdi-animation',
  },
];

const partitionBuilderUrl = computed(() => store.partitionBuilderUrl);
const partitionBuilderError = computed(() => store.partitionBuilderError);
const backtraceDecodeResult = computed(() => store.backtraceDecodeResult);
const backtraceDecodeError = computed(() => store.backtraceDecodeError);
const backtraceLog = ref('');

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

const decodeBacktrace = () => {
  store.sendMessage({
    command: ARDUINO_MESSAGES.DECODE_ESP32_BACKTRACE,
    errorMessage: "",
    payload: backtraceLog.value,
  });
};

const openFrameLocation = (file: string, line: number) => {
  store.sendMessage({
    command: ARDUINO_MESSAGES.OPEN_FILE_AT_LOCATION,
    errorMessage: "",
    payload: {
      file,
      line,
      beside: true,
    },
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

      <v-card rounded="lg" class="mt-6">
        <v-card-title>ESP32 Backtrace Decoder</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="backtraceLog"
            label="Paste ESP32 crash log from Serial Monitor"
            auto-grow
            rows="6"
          />
          <v-btn
            class="mt-2"
            color="primary"
            :disabled="!backtraceLog.trim()"
            @click="decodeBacktrace"
          >
            Decode Backtrace
          </v-btn>

          <div v-if="backtraceDecodeError" class="text-error mt-2">
            {{ backtraceDecodeError }}
          </div>

          <div v-if="backtraceDecodeResult?.frames?.length" class="mt-4">
            <div class="text-subtitle-1">Decoded Frames</div>
            <v-list density="compact">
            <v-list-item
              v-for="(frame, index) in backtraceDecodeResult.frames"
              :key="`${frame.address}-${index}`"
            >
                <v-list-item-title>
                  {{ frame.functionName || '??' }}
                </v-list-item-title>
                <v-list-item-subtitle>
                  <span v-if="frame.address">{{ frame.address }} - </span>
                  {{ frame.file }}:{{ frame.line }}
                </v-list-item-subtitle>

                <template #append>
                  <v-btn
                    v-if="frame.file && frame.file !== '??' && frame.line > 0"
                    icon="mdi-open-in-new"
                    variant="text"
                    :title="frame.file"
                    @click="openFrameLocation(frame.file, frame.line)"
                  />
                </template>
            </v-list-item>
          </v-list>
        </div>
      </v-card-text>
      </v-card>
    </v-responsive>
  </v-container>
</template>
