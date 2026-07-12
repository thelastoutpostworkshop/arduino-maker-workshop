import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { createCortexDebugConfiguration, findCortexDebugConfiguration, mergeCortexDebugConfiguration } from '../debugConfiguration';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});
});

suite('Cortex-Debug configuration', () => {
	test('maps Arduino CLI debug metadata including custom Cortex-Debug fields', () => {
		const configuration = createCortexDebugConfiguration({
			executable: '/tmp/blink.elf',
			toolchain_path: '/tools/bin',
			toolchain_prefix: 'arm-none-eabi',
			server: 'openocd',
			server_path: '/tools/openocd',
			server_configuration: { scripts: ['/boards/zero.cfg'] },
			svd_file: '/boards/chip.svd',
			custom_configs: { 'cortex-debug': { runToEntryPoint: 'main' } },
		}, 'arduino:samd:zero', 'edbg');

		assert.strictEqual(configuration.configId, 'arduino:samd:zero:programmer=edbg');
		assert.strictEqual(configuration.type, 'cortex-debug');
		assert.strictEqual(configuration.executable, '/tmp/blink.elf');
		assert.strictEqual(configuration.runToEntryPoint, 'main');
		assert.deepStrictEqual(configuration.configFiles, ['/boards/zero.cfg']);
	});

	test('updates only the matching generated launch configuration', () => {
		const generated = createCortexDebugConfiguration({
			executable: '/tmp/blink.elf',
			server: 'openocd',
			server_path: '/tools/openocd',
		}, 'arduino:samd:zero', 'edbg');
		const launch = mergeCortexDebugConfiguration({
			version: '0.2.0',
			configurations: [
				{ name: 'Keep me', type: 'node', request: 'launch' },
				{ configId: generated.configId, name: 'Old generated configuration' },
			]
		}, generated);

		const configurations = launch.configurations as Record<string, unknown>[];
		assert.strictEqual(configurations.length, 2);
		assert.strictEqual(configurations[0].name, 'Keep me');
		assert.strictEqual(configurations[1].executable, '/tmp/blink.elf');
	});

	test('preserves an existing launch version', () => {
		const generated = createCortexDebugConfiguration({
			executable: '/tmp/blink.elf',
			server: 'openocd',
			server_path: '/tools/openocd',
		}, 'arduino:samd:zero', 'edbg');
		const launch = mergeCortexDebugConfiguration({ version: '0.3.0' }, generated);
		assert.strictEqual(launch.version, '0.3.0');
	});

	test('finds a generated configuration by its stable identifier', () => {
		const generated = createCortexDebugConfiguration({
			executable: '/tmp/blink.elf',
			server: 'openocd',
			server_path: '/tools/openocd',
		}, 'arduino:samd:zero', 'edbg');
		const launch = mergeCortexDebugConfiguration(undefined, generated);
		assert.strictEqual(findCortexDebugConfiguration(launch, generated.configId)?.name, generated.name);
	});
});
