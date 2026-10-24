/* ===== Knall — Live écran : fond, sous-titres, prononciation kreyòl, « Knall se tait quand je parle » =====
   - Fond d'écran du live (image Wiler-Tech) et mise en page : sous-titres en haut, boule au milieu, ce que TU dis en bas.
   - Sous-titres : le texte que Knall dit à voix haute s'affiche en grand, phrase par phrase.
   - Prononciation : en conversation live, le kreyòl est réécrit pour la voix française avec les règles de Wilo.
   - « Knall se tait quand je parle » : si tu parles pendant que Knall parle, il s'arrête et t'écoute (Réglages > Conversation vocale).
*/
(function(){
  "use strict";
  var CLE = "knall-liveecran";
  var cfg = {silence:true, kreyol:true, sous:true};
  try{ var s0 = JSON.parse(localStorage.getItem(CLE) || "{}"); for(var k in s0) if(k in cfg) cfg[k] = !!s0[k]; }catch(e){}
  function sauver(){ try{ localStorage.setItem(CLE, JSON.stringify(cfg)); }catch(e){} }
  function liveOuvert(){ return !!document.querySelector(".live-ov"); }
  function toast(msg){
    var t = document.createElement("div"); t.className = "le-toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 3600);
  }

  /* ---------- Règles de prononciation kreyòl (voix française) ---------- */
  // Mots à traiter à part (le reste suit les règles générales plus bas)
  var EXC = {
    "genyen":"guiniyen", "gen":"guin", "kreyòl":"kréyol", "kreyol":"kréyol", "ayiti":"aïti", "ayisyen":"aïsyin", "ayisyèn":"aïsyèn",
    "byen":"bien", "w":"ou", "m":"mouin", "n":"nou", "l":"li", "k":"ki", "s":"sé", "t":"té", "y":"yo"
  };
  function casse(orig, nouveau){
    if(orig.length > 1 && orig === orig.toUpperCase()) return nouveau.toUpperCase();
    if(orig.charAt(0) !== orig.charAt(0).toLowerCase()) return nouveau.charAt(0).toUpperCase() + nouveau.slice(1);
    return nouveau;
  }
  function motKreyol(w){
    var bas = w.toLowerCase().normalize("NFC");
    if(Object.prototype.hasOwnProperty.call(EXC, bas)) return casse(w, EXC[bas]);
    var m = bas;
    m = m.replace(/w([èé])/g, "ou\u0001");     // wè -> ouè (le è reste : Jwèt -> Jouèt)
    m = m.replace(/wenn?/g, "ouin");           // Mwen -> Mouin, Jwenn -> Jouin
    m = m.replace(/w(?=[aie])/g, "ou");        // wi -> oui ; w devant o/ou reste (Wout)
    m = m.replace(/òl/g, "ol");                // Kreyòl, Lekòl : pas de « r » roulé
    m = m.replace(/ò/g, "or");                 // Fò -> For, Pòt -> Port, Kò -> Kor
    m = m.replace(/è/g, "er");                 // Fè -> Fer, Ouvè -> Ouver, Rèv -> Rerv
    m = m.replace(/en(?=m)/g, "è");            // Renmen -> Rèmen (puis Rèmenn)
    m = m.replace(/en(?=[bp])/g, "enn");       // Kenbe -> Kennbe
    m = m.replace(/en$/, "enn");               // Chen -> Chenn, Demen -> Demenn
    m = m.replace(/e(?=y)/g, "é");             // Peyi -> Péyi
    m = m.replace(/e$/, "é");                  // Manje -> Manjé, Paske -> Paské (le e final français est muet)
    m = m.replace(/g(?=e)/g, "gu");            // g dur devant e
    m = m.replace(/\u0001/g, "è");
    return casse(w, m);
  }
  function kreyolLive(texte){
    return String(texte).replace(/[\p{L}']+/gu, function(tok){
      if(tok.indexOf("'") >= 0){                // m'ap, l'ap, n'ap : on sépare
        return tok.split("'").filter(Boolean).map(motKreyol).join(" ");
      }
      return motKreyol(tok);
    });
  }

  /* ---------- Sous-titres ---------- */
  function planSousTitres(raw, vitesse){
    var propre = (typeof texteALire === "function") ? texteALire(raw) : String(raw || "");
    var v = vitesse > 0 ? vitesse : 1;
    return propre.split(/(?<=[.!?…:;])\s+/).map(function(x){ return x.trim(); }).filter(Boolean).map(function(x){
      return {texte: x, ms: Math.max(1100, Math.round(x.length * 66 / v)) + 150};
    });
  }
  var ST = {zone:null, jeton:0, timer:null, plan:[], i:0};
  function zoneSous(){
    var ov = document.querySelector(".live-ov"); if(!ov) return null;
    var z = ov.querySelector(".lv-sous");
    if(!z){ z = document.createElement("div"); z.className = "lv-sous"; ov.insertBefore(z, ov.firstChild); }
    return z;
  }
  function dessiner(){
    var z = ST.zone; if(!z) return;
    z.innerHTML = "";
    var morceaux = [[ST.plan[ST.i - 1], false], [ST.plan[ST.i], true], [ST.plan[ST.i + 1], false]];
    morceaux.forEach(function(x){
      if(!x[0]) return;
      var p = document.createElement("p"); p.textContent = x[0].texte; if(x[1]) p.className = "lv-on"; z.appendChild(p);
    });
  }
  function arreterSousTitres(effacer){
    if(ST.timer){ clearTimeout(ST.timer); ST.timer = null; }
    if(effacer && ST.zone){ ST.zone.innerHTML = ""; }
  }
  function demarrerSousTitres(raw, jeton){
    arreterSousTitres(false);
    if(!cfg.sous) return;
    var z = zoneSous(); if(!z) return;
    var vit = 1; try{ vit = (typeof vitesseVoix === "function") ? vitesseVoix() : 1; }catch(e){}
    ST.zone = z; ST.plan = planSousTitres(raw, vit); ST.i = 0;
    if(!ST.plan.length) return;
    dessiner();
    (function suite(){
      if(jeton !== ST.jeton) return;
      ST.timer = setTimeout(function(){
        if(jeton !== ST.jeton) return;
        if(ST.i < ST.plan.length - 1){ ST.i++; dessiner(); suite(); }
      }, ST.plan[ST.i].ms);
    })();
  }

  /* ---------- « Knall se tait quand je parle » ---------- */
  // Détecteur : pendant les 0,7 premières secondes on mesure l'écho de la voix de Knall, puis on exige une voix nettement plus forte,
  // pendant au moins 3 mesures de suite (~0,25 s), pour couper la parole.
  function creerDetecteur(){
    var echo = 0, suite = 0;
    return {
      pousser: function(niveau, ms){
        if(ms < 700){ if(niveau > echo) echo = niveau; return false; }
        var seuil = Math.max(0.06, echo * 2.2 + 0.03);
        if(niveau > seuil){ suite++; } else { suite = 0; }
        return suite >= 3;
      }
    };
  }
  var VEILLE = {ctx:null, flux:null, timer:null};
  function arreterVeille(){
    if(VEILLE.timer) clearInterval(VEILLE.timer);
    try{ if(VEILLE.flux) VEILLE.flux.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
    try{ if(VEILLE.ctx) VEILLE.ctx.close(); }catch(e){}
    VEILLE = {ctx:null, flux:null, timer:null};
  }
  var faux = 0;      // coupures très rapides (probable écho du haut-parleur)
  async function demarrerVeille(jeton, surParole){
    arreterVeille();
    if(!cfg.silence || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try{
      var flux = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:false}});
      if(jeton !== ST.jeton || !liveOuvert()){ flux.getTracks().forEach(function(t){ t.stop(); }); return; }   // Knall a déjà fini de parler
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC(), src = ctx.createMediaStreamSource(flux), an = ctx.createAnalyser();
      an.fftSize = 512; src.connect(an);
      var buf = new Float32Array(an.fftSize), t0 = Date.now(), det = creerDetecteur();
      var timer = setInterval(function(){
        an.getFloatTimeDomainData(buf);
        var s = 0; for(var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        var ms = Date.now() - t0;
        if(det.pousser(Math.sqrt(s / buf.length), ms)){ arreterVeille(); surParole(ms); }
      }, 80);
      VEILLE = {ctx:ctx, flux:flux, timer:timer};
    }catch(e){}
  }

  /* ---------- Branchement sur la lecture vocale de l'app ---------- */
  var lireTexte0 = (typeof lireTexte === "function") ? lireTexte : null;
  if(lireTexte0){
    lireTexte = function(raw, onFin){
      if(!liveOuvert()) return lireTexte0(raw, onFin);
      var mon = ++ST.jeton;
      var fin = function(){
        if(mon === ST.jeton){ arreterVeille(); arreterSousTitres(false); }
        if(onFin) onFin();
      };
      demarrerSousTitres(raw, mon);
      demarrerVeille(mon, function(ms){
        if(mon !== ST.jeton) return;
        if(ms < 1500 && ++faux >= 2){          // il se coupe tout seul : c'est l'écho du haut-parleur
          cfg.silence = false; sauver(); majReglages();
          toast("« Knall se tait quand je parle » est désactivé (écho détecté). Avec des écouteurs, tu peux le réactiver dans Réglages.");
        }
        try{ arreterLecture(); }catch(e){}
      });
      return lireTexte0(raw, fin);
    };
  }
  // Prononciation : règles de Wilo en live (le texte affiché ne change pas, seule la voix lit la version réécrite)
  var kv0 = (typeof kreyolVersFrancais === "function") ? kreyolVersFrancais : null;
  if(kv0){
    kreyolVersFrancais = function(t){ return (liveOuvert() && cfg.kreyol) ? kreyolLive(t) : kv0(t); };
  }
  // Nettoyage quand le live se ferme ou quand c'est à toi de parler
  new MutationObserver(function(){
    if(!liveOuvert()){ ST.jeton++; arreterVeille(); arreterSousTitres(true); ST.zone = null; faux = 0; }
  }).observe(document.body, {childList:true});

  /* ---------- Style : fond + mise en page (design moderne, même photo) ---------- */
  var FOND = "__FOND__";
  var css = document.createElement("style");
  css.textContent =
    ":root{--live-fond:none;--live-a1:#3fa9f5;--live-a2:#a24bf0}" +
    "@keyframes liveZoom{0%{transform:scale(1.02)}100%{transform:scale(1.09)}}" +
    "@keyframes liveDot{0%,100%{opacity:.45;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}" +
    ".live-ov{position:fixed;inset:0;overflow:hidden;background:#070a16;justify-content:space-between;gap:10px;" +
      "padding:calc(env(safe-area-inset-top,0px) + 6vh) 18px calc(env(safe-area-inset-bottom,0px) + 4vh)}" +
    ".live-ov::before{content:'';position:absolute;inset:-5%;z-index:0;background:var(--live-fond) center/cover no-repeat;filter:saturate(1.1) contrast(1.05);animation:liveZoom 28s ease-in-out infinite alternate}" +
    ".live-ov::after{content:'';position:absolute;inset:0;z-index:1;" +
      "background:radial-gradient(circle at 50% 32%,rgba(10,14,32,.32),rgba(5,8,19,.84) 60%,rgba(3,5,12,.95) 100%)," +
      "linear-gradient(180deg,rgba(4,8,22,.55) 0%,rgba(4,8,22,.32) 32%,rgba(3,6,17,.9) 100%)}" +
    ".live-ov > *{position:relative;z-index:2}" +
    ".live-ov .lv-sous{order:0;flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;width:100%;max-width:580px;text-align:center;overflow:hidden;padding:4px}" +
    ".live-ov .lv-sous p{margin:0;font-size:clamp(17px,4.6vw,26px);font-weight:600;letter-spacing:.01em;line-height:1.42;color:rgba(255,255,255,.3);transition:color .35s ease,transform .35s ease,opacity .35s ease;word-break:break-word;transform:scale(.97)}" +
    ".live-ov .lv-sous p.lv-on{color:#fff;font-size:clamp(20px,5.4vw,30px);font-weight:700;text-shadow:0 2px 24px rgba(0,0,0,.55);transform:scale(1)}" +
    ".live-ov .live-st{order:1;flex:none;display:inline-flex;align-items:center;gap:9px;margin:0 auto;padding:9px 20px;border-radius:999px;" +
      "background:rgba(18,22,38,.5);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.14);" +
      "font-size:12.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#edf1ff;box-shadow:0 10px 30px rgba(0,0,0,.35)}" +
    ".live-ov .live-st::before{content:'';width:8px;height:8px;border-radius:50%;flex:none;" +
      "background:linear-gradient(135deg,var(--live-a1),var(--live-a2));box-shadow:0 0 12px var(--live-a1);animation:liveDot 1.5s ease-in-out infinite}" +
    ".live-ov .live-orbe{order:2;flex:none;width:130px;height:130px;margin:8px auto;position:relative;" +
      "box-shadow:0 0 0 1px rgba(255,255,255,.08),0 0 90px rgba(63,169,245,.45),0 0 170px rgba(162,75,240,.25)}" +
    ".live-ov .live-orbe::before{content:'';position:absolute;inset:-16px;border-radius:50%;border:1px solid rgba(255,255,255,.2);opacity:.55;pointer-events:none}" +
    ".live-ov .live-orbe::after{content:'';position:absolute;inset:-30px;border-radius:50%;border:1px solid rgba(255,255,255,.08);pointer-events:none}" +
    ".live-ov .live-dit{order:3;flex:none;min-height:0;max-width:540px;width:100%;margin:0 auto;padding:13px 20px;border-radius:20px;" +
      "background:rgba(14,18,34,.55);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.1);" +
      "color:#eef1ff;font-size:15px;line-height:1.45;text-align:center;box-shadow:0 12px 32px rgba(0,0,0,.4)}" +
    ".live-ov .live-dit:empty{display:none}" +
    ".live-ov .live-fin{order:4;flex:none;margin:4px auto 0;border:0;border-radius:999px;padding:14px 32px;font-size:15px;font-weight:700;letter-spacing:.02em;" +
      "color:#fff;background:linear-gradient(135deg,#ff5a68,#c0303f);box-shadow:0 12px 30px rgba(224,70,80,.45);cursor:pointer;transition:transform .15s ease}" +
    ".live-ov .live-fin:active{transform:scale(.95)}" +
    ".le-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:rgba(10,14,28,.92);backdrop-filter:blur(14px);color:#fff;" +
      "padding:11px 18px;border-radius:14px;font-size:13px;z-index:100080;max-width:85%;text-align:center;border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 32px rgba(0,0,0,.4)}";
  document.head.appendChild(css);
  if(FOND.length > 200) document.documentElement.style.setProperty("--live-fond", "url(data:image/jpeg;base64," + FOND + ")");

  /* ---------- Réglages ---------- */
  function majReglages(){
    [["leSwSilence", "silence"], ["leSwKreyol", "kreyol"], ["leSwSous", "sous"]].forEach(function(x){
      var e = document.getElementById(x[0]); if(e) e.classList.toggle("on", !!cfg[x[1]]);
    });
  }
  function ligne(id, swId, titre, aide, cle){
    var b = document.createElement("button"); b.className = "row"; b.id = id; b.type = "button";
    b.innerHTML = '<span class="ri"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4zM5 11a7 7 0 0 0 14 0M12 18v3"/></svg></span>' +
      '<span class="rt"><b></b><small></small></span><span class="lp-sw" id="' + swId + '"></span>';
    b.querySelector("b").textContent = titre; b.querySelector("small").textContent = aide;
    b.onclick = function(){ cfg[cle] = !cfg[cle]; sauver(); majReglages(); };
    return b;
  }
  function injecter(){
    var ancre = document.getElementById("lpBip") || document.getElementById("lpMots");
    if(!ancre || document.getElementById("leSilence")) return;
    var rangees = [
      ligne("leSilence", "leSwSilence", "Knall se tait quand je parle", "Si tu parles pendant que Knall parle, il s'arrête et t'écoute. Marche mieux avec des écouteurs.", "silence"),
      ligne("leKreyol", "leSwKreyol", "Prononciation kreyòl améliorée", "En live, la voix lit le kreyòl avec les règles de Wilo (Mwen → Mouin, Fè → Fer…).", "kreyol"),
      ligne("leSous", "leSwSous", "Sous-titres du live", "Affiche en grand ce que Knall est en train de dire.", "sous")
    ];
    var suite = ancre.nextSibling;
    rangees.forEach(function(r){ ancre.parentNode.insertBefore(r, suite); });
    majReglages();
  }
  function init(){ injecter(); majReglages(); }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.__liveEcran = {kreyolLive:kreyolLive, motKreyol:motKreyol, planSousTitres:planSousTitres, creerDetecteur:creerDetecteur, cfg:cfg};
})();
