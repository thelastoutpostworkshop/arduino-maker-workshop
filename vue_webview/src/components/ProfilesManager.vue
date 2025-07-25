<script setup lang="ts">
import { useVsCodeStore } from '../stores/useVsCodeStore';
import { ARDUINO_MESSAGES, LibraryInformation } from '@shared/messages';
import { onMounted, computed, ref, watch } from 'vue';

const store = useVsCodeStore();


</script>

<template>
  <v-container>
    <v-responsive>
      <v-row align="center" class="mt-1 ml-5 mb-5">
        <v-icon>mdi-application-array-outline</v-icon>
        <span class="text-h4 font-weight-bold ml-5">Profiles Manager</span>
      </v-row>
 
    </v-responsive>
  </v-container>
</template>