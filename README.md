# Arduino Maker Workshop
The ultimate tool for makers to bring Arduino projects to life in Visual Studio Code on Windows.

> **Currently supported on Windows x64 and MacOS ARM64 and Linux x64**, help needed for [for other platforms](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/discussions/2)
## Microcontrollers Platforms
All the platforms supported by the [Arduino CLI](https://arduino.github.io/arduino-cli) (the CLI is included in this extension).

## Tutorial : [Get Started](https://youtu.be/rduTUUVkzqM)

### Arduino Code Snippets : [Documentation](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/blob/main/Arduino_Snippets_Documentation.md)

## New Sketch
![new sketch](.readme/new_sketch.gif)

## Board Selection
![new sketch](.readme/board_selection.gif)

## Board Configuration
![new sketch](.readme/board_configuration.gif)

## Boards Manager
![new sketch](.readme/board_manager.gif)

## Library Manager
![new sketch](.readme/library_manager.gif)

## Library Example
![new sketch](.readme/library_example.gif)

## Contributors
Contributors are welcomed! 
Take a look at [the project](https://github.com/users/thelastoutpostworkshop/projects/3) to see features to be implemented or bugs to be fixed

If you want to submit pull requests, [here is how you can do it](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project).

## Extension Development
Install the dependancies:
- run `npm install` in the main folder of the extension
- run `npm install` in the webview folder

**Testing**
- Use `npm run watch` in the main folder to debug the extension in Visual Studio Code
- If you modify the webview, you must build it before testing the extension with the command `npm run build`
- You can test the webview in standalone mode using the command `npm run dev`, (in the webview folder). In development the webview uses mock files to simulate call to the Arduino CLI.

