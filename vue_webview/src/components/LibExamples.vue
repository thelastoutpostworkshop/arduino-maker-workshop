<script setup lang="ts">
import { ARDUINO_MESSAGES } from '@shared/messages';
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { onMounted } from 'vue';

const store = useVsCodeStore();

function openExample(examplePath: string) {
  store.sendMessage({ command: ARDUINO_MESSAGES.OPEN_LIBRARY, errorMessage: "", payload: examplePath });
}

function examplesItems(examples: string[]): any[] {
  const groupedItems: any[] = []; // Final array of grouped items
  const groups: Record<string, any[]> = {}; // Groups to hold examples under subheaders
  const noGroupItems: any[] = []; // Examples without subpaths

  examples.forEach((example, index) => {
    // Extract the part after "examples\\"
    const parts = example.split('examples\\');
    const relevantPart = parts.length > 1 ? parts[1] : example;

    // Split into hierarchical parts (e.g., "Smooth Fonts\\SPIFFS\\Font_Demo_1")
    const pathParts = relevantPart.split('\\');

    if (pathParts.length === 1) {
      // No subpath, add directly to noGroupItems
      noGroupItems.push({
        title: pathParts[0],
        value: example, // Full path as the value
      });
    } else {
      // Has subpath, group by the top-level directory
      const groupName = pathParts[0]; // Top-level group 
      const title = pathParts.slice(1).join(' \\ '); // Remaining parts as the title

      // Initialize group if it doesn't exist
      if (!groups[groupName]) {
        groups[groupName] = [];
      }

      // Add the example to its group
      groups[groupName].push({
        title,
        value: example, // Full path as the value
      });
    }
  });

  // Add ungrouped items first
  groupedItems.push(...noGroupItems);

  // Convert groups into the required format
  Object.entries(groups).forEach(([groupName, items]) => {
    groupedItems.push({ type: 'subheader', title: groupName }); // Add subheader
    groupedItems.push(...items); // Add examples under this group
    groupedItems.push({ type: 'divider' }); // Add a divider after each group
  });

  return groupedItems;
}




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
          <v-expansion-panel v-for="(library) in store.librariesInstalled.installed_libraries"
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
                :items="examplesItems(library.library.examples)">
                <template v-slot:append="{ item,isSelected }">
                  <v-list-item-action v-if="isSelected" start >
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
