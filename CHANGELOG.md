# Change Log

All notable changes to the Arduino Maker Workshop extension will be documented in this file.

## Version 1.1.3

- Support for Windows ARM (Serial Monitor not supported) thanks to [jfthuong](https://github.com/jfthuong) ([issue #5](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/5))
- Arduino CLI 1.4.1
- Persist upload/monitor ports by address while keeping the label visible (fixes Wi-Fi board uploads like UNO Q; backwards compatible with existing port labels) ([issue #103](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/103))
- Added a command to clear Arduino CLI caches and refresh board/library data ([issue #102](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/102))

## Version 1.1.2

- Fixed board examples mixed with library examples and board examples not refreshed when a board change ([issue #100](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/100))
- Board examples now compatible with build profiles
- Board examples now show the source of the examples

## Version 1.1.1

- For the ESP32 Backtrace Decoder implemented robust target detection so SparkFun-style FQBNs (and other variants) are recognized, and defaulted to xtensa when the target is ESP32 but not RISC‑V ([issue #98](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/98))
- Improve IntelliSense generation by parsing JSON includes.cache entries and extracting include paths from compile_commands.json, ensuring Arduino.h is forced when available ([issue #99](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/99))
- Added Board Examples view sourced from the selected board platform libraries ([issue #100](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/100))
- Disabled the Home upload port selector while build profiles are active to avoid mismatched upload ports ([issue #81](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/81))
- Synced upload port updates back to the webview and tightened auto-selection to avoid overriding user choices during port refreshes ([issue #81](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/81))
- Upload now invalidates stale builds after git pulls by watching filesystem changes and checking build timestamps before upload ([issue #80](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/80))

## Version 1.1.0

- The link to the ESP32 Partition builder application in external tools, now pass the current partitions.csv stored the current build output
- Added ESP32 backtrace decoder to resolve crash logs to functions and source lines in "Other Tools and ressources" ([issue #97](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/97))
- Fixed Arduino CLI output title bar text visibility on some dark themes ([issue #89](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/89))
- Added an empty-state banner on Home with create/open sketch actions when no sketch folder is open ([issue #88](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/88))


## Version 1.0.8

- Arduino CLI 1.4.0
- Added Links to external tools for the ESP32

## Version 1.0.7

- Added toolbar controls in the Arduino CLI output view so users can clear the log, pause auto-scrolling, and filter compile/upload output with a search query  ([issue #78](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/78))
- Port-only edits in build profiles no longer invalidate the last build; recompilation is only required when other profile settings change ([issue #84](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/84))

## Version 1.0.6

- Reduced Arduino CLI cache durations so board metadata refreshes hourly and library info every 30 minutes, balancing freshness with CLI call volume ([issue #68](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/68))
- Trim additional board URLs before saving and simplify the add/edit dialog validation
- Optimized packaging by excluding unused node_modules while preserving USB runtime support
- Notify when a zip library installation is completed
- Detect build profile value changes and invalidate the previous build output so the next compile reflects the new configuration
- Render Arduino CLI output with color in a dedicated panel view during compilation
- Highlight compile warnings/errors inline in the colorized CLI output panel  ([issue #69](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/69))
- Consolidated compile/upload logs into the colorized panel and removed the legacy output channel

## Version 1.0.5

- Fix programmer issue, use id instead of value  ([issue #65](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/65))

## Version 1.0.4

- Toolbar items are deactivated when vscode open a folder that do not contain a sketch to avoid confusion
- Fixed profile selection not appearing in the status bar when profiles are active

## Version 1.0.3

- Introducing Build Profiles, [tutorial](https://youtu.be/i0gzop0k6yY)
- Added support for local libraries in sketch.yaml — entries with dir: paths are now fully recognized and processed.
- Arduino CLI v1.3.1

## Version 1.0.2

- Introducing Build Profiles, [tutorial](https://youtu.be/i0gzop0k6yY)
- Arduino CLI v1.3.0

## Version 0.7.5

- Fix programmer issue ([issue #60](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/60))

## Version 0.7.4

- Add option to optimize compile output for debugging, rather than for release ([feature request #59](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/59))

## Version 0.7.3

- Add user setting to enable verbose compilation or not (default is verbose)
- Fix a problem when creating sketch on an alternate drive ([issue #58](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/58))
- Fix bad handling of library installation failing ([issue #57](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/57))

## Version 0.7.2

- Arduino CLI v1.2.2

## Version 0.7.1

- Arduino CLI v1.2.0

## Version 0.7.0

- Add user setting to disable automatic port detection on Windows ([issue #30](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/30))

## Version 0.6.9

- Fix bug when installing a library through zip ([issue](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/36))
- Add action button to remove an updatable library ([feature request](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/37) by omarbaf)
- Add action button to remove an updatable board ([feature request](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/37) by omarbaf)
- Add folder name and sketch name in the error message when folder name and sketch name do not match

## Version 0.6.7

- Add user setting to set user directory, equivalent of the Arduino IDE's 'sketchbook' directory. Library Manager installations are made to the libraries subdirectory of the user directory
- Add support for macOS Intel by [rudeb0t](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/28)
- UI Performance improvement by using cache to avoid repeated calls to the arduino-cli
- Correctly report to the user that a project is compiled "clean"
- Fix bug when adding additional URL

## Version 0.6.2

- Fix libraries with patchlevel 0 showing wrongly as updatable ([issue](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/22))
- Fix upload error when starting a new sketch
- Fix cancel or upload error forcing a recompilation
- Fix user error reporting when create a sketch with a name that already exist

## Version 0.6.1

- Serial monitor settings on Home page by [rudeb0t](https://github.com/rudeb0t)
- Code Snippets added : [Documentation](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/blob/main/Arduino_Snippets_Documentation.md)
- IntelliSense improvements
- Upload command will trigger compile if build is not valid

## Version 0.5.1

- Implement notification and cancel for upload by [rudeb0t](https://github.com/rudeb0t)
- Fix bundled CLI permission on macOS Silicon by [rudeb0t](https://github.com/rudeb0t)
- Fix Arduino CLI path in settings on Windows
- Changes to Arduino CLI settings are applied to the current workspace
- Fix intellisense adding duplicate defines

## Version 0.5.0

- Linux x64 now supported
- Bugs corrected

## Version 0.4.92

- Resolved and restored conflict with `which` import for MacOS

## Version 0.4.8

- MacOS ARM64 version, thanks to [rudeb0t](https://github.com/rudeb0t)
- Build output in invalidated when changes to project files and arduino configuration

## Version 0.4.7

- New help dialog when adding and additionnal board URL

## Version 0.4.6

- Corrected typo in Webview 

## Version 0.4.5

- Repackaged as Win32-x64 since Linux and MacOS support are not avalaible yet.
