// Ajoute les permissions Android de Knall dans AndroidManifest.xml (sans doublon).
// Lancé automatiquement par: npm run init  (et par le workflow GitHub).
const fs = require("fs");
const M = "android/app/src/main/AndroidManifest.xml";
if (!fs.existsSync(M)) { console.error("AndroidManifest.xml introuvable. Lance d'abord: npx cap add android"); process.exit(1); }
let x = fs.readFileSync(M, "utf8");

const PERMS = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
];
const FEATURES = ["android.hardware.camera", "android.hardware.microphone"]; // required=false : l'app s'installe même sans caméra/micro

let add = "";
for (const p of PERMS) if (!x.includes('"' + p + '"')) add += `    <uses-permission android:name="${p}" />\n`;
for (const f of FEATURES) if (!x.includes('"' + f + '"')) add += `    <uses-feature android:name="${f}" android:required="false" />\n`;

if (add) { x = x.replace("</manifest>", add + "</manifest>"); fs.writeFileSync(M, x); console.log("Permissions ajoutées ✔"); }
else console.log("Permissions déjà en place ✔");
