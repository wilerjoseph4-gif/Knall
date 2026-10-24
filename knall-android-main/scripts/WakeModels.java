package com.wilertech.knall;

import android.content.Context;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;

/** Modèles Vosk (hors ligne) : copie depuis les assets, vocabulaire, et choix des mots à écouter. */
final class WakeModels {
    /** Ordre de préférence quand un mot n'a pas d'indice de langue. */
    static final String[] LANGS = {"fr", "en"};
    private static final Map<String, Set<String>> VOCAB = new HashMap<>();

    /** Résultat du choix : quels mots dans quelle langue, et lesquels ne sont pas reconnus hors ligne. */
    static final class Plan {
        final Map<String, List<String>> phrases = new LinkedHashMap<>();   // langue -> phrases de la grammaire
        final Map<String, Map<String, String>> canon = new HashMap<>();    // langue -> (phrase -> mot affiché)
        final List<String> supportes = new ArrayList<>();
        final List<String> nonSupportes = new ArrayList<>();
    }

    private WakeModels() {}

    static File dir(Context c, String lang) {
        return new File(c.getFilesDir(), "vosk/model-" + lang);
    }

    static boolean dansApk(Context c, String lang) {
        try {
            String[] l = c.getAssets().list("vosk-model-" + lang);
            return l != null && l.length > 0;
        } catch (IOException e) {
            return false;
        }
    }

    private static String marque(Context c) {
        long t = 0;
        try {
            t = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).lastUpdateTime;
        } catch (Exception e) { /* marque 0 */ }
        return ".ok-" + t;
    }

    static boolean pret(Context c, String lang) {
        return new File(dir(c, lang), marque(c)).exists();
    }

    /** Copie le modèle depuis l'APK vers le stockage interne (une seule fois par installation). */
    static synchronized boolean preparer(Context c, String lang) {
        if (pret(c, lang)) return true;
        if (!dansApk(c, lang)) return false;
        try {
            File d = dir(c, lang);
            supprimer(d);
            d.mkdirs();
            copier(c.getAssets(), "vosk-model-" + lang, d);
            new File(d, marque(c)).createNewFile();
            VOCAB.remove(lang);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static void copier(AssetManager am, String from, File to) throws IOException {
        String[] list = am.list(from);
        if (list == null || list.length == 0) {
            InputStream in;
            try {
                in = am.open(from);
            } catch (IOException e) {          // dossier vide
                to.mkdirs();
                return;
            }
            try (InputStream i = in; OutputStream out = new FileOutputStream(to)) {
                byte[] b = new byte[65536];
                int n;
                while ((n = i.read(b)) > 0) out.write(b, 0, n);
            }
            return;
        }
        to.mkdirs();
        for (String s : list) copier(am, from + "/" + s, new File(to, s));
    }

    private static void supprimer(File f) {
        if (!f.exists()) return;
        File[] fs = f.listFiles();
        if (fs != null) for (File x : fs) supprimer(x);
        f.delete();
    }

    /** Liste des mots connus du modèle (graph/words.txt). null = inconnu. */
    static synchronized Set<String> vocab(Context c, String lang) {
        if (VOCAB.containsKey(lang)) return VOCAB.get(lang);
        File f = new File(dir(c, lang), "graph/words.txt");
        Set<String> s = null;
        if (f.exists()) {
            s = new HashSet<>();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    int i = line.indexOf(' ');
                    s.add(i > 0 ? line.substring(0, i) : line);
                }
            } catch (IOException e) {
                s = null;
            }
        }
        VOCAB.put(lang, s);
        return s;
    }

    static String sansAccents(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
    }

    private static String normPhrase(String s) {
        return s.toLowerCase(Locale.ROOT).replace('\u2019', '\'').trim().replaceAll("\\s+", " ");
    }

    private static String resoudre(Set<String> vocab, String tok) {
        if (vocab == null) return tok;            // vocabulaire inconnu : on laisse Vosk décider
        if (vocab.contains(tok)) return tok;
        String s = sansAccents(tok);
        if (vocab.contains(s)) return s;
        return null;
    }

    /**
     * mots = [{"m":"Messi","v":["messi","messie"],"l":"fr"}, ...]
     * Chaque mot va dans la première langue (indice d'abord) dont le vocabulaire contient au moins une de ses variantes.
     */
    static Plan planifier(Context c, JSONArray mots) {
        Plan p = new Plan();
        List<String> langues = new ArrayList<>();
        for (String l : LANGS) if (pret(c, l)) langues.add(l);

        for (int i = 0; i < mots.length(); i++) {
            JSONObject o = mots.optJSONObject(i);
            if (o == null) continue;
            String m = o.optString("m", "").trim();
            if (m.isEmpty()) continue;
            String indice = o.optString("l", "");

            LinkedHashSet<String> variantes = new LinkedHashSet<>();
            variantes.add(normPhrase(m));
            JSONArray v = o.optJSONArray("v");
            if (v != null) {
                for (int j = 0; j < v.length(); j++) {
                    String s = normPhrase(v.optString(j, ""));
                    if (!s.isEmpty()) variantes.add(s);
                }
            }

            List<String> ordre = new ArrayList<>();
            if (!indice.isEmpty() && langues.contains(indice)) ordre.add(indice);
            for (String l : langues) if (!ordre.contains(l)) ordre.add(l);

            boolean ok = false;
            for (String l : ordre) {
                Set<String> voc = vocab(c, l);
                List<String> retenues = new ArrayList<>();
                for (String ph : variantes) {
                    StringBuilder sb = new StringBuilder();
                    boolean tout = true;
                    for (String tok : ph.split(" ")) {
                        String r = resoudre(voc, tok);
                        if (r == null) { tout = false; break; }
                        if (sb.length() > 0) sb.append(' ');
                        sb.append(r);
                    }
                    if (tout && sb.length() > 0) retenues.add(sb.toString());
                }
                if (retenues.isEmpty()) continue;
                List<String> g = p.phrases.get(l);
                if (g == null) { g = new ArrayList<>(); p.phrases.put(l, g); }
                Map<String, String> cn = p.canon.get(l);
                if (cn == null) { cn = new HashMap<>(); p.canon.put(l, cn); }
                for (String r : retenues) {
                    if (!g.contains(r)) g.add(r);
                    cn.put(r, m);
                }
                ok = true;
                break;
            }
            if (ok) p.supportes.add(m); else p.nonSupportes.add(m);
        }
        return p;
    }
}
