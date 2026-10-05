import { readFile } from 'node:fs/promises';
import { Type } from '@earendil-works/pi-ai';
import { defineExtension, defineTool, section } from '@earendil-works/pi-durable';

export const ANDROID_CONTEXT = `You are running in pi mobile on an Android phone.
The agent harness and coding tools run locally in this app's Android sandbox; model inference uses the selected provider.
Use android_device_info when asked about the device, OS, battery or connectivity. Do not claim these are inaccessible without trying the tool.
The tool reports a timestamped, periodically refreshed native Android status snapshot, not a live screen view. Check its age.
read/write/edit/bash can access this app's private files and working directory, and public system information permitted to the app.
You do not have the Mac host's ADB or root permissions. Other apps' private files, screen capture, contacts, location, and unrestricted system settings are not available through this tool.
Device status is read-only. Do not claim to change Android settings or install app updates without an explicit supported tool and user approval.
Explain what you actually observed, what is unknown, and the permission needed for additional access.`;

export async function readAndroidDeviceInfo(file, now = Date.now()) {
  if (!file) throw new Error('Android device status is not configured on this host.');
  const info = JSON.parse(await readFile(file, 'utf8'));
  const timestamp = Date.parse(info.capturedAt);
  if (info.schemaVersion !== 1 || !Number.isFinite(timestamp) || !info.device || !info.battery || !info.network) {
    throw new Error('Android device status is invalid.');
  }
  const ageSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (ageSeconds > 30 || timestamp > now + 30_000) {
    throw new Error('Android device status is stale. The native app service may have stopped; reopen pi mobile.');
  }
  // Allowlist fields. Never expose Android identifiers, accounts, SSIDs or addresses.
  return {
    capturedAt: info.capturedAt, ageSeconds,
    device: { manufacturer: info.device.manufacturer, model: info.device.model,
      androidVersion: info.device.androidVersion, sdk: info.device.sdk },
    battery: { percent: info.battery.percent ?? null, charging: info.battery.charging ?? null,
      plugged: info.battery.plugged ?? null, powerSaveMode: info.battery.powerSaveMode ?? null },
    network: { connected: info.network.connected, internetAvailable: info.network.internetAvailable,
      validated: info.network.validated, transports: info.network.transports },
  };
}

export function androidDeviceExtension(file) {
  return defineExtension({
    name: 'android-device',
    sections: [section('android_runtime', () => ANDROID_CONTEXT)],
    tools: [defineTool({
      name: 'android_device_info',
      description: 'Read the Android phone model, OS version, battery and active network status. Read-only snapshot refreshed about every 5 seconds. Does not access the screen or other apps.',
      parameters: Type.Object({}),
      replay: 'safe',
      execute: async () => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(await readAndroidDeviceInfo(file), null, 2) }] };
        } catch {
          return { isError: true, content: [{ type: 'text', text: 'Android端末情報を取得できませんでした。情報が古いか、サービスが停止しています。pi mobileを開き直してください。' }] };
        }
      },
    })],
  });
}
