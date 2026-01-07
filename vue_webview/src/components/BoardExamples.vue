<script setup lang="ts">
import { ARDUINO_ERRORS, ARDUINO_MESSAGES } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { computed, watch } from 'vue';

const store = useVsCodeStore();

function openExample(examplePath: string) {
  store.sendMessage({ command: ARDUINO_MESSAGES.OPEN_LIBRARY, errorMessage: "", payload: examplePath });
}

function examplesItems(examples: string[]): any[] {
  const groupedItems: any[] = [];
  const groups: Record<string, any[]> = {};
  const noGroupItems: any[] = [];

  examples.forEach((example) => {
    const parts = example.split('examples\\');
    const relevantPart = parts.length > 1 ? parts[1] : example;
    const pathParts = relevantPart.split('\\');

    if (pathParts.length === 1) {
      noGroupItems.push({
        title: pathParts[0],
        value: example,
      });
    } else {
      const groupName = pathParts[0];
      const title = pathParts.slice(1).join(' \\ ');

      if (!groups[groupName]) {
        groups[groupName] = [];
      }

      groups[groupName].push({
        title,
        value: example,
      });
    }
  });

  groupedItems.push(...noGroupItems);

  Object.entries(groups).forEach(([groupName, items]) => {
    groupedItems.push({ type: 'subheader', title: groupName });
    groupedItems.push(...items);
    groupedItems.push({ type: 'divider' });
  });

  return groupedItems;
}

const boardExampleLibraries = computed(() => {
  const libraries = store.boardExamples?.installed_libraries ?? [];
  return libraries.filter((entry) => entry?.library?.location && entry.library.location !== 'user');
});

const hasBoard = computed(() => {
  return !!store.projectInfo?.board && store.projectStatus?.status === ARDUINO_ERRORS.NO_ERRORS;
});

watch(hasBoard, (ready) => {
  if (ready) {
    store.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_EXAMPLES, errorMessage: '', payload: '' });
  }
}, { immediate: true });

watch(() => store.projectInfo, (info) => {
  if (!info) {
    store.sendMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO, errorMessage: '', payload: '' });
  }
}, { immediate: true });
</script>

<template>
  <v-container>
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5 mb-5">
        <v-icon>mdi-chip</v-icon>
        <span class="text-h4 font-weight-bold ml-5">Board Examples</span>
      </v-row>
      <div>
        <v-card v-if="!hasBoard" class="mt-5">
          <v-card-item title="Select a board to see board examples">
            <template v-slot:subtitle>
              Board examples are tied to the selected board platform.
            </template>
          </v-card-item>
        </v-card>
        <v-card v-else-if="store.boardExamplesError" class="mt-5">
          <v-card-item title="Unable to load board examples">
            <template v-slot:subtitle>
              {{ store.boardExamplesError }}
            </template>
          </v-card-item>
        </v-card>
        <v-card v-else-if="!store.boardExamples" class="mt-5">
          <v-card-item title="Loading board examples">
            <template v-slot:subtitle>
              Please wait
            </template>
          </v-card-item>
          <v-card-text class="py-0">
            <v-progress-linear color="grey" indeterminate></v-progress-linear>
          </v-card-text>
        </v-card>
        <v-card v-else-if="boardExampleLibraries.length === 0" class="mt-5">
          <v-card-item title="No board examples found">
            <template v-slot:subtitle>
              Install the board platform or try another board.
            </template>
          </v-card-item>
        </v-card>
        <v-expansion-panels v-else multiple>
          <v-expansion-panel v-for="(library) in boardExampleLibraries" :key="library.library.name">
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
                Examples provided with the board platform:
              </div>
              <v-list v-if="library.library.examples" density="compact"
                :items="examplesItems(library.library.examples)">
                <template v-slot:append="{ item, isSelected }">
                  <v-list-item-action v-if="isSelected" start>
                    <v-btn @click="openExample(item.value)">Open</v-btn>
                  </v-list-item-action>
                </template>
              </v-list>
              <div v-else>
                No examples found for this library
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
    </v-responsive>
  </v-container>
</template>
