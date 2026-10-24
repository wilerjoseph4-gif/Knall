/* ===== Knall — Mise à jour de l'application (annoncée depuis l'Admin) =====
   - Au démarrage (et au retour dans l'app), Knall demande au serveur s'il existe une version plus récente.
   - Mise à jour « au choix » : fenêtre avec « Mettre à jour » / « Plus tard » (revient dans 24 h).
   - Mise à jour « obligatoire » : fenêtre qui bloque l'app jusqu'à la mise à jour.
   - Réglages > Mise à jour : version installée, bouton, lien de téléchargement et package.
   Le numéro de version de l'APK (APP_BUILD) est écrit automatiquement par le workflow GitHub.
*/
(function(){
  "use strict";
  var B = {code:0, name:"dev"};
  try{ if(typeof APP_BUILD !== "undefined" && APP_BUILD) B = APP_BUILD; }catch(e){}
  var CLE_SKIP = "knall-maj-skip";
  var etat = {dernier:null, verifie:0, erreur:null, modal:null};

  function $$(id){ return document.getElementById(id); }
  function toast(msg){
    var t = document.createElement("div"); t.className = "mj-toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 2800);
  }

  /* ---------- Demander la dernière version publiée ---------- */
  async function recuperer(){
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var t = setTimeout(function(){ try{ if(ctrl) ctrl.abort(); }catch(e){} }, 9000);
    try{
      var r = await fetch(PROXY_URL.replace(/\/$/, "") + "/update", {
        headers: { "x-knall-token": APP_TOKEN }, cache: "no-store", signal: ctrl ? ctrl.signal : undefined
      });
      if(!r.ok) throw new Error("HTTP " + r.status);
      var d = await r.json();
      etat.dernier = (d && d.build) ? d : null;
      etat.erreur = null; etat.verifie = Date.now();
    }catch(e){
      etat.erreur = (e && e.message) ? e.message : "erreur";
    }
    clearTimeout(t);
    return etat.dernier;
  }
  function nouvelle(){ var d = etat.dernier; return !!(d && B.code > 0 && d.build > B.code); }

  function ouvrirLien(url){
    if(typeof url !== "string" || !/^https:\/\//i.test(url)){ toast("Lien de mise à jour invalide."); return; }
    try{
      var L = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppLauncher;
      if(L && L.openUrl){ L.openUrl({ url: url }); return; }
    }catch(e){}
    try{ window.open(url, "_system"); }catch(e){ location.href = url; }
  }

  /* ---------- Fenêtre de mise à jour ---------- */
  function sauter(d){
    try{
      var s = (localStorage.getItem(CLE_SKIP) || "").split(":");
      return String(s[0]) === String(d.build) && (Date.now() - Number(s[1] || 0)) < 24 * 3600 * 1000;
    }catch(e){ return false; }
  }
  function fermerModal(){ if(etat.modal){ etat.modal.remove(); etat.modal = null; } }
  function montrerModal(d){
    if(etat.modal) return;
    var obl = !!d.obligatoire;
    var ov = document.createElement("div"); ov.className = "mj-ov";
    var c = document.createElement("div"); c.className = "mj-card"; ov.appendChild(c);
    var t = document.createElement("div"); t.className = "mj-t"; t.textContent = obl ? "Mise à jour obligatoire" : "Mise à jour disponible"; c.appendChild(t);
    var v = document.createElement("div"); v.className = "mj-v";
    v.textContent = "Nouvelle version " + (d.nom || ("build " + d.build)) + (B.name ? "  ·  installée : " + B.name : ""); c.appendChild(v);
    if(d.message){ var m = document.createElement("div"); m.className = "mj-m"; m.textContent = d.message; c.appendChild(m); }
    if(obl){ var n = document.createElement("div"); n.className = "mj-n"; n.textContent = "Tu dois mettre à jour pour continuer à utiliser Knall."; c.appendChild(n); }
    var b = document.createElement("button"); b.type = "button"; b.className = "mj-b"; b.textContent = "Mettre à jour";
    b.onclick = function(){ ouvrirLien(d.url); };
    c.appendChild(b);
    if(!obl){
      var l = document.createElement("button"); l.type = "button"; l.className = "mj-b2"; l.textContent = "Plus tard";
      l.onclick = function(){ try{ localStorage.setItem(CLE_SKIP, d.build + ":" + Date.now()); }catch(e){} fermerModal(); };
      c.appendChild(l);
    }
    document.body.appendChild(ov); etat.modal = ov;
  }

  async function verifierAuto(){
    await recuperer(); majReglages();
    if(nouvelle()){
      var d = etat.dernier;
      if(d.obligatoire || !sauter(d)) montrerModal(d);
    } else {
      fermerModal();            // la mise à jour a été retirée ou l'app est à jour
    }
  }

  /* ---------- Réglages > Mise à jour ---------- */
  function majReglages(){
    var v = $$("mjVer"); if(!v) return;
    var d = etat.dernier, st = $$("mjSt"), bt = $$("mjBtnT"), lien = $$("mjLien"), pk = $$("mjPkg");
    v.textContent = B.code > 0 ? ("Version " + B.name + " (build " + B.code + ")") : "Version de développement";
    if(nouvelle()){
      bt.textContent = "Mettre à jour";
      st.textContent = "Nouvelle version " + (d.nom || d.build) + (d.obligatoire ? " (obligatoire)" : "") + (d.message ? " · " + d.message : "");
    } else {
      bt.textContent = "Rechercher une mise à jour";
      if(etat.erreur) st.textContent = "Impossible de vérifier (" + etat.erreur + ")";
      else if(B.code === 0 && d) st.textContent = "Version de développement. Dernière version publiée : " + (d.nom || d.build);
      else if(d) st.textContent = "Tu as la dernière version.";
      else st.textContent = etat.verifie ? "Aucune mise à jour publiée." : "Pas encore vérifié.";
    }
    lien.textContent = d && d.url ? ("Lien : " + d.url) : "Lien : aucun lien publié";
    pk.textContent = "Package : " + ((d && d.package) ? d.package : "com.wilertech.knall");
  }
  async function action(){
    if(nouvelle()){ ouvrirLien(etat.dernier.url); return; }
    var st = $$("mjSt"); if(st) st.textContent = "Vérification…";
    await recuperer(); majReglages();
    if(nouvelle()) toast("Nouvelle version " + (etat.dernier.nom || etat.dernier.build) + " disponible.");
    else if(!etat.erreur) toast("Tu as la dernière version.");
  }
  function injecter(){
    if($$("mjCard")) return;
    var ancre = $$("signalBtn") ? $$("signalBtn").parentNode : null;
    var parent = ancre ? ancre.parentNode : $$("modeBar");
    if(!parent) return;
    var titre = document.createElement("div"); titre.className = "set-title"; titre.textContent = "Mise à jour";
    var carte = document.createElement("div"); carte.className = "set-card"; carte.id = "mjCard";
    carte.innerHTML =
      '<div class="row info"><span class="ri"><svg class="ic" viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg></span>' +
      '<span class="rt"><b>Version installée</b><small id="mjVer"></small></span></div>' +
      '<button class="row" id="mjBtn"><span class="ri"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg></span>' +
      '<span class="rt"><b id="mjBtnT">Rechercher une mise à jour</b><small id="mjSt"></small></span></button>' +
      '<div class="row info"><span class="ri"><svg class="ic" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg></span>' +
      '<span class="rt"><b>Téléchargement (GitHub)</b><small id="mjLien" style="word-break:break-all;user-select:text;-webkit-user-select:text"></small><small id="mjPkg" style="user-select:text;-webkit-user-select:text"></small></span></div>';
    var suite = ancre ? ancre.nextSibling : null;
    parent.insertBefore(titre, suite);
    parent.insertBefore(carte, titre.nextSibling);
    $$("mjBtn").onclick = action;
    majReglages();
  }

  /* ---------- Style ---------- */
  var css = document.createElement("style");
  css.textContent =
    ".mj-ov{position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px}" +
    ".mj-card{background:var(--card,#16203a);color:var(--text,#fff);border:1px solid var(--border,#2a3558);border-radius:18px;padding:22px 20px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)}" +
    ".mj-t{font-size:19px;font-weight:800;margin-bottom:6px}.mj-v{font-size:13px;opacity:.75;margin-bottom:12px}" +
    ".mj-m{font-size:15px;line-height:1.5;white-space:pre-wrap;margin:10px 0 14px;word-break:break-word}" +
    ".mj-n{font-size:13px;color:#ffb4a8;margin-bottom:12px}" +
    ".mj-b{display:block;width:100%;border:0;border-radius:12px;padding:13px;font-size:16px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--accent1,#3fa9f5),var(--accent2,#7b5cff))}" +
    ".mj-b2{display:block;width:100%;margin-top:10px;border:1px solid var(--border,#2a3558);border-radius:12px;padding:12px;font-size:15px;background:transparent;color:inherit}" +
    ".mj-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#000c;color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;z-index:100060;max-width:80%;text-align:center}";
  document.head.appendChild(css);

  /* ---------- Démarrage ---------- */
  function init(){
    injecter();
    setTimeout(verifierAuto, 2500);
    document.addEventListener("visibilitychange", function(){
      if(!document.hidden && Date.now() - etat.verifie > 30 * 60 * 1000) verifierAuto();
    });
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.__maj = {recuperer:recuperer, nouvelle:nouvelle, etat:etat, montrerModal:montrerModal, fermerModal:fermerModal, verifierAuto:verifierAuto, ouvrirLien:ouvrirLien, sauter:sauter, majReglages:majReglages, B:B};
})();
