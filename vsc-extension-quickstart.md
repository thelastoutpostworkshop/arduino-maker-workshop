## What's in the folder

* This folder contains all of the files necessary for Arduino Maker Workshop Extension.
* `package.json` - this is the manifest file in which are declared the extension and commands.
* `src/extension.ts` - this is the main file of the extension.
  * The file exports one function, `activate`, which is called the very first time the extension is activated.

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run watch
```

## Get up and running straight away

* Press `F5` to open a new window with the extension loaded.
* Click the Arduino Maker Workshop in the Activity Bar
* Set breakpoints in the code inside `src/extension.ts` to debug.
* Find console.log output from the extension in the debug console and for the webview in Webview developers tools.

## Make changes

* You can relaunch the extension from the debug toolbar after changing code in `src/extension.ts`.
* You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load your changes.

## Explore the API

* You can open the full set of our API when you open the file `node_modules/@types/vscode/index.d.ts`.

## Run tests

* (to be done later)

## Go further

* [Follow UX guidelines](https://code.visualstudio.com/api/ux-guidelines/overview) to create extensions that seamlessly integrate with VS Code's native interface and patterns.
