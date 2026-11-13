<script setup lang="ts">
import { ARDUINO_MESSAGES } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { computed, onMounted } from 'vue';
import { examplesItems } from '../utilities/examplePaths';

const store = useVsCodeStore();

function openExample(examplePath: string) {
  store.sendMessage({ command: ARDUINO_MESSAGES.OPEN_LIBRARY, errorMessage: "", payload: examplePath });
}

const sortedLibraries = computed(() => {
  const libraries = store.librariesInstalled?.installed_libraries ?? [];
  return [...libraries].sort((a, b) => {
    return a.library.name.localeCompare(b.library.name, undefined, { sensitivity: 'base' });
  });
});




onMounted(() => {
  store.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED, errorMessage: '', payload: '' });
});
</script>

<template>
  <v-container>
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5 mb-5">
        <v-icon>mdi-test-tube</v-icon>
        <span class="text-h4 font-weight-bold ml-5">Library Examples</span>
      </v-row>
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
          <v-expansion-panel v-for="(library) in sortedLibraries"
            :key="library.library.name">
            <v-expansion-panel-title>
              {{ library.library.name }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="text-grey">
                <div>
                  by {{ library.library.maintainer }}
                </div>
                {{ library.library.paragraph }}
                <span class="text-subtitle-2"> <a :href="library.library.website" target="_blank">More Info</a></span>
              </div>
              <div class="mt-1">
                Examples provided with the library:
              </div>
              <v-list v-if="library.library.examples" density="compact"
                :items="examplesItems(library.library.examples, library.library.install_dir)">
                <template v-slot:title="{ item }">
                  <v-tooltip v-if="'value' in item" :text="item.value">
                    <template v-slot:activator="{ props }">
                      <span v-bind="props">{{ item.title }}</span>
                    </template>
                  </v-tooltip>
                </template>
                <template v-slot:append="{ item,isSelected }">
                  <v-list-item-action v-if="isSelected && 'value' in item" start >
                    <v-btn @click="openExample(item.value)">Open</v-btn>
                  </v-list-item-action>
                </template>
              </v-list>
              <div v-else>
                Library does not provide any examples
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
    </v-responsive>
  </v-container>
</template>
