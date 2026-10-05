import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readAndroidDeviceInfo, androidDeviceExtension, ANDROID_CONTEXT } from '../android-device.mjs';

async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-android-status-'));
  const file = path.join(directory, 'device-info.json');
  try { await run(file); } finally { await rm(directory, { recursive: true, force: true }); }
}
const now = Date.parse('2026-10-05T00:00:10Z');
const sample = () => ({
  schemaVersion: 1, capturedAt: '2026-10-05T00:00:05Z',
  device: { manufacturer: 'samsung', model: 'SM_S931Z', androidVersion: '16', sdk: 36, serial: 'SECRET' },
  battery: { percent: 75, charging: true, plugged: true, powerSaveMode: false },
  network: { connected: true, internetAvailable: true, validated: true, transports: ['wifi'], ssid: 'SECRET' },
  account: 'SECRET',
});

test('native snapshot is timestamped, allowlisted and read-only', async () => fixture(async (file) => {
  await writeFile(file, JSON.stringify(sample()));
  const result = await readAndroidDeviceInfo(file, now);
  assert.equal(result.device.androidVersion, '16');
  assert.equal(result.battery.percent, 75);
  assert.equal(result.ageSeconds, 5);
  assert.deepEqual(result.network.transports, ['wifi']);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.match(ANDROID_CONTEXT, /Android sandbox/);
  const extension = androidDeviceExtension(file);
  assert.equal(extension.name, 'android-device');
}));

test('reject absent, malformed, stale and future status', async () => fixture(async (file) => {
  await assert.rejects(readAndroidDeviceInfo(undefined, now), /not configured/);
  await assert.rejects(readAndroidDeviceInfo(file, now));
  await writeFile(file, '{}');
  await assert.rejects(readAndroidDeviceInfo(file, now), /invalid/);
  await writeFile(file, JSON.stringify(sample()));
  await assert.rejects(readAndroidDeviceInfo(file, now + 60_000), /stale/);
  await assert.rejects(readAndroidDeviceInfo(file, now - 60_000), /stale/);
}));
