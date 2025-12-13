<script setup lang="ts">
type ExternalTool = {
  name: string;
  description: string;
  url: string;
  icon: string;
};

const externalTools: ExternalTool[] = [
  {
    name: 'Example External Tool',
    description: 'Fake tool link for testing the UI layout.',
    url: 'https://example.com/tool-a',
    icon: 'mdi-open-in-new',
  },
  {
    name: 'Another Tool Link',
    description: 'Another fake external tool to play with the visual.',
    url: 'https://example.com/tool-b',
    icon: 'mdi-tools',
  },
];
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
            External resources and tools (links open in a new tab).
          </div>

          <v-list class="mt-3" lines="two">
            <v-list-item v-for="tool in externalTools" :key="tool.name">
              <template #prepend>
                <v-icon :icon="tool.icon" />
              </template>

              <v-list-item-title>{{ tool.name }}</v-list-item-title>
              <v-list-item-subtitle>{{ tool.description }}</v-list-item-subtitle>

              <template #append>
                <v-btn
                  :href="tool.url"
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
    </v-responsive>
  </v-container>
</template>

