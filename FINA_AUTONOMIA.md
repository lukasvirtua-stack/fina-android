# FINA — Operação autônoma, diagnóstico e recuperação

Atualizado em 13/11/2026. Aplicativo financeiro do casal: Lucas e Naara.

## Fonte da verdade

- **Banco de dados**: Supabase project `gdjswengldvvgjrpdtst`.
- **Extratos**: `fina_bank_transactions` só recebe registros provenientes da Pluggy; o app nunca cria TEDs por expectativa.
- **Contas**: `fina_bank_accounts`; saldos de cartão/limites de crédito jamais integram o saldo bancário.
- **Pluggy**: `fina_bank_items.last_sync_at` = última consulta **pela FINA**, não última atualização real do banco.
- **Pluggy**: `provider_last_updated_at` = `GET /items/{id}.lastUpdatedAt`, `provider_execution_status` = execução real, `provider_next_auto_sync_at` = próxima atualização prevista.
- **Importação FINA**: `last_import_success_at`, `last_import_count`, `last_import_error` refletem resultado do extrato importado. Uma execução HTTP 200 pode conter falhas parciais em outros itens.
- **Faturas**: `fina_card_bills` e contas manuais reconciliadas após débito real.
- **Transferências**: entre Lucas e Naara contam individualmente; no coração não somam Entrou/Saiu. Contas da mesma pessoa não somam em nenhuma visão.

## Serviços automáticos Supabase

- `fina-safe-auto-sync-5min`: consulta o acervo da Pluggy, importa as contas, movimentações e faturas, detecta falhas individualmente.
- `fina-reconcile-manual-bills-1min`: associa pagamento à transação bancária real.
- `fina-refresh-own-transfers-1min` e `fina-refresh-couple-transfers-15min`: consolidam pares de transferências.
- `fina-refresh-financings-15min`: atualiza compromissos bancários.
- `fina-monitor-bank-sync-15min`: sinaliza conexão desatualizada, importação falha, erro do banco ou autorização próxima do vencimento.
- `fina-push-dispatch-15min`: envia avisos de transações e falhas, com deduplicação por dispositivo.
- `fina-clean-resolved-sync-alerts-15min`: remove registros de entrega de alertas já resolvidos, permitindo futuros alertas recorrentes.

**Regra importante:** nunca criar uma rotina de `PATCH /items/{id}` a cada 5 minutos. A Pluggy limita atualizações forçadas e pode exigir uma ação humana (MFA / reconexão). A FINA respeita a sincronização automática oferecida pela Pluggy e consulta a API a cada 5 minutos para importar assim que a Pluggy tiver atualizado.

## Offline e privacidade

- SW `web/service-worker.js` armazena **somente arquivos estáticos públicos**. Requests Supabase/Pluggy e autenticação jamais entram no SW cache.
- `web/offline-vault.js` armazena o último snapshot bancário completo permitido (até 10 mil transações por usuário), cifrado por AES-GCM com chave não exportável, armazenada no IndexedDB do dispositivo.
- O snapshot é segregado por `userId` Google e ownerKey. A visualização do parceiro depende de consentimento; na ausência de rede, somente o histórico próprio é liberado.
- Em logout ou revogação de compartilhamento, apagar o cofre e o snapshot rápido. Em trocas de usuário, nunca reaproveitar dados do login anterior.
- **Limite de segurança:** autenticação antiga no dispositivo + acesso físico desbloqueado ou JavaScript comprometido ainda podem expor dados. IndexedDB cifrado não substitui bloqueio do aparelho. Offline só funciona após ao menos uma sincronização autenticada.

## Implantação de código e testes

- GitHub: `lukasvirtua-stack/fina-android`; mudanças via PR. CI: `tests/finance-rules.test.mjs`, `tests/financial-invariants.test.mjs`, `tests/pwa-cache.test.mjs`, `tests/offline-vault.test.mjs`.
- Novo projeto Git-linked Vercel: `fina-git-auto` (`web/`, branch `main`), auto-deploy por push no GitHub.
- **Produção atual continua em** `fina-html-v14.vercel.app`, projeto Vercel separado não vinculado ao GitHub. Não substituir a origem do app sem antes autorizar URL de callback Google/Supabase, testar autenticação para os dois acessos e migrar a URL/instalação de forma segura.
- Funções Supabase versionadas em `supabase/functions/`. Aplicações de novas versões dessas Edge Functions requerem uma etapa de implantação controlada e testes. O mero push do GitHub não implanta automaticamente funções Supabase.
- Atualização do **aplicativo instalado** usa SW cache-first e revalidação em segundo plano.

## Quando um TED não aparece

1. Consultar no app, em Bancos, a **atualização real do banco** e a **última importação da FINA**, separadamente.
2. Conferir `fina_bank_items.provider_execution_status`, `provider_last_updated_at`, `provider_next_auto_sync_at`, `last_import_success_at` e `last_import_error`.
3. Se a Pluggy não publicou a transação, **não inserir por conta própria**. A FINA espera o próximo ciclo legítimo e mostra avisos de atraso/falha.
4. Se há transação na Pluggy mas não no Supabase, investigar erro de página, importação ou autorização via alertas; sem duplicar transações.
5. Uma conexão com `status='UPDATED'` **não garante movimentação nova**.

## Testes não substituem validação real

A suíte valida cálculos e cenários simulados, criptografia e reabertura offline. Ainda são necessários testes autenticados nos dois aparelhos, suspensão de internet, renovação de consentimento e confirmação de Push no Android. Regressões de infraestrutura devem ser monitoradas em `cron.job_run_details` e na tabela `fina_sync_alerts`.
