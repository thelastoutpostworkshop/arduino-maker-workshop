<script setup lang="ts">
import { ARDUINO_MESSAGES } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted } from 'vue';

const store = useVsCodeStore();

onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED, errorMessage: "", payload: "" });
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
            <v-expansion-panel-title>{{ library.library.name }} by {{ library.library.maintainer
              }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="text-grey">
                {{ library.library.paragraph }}
                <span class="text-subtitle-2"> <a :href="library.library.website" target="_blank">More Info</a></span>
              </div>
              <!-- <v-autocomplete class="pt-2" v-model="boardSelect[index]" :items="platformData.boards" item-title="name"
                item-value="fqbn" label="Select a Board" outlined dense return-object></v-autocomplete> -->
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
    </v-responsive>
  </v-container>
</template>
