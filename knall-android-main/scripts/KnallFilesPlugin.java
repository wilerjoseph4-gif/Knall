package com.wilertech.knall;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewTreeObserver;
import android.webkit.DownloadListener;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * Téléchargements natifs : le WebView Android ne sait pas télécharger tout seul (liens « download »,
 * blobs, images). Ce plugin enregistre les fichiers dans « Téléchargements » (ou « Images/Knall »)
 * et lance les téléchargements de liens avec le gestionnaire Android (notification de progression).
 * Aucune permission à demander sur Android 10 et plus.
 */
@CapacitorPlugin(name = "KnallFiles")
public class KnallFilesPlugin extends Plugin {

    @Override
    public void load() {
        // Liens http(s) lancés depuis la page (ex. <a href="...apk" download>) : on les confie au gestionnaire Android
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                try {
                    WebView w = getBridge().getWebView();
                    if (w == null) return;
                    w.setDownloadListener(new DownloadListener() {
                        @Override
                        public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;   // blob: et data: sont gérés par le JS
                            try {
                                String nom = URLUtil.guessFileName(url, contentDisposition, mimetype);
                                lancer(url, nom, mimetype, false);
                                Toast.makeText(getContext(), "Téléchargement lancé : " + nom, Toast.LENGTH_SHORT).show();
                            } catch (Exception e) {
                                Toast.makeText(getContext(), "Téléchargement impossible", Toast.LENGTH_SHORT).show();
                            }
                        }
                    });
                } catch (Exception e) { /* ignore */ }
                surveillerClavier();
            }
        });
    }

    // ------------------------------------------------------------------ clavier
    // Dit à la page de combien le clavier recouvre réellement l'écran : la page remonte alors la barre de chat.
    // On mesure l'écart réel (bas du WebView - haut du clavier) : si Android a déjà redimensionné la page, l'écart est 0.
    private int dernierClavier = -1;

    private void surveillerClavier() {
        try {
            final Activity act = getActivity();
            if (act == null) return;
            final View racine = act.getWindow().getDecorView();
            racine.getViewTreeObserver().addOnGlobalLayoutListener(new ViewTreeObserver.OnGlobalLayoutListener() {
                @Override
                public void onGlobalLayout() {
                    clavierChange(racine);
                }
            });
        } catch (Exception e) { /* ignore */ }
    }

    private void clavierChange(View racine) {
        try {
            final WebView w = getBridge().getWebView();
            WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(racine);
            int recouvre = 0;
            if (w != null && wi != null && wi.isVisible(WindowInsetsCompat.Type.ime())) {
                int imeBas = wi.getInsets(WindowInsetsCompat.Type.ime()).bottom;
                int[] pos = new int[2];
                w.getLocationInWindow(pos);
                int basWebView = pos[1] + w.getHeight();
                int hautClavier = racine.getHeight() - imeBas;
                recouvre = Math.max(0, basWebView - hautClavier);
            }
            if (recouvre == dernierClavier) return;
            dernierClavier = recouvre;
            final int dp = Math.round(recouvre / getContext().getResources().getDisplayMetrics().density);
            if (w != null) {
                w.post(new Runnable() {
                    @Override
                    public void run() {
                        w.evaluateJavascript("window.__knallClavier&&window.__knallClavier(" + dp + ")", null);
                    }
                });
            }
        } catch (Exception e) { /* ignore */ }
    }

    // ------------------------------------------------------------------ utilitaires

    private static String nettoyer(String nom) {
        if (nom == null) nom = "";
        nom = nom.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (nom.length() > 120) nom = nom.substring(nom.length() - 120);
        return nom.isEmpty() ? "knall-fichier" : nom;
    }

    private static String mimeDe(String nom) {
        int i = nom.lastIndexOf('.');
        if (i >= 0 && i < nom.length() - 1) {
            String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(nom.substring(i + 1).toLowerCase(Locale.ROOT));
            if (m != null) return m;
        }
        return "application/octet-stream";
    }

    private static File fichierUnique(File dir, String nom) {
        File f = new File(dir, nom);
        if (!f.exists()) return f;
        int i = nom.lastIndexOf('.');
        String base = i > 0 ? nom.substring(0, i) : nom, ext = i > 0 ? nom.substring(i) : "";
        for (int n = 1; n < 1000; n++) {
            f = new File(dir, base + " (" + n + ")" + ext);
            if (!f.exists()) return f;
        }
        return new File(dir, System.currentTimeMillis() + ext);
    }

    /** Enregistre des octets dans Téléchargements (image = false) ou Images/Knall (image = true). */
    private JSObject enregistrer(String nom, byte[] data, String mime, boolean image) throws Exception {
        Context c = getContext();
        nom = nettoyer(nom);
        if (mime == null || mime.isEmpty()) mime = mimeDe(nom);
        String dossier = image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS;
        String etiquette = image ? "Images/Knall" : "Téléchargements";
        JSObject r = new JSObject();
        r.put("name", nom);
        r.put("folder", etiquette);
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, nom);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, image ? dossier + "/Knall" : dossier);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri coll = image
                    ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            ContentResolver res = c.getContentResolver();
            Uri u = res.insert(coll, v);
            if (u == null) throw new IllegalStateException("enregistrement impossible");
            try (OutputStream o = res.openOutputStream(u)) {
                if (o == null) throw new IllegalStateException("écriture impossible");
                o.write(data);
            }
            ContentValues fin = new ContentValues();
            fin.put(MediaStore.MediaColumns.IS_PENDING, 0);
            res.update(u, fin, null, null);
            r.put("uri", u.toString());
        } else {
            // Android 9 et moins : l'écriture dans le stockage public demande l'autorisation « Stockage »
            if (ContextCompat.checkSelfPermission(c, Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                throw new IllegalStateException("autorise « Stockage » pour Knall dans les réglages Android");
            }
            File dir = Environment.getExternalStoragePublicDirectory(dossier);
            if (image) dir = new File(dir, "Knall");
            dir.mkdirs();
            File f = fichierUnique(dir, nom);
            try (OutputStream o = new FileOutputStream(f)) {
                o.write(data);
            }
            MediaScannerConnection.scanFile(c, new String[]{f.getAbsolutePath()}, new String[]{mime}, null);
            r.put("uri", Uri.fromFile(f).toString());
        }
        return r;
    }

    /** Lance un téléchargement avec le gestionnaire Android (notification de progression). */
    private long lancer(String url, String nom, String mime, boolean image) {
        nom = nettoyer(nom);
        Context c = getContext();
        DownloadManager dm = (DownloadManager) c.getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        req.setTitle(nom);
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.allowScanningByMediaScanner();
        if (mime != null && !mime.isEmpty()) req.setMimeType(mime);
        req.setDestinationInExternalPublicDir(image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS, (image ? "Knall/" : "") + nom);
        return dm.enqueue(req);
    }

    // ------------------------------------------------------------------ méthodes appelées par le JS

    /** saveFile({name, base64, mime?}) -> {name, folder, uri} : dans Téléchargements */
    @PluginMethod
    public void saveFile(final PluginCall call) {
        sauver(call, false);
    }

    /** saveImage({name, base64, mime?}) -> {name, folder, uri} : dans Images/Knall (visible dans la Galerie) */
    @PluginMethod
    public void saveImage(final PluginCall call) {
        sauver(call, true);
    }

    private void sauver(final PluginCall call, final boolean image) {
        final String nom = call.getString("name", "knall-fichier");
        final String b64 = call.getString("base64", "");
        final String mime = call.getString("mime", "");
        if (b64 == null || b64.isEmpty()) {
            call.reject("contenu vide");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    byte[] data = Base64.decode(b64, Base64.DEFAULT);
                    JSObject r;
                    try {
                        r = enregistrer(nom, data, mime, image);
                    } catch (Exception e) {
                        if (!image) throw e;
                        r = enregistrer(nom, data, mime, false);       // type d'image refusé par la Galerie : on le met dans Téléchargements
                    }
                    call.resolve(r);
                } catch (Exception e) {
                    call.reject("sauvegarde: " + e.getMessage());
                }
            }
        }).start();
    }

    /** download({url, name?, mime?, kind?}) : téléchargement d'un lien http(s) par le gestionnaire Android */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("lien invalide");
            return;
        }
        String mime = call.getString("mime", "");
        String nom = call.getString("name", "");
        if (nom == null || nom.isEmpty()) nom = URLUtil.guessFileName(url, null, mime);
        boolean image = "image".equals(call.getString("kind", ""));
        try {
            long id = lancer(url, nom, mime, image);
            JSObject r = new JSObject();
            r.put("id", id);
            r.put("name", nettoyer(nom));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("téléchargement: " + e.getMessage());
        }
    }

    /** downloadStatus({id}) -> {status: pending|running|paused|ok|failed|unknown, reason} (reason = code HTTP ou code Android si échec) */
    @PluginMethod
    public void downloadStatus(PluginCall call) {
        long id = call.getData().optLong("id", -1);
        JSObject r = new JSObject();
        r.put("status", "unknown");
        r.put("reason", 0);
        try {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            Cursor c = dm.query(new DownloadManager.Query().setFilterById(id));
            if (c != null) {
                try {
                    if (c.moveToFirst()) {
                        int st = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS));
                        int why = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_REASON));
                        String nom = st == DownloadManager.STATUS_SUCCESSFUL ? "ok"
                                : st == DownloadManager.STATUS_FAILED ? "failed"
                                : st == DownloadManager.STATUS_PAUSED ? "paused"
                                : st == DownloadManager.STATUS_RUNNING ? "running" : "pending";
                        r.put("status", nom);
                        r.put("reason", why);
                    }
                } finally {
                    c.close();
                }
            }
        } catch (Exception e) { /* statut inconnu */ }
        call.resolve(r);
    }
}
