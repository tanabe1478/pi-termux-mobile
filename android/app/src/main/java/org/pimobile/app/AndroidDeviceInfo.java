package org.pimobile.app;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.time.Instant;

/** Minimal, read-only device status. No account identifiers, location, SSID or IP addresses. */
final class AndroidDeviceInfo {
    private AndroidDeviceInfo() {}

    static File file(Context context) {
        return new File(context.getFilesDir(), "home/.pi-mobile/device-info.json");
    }

    static void write(Context context) {
        File target = file(context);
        target.getParentFile().mkdirs();
        AtomicFile atomic = new AtomicFile(target);
        FileOutputStream stream = null;
        try {
            JSONObject data = new JSONObject();
            data.put("schemaVersion", 1);
            data.put("capturedAt", Instant.now().toString());
            JSONObject device = new JSONObject();
            device.put("manufacturer", Build.MANUFACTURER);
            device.put("model", Build.MODEL);
            device.put("androidVersion", Build.VERSION.RELEASE);
            device.put("sdk", Build.VERSION.SDK_INT);
            data.put("device", device);

            JSONObject battery = new JSONObject();
            Intent intent = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (intent != null) {
                int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                battery.put("percent", level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : JSONObject.NULL);
                int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                battery.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING
                        || status == BatteryManager.BATTERY_STATUS_FULL);
                battery.put("plugged", intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0);
            }
            PowerManager power = context.getSystemService(PowerManager.class);
            battery.put("powerSaveMode", power != null && power.isPowerSaveMode());
            data.put("battery", battery);

            JSONObject connection = new JSONObject();
            ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
            Network network = manager == null ? null : manager.getActiveNetwork();
            NetworkCapabilities caps = network == null ? null : manager.getNetworkCapabilities(network);
            JSONArray transports = new JSONArray();
            if (caps != null) {
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transports.put("wifi");
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transports.put("cellular");
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transports.put("ethernet");
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) transports.put("vpn");
                if (transports.length() == 0) transports.put("other");
            }
            connection.put("connected", caps != null);
            connection.put("internetAvailable", caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));
            connection.put("validated", caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
            connection.put("transports", transports);
            data.put("network", connection);

            stream = atomic.startWrite();
            stream.write(data.toString().getBytes("UTF-8"));
            atomic.finishWrite(stream);
        } catch (Exception error) {
            if (stream != null) atomic.failWrite(stream);
            android.util.Log.w("PiService", "Device status snapshot unavailable");
        }
    }
}
