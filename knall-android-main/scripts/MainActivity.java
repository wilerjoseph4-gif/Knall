package com.wilertech.knall;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** vrai quand l'app est à l'écran (lue par le service d'écoute) */
    static volatile boolean visible = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakePlugin.class);
        super.onCreate(savedInstanceState);
        traiterIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        traiterIntent(intent);
    }

    @Override
    public void onStart() {
        super.onStart();
        visible = true;
    }

    @Override
    public void onStop() {
        super.onStop();
        visible = false;
        masquerSurVerrouillage();
    }

    /** Lancée par le mot-clé : on s'affiche par-dessus l'écran verrouillé (seulement dans ce cas). */
    private void traiterIntent(Intent i) {
        if (i == null || !i.getBooleanExtra("knall_wake", false)) return;
        i.removeExtra("knall_wake");
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        WakePlugin.pending = true;
        WakePlugin.pendingAt = System.currentTimeMillis();
        String mot = i.getStringExtra("knall_wake_word");
        if (mot != null) WakePlugin.pendingWord = mot;
        // si la page est déjà chargée, on la prévient ; sinon elle demandera « takePending » au démarrage
        try {
            Bridge br = getBridge();
            if (br != null && br.getWebView() != null) {
                final WebView w = br.getWebView();
                w.post(new Runnable() {
                    @Override
                    public void run() {
                        w.evaluateJavascript("try{window.__knallWake&&window.__knallWake()}catch(e){}", null);
                    }
                });
            }
        } catch (Exception e) { /* ignore */ }
    }

    private void masquerSurVerrouillage() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(false);
            setTurnScreenOn(false);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }
}
