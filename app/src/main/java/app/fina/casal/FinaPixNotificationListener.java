package app.fina.casal;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Funcionalidade LOCAL e opcional, desligada por padrão.
 * Não envia notificações bancárias, dados pessoais, valores ou credenciais para
 * o servidor. Nunca modifica Entrou, Saiu, saldo, previsões ou faturas da FINA.
 */
public final class FinaPixNotificationListener extends NotificationListenerService {
    static final String PREFS = "fina_pix_preview_settings";
    static final String ENABLED = "consent_enabled";
    private static final String CHANNEL = "fina_pix_provisional_v1";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(ENABLED, false)) return;
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;

        Bundle extras = n.extras;
        if (extras == null) return;
        CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence body = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (body == null) body = extras.getCharSequence(Notification.EXTRA_TEXT);
        FinaPixAlertParser.Signal signal = FinaPixAlertParser.detect(
            sbn.getPackageName(), title == null ? "" : title.toString(),
            body == null ? "" : body.toString());
        if (signal == null) return;

        // Chaves irreversíveis para evitar avisos repetidos. Jamais guardar o
        // texto original, o nome de quem enviou, nem quantias nos Preferences.
        String digest = sha256(sbn.getPackageName() + "|" + sbn.getKey() + "|"
            + String.valueOf(title) + "|" + String.valueOf(body));
        if (digest.isEmpty()) return;
        String seen = prefs.getString("recent_hashes", "");
        if (seen.contains(":" + digest + ":")) return;
        String next = seen + ":" + digest + ":";
        if (next.length() > 4600) next = next.substring(next.length() - 4500);
        prefs.edit().putString("recent_hashes", next).apply();

        NotificationManager manager = (NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, "FINA · Pix provisório", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(this, FinaLauncherActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String message = signal.bank + (signal.amount.isEmpty() ? "" : " · " + signal.amount);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_fina)
            .setContentTitle("Possível Pix recebido · não confirmado")
            .setContentText(message + " · Confira o extrato na FINA")
            .setStyle(new Notification.BigTextStyle().bigText(
                message + "\nAviso provisório do celular; saldo e Entrou só mudam após confirmação pela Pluggy."))
            .setContentIntent(tap).setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(Notification.CATEGORY_STATUS);
        manager.notify(digest.hashCode(), builder.build());
    }

    private static String sha256(String text) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256")
                .digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
            return hex.toString();
        } catch (Exception ignored) {
            return "";
        }
    }
}
