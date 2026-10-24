// Installe l'écoute en arrière-plan dans le projet Android (lancé par le workflow "Build APK (arrière-plan)").
// Copie les fichiers Java, déclare le service + les permissions, ajoute Vosk (reconnaissance hors ligne) à Gradle.
const fs = require('fs'), path = require('path');

const APP = 'android/app';
const JAVA = path.join(APP, 'src/main/java/com/wilertech/knall');
const MANIFEST = path.join(APP, 'src/main/AndroidManifest.xml');
const APP_GRADLE = path.join(APP, 'build.gradle');
const ROOT_GRADLE = 'android/build.gradle';

function fail(msg) { console.error('ERREUR patch-wake : ' + msg); process.exit(1); }
function read(f) { if (!fs.existsSync(f)) fail('fichier introuvable : ' + f); return fs.readFileSync(f, 'utf8'); }

// 1) Sources Java (MainActivity.java remplace celui du projet)
for (const f of ['WakeModels.java', 'WakeService.java', 'WakePlugin.java', 'MainActivity.java']) {
  const src = path.join('scripts', f);
  if (!fs.existsSync(src)) fail('manque ' + src);
  fs.mkdirSync(JAVA, { recursive: true });
  fs.copyFileSync(src, path.join(JAVA, f));
  console.log('copié', f);
}

// 2) Manifest : permissions + service
let m = read(MANIFEST);
for (const p of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE', 'SYSTEM_ALERT_WINDOW', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', 'RECORD_AUDIO', 'POST_NOTIFICATIONS', 'WAKE_LOCK', 'VIBRATE']) {
  if (!m.includes('android.permission.' + p + '"')) {
    if (!m.includes('<application')) fail('<application introuvable dans le manifest');
    m = m.replace('<application', '<uses-permission android:name="android.permission.' + p + '" />\n    <application');
  }
}
if (!m.includes('.WakeService')) {
  if (!m.includes('</application>')) fail('</application> introuvable dans le manifest');
  m = m.replace('</application>', '    <service android:name=".WakeService" android:exported="false" android:foregroundServiceType="microphone" />\n    </application>');
}
fs.writeFileSync(MANIFEST, m);
console.log('manifest OK');

// 3) Gradle de l'app : Vosk + JNA, architectures ARM seulement (APK plus léger)
let g = read(APP_GRADLE);
if (!g.includes('vosk-android')) {
  const ancre = "implementation project(':capacitor-android')";
  if (!g.includes(ancre)) fail("ancre introuvable dans app/build.gradle : " + ancre);
  g = g.replace(ancre, ancre +
    "\n    implementation('com.alphacephei:vosk-android:0.3.47') { exclude group: 'net.java.dev.jna', module: 'jna' }" +
    "\n    implementation 'net.java.dev.jna:jna:5.13.0@aar'");
}
if (!g.includes('abiFilters')) {
  const mv = g.match(/^[ \t]*versionName[^\n]*$/m);
  if (!mv) fail('ligne versionName introuvable dans app/build.gradle');
  g = g.replace(mv[0], () => mv[0] + "\n        ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }");
}
fs.writeFileSync(APP_GRADLE, g);
console.log('app/build.gradle OK');

// 4) Dépôt Maven de Vosk (en plus de Maven Central)
let r = read(ROOT_GRADLE);
if (!r.includes('alphacephei.com/maven')) {
  const ancre = /allprojects\s*\{\s*repositories\s*\{/;
  if (!ancre.test(r)) fail('bloc allprojects/repositories introuvable dans android/build.gradle');
  r = r.replace(ancre, m0 => m0 + "\n        maven { url 'https://alphacephei.com/maven/' }");
  fs.writeFileSync(ROOT_GRADLE, r);
}
console.log('android/build.gradle OK');
console.log('Écoute en arrière-plan installée.');
