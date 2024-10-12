<script setup lang="ts">
import arduinoIcon from '@/assets/arduino_icon.webp';
import { useRouter } from 'vue-router'

const router = useRouter()

</script>

<template>
    <v-navigation-drawer permanent rail>
        <v-list-item :prepend-avatar="arduinoIcon"></v-list-item>
        <v-divider></v-divider>
        <v-list-item prepend-icon="mdi-home" v-tooltip  @click="router.push({ name: 'home' })">Project Home</v-list-item>
        <v-list-item prepend-icon="mdi-cog" v-tooltip  @click="router.push({ name: 'board-configuration' })">Board Configuration</v-list-item>
        <v-list-item prepend-icon="mdi-developer-board" v-tooltip  @click="router.push({ name: 'boards' })">Boards</v-list-item>
    </v-navigation-drawer>
</template>
