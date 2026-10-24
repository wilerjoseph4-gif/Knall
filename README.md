# Knall — vèsyon Android (Capacitor)

## Sa ki nan zip la
```
www/                  ← app la (index.html + knowledge/)
  index.html          ← Knall (tout nan yon sèl fichye)
  knowledge/<ajan>/   ← konesans chak ajan (general, taches, code, recherche, redaction)
                        PA gen dosye pou ajan "image"
server/               ← sèvè relè a (Render): server.js, package.json, .env.example
resources/            ← ikòn + splash (zèklè Knall)
capacitor.config.json ← non app la (Knall) + id (com.wilertech.knall)
package.json          ← Capacitor 8 + plugin Filesystem ak Share
.github/workflows/    ← konstwi APK a sou GitHub, san PC
```

## 1) Mete konesans ou yo
Pou chak ajan, dosye `www/knowledge/<ajan>/` gen:
- `index.json` → lis non fichye yo: `["base.json", "lot.json"]`
- fichye yo → lis kesyon/repons:
```json
[{"id":"g001","question":"kisa Knall ye","reponse":"Knall se ...","tags":["knall","app"]}]
```
Si ou gen deja yon `www/` ak konesans ou, kopye li sou `www/` la. Se sèlman bezwen `index.html` + `knowledge/`.
Si fichye yo pa jwenn, app la itilize ti konesans entegre a (13 repons).

## 2) Sèvè a (Render) — fè sa anvan
- Mete `server/` sou Render (Web Service, `npm install` / `npm start`).
- Nan Environment: `KNALL_APP_TOKEN` (menm valè ak `APP_TOKEN` nan `index.html`) + omwen yon kle IA (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`...).
- Nan `www/index.html`, `PROXY_URL` dwe pwente sou **menm sèvis la** (kounye a: `https://knall-1.onrender.com`).
  Teste: louvri URL la nan navigatè → ou dwe wè **Knall proxy OK**. Si ou wè 404, URL la pa bon.

## 3) APK a — opsyon A: sou GitHub (san PC)
1. Mete tout dosye sa yo nan yon repo GitHub.
2. Onglet **Actions → Build APK Knall → Run workflow**.
3. Lè li fini, telechaje **knall-apk** (andedan: `app-debug.apk`) epi enstale l sou telefòn.

## 3) APK a — opsyon B: sou PC (Node 22+, Java 21, Android Studio)
```
npm install
npm run init          # kreye android/ + mete pèmisyon yo + ikòn/splash + sync
npm run open          # Android Studio → Build → Build APK(s)
```
Pèmisyon yo (entènèt, kamera, mikwo) mete otomatikman pa `scripts/patch-android.js` (`npm run perms` si ou bezwen relanse l).
Chak fwa ou chanje `www/`: `npm run sync`.

## Sa pou veye
- **Telechaje/Pataje fichye** (PDF, Word, Excel...): `index.html` deja itilize plugin Filesystem + Share lè l nan Android. Yo nan `package.json`.
- **Mikwo (dikte):** WebView Android pa gen dikte; bouton an kache poukont li. Pou l mache: plugin `@capacitor-community/speech-recognition` (pwochen etap).
- **Lekti vwa (Écouter):** itilize vwa TTS telefòn lan (fransè pou kreyòl, ak règ pwononsyasyon yo).
- **Internet:** pdf.js, mammoth, KaTeX, Firebase ak OCR chaje depi CDN → bezwen entènèt. Pou travay offline nèt, telechaje yo nan `www/` epi chanje `<script src>`.
- **Debug vs release:** APK a se *debug*. Pou Play Store: bezwen yon *keystore* (siyati) ak `assembleRelease`.
- **Chanje id app la** (`com.wilertech.knall`) nan `capacitor.config.json` AVAN `cap add android`.
- **Sekirite:** `APP_TOKEN` ak kòd admin (`000999`) nan `index.html` vizib nan APK. Pa mete yon sekrè enpòtan la.
- Si ou vle yon vèsyon Capacitor ki pi nouvo, fè tout pakè `@capacitor/*` rete sou menm vèsyon majè.
