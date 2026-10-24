// Signature stable + numéro de version automatique (lancé par les workflows de build).
//  - versionCode = numéro d'exécution GitHub Actions (toujours croissant : Android accepte la mise à jour)
//  - signature : android/app/knall.keystore (créée UNE fois par le workflow « Créer la clé de signature »).
//    Sans cette clé, GitHub signe avec une clé différente à chaque build et Android refuse la mise à jour.
const fs = require('fs');
const G = 'android/app/build.gradle';
if (!fs.existsSync(G)) { console.error('ERREUR patch-signing : ' + G + ' introuvable'); process.exit(1); }
let g = fs.readFileSync(G, 'utf8');

g = g.replace(/versionCode[ \t]+[^\n]+/, () => 'versionCode Integer.parseInt(System.getenv("GITHUB_RUN_NUMBER") ?: "1")');
g = g.replace(/versionName[ \t]+[^\n]+/, () => 'versionName "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")');

if (!g.includes('knallSigning')) {
  const a = g.indexOf('android {');
  if (a < 0) { console.error('ERREUR patch-signing : bloc android { introuvable'); process.exit(1); }
  const bloc = `
    // knallSigning : clé de signature stable
    signingConfigs {
        knall {
            def ks = file('knall.keystore')
            def pf = file('knall.keystore.pass')
            if (ks.exists() && pf.exists()) {
                storeFile ks
                storePassword pf.text.trim()
                keyAlias 'knall'
                keyPassword pf.text.trim()
            }
        }
    }
`;
  g = g.slice(0, a + 'android {'.length) + bloc + g.slice(a + 'android {'.length);
  if (!/buildTypes\s*\{/.test(g)) { console.error('ERREUR patch-signing : buildTypes introuvable'); process.exit(1); }
  g = g.replace(/buildTypes\s*\{/, m => m + `
        debug {
            if (file('knall.keystore').exists()) { signingConfig signingConfigs.knall }
        }`);
  g = g.replace(/(release\s*\{)/, m => m + `
            if (file('knall.keystore').exists()) { signingConfig signingConfigs.knall }`);
}
fs.writeFileSync(G, g);

const stable = fs.existsSync('android/app/knall.keystore') && fs.existsSync('android/app/knall.keystore.pass');
console.log(stable
  ? 'Signature : clé stable knall.keystore (les mises à jour s\'installeront par-dessus).'
  : 'ATTENTION : pas de clé stable. Lance une fois « Créer la clé de signature » : sans elle Android refuse les mises à jour.');
console.log('Numéro de version : build ' + (process.env.GITHUB_RUN_NUMBER || '1'));
