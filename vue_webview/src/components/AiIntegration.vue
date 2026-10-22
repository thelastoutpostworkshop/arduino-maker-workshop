<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useVsCodeStore } from '@/stores/useVsCodeStore';
import { ARDUINO_MESSAGES, type AiSetupClient } from '@shared/messages';

const store = useVsCodeStore();
const state = computed(() => store.aiIntegration);
const busy = computed(() => store.aiActionPending || !!state.value?.busy);
const setupDisabled = computed(() => busy.value || !state.value?.enabled);
const statusTitle = computed(() => {
  if (!state.value) { return 'Checking AI integration...'; }
  switch (state.value.status) {
    case 'disabled': return 'Disabled';
    case 'waiting': return 'Not yet available';
    case 'connecting': return 'Starting AI integration...';
    case 'ready': return 'Available to assistants';
    case 'error': return 'AI integration needs attention';
  }
});
const statusType = computed<'success' | 'error' | 'info'>(() =>
  state.value?.status === 'error' ? 'error' : state.value?.status === 'ready' ? 'success' : 'info'
);
const actionError = computed(() =>
  state.value?.status === 'error' && state.value.message === store.aiIntegrationError
    ? '' : store.aiIntegrationError
);
const statusMessage = computed(() => state.value?.message === actionError.value ? '' : state.value?.message);

function setEnabled(enabled: boolean | null) {
  store.sendMessage({ command: ARDUINO_MESSAGES.AI_SET_ENABLED, errorMessage: '', payload: enabled === true });
}

function setup(client: AiSetupClient) {
  store.sendMessage({ command: ARDUINO_MESSAGES.AI_SETUP_CLIENT, errorMessage: '', payload: client });
}

function showInstructions() {
  store.sendMessage({ command: ARDUINO_MESSAGES.AI_SHOW_SETUP, errorMessage: '', payload: '' });
}

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.AI_GET_STATE, errorMessage: '', payload: '' });
});
</script>

<template>
  <v-card rounded="lg" variant="outlined" data-testid="ai-integration">
    <v-card-title class="d-flex align-center ga-2 text-wrap">
      <v-icon icon="mdi-robot-outline" aria-hidden="true" />
      <span>AI integration</span>
    </v-card-title>
    <v-card-text>
      <p class="text-body-2">
        Let assistants inspect your Arduino projects and request compilation. Each compile still needs your approval in VS Code.
      </p>
      <v-switch
        :model-value="state?.enabled ?? false"
        :disabled="busy || !state"
        color="success"
        label="Enable AI integration"
        hide-details
        class="mt-2"
        data-testid="ai-enable"
        @update:model-value="setEnabled"
      />
      <p class="text-body-2 text-medium-emphasis mb-4">
        This setting is remembered across restarts. Enabled integration automatically becomes available in trusted local sketch windows.
      </p>
      <v-alert :type="statusType" variant="tonal" density="compact" data-testid="ai-status" role="status">
        <v-alert-title>{{ statusTitle }}</v-alert-title>
        <span v-if="statusMessage">{{ statusMessage }}</span>
      </v-alert>
      <v-alert v-if="actionError"
        type="error" variant="tonal" density="compact" class="mt-3" role="alert" data-testid="ai-action-error">
        {{ actionError }}
      </v-alert>
      <p class="text-body-2 mt-4 mb-3">
        Set up your client once. Codex or Claude Code setup updates the selected client's user configuration with automatically generated bridge paths.
        Copilot uses VS Code's MCP support.
      </p>
      <div class="d-flex flex-wrap ga-2">
        <v-btn :disabled="setupDisabled" variant="tonal" data-testid="ai-setup-codex" @click="setup('codex')">
          Set up Codex
        </v-btn>
        <v-btn :disabled="setupDisabled" variant="tonal" data-testid="ai-setup-claude" @click="setup('claude')">
          Set up Claude Code
        </v-btn>
        <v-btn :disabled="setupDisabled" variant="tonal" data-testid="ai-setup-copilot" @click="setup('copilot')">
          Use with Copilot
        </v-btn>
        <v-btn :disabled="busy || !state" variant="text" data-testid="ai-show-setup" @click="showInstructions">
          Manual setup instructions
        </v-btn>
      </div>
      <p v-if="state?.enabled && !state.nativeMcpAvailable" class="text-body-2 text-medium-emphasis mt-3">
        Automatic Copilot registration is unavailable in this VS Code version. Open setup instructions for the available options.
      </p>
      <div v-if="busy" class="mt-3" role="status" data-testid="ai-busy">
        <v-progress-linear indeterminate color="primary" aria-label="Updating AI integration" />
        <span class="text-caption">Applying AI integration changes...</span>
      </div>
    </v-card-text>
  </v-card>
</template>
