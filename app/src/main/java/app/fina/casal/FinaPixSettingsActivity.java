package app.fina.casal;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Configuração explícita POR APARELHO. Sem consentimento, o listener ignora tudo. */
public final class FinaPixSettingsActivity extends Activity {
    private static final int BACKGROUND=Color.rgb(251,250,247);
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(BACKGROUND);
        LinearLayout root=new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(22),dp(30),dp(22),dp(24));

        TextView title=new TextView(this);
        title.setText("FINA · Avisos de Pix");
        title.setTextSize(23);title.setTextColor(Color.rgb(97,68,29));
        root.addView(title,new LinearLayout.LayoutParams(-1,dp(62)));

        TextView guide=new TextView(this);
        guide.setText("Opcional: a FINA pode reconhecer notificações de Pix recebido dos apps oficiais Santander, Nubank, Itaú e Bradesco neste Android.\n\n"
            +"O aviso é PROVISÓRIO. Não modifica saldo, Entrou, Saiu nem faturas; somente o extrato confirmado pela Pluggy faz isso.\n\n"
            +"As notificações são analisadas neste aparelho. A FINA não envia textos, nomes ou valores dessas notificações para a nuvem. "
            +"Sem o app do banco notificando, não há aviso antecipado.\n");
        guide.setTextSize(15);guide.setTextColor(Color.DKGRAY);
        root.addView(guide,new LinearLayout.LayoutParams(-1,-2));

        CheckBox enabled=new CheckBox(this);
        enabled.setText("Autorizo avisos provisórios de Pix neste aparelho");
        enabled.setTextSize(15);
        enabled.setChecked(getSharedPreferences(FinaPixNotificationListener.PREFS, Context.MODE_PRIVATE)
            .getBoolean(FinaPixNotificationListener.ENABLED,false));
        enabled.setOnCheckedChangeListener((v,isChecked)->{
            getSharedPreferences(FinaPixNotificationListener.PREFS,Context.MODE_PRIVATE)
                .edit().putBoolean(FinaPixNotificationListener.ENABLED,isChecked).apply();
            if(isChecked&&Build.VERSION.SDK_INT>=33
                &&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},101);
            }
        });
        root.addView(enabled,new LinearLayout.LayoutParams(-1,dp(76)));

        Button access=new Button(this);
        access.setText("CONFIGURAR ACESSO ÀS NOTIFICAÇÕES");
        access.setOnClickListener(v->{
            try{startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));}
            catch(Exception e){
                new android.app.AlertDialog.Builder(this)
                    .setMessage("Abra Configurações do Android > Notificações > Acesso a notificações e autorize a FINA.")
                    .setPositiveButton("OK",null).show();
            }
        });
        root.addView(access,new LinearLayout.LayoutParams(-1,dp(60)));

        TextView instructions=new TextView(this);
        instructions.setText("São necessárias duas permissões: autorizar a leitura das notificações nas configurações do Android e permitir que a FINA mostre notificações. Você pode revogar o acesso a qualquer momento.\n");
        instructions.setTextColor(Color.DKGRAY);instructions.setTextSize(12);
        root.addView(instructions,new LinearLayout.LayoutParams(-1,-2));

        Button back=new Button(this);
        back.setText("VOLTAR À FINA");
        back.setOnClickListener(v->{
            startActivity(new Intent(this,FinaLauncherActivity.class));
            finish();
        });
        root.addView(back,new LinearLayout.LayoutParams(-1,dp(58)));
        setContentView(root);
    }
    private int dp(int px){return Math.round(px*getResources().getDisplayMetrics().density);}
}
