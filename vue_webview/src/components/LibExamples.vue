<script setup lang="ts">
import { ARDUINO_MESSAGES } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted, computed } from 'vue';

const store = useVsCodeStore();

function buildTree(paths: string[]): any[] {
  const tree: Record<string, any> = {};

  paths.forEach((path) => {
    const parts = path.split('\\');
    const examplesIndex = parts.indexOf('examples');
    if (examplesIndex !== -1) {
      const relevantParts = parts.slice(examplesIndex + 1); // Skip "examples"
      let currentLevel = tree;

      relevantParts.forEach((part) => {
        if (!currentLevel[part]) {
          currentLevel[part] = { id: Math.random(), title: part, children: {} }; // Unique ID
        }
        currentLevel = currentLevel[part].children;
      });
    }
  });

  // Convert the tree object into the required v-treeview format
  const convertToTreeView = (obj: Record<string, any>): any[] =>
    Object.values(obj).map(({ id, title, children }) => ({
      id,
      title,
      ...(Object.keys(children).length > 0 && { children: convertToTreeView(children) }), // Only include children if not empty
    }));

  return convertToTreeView(tree);
}

// Computed property to build tree data for each library
const libraryExamplesTree = computed(() =>
  store.librariesInstalled?.installed_libraries.map((library) => ({
    name: library.library.name,
    examplesTree: buildTree(library.library.examples || []),
  }))
);

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
          <v-expansion-panel
            v-for="(library) in libraryExamplesTree"
            :key="library.name"
          >
            <v-expansion-panel-title>
              {{ library.name }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="text-grey mb-4">
                <span class="text-subtitle-2">Explore the examples below:</span>
              </div>
              <!-- Treeview rendering -->
              <v-treeview
                :items="library.examplesTree"
                item-text="title"
                item-value="id"
                open-on-click
                activatable
              ></v-treeview>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </div>
    </v-responsive>
  </v-container>
</template>
