<script setup lang="ts">
import arduinoIcon from '@/assets/arduino_icon.webp';
</script>

<template>
    <v-navigation-drawer permanent rail>
        <v-list-item :prepend-avatar="arduinoIcon"></v-list-item>
        <v-divider></v-divider>
        <v-list-item prepend-icon="mdi-home" v-tooltip link>Home</v-list-item>
        <v-list-item prepend-icon="mdi-developer-board"  v-tooltip link>Boards</v-list-item>
    </v-navigation-drawer>
</template>
