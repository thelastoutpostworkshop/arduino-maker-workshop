<script setup lang="ts">
import { ARDUINO_MESSAGES } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted, computed, ref } from 'vue';

const store = useVsCodeStore();
const selectedExample = ref<string[]>([]); // v-model as an array
let uniqueIdCounter = 1; // Counter for generating unique numeric IDs

// Utility function to build a tree structure with the required format
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
          currentLevel[part] = {
            id: uniqueIdCounter++, // Use full path as the unique identifier
            path:path,
            title: part,
            children: {},
          };
        }
        currentLevel = currentLevel[part].children;
      });
    }
  });

  const convertToTreeView = (obj: Record<string, any>): any[] =>
    Object.values(obj).map(({ id, title, children,path }) => ({
      id,
      title,
      path,
      ...(Object.keys(children).length > 0 && { children: convertToTreeView(children) }), // Only include children if not empty
    }));

  return convertToTreeView(tree);
}

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
                item-value="path"
                v-model:selected="selectedExample"
                open-on-click
                selectable
                select-strategy="single-leaf"
                density="compact"
                return-object
              ></v-treeview>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <div class="mt-4">
          <h3>Selected Example:</h3>
          <p >{{ selectedExample }}</p>
        </div>
      </div>
    </v-responsive>
  </v-container>
</template>
