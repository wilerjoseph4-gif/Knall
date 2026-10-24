// Installe les téléchargements natifs (plugin KnallFiles) dans le projet Android.
// Lancé par les deux workflows de build, après "Permissions Android" (et après patch-wake.js s'il y en a un).
const fs = require('fs'), path = require('path');
const JAVA = 'android/app/src/main/java/com/wilertech/knall';
const MAIN = path.join(JAVA, 'MainActivity.java');
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
function fail(msg) { console.error('ERREUR patch-files : ' + msg); process.exit(1); }

// 1) le plugin
if (!fs.existsSync('scripts/KnallFilesPlugin.java')) fail('manque scripts/KnallFilesPlugin.java');
fs.mkdirSync(JAVA, { recursive: true });
fs.copyFileSync('scripts/KnallFilesPlugin.java', path.join(JAVA, 'KnallFilesPlugin.java'));
console.log('copié KnallFilesPlugin.java');

// 2) l'enregistrer dans MainActivity (version d'origine ou version avec écoute en arrière-plan)
if (!fs.existsSync(MAIN)) fail('MainActivity.java introuvable : ' + MAIN);
let m = fs.readFileSync(MAIN, 'utf8');
if (!m.includes('KnallFilesPlugin')) {
  if (m.includes('registerPlugin(')) {
    m = m.replace(/([ \t]*)registerPlugin\(([A-Za-z]+)\.class\);/, (all, ind, nom) => all + '\n' + ind + 'registerPlugin(KnallFilesPlugin.class);');
  } else if (/super\.onCreate\(/.test(m)) {
    m = m.replace(/([ \t]*)super\.onCreate\(/, (all, ind) => ind + 'registerPlugin(KnallFilesPlugin.class);\n' + all);
  } else {
    const pkg = (m.match(/^package\s+([\w.]+);/m) || [])[1] || 'com.wilertech.knall';
    m = 'package ' + pkg + ';\n\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n' +
        '    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(KnallFilesPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}\n';
  }
  fs.writeFileSync(MAIN, m);
}
if (!fs.readFileSync(MAIN, 'utf8').includes('registerPlugin(KnallFilesPlugin.class)')) fail("l'enregistrement de KnallFilesPlugin n'a pas pu être ajouté à MainActivity.java");
console.log('MainActivity OK');

// 3) permissions : réseau + stockage ancien Android (Android 10 et plus n'en ont pas besoin)
let x = fs.readFileSync(MANIFEST, 'utf8');
function perm(nom, attrs) {
  if (!x.includes('android.permission.' + nom + '"')) {
    x = x.replace('<application', '<uses-permission android:name="android.permission.' + nom + '" ' + (attrs || '') + '/>\n    <application');
  }
}
perm('INTERNET');
perm('ACCESS_NETWORK_STATE');
perm('WRITE_EXTERNAL_STORAGE', 'android:maxSdkVersion="28" ');
// le clavier doit REDIMENSIONNER la page (et non la faire glisser) : la barre de chat reste alors au-dessus du clavier
if (/android:windowSoftInputMode="[^"]*"/.test(x)) {
  x = x.replace(/android:windowSoftInputMode="[^"]*"/, 'android:windowSoftInputMode="adjustResize"');
} else {
  x = x.replace(/<activity\b/, '<activity android:windowSoftInputMode="adjustResize"');
}
fs.writeFileSync(MANIFEST, x);
console.log('manifest OK');
