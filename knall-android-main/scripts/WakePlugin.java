package com.wilertech.knall;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Pont JavaScript <-> service d'écoute. Côté JS : Capacitor.Plugins.KnallWake */
@CapacitorPlugin(name = "KnallWake")
public class WakePlugin extends Plugin {
    static volatile boolean pending = false;
    static volatile String pendingWord = "";
    static volatile long pendingAt = 0;
    private static WakePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Prévient le JS qu'un mot a été entendu. false si la page n'est pas là. */
    static boolean emit(String word) {
        WakePlugin p = instance;
        if (p == null) return false;
        JSObject o = new JSObject();
        o.put("word", word);
        p.notifyListeners("wake", o);
        return true;
    }

    private static JSArray liste(java.util.List<String> l) {
        JSArray a = new JSArray();
        for (String s : l) a.put(s);
        return a;
    }

    private JSObject resultat(WakeModels.Plan p) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("supported", liste(p.supportes));
        r.put("unsupported", liste(p.nonSupportes));
        java.util.List<String> prets = new java.util.ArrayList<>();
        java.util.List<String> apk = new java.util.ArrayList<>();
        for (String l : WakeModels.LANGS) {
            if (WakeModels.pret(c, l)) prets.add(l);
            if (WakeModels.dansApk(c, l)) apk.add(l);
        }
        r.put("models", liste(prets));
        r.put("modelsInApk", liste(apk));
        return r;
    }

    /** Quels mots le moteur hors ligne peut-il reconnaître ? (copie les modèles la 1ère fois : ~30 s) */
    @PluginMethod
    public void coverage(final PluginCall call) {
        final JSArray mots = call.getArray("words", new JSArray());
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Context c = getContext();
                    for (String l : WakeModels.LANGS) WakeModels.preparer(c, l);
                    call.resolve(resultat(WakeModels.planifier(c, mots)));
                } catch (Exception e) {
                    call.reject("coverage: " + e.getMessage());
                }
            }
        }).start();
    }

    /** Démarre (ou recharge) l'écoute avec ces mots : {words:[{m,v:[...],l}]} */
    @PluginMethod
    public void start(final PluginCall call) {
        final Context c = getContext();
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("micro");
            return;
        }
        final JSArray mots = call.getArray("words", new JSArray());
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    for (String l : WakeModels.LANGS) WakeModels.preparer(c, l);
                    WakeModels.Plan p = WakeModels.planifier(c, mots);
                    JSObject r = resultat(p);
                    if (p.phrases.isEmpty()) {
                        r.put("started", false);
                        r.put("reason", "aucun-mot");
                        call.resolve(r);
                        return;
                    }
                    c.getSharedPreferences("knall_wake", Context.MODE_PRIVATE).edit().putString("mots", mots.toString()).apply();
                    WakeService.pausedUntil = 0;
                    WakeService.arretManuel = false;
                    if (WakeService.running) WakeService.recharger = true;
                    ContextCompat.startForegroundService(c, new Intent(c, WakeService.class));
                    r.put("started", true);
                    call.resolve(r);
                } catch (Exception e) {
                    call.reject("start: " + e.getMessage());
                }
            }
        }).start();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context c = getContext();
        WakeService.arretManuel = false;
        c.stopService(new Intent(c, WakeService.class));
        call.resolve();
    }

    /** Pause tenue par l'app (live, dictée...) : le micro est rendu. */
    @PluginMethod
    public void pause(PluginCall call) {
        // 20 s : l'app renvoie « pause » toutes les quelques secondes tant que le live est ouvert.
        // Si l'app est gelée (écran verrouillé), la pause expire et l'écoute reprend toute seule.
        WakeService.pausedUntil = System.currentTimeMillis() + 20000;
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        WakeService.pausedUntil = 0;
        call.resolve();
    }

    /** Un mot a-t-il été entendu pendant que l'app n'était pas là ? {pending, word, age} (age en ms) */
    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject r = new JSObject();
        boolean p = pending;
        r.put("pending", p);
        r.put("word", pendingWord);
        r.put("age", p ? System.currentTimeMillis() - pendingAt : 0);
        pending = false;
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("running", WakeService.running);
        r.put("etat", WakeService.etat);
        r.put("heard", WakeService.entendu);
        r.put("heardAgo", WakeService.entenduA == 0 ? -1 : System.currentTimeMillis() - WakeService.entenduA);
        r.put("detections", WakeService.detections);
        r.put("lastWord", WakeService.dernierMot);
        r.put("grammar", WakeService.grammaire);
        r.put("level", WakeService.niveau);
        r.put("mic", WakeService.micro);
        long t = WakeService.pausedUntil;
        r.put("paused", t != 0 && System.currentTimeMillis() < t);
        r.put("arretManuel", WakeService.arretManuel);
        r.put("overlay", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c));
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        r.put("battery", pm != null && Build.VERSION.SDK_INT >= 23 && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        boolean plein = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            plein = nm != null && nm.canUseFullScreenIntent();
        }
        r.put("fullScreen", plein);
        r.put("notifications", NotificationManagerCompat.from(c).areNotificationsEnabled());
        java.util.List<String> prets = new java.util.ArrayList<>();
        java.util.List<String> apk = new java.util.ArrayList<>();
        for (String l : WakeModels.LANGS) {
            if (WakeModels.pret(c, l)) prets.add(l);
            if (WakeModels.dansApk(c, l)) apk.add(l);
        }
        r.put("models", liste(prets));
        r.put("modelsInApk", liste(apk));
        call.resolve(r);
    }

    /** Ouvre le bon écran de réglages Android : what = battery | overlay | fullscreen | notifications */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String what = call.getString("what", "notifications");
        String pkg = getContext().getPackageName();
        Intent i;
        if ("battery".equals(what)) {
            i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
        } else if ("overlay".equals(what)) {
            i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + pkg));
        } else if ("fullscreen".equals(what)) {
            if (Build.VERSION.SDK_INT < 34) {
                call.resolve();
                return;
            }
            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + pkg));
        } else {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        }
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)));
                call.resolve();
            } catch (Exception e2) {
                call.reject("settings: " + e2.getMessage());
            }
        }
    }
}
