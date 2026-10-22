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

function setCompileApproval(confirm: boolean | null) {
  store.sendMessage({ command: ARDUINO_MESSAGES.AI_SET_COMPILE_APPROVAL, errorMessage: '', payload: confirm !== false });
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
  <v-container data-testid="ai-integration">
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5 mb-5">
        <v-icon icon="mdi-robot-outline" aria-hidden="true" />
        <span class="text-h4 font-weight-bold ml-5">AI integration</span>
      </v-row>
      <v-alert v-if="actionError"
        type="error" variant="tonal" density="compact" class="mb-4" role="alert" data-testid="ai-action-error">
        {{ actionError }}
      </v-alert>
      <div v-if="busy" class="mb-4" role="status" data-testid="ai-busy">
        <v-progress-linear indeterminate color="primary" aria-label="Updating AI integration" />
        <span class="text-caption">Applying AI integration changes...</span>
      </div>
      <v-card rounded="lg">
        <v-card-title>Assistant access</v-card-title>
        <v-card-text>
          <p class="text-body-2">Let assistants inspect your Arduino projects and request compilation.</p>
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
        </v-card-text>
      </v-card>

      <v-card rounded="lg" class="mt-6">
        <v-card-title>Compilation approval</v-card-title>
        <v-card-text>
          <v-switch
            :model-value="state?.confirmCompile ?? true"
            :disabled="busy || !state"
            color="success"
            label="Ask before AI compilation"
            hide-details
            data-testid="ai-confirm-compile"
            @update:model-value="setCompileApproval"
          />
          <p class="text-body-2">
            On: VS Code asks before each AI compile. Off: normal and clean AI compilations run automatically in trusted local workspaces;
            clean builds may clear build output.
          </p>
          <p class="text-body-2 mt-2">
            Compilation runs installed board-package recipes, writes build files, and may download dependencies.
          </p>
          <p class="text-body-2 text-medium-emphasis mt-2">
            This user preference is remembered across trusted local workspaces. Your AI client's own approval settings still apply.
          </p>
        </v-card-text>
      </v-card>

      <v-card rounded="lg" class="mt-6">
        <v-card-title>Client setup</v-card-title>
        <v-card-text>
          <p class="text-body-2 mb-3">
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
        </v-card-text>
      </v-card>
    </v-responsive>
  </v-container>
</template>
