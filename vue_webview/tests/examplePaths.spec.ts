import { test, expect } from '@playwright/test';
import { examplesItems } from '../src/utilities/examplePaths';

test.describe('example paths', () => {
  const platforms = [
    {
      name: 'macOS',
      installDir: '/Users/maker/Documents/Arduino/libraries/Display',
      simple: '/Users/maker/Documents/Arduino/libraries/Display/examples/Blink',
      nested: '/Users/maker/Documents/Arduino/libraries/Display/examples/Fonts/SPIFFS/Font_Demo',
    },
    {
      name: 'Linux with a capitalized Examples directory',
      installDir: '/home/maker/Arduino/libraries/Display',
      simple: '/home/maker/Arduino/libraries/Display/Examples/Blink',
      nested: '/home/maker/Arduino/libraries/Display/Examples/Fonts/SPIFFS/Font_Demo',
    },
    {
      name: 'Windows with mixed separators',
      installDir: String.raw`C:\Users\maker\Arduino\libraries\Display`,
      simple: String.raw`C:\Users\maker\Arduino\libraries\Display\examples\Blink`,
      nested: String.raw`C:\Users\maker\Arduino\libraries\Display/examples/Fonts\SPIFFS/Font_Demo`,
    },
    {
      name: 'Windows UNC share',
      installDir: String.raw`\\server\Arduino sketches\libraries\Display`,
      simple: String.raw`\\server\Arduino sketches\libraries\Display\examples\Blink`,
      nested: String.raw`\\server\Arduino sketches\libraries\Display\examples\Fonts\SPIFFS\Font_Demo`,
    },
  ];

  for (const entry of platforms) {
    test(`shows relative names and preserves open paths on ${entry.name}`, () => {
      expect(examplesItems([entry.nested, entry.simple], entry.installDir)).toEqual([
        { title: 'Blink', value: entry.simple },
        { type: 'subheader', title: 'Fonts' },
        { title: 'SPIFFS / Font_Demo', value: entry.nested },
        { type: 'divider' },
      ]);
    });
  }

  test('anchors the examples root to the library despite matching parent and nested folders', () => {
    const installDir = '/Users/examples/myexamples/libraries/Display';
    const example = `${installDir}/examples/Fonts/examples/Nested/Font_Demo`;

    expect(examplesItems([example], installDir)).toEqual([
      { type: 'subheader', title: 'Fonts' },
      { title: 'examples / Nested / Font_Demo', value: example },
      { type: 'divider' },
    ]);
  });

  test('keeps equal example names in separate groups with their original paths', () => {
    const installDir = '/opt/arduino/libraries/Sensors';
    const analog = `${installDir}/examples/Analog/ReadSensor`;
    const digital = `${installDir}/examples/Digital/ReadSensor`;

    expect(examplesItems([digital, analog], installDir)).toEqual([
      { type: 'subheader', title: 'Analog' },
      { title: 'ReadSensor', value: analog },
      { type: 'divider' },
      { type: 'subheader', title: 'Digital' },
      { title: 'ReadSensor', value: digital },
      { type: 'divider' },
    ]);
  });

  test('sorts standalone examples, groups and children without mutating input', () => {
    const installDir = '/opt/arduino/libraries/Display';
    const root = `${installDir}/examples`;
    const examples = [
      `${root}/zuluGroup/Example`,
      `${root}/Zulu`,
      `${root}/alphaGroup/Zulu`,
      `${root}/alpha`,
      `${root}/alphaGroup/alpha`,
    ];
    const original = [...examples];
    Object.freeze(examples);

    expect(examplesItems(examples, installDir)).toEqual([
      { title: 'alpha', value: `${root}/alpha` },
      { title: 'Zulu', value: `${root}/Zulu` },
      { type: 'subheader', title: 'alphaGroup' },
      { title: 'alpha', value: `${root}/alphaGroup/alpha` },
      { title: 'Zulu', value: `${root}/alphaGroup/Zulu` },
      { type: 'divider' },
      { type: 'subheader', title: 'zuluGroup' },
      { title: 'Example', value: `${root}/zuluGroup/Example` },
      { type: 'divider' },
    ]);
    expect(examples).toEqual(original);
  });

  test('finds a complete examples directory segment when install metadata is unavailable', () => {
    const example = '/home/maker/myexamples/Display/examples/Basic/Blink';

    expect(examplesItems([example])).toEqual([
      { type: 'subheader', title: 'Basic' },
      { title: 'Blink', value: example },
      { type: 'divider' },
    ]);
  });
});
