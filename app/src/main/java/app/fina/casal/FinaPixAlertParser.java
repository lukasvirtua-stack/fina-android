package app.fina.casal;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Map;
import java.util.HashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Interpreta apenas notificações dos aplicativos bancários oficiais conhecidos.
 * Um Signal NUNCA representa saldo, transação POSTED ou movimentação confirmada.
 * Não armazena nomes, descrições, contatos, extratos ou textos originais.
 */
public final class FinaPixAlertParser {
    private static final Map<String,String> BANKS = new HashMap<>();
    private static final Pattern AMOUNT = Pattern.compile("r\\$\\s*([0-9][0-9.]*,[0-9]{2})");
    private static final Pattern PIX = Pattern.compile("\\bpix\\b");
    private static final Pattern RECEIVED = Pattern.compile(
        "(?:\\bpix\\b.{0,90}\\b(?:recebido|recebida|recebemos|creditado)\\b"
        + "|\\b(?:recebeu|recebemos|recebido|creditado)\\b.{0,90}\\bpix\\b)");
    private static final Pattern NOT_RECEIVED = Pattern.compile(
        "\\bpix\\b.{0,60}\\b(?:enviado|realizado|efetuado|pago|agendado|devolvido|estornado|cancelado|saiu)\\b");
    static {
        BANKS.put("com.santander.app", "Santander");
        BANKS.put("com.nu.production", "Nubank");
        BANKS.put("com.itau", "Itaú");
        BANKS.put("com.bradesco", "Bradesco");
    }

    private FinaPixAlertParser() { }

    public static final class Signal {
        public final String bank;
        public final String amount;
        Signal(String bank, String amount) {
            this.bank = bank;
            this.amount = amount;
        }
    }

    public static Signal detect(String packageId, String title, String body) {
        String bank = BANKS.get(packageId);
        if (bank == null) return null;
        String normalized = Normalizer.normalize(
            String.valueOf(title == null ? "" : title) + " " + String.valueOf(body == null ? "" : body),
            Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
        if (normalized.length() > 750) normalized = normalized.substring(0, 750);
        if (!PIX.matcher(normalized).find() || NOT_RECEIVED.matcher(normalized).find()
            || !RECEIVED.matcher(normalized).find()) return null;

        // O valor apenas será exibido como pista; jamais entra no cálculo da FINA.
        Matcher matcher = AMOUNT.matcher(normalized);
        String amount = matcher.find() ? "R$ " + matcher.group(1) : "";
        return new Signal(bank, amount);
    }
}
