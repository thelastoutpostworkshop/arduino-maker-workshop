# Change Log

All notable changes to the Arduino Malker Workshop extension will be documented in this file.

**Version 1.0.6**
- Reduced Arduino CLI cache durations so board metadata refreshes hourly and library info every 30 minutes, balancing freshness with CLI call volume ([issue #68](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/68))
- Trim additional board URLs before saving and simplify the add/edit dialog validation
- Optimized packaging by excluding unused node_modules while preserving USB runtime support
- Notify when a zip library installation is completed
- Detect build profile value changes and invalidate the previous build output so the next compile reflects the new configuration
- Render Arduino CLI output with color in a dedicated panel view during compilation
- Highlight compile warnings/errors inline in the colorized CLI output panel  ([issue #69](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/69))
- Consolidated compile/upload logs into the colorized panel and removed the legacy output channel

**Version 1.0.5**
- Fix programmer issue, use id instead of value  ([issue #65](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/65))

**Version 1.0.4**
- Toolbar items are deactivated when vscode open a folder that do not contain a sketch to avoid confusion
- Fixed profile selection not appearing in the status bar when profiles are active

**Version 1.0.3**
- Introducing Build Profiles, [tutorial](https://youtu.be/i0gzop0k6yY)
- Added support for local libraries in sketch.yaml — entries with dir: paths are now fully recognized and processed.
- Arduino CLI v1.3.1

**Version 1.0.2**
- Introducing Build Profiles, [tutorial](https://youtu.be/i0gzop0k6yY)
- Arduino CLI v1.3.0

**Version 0.7.5**
- Fix programmer issue ([issue #60](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/60))

**Version 0.7.4**
- Add option to optimize compile output for debugging, rather than for release ([feature request #59](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/59))

**Version 0.7.3**
- Add user setting to enable verbose compilation or not (default is verbose)
- Fix a problem when creating sketch on an alternate drive ([issue #58](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/58))
- Fix bad handling of library installation failing ([issue #57](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/57))

**Version 0.7.2**
- Arduino CLI v1.2.2 

**Version 0.7.1**
- Arduino CLI v1.2.0 

**Version 0.7.0**
- Add user setting to disable automatic port detection on Windows ([issue #30](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/30))

**Version 0.6.9**
- Fix bug when installing a library through zip ([issue](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/36))
- Add action button to remove an updatable library ([feature request](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/37) by omarbaf)
- Add action button to remove an updatable board ([feature request](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/37) by omarbaf)
- Add folder name and sketch name in the error message when folder name and sketch name do not match

**Version 0.6.7**
- Add user setting to set user directory, equivalent of the Arduino IDE's 'sketchbook' directory. Library Manager installations are made to the libraries subdirectory of the user directory
- Add support for macOS Intel by [rudeb0t](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/28)
- UI Performance improvement by using cache to avoid repeated calls to the arduino-cli
- Correctly report to the user that a project is compiled "clean"
- Fix bug when adding additional URL

**Version 0.6.2**
- Fix libraries with patchlevel 0 showing wrongly as updatable ([issue](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/issues/22))
- Fix upload error when starting a new sketch
- Fix cancel or upload error forcing a recompilation
- Fix user error reporting when create a sketch with a name that already exist

**Version 0.6.1**
- Serial monitor settings on Home page by [rudeb0t](https://github.com/rudeb0t)
- Code Snippets added : [Documentation](https://github.com/thelastoutpostworkshop/arduino-maker-workshop/blob/main/Arduino_Snippets_Documentation.md)
- IntelliSense improvements
- Upload command will trigger compile if build is not valid

**Version 0.5.1**
- Implement notification and cancel for upload by [rudeb0t](https://github.com/rudeb0t)
- Fix bundled CLI permission on macOS Silicon by [rudeb0t](https://github.com/rudeb0t)
- Fix Arduino CLI path in settings on Windows
- Changes to Arduino CLI settings are applied to the current workspace
- Fix intellisense adding duplicate defines

**Version 0.5.0**
- Linux x64 now supported
- Bugs corrected

**Version 0.4.92**
- Resolved and restored conflict with `which` import for MacOS

**Version 0.4.8**
- MacOS ARM64 version, thanks to [rudeb0t](https://github.com/rudeb0t)
- Build output in invalidated when changes to project files and arduino configuration

**Version 0.4.7**
- New help dialog when adding and additionnal board URL

**Version 0.4.6**
- Corrected typo in Webview 

**Version 0.4.5**
- Repackaged as Win32-x64 since Linux and MacOS support are not avalaible yet. 

