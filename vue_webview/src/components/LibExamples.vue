<script setup lang="ts">
import { ARDUINO_MESSAGES } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted } from 'vue';

const store = useVsCodeStore();

function examplesItems(examples: string[]): any[] {
  return examples.map((example) => ({
    title: example, 
    value: example,           
  }));
}


onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED, errorMessage: '', payload: '' });
});
</script>

<template>
  <v-container>
    <v-responsive>
      <div class="text-center">
        <h1 class="text-h4 font-weight-bold mb-4">Library Examples</h1>
      </div>
      <div>
        <v-card v-if="!store.librariesInstalled?.installed_libraries" class="mt-5">
          <v-card-item title="Loading Libraries examples">
            <template v-slot:subtitle>
              Please wait
            </template>
          </v-card-item>
          <v-card-text class="py-0">
            <v-progress-linear color="grey" indeterminate></v-progress-linear>
          </v-card-text>
        </v-card>
        <v-expansion-panels v-else multiple>
          <v-expansion-panel v-for="(library) in store.librariesInstalled.installed_libraries"
            :key="library.library.name">
            <v-expansion-panel-title>
              {{ library.library.name }} by {{ library.library.maintainer }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="text-grey mb-4">
                {{ library.library.paragraph }}
                <span class="text-subtitle-2"> <a :href="library.library.website" target="_blank">More Info</a></span>
              </div>
              <v-list v-if="library.library.examples" density="compact" :items="examplesItems(library.library.examples)">
  
              </v-list>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
    </v-responsive>
  </v-container>
</template>
