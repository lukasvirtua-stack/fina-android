package app.fina.casal;

/** Roda com java puro, sem emulador e sem credenciais reais. */
public final class FinaPixParserTest {
    private static void yes(boolean value,String why){
        if(!value)throw new AssertionError(why);
    }
    public static void main(String[] args){
        FinaPixAlertParser.Signal a=FinaPixAlertParser.detect(
            "com.santander.app","Pix recebido","Você recebeu um Pix de R$ 1.234,56");
        yes(a!=null&&a.bank.equals("Santander")&&a.amount.equals("R$ 1.234,56"),
            "Santander: Pix recebido não reconhecido");
        FinaPixAlertParser.Signal b=FinaPixAlertParser.detect(
            "com.nu.production","Você recebeu","um Pix de R$ 12,10");
        yes(b!=null&&b.bank.equals("Nubank"),"Nubank recebido não reconhecido");
        yes(FinaPixAlertParser.detect("com.itau","Pix recebido","Crédito confirmado")!=null,
            "Itaú recebido não reconhecido");
        yes(FinaPixAlertParser.detect("com.bradesco","Pix recebido","R$ 0,99")!=null,
            "Bradesco recebido não reconhecido");
        yes(FinaPixAlertParser.detect("com.bradesco","Pix enviado","Sua transferência de R$ 100,00 foi realizada")==null,
            "Pix enviado classificado como recebido");
        yes(FinaPixAlertParser.detect("com.santander.app","Pix agendado","R$ 230,00")==null,
            "Pix agendado classificado como recebido");
        yes(FinaPixAlertParser.detect("com.santander.app","Pix estornado","Valor recebido de volta")==null,
            "Estorno classificado como recebimento");
        yes(FinaPixAlertParser.detect("com.app.malicioso","Pix recebido","R$ 5.000,00")==null,
            "Pacote não oficial aceito");
        yes(FinaPixAlertParser.detect("com.nu.production","Cartão aprovado","Compra de R$ 45,00")==null,
            "Compra no cartão classificada como Pix");
        System.out.println("FINA PIX PARSER TESTS PASSED");
    }
}
