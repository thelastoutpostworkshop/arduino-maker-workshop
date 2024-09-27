<template>
  <v-layout class="rounded rounded-md">
    <toolbar />
    <v-main class="d-flex align-center justify-center">
      Main content
    </v-main>
  </v-layout>

</template>

<script setup lang="ts">

</script>
<style>
body {
  background-color: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}

button:hover {
	cursor: pointer;
	background: var(--vscode-button-hoverBackground);
}

button:focus {
	outline-color: var(--vscode-focusBorder);
}

button {
	border: none;
	padding: var(--input-padding-vertical) var(--input-padding-horizontal);
	width: 100%;
	text-align: center;
	outline: 1px solid transparent;
	outline-offset: 2px !important;
	color: var(--vscode-button-foreground);
	background: var(--vscode-button-background);
}

a {
  color: var(--vscode-textLink-foreground);
}

a:hover,
a:active {
  color: var(--vscode-textLink-activeForeground);
}
#icons {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
    justify-content: center;
}

#icons .icon {
	width: 140px;
	padding: 20px;
	font-size: 14px;
	display: flex;
	flex-direction: column;
	text-align: center;
}

#icons .icon .codicon {
	font-size: 32px;
	padding-bottom: 16px;
}
</style>