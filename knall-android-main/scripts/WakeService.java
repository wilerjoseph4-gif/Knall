package com.wilertech.knall;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Service d'écoute du mot de déclenchement : tourne en avant-plan (notification), micro ouvert,
 * reconnaissance Vosk HORS LIGNE avec une petite grammaire (tes mots + [unk]).
 * Aucune donnée n'est envoyée sur Internet.
 */
public class WakeService extends Service {
    static final String TAG = "KnallWake";
    static final String ACTION_STOP = "com.wilertech.knall.WAKE_STOP";
    static final String CHANNEL = "knall_wake";
    static final String CHANNEL_ALERTE = "knall_wake_alerte";
    static final int NOTIF_ID = 4177;
    static final int ALERTE_ID = 4178;
    static final int RATE = 16000;

    static volatile boolean running = false;
    static volatile boolean recharger = false;       // demande de relire les mots
    static volatile boolean arretManuel = false;     // l'utilisateur a touché « Arrêter » dans la notification
    static volatile long pausedUntil = 0;            // 0 = écoute ; Long.MAX_VALUE = pause tenue par l'app
    static volatile String etat = "arret";           // arret | chargement | ecoute | erreur:...
    // --- diagnostic (affiché dans l'app : Réglages > Diagnostic de l'écoute)
    static volatile String entendu = "";             // dernier texte compris par le moteur
    static volatile long entenduA = 0;
    static volatile int detections = 0;
    static volatile String dernierMot = "";
    static volatile String grammaire = "";           // mots réellement écoutés, par langue
    static volatile int niveau = 0;                  // volume du micro (0 = silence)
    static volatile String micro = "arret";          // arret | ok | occupe | pause

    private Thread worker;
    private volatile boolean stopFlag = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            arretManuel = true;
            stopFlag = true;
            stopSelf();
            return START_NOT_STICKY;
        }
        creerCanaux();
        try {
            Notification n = notif();
            if (Build.VERSION.SDK_INT >= 30) {
                ServiceCompat.startForeground(this, NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            etat = "erreur:" + e.getMessage();
            Log.e(TAG, "startForeground", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (worker == null || !worker.isAlive()) {
            stopFlag = false;
            running = true;
            worker = new Thread(new Runnable() {
                @Override
                public void run() {
                    boucle();
                }
            }, "knall-wake");
            worker.start();
        } else {
            recharger = true;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopFlag = true;
        running = false;
        etat = "arret";
        super.onDestroy();
    }

    // ---------------------------------------------------------------- notification

    private void creerCanaux() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Écoute du mot-clé", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(CHANNEL_ALERTE, "Mot-clé entendu", NotificationManager.IMPORTANCE_HIGH));
    }

    private Notification notif() {
        Intent ouvrir = new Intent(this, MainActivity.class);
        ouvrir.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pOuvrir = PendingIntent.getActivity(this, 0, ouvrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent arret = new Intent(this, WakeService.class).setAction(ACTION_STOP);
        PendingIntent pArret = PendingIntent.getService(this, 2, arret, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Knall")
                .setContentText("Écoute du mot-clé (hors ligne)")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pOuvrir)
                .addAction(0, "Arrêter", pArret)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    // ---------------------------------------------------------------- boucle d'écoute

    private boolean enPause() {
        long t = pausedUntil;
        return t != 0 && System.currentTimeMillis() < t;
    }

    private void boucle() {
        try {
            while (!stopFlag) {
                recharger = false;
                if (!session()) break;
            }
        } catch (Throwable t) {
            etat = "erreur:" + t.getMessage();
            Log.e(TAG, "boucle", t);
        } finally {
            running = false;
            if (!etat.startsWith("erreur")) etat = "arret";
            micro = "arret";
            stopForeground(true);
            stopSelf();
        }
    }

    private AudioRecord creerMicro() {
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioRecord r = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE * 2));
        if (r.getState() != AudioRecord.STATE_INITIALIZED) {
            r.release();
            return null;
        }
        return r;
    }

    private static void fermerMicro(AudioRecord r) {
        if (r == null) return;
        try { r.stop(); } catch (Exception e) { /* déjà arrêté */ }
        try { r.release(); } catch (Exception e) { /* ignore */ }
    }

    /** Une session = les mots actuels. Retourne false si on doit s'arrêter pour de bon. */
    private boolean session() throws Exception {
        etat = "chargement";
        List<Model> modeles = new ArrayList<>();
        Map<String, Recognizer> recs = new LinkedHashMap<>();
        AudioRecord micro = null;
        try {
            JSONArray mots = new JSONArray(getSharedPreferences("knall_wake", MODE_PRIVATE).getString("mots", "[]"));
            for (String l : WakeModels.LANGS) WakeModels.preparer(this, l);
            WakeModels.Plan plan = WakeModels.planifier(this, mots);
            if (plan.phrases.isEmpty()) {
                etat = "erreur:aucun mot reconnu hors ligne";
                return false;
            }
            grammaire = plan.phrases.toString();
            LibVosk.setLogLevel(LogLevel.WARNINGS);
            for (Map.Entry<String, List<String>> e : plan.phrases.entrySet()) {
                JSONArray g = new JSONArray();
                for (String s : e.getValue()) g.put(s);
                g.put("[unk]");
                Model m = new Model(WakeModels.dir(this, e.getKey()).getAbsolutePath());
                modeles.add(m);
                recs.put(e.getKey(), new Recognizer(m, (float) RATE, g.toString()));
            }

            short[] buf = new short[1600];          // 100 ms
            short[] prev = new short[1600];
            int prevN = 0;
            double bruit = 100;
            long dernierVoix = 0;
            boolean ouvert = false;
            etat = "ecoute";

            while (!stopFlag && !recharger) {
                if (enPause()) {
                    WakeService.micro = "pause";
                    if (micro != null) {            // on rend le micro à l'app
                        fermerMicro(micro);
                        micro = null;
                        for (Recognizer r : recs.values()) r.reset();
                        ouvert = false;
                        prevN = 0;
                    }
                    Thread.sleep(250);
                    continue;
                }
                if (micro == null) {
                    micro = creerMicro();
                    if (micro == null) { WakeService.micro = "occupe"; Thread.sleep(1000); continue; }     // micro occupé (appel...) : on réessaie
                    try {
                        micro.startRecording();
                    } catch (Exception e) {
                        fermerMicro(micro);
                        micro = null;
                        Thread.sleep(1000);
                        continue;
                    }
                }
                WakeService.micro = "ok";
                int n = micro.read(buf, 0, buf.length);
                if (n <= 0) {
                    fermerMicro(micro);
                    micro = null;
                    Thread.sleep(500);
                    continue;
                }

                double s = 0;
                for (int i = 0; i < n; i++) s += (double) buf[i] * buf[i];
                double rms = Math.sqrt(s / n);
                niveau = (int) rms;
                long now = System.currentTimeMillis();
                boolean voix = rms > Math.max(300.0, bruit * 3.0);
                if (voix) dernierVoix = now; else bruit = bruit * 0.95 + rms * 0.05;
                boolean actif = (now - dernierVoix) < 800;       // on ne calcule que quand ça parle (économie de batterie)

                if (actif) {
                    if (!ouvert) {
                        ouvert = true;
                        if (prevN > 0 && verifier(recs, prev, prevN, plan)) { ouvert = false; prevN = 0; continue; }
                    }
                    if (verifier(recs, buf, n, plan)) { ouvert = false; prevN = 0; continue; }
                } else if (ouvert) {
                    ouvert = false;
                    for (Map.Entry<String, Recognizer> e : recs.entrySet()) {
                        String hit = chercher(e.getValue().getFinalResult(), plan.canon.get(e.getKey()));
                        e.getValue().reset();
                        if (hit != null) { declencher(hit); break; }
                    }
                }
                System.arraycopy(buf, 0, prev, 0, n);
                prevN = n;
            }
            return !stopFlag;
        } finally {
            fermerMicro(micro);
            for (Recognizer r : recs.values()) { try { r.close(); } catch (Throwable t) { /* ignore */ } }
            for (Model m : modeles) { try { m.close(); } catch (Throwable t) { /* ignore */ } }
        }
    }

    /** Envoie l'audio aux reconnaisseurs. true si un mot a été reconnu (et déclenché). */
    private boolean verifier(Map<String, Recognizer> recs, short[] data, int n, WakeModels.Plan plan) {
        for (Map.Entry<String, Recognizer> e : recs.entrySet()) {
            Recognizer r = e.getValue();
            boolean fin = r.acceptWaveForm(data, n);
            String hit = chercher(fin ? r.getResult() : r.getPartialResult(), plan.canon.get(e.getKey()));
            if (hit != null) {
                r.reset();
                declencher(hit);
                return true;
            }
        }
        return false;
    }

    private static String chercher(String json, Map<String, String> canon) {
        if (json == null || canon == null) return null;
        try {
            JSONObject o = new JSONObject(json);
            String t = o.optString("partial", o.optString("text", "")).trim();
            if (t.isEmpty()) return null;
            entendu = t;
            entenduA = System.currentTimeMillis();
            String h = " " + t + " ";
            for (Map.Entry<String, String> e : canon.entrySet()) {
                if (h.contains(" " + e.getKey() + " ")) return e.getValue();
            }
        } catch (Exception e) { /* json illisible */ }
        return null;
    }

    // ---------------------------------------------------------------- déclenchement

    private void declencher(String mot) {
        // pause automatique 30 s : l'app prend le micro. L'app peut la prolonger (pause) ou la lever (resume).
        pausedUntil = System.currentTimeMillis() + 30000;
        detections++;
        dernierMot = mot;
        WakePlugin.pending = true;
        WakePlugin.pendingWord = mot;
        WakePlugin.pendingAt = System.currentTimeMillis();
        boolean visible = MainActivity.visible;
        if (!visible) {
            bip();
            vibrer();
        }
        WakePlugin.emit(mot);                       // app ouverte : le JS reçoit l'événement tout de suite
        if (!visible) lancerApp(mot);
    }

    private void vibrer() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(90, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(90);
        } catch (Exception e) { /* ignore */ }
    }

    /** Bip natif : garanti même si la page web n'est pas encore chargée. */
    private void bip() {
        try {
            final ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80);
            tg.startTone(ToneGenerator.TONE_PROP_BEEP2, 160);
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try { Thread.sleep(400); } catch (InterruptedException e) { /* ignore */ }
                    tg.release();
                }
            }).start();
        } catch (Throwable t) { /* ignore */ }
    }

    private void lancerApp(String mot) {
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra("knall_wake", true);
        i.putExtra("knall_wake_word", mot);
        // 1) lancement direct (autorisé si « Afficher par-dessus les autres apps » est accordé)
        try {
            startActivity(i);
        } catch (Exception e) {
            Log.w(TAG, "startActivity", e);
        }
        // 2) filet de sécurité : notification plein écran (touche = ouvre l'app)
        try {
            PendingIntent pi = PendingIntent.getActivity(this, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification n = new NotificationCompat.Builder(this, CHANNEL_ALERTE)
                    .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                    .setContentTitle("Knall")
                    .setContentText("« " + mot + " » entendu : touche pour ouvrir le live")
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setAutoCancel(true)
                    .setTimeoutAfter(20000)
                    .setContentIntent(pi)
                    .setFullScreenIntent(pi, true)
                    .build();
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(ALERTE_ID, n);
        } catch (Exception e) {
            Log.w(TAG, "alerte", e);
        }
    }
}
