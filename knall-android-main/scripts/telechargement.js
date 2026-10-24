/* ===== Knall — Téléchargements natifs (APK Android) =====
   Le WebView Android ne télécharge pas les liens « download », les blobs ni les images.
   Quand le plugin natif KnallFiles est présent, ces fonctions enregistrent vraiment les fichiers :
   - fichiers et code  -> dossier « Téléchargements »
   - images            -> « Images/Knall » (visibles dans la Galerie)
   - liens http(s)     -> gestionnaire de téléchargement Android (notification de progression)
   Sans le plugin (navigateur, app Test), rien ne change.
*/
(function(){
  "use strict";
  function KF(){ try{ return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KnallFiles; }catch(e){ return null; } }

  function info(msg){
    var t = document.createElement("div"); t.className = "tl-toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 3200);
  }
  function flash(btn, txt){ if(btn){ var o = btn.innerHTML; btn.textContent = txt; setTimeout(function(){ btn.innerHTML = o; }, 1800); } }
  function blobB64(blob){
    return new Promise(function(ok, ko){
      var r = new FileReader();
      r.onload = function(){ ok(String(r.result).split(",")[1] || ""); };
      r.onerror = ko; r.readAsDataURL(blob);
    });
  }
  function texteB64(t){ return btoa(unescape(encodeURIComponent(t))); }
  function erreur(e){ return (e && (e.message || e.errorMessage)) ? String(e.message || e.errorMessage) : String(e || "erreur"); }
  function estImage(type){ return /^image\/(png|jpe?g|gif|webp|bmp|heic|heif)/i.test(type || ""); }

  var style = document.createElement("style");
  style.textContent = ".tl-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#000d;color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;z-index:100070;max-width:85%;text-align:center}";
  document.head.appendChild(style);

  // Fonctions d'origine de l'app (gardées comme solution de secours)
  var origBlob = (typeof sauverBlob === "function") ? sauverBlob : null;
  var origFichier = (typeof telechargerFichier === "function") ? telechargerFichier : null;
  var origImage = (typeof telechargerImageUrl === "function") ? telechargerImageUrl : null;

  async function sauverBlobNatif(nom, blob, btn, partager){
    var P = KF();
    if(!P || partager){ return origBlob ? origBlob(nom, blob, btn, partager) : undefined; }   // « Ouvrir avec… » : comportement d'origine
    try{
      var r = await P[estImage(blob.type) ? "saveImage" : "saveFile"]({ name: nom, base64: await blobB64(blob), mime: blob.type || "" });
      flash(btn, "✅ Enregistré");
      info("Enregistré dans " + (r && r.folder ? r.folder : "Téléchargements") + " : " + ((r && r.name) || nom));
    }catch(e){
      info("Téléchargement impossible : " + erreur(e));
      if(origBlob) return origBlob(nom, blob, btn, partager);
    }
  }
  async function telechargerFichierNatif(nom, contenu, btn){
    var P = KF();
    if(!P){ return origFichier ? origFichier(nom, contenu, btn) : undefined; }
    try{
      var r = await P.saveFile({ name: nom, base64: texteB64(String(contenu)), mime: "" });
      flash(btn, "✅ Enregistré");
      info("Enregistré dans " + (r && r.folder ? r.folder : "Téléchargements") + " : " + ((r && r.name) || nom));
    }catch(e){
      info("Téléchargement impossible : " + erreur(e));
      if(origFichier) return origFichier(nom, contenu, btn);
    }
  }
  async function telechargerImageNatif(url, btn){
    var P = KF();
    if(!P){ return origImage ? origImage(url, btn) : undefined; }
    var nom = "knall-image-" + Date.now().toString().slice(-6);
    try{
      var rep = await fetch(url); var b = await rep.blob();
      var ext = (b.type.split("/")[1] || "jpg").replace("jpeg", "jpg").replace("svg+xml", "svg");
      return await sauverBlobNatif(nom + "." + ext, b, btn, false);
    }catch(e){
      // l'image est sur un autre site qui refuse la lecture directe : le gestionnaire Android la télécharge lui-même
      try{
        await P.download({ url: url, name: nom + ".jpg", kind: "image" });
        flash(btn, "✅ Lancé");
        info("Téléchargement lancé : regarde la notification.");
      }catch(e2){
        if(origImage) return origImage(url, btn);
        info("Téléchargement impossible : " + erreur(e2));
      }
    }
  }

  if(origBlob) sauverBlob = sauverBlobNatif;
  if(origFichier) telechargerFichier = telechargerFichierNatif;
  if(origImage) telechargerImageUrl = telechargerImageNatif;

  window.__tl = { sauverBlobNatif: sauverBlobNatif, telechargerFichierNatif: telechargerFichierNatif, telechargerImageNatif: telechargerImageNatif, texteB64: texteB64 };
})();
