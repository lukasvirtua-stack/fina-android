package app.fina.casal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.util.Log;

import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;

/**
 * Launcher resiliente: não exige uma Trusted Web Activity previamente verificada.
 * Mantém um botão de recuperação caso o navegador não consiga abrir.
 * O Google OAuth ocorre no navegador do dispositivo, nunca em WebView embutido.
 */
public final class FinaLauncherActivity extends Activity {
    private static final String TAG = "FinaLauncher";
    private static final Uri FINA_URL = Uri.parse("https://fina-html-v14.vercel.app/");
    private static final int BACKGROUND = Color.rgb(251, 250, 247);
    private static final int GOLD = Color.rgb(194, 154, 88);
    private TextView status;
    private boolean launchedOnce = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        buildRecoveryScreen();
        // O próprio launcher permanece utilizável caso a guia/buscador falhe.
        if (state == null) getWindow().getDecorView().post(this::openFina);
    }

    private void buildRecoveryScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(30), dp(28), dp(30), dp(28));
        root.setBackgroundColor(BACKGROUND);

        TextView logo = new TextView(this);
        logo.setText("FINA");
        logo.setTextSize(38);
        logo.setTextColor(GOLD);
        logo.setGravity(Gravity.CENTER);
        root.addView(logo, new LinearLayout.LayoutParams(-1, dp(70)));

        TextView subtitle = new TextView(this);
        subtitle.setText("Finanças a Dois");
        subtitle.setTextSize(19);
        subtitle.setTextColor(Color.rgb(48, 45, 40));
        subtitle.setGravity(Gravity.CENTER);
        root.addView(subtitle, new LinearLayout.LayoutParams(-1, dp(55)));

        status = new TextView(this);
        status.setText("Abrindo sua FINA com segurança…");
        status.setTextSize(15);
        status.setGravity(Gravity.CENTER);
        status.setTextColor(Color.DKGRAY);
        status.setPadding(0, dp(22), 0, dp(22));
        root.addView(status, new LinearLayout.LayoutParams(-1, -2));

        Button open = new Button(this);
        open.setText("ABRIR FINA");
        open.setOnClickListener(v -> openFina());
        root.addView(open, new LinearLayout.LayoutParams(-1, dp(56)));

        TextView hint = new TextView(this);
        hint.setText("Se a FINA não abrir automaticamente, toque no botão acima. A conexão bancária continua protegida pelo seu login Google.");
        hint.setGravity(Gravity.CENTER);
        hint.setTextSize(13);
        hint.setTextColor(Color.GRAY);
        hint.setPadding(0, dp(15), 0, 0);
        root.addView(hint, new LinearLayout.LayoutParams(-1, -2));

        setContentView(root);
    }

    private int dp(float px) {
        return Math.round(px * getResources().getDisplayMetrics().density);
    }

    private void openFina() {
        status.setText("Abrindo FINA no navegador seguro…");
        try {
            launchCustomTab(true);
            launchedOnce = true;
            status.setText("FINA aberta. Para entrar novamente, toque em ABRIR FINA.");
            return;
        } catch (RuntimeException | LinkageError first) {
            Log.w(TAG, "Chrome Custom Tab indisponível: tentando navegador padrão", first);
        }
        try {
            launchCustomTab(false);
            launchedOnce = true;
            status.setText("FINA aberta. Para entrar novamente, toque em ABRIR FINA.");
            return;
        } catch (RuntimeException | LinkageError second) {
            Log.w(TAG, "Custom Tab indisponível: tentando navegador padrão", second);
        }
        try {
            Intent browser = new Intent(Intent.ACTION_VIEW, FINA_URL);
            browser.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(browser);
            launchedOnce = true;
            status.setText("FINA aberta no navegador.");
        } catch (ActivityNotFoundException | SecurityException error) {
            Log.e(TAG, "Nenhum navegador disponível para a FINA", error);
            status.setText("Não foi possível abrir a FINA. Verifique se Chrome está instalado e habilitado, depois toque em ABRIR FINA.");
        }
    }

    private void launchCustomTab(boolean useChrome) {
        CustomTabsIntent tabs = new CustomTabsIntent.Builder()
            .setShowTitle(false)
            .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
            .setDefaultColorSchemeParams(
                new CustomTabColorSchemeParams.Builder().setToolbarColor(BACKGROUND).build())
            .build();
        if (useChrome) tabs.intent.setPackage("com.android.chrome");
        tabs.launchUrl(this, FINA_URL);
    }
}
