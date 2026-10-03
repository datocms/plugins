# Auditoria de escala — Automatic Environment Backups

Data: 2026-10-02. Escopo: somente este plugin; nenhuma chamada real ao CMA ou ao serviço de backup, nenhuma criação/exclusão de ambiente, deploy, commit ou alteração de dependências.

## Diagnóstico inicial

O plugin configura e acompanha backups. Os registros, assets, modelos, locales, blocos e referências são copiados pelo fork nativo do DatoCMS, executado no serviço externo. Não há paginação de records/assets, processamento de conteúdo ou bulk ilimitado no navegador. A memória do plugin depende da lista de metadata dos ambientes e de quatro cadências, não do número de entidades do projeto.

Os riscos encontrados no código inicial foram:

- O timeout HTTP terminava ao receber os headers, deixando a leitura do corpo sem prazo.
- Qualquer HTTP 409 era reenviado como se significasse um clone em andamento. No handler público atual ele significa `CADENCE_NOT_ENABLED`.
- Timeout/erro do pedido de backup não permitia acompanhar automaticamente uma clonagem longa, nem distinguir uma operação iniciada de uma falha anterior ao envio.
- O status público informa `meta.created_at` mesmo quando o ambiente ainda está `creating`. Data de criação não comprova que o backup está pronto.
- A interface inferia o ID do ambiente pela data e tratava uma lista vazia como desconhecida, podendo apresentar vínculos e checklist incorretos.
- Falhas parciais eram apagadas pela atualização posterior do overview.
- O merge de parâmetros caía em um snapshot antigo após erro de leitura autoritativa, e um save malsucedido contaminava a base do próximo save.
- Saves/testes concorrentes e respostas antigas podiam agir com configurações diferentes das efetivamente persistidas.

## Correções implementadas

- `src/utils/lambdaHttp.ts`: deadline total para fetch, corpo e backoff; consumo incremental limitado a 1 MiB; cancelamento; até três tentativas para health/status; respeito a `Retry-After`.
- `src/utils/cmaRead.ts`: somente GET, deadline total de 10 segundos, até três tentativas, cancelamento e respeito a `x-ratelimit-reset`/`Retry-After`. Desativa o retry ilimitado do SDK nesta camada de leitura.
- `src/utils/backupExecution.ts`: execução sequencial, preflight das cadências, confirmação de ambiente `ready`, acompanhamento automático por polling após resultado incerto, sem reenviar a mutação. O hook usa acompanhamento contínuo enquanto a tela está aberta; não há pausa, retomada ou checkpoint obrigatório.
- `src/utils/backupEnvironments.ts`: confirmação do ID pela metadata, reconciliação de snapshots entre status e CMA, exclusão de primary/creating/destroying da confirmação e uso somente do progresso fornecido pelo CMA.
- `src/config/useBackupsConfig.ts`: bloqueios imediatos contra ações concorrentes, cancelamento de leituras obsoletas, sequência save+act com os parâmetros efetivamente salvos e preservação de falhas parciais.
- `src/utils/pluginParameterMerging.ts`: fila de persistência testável, falha de leitura impede gravação, acumulador avança somente após sucesso, invalidação de conexão usa o segredo e a URL autoritativos e health checks antigos não sobrescrevem credenciais novas.
- `src/utils/buildBackupOverviewRows.ts` e componentes existentes: só mostram ambiente confirmado como pronto; a UI atual foi mantida, com progresso transitório e desabilitação dos controles durante operações.
- `src/utils/backupSchedule.ts` e `automaticBackupsScheduleState.ts`: validação de timezone, datas, timestamps e cadências, preservando os campos legados e parâmetros desconhecidos.

## Limites e pendências externas

O código público do serviço revisado em `master` apaga os backups anteriores antes de fazer o fork. Se a clonagem falhar, pode não restar um backup dessa cadência. Ele também não oferece uma chave de idempotência, identificador de job, exclusão mútua distribuída ou cancelamento remoto. A fila do plugin não resolve corridas entre cron, diferentes navegadores e diferentes instâncias do serviço. Essas correções exigem o repositório externo e estão fora do escopo autorizado.

O serviço atende `backup-now` de forma síncrona e usa o fork padrão, que aguarda o job. O polling do plugin acompanha um clone que continua no DatoCMS após perder a resposta; não mantém vivo um processo serverless que o provedor encerrou, não realiza rotação e não corrige uma falha de persistência no serviço. Abortar a requisição no navegador não cancela a clonagem já iniciada no servidor.

A gravação de parâmetros permanece uma leitura seguida de escrita: não há CAS/transação no contrato usado pelo plugin. O serviço pode alterar estado entre essas duas operações. Sem token de leitura, saves de configuração conservam a base de gravações bem-sucedidas; iniciar backups exige acesso de leitura aos ambientes para confirmar integridade.

A confirmação por metadata prova que o DatoCMS declarou aquele ambiente `ready`; não constitui comparação integral de 200.000 records/10.000 assets, hash de conteúdo ou prova de desempenho. A implantação real, quotas do projeto, custos de ambientes extras, limites de duração do provedor e versão implantada não foram acessados. Nenhum teste simulado comprova throughput, duração ou recuperação de produção.

## Fontes oficiais e contrato revisado

- [Fork de ambiente](https://www.datocms.com/docs/content-management-api/resources/environment/fork): `immediate_return`, operação assíncrona e `fast` bloqueando escrita no ambiente de origem. O plugin não habilita `fast`.
- [Metadata de ambiente](https://www.datocms.com/docs/content-management-api/resources/environment): estados `creating`, `ready`, `destroying` e `fork_completion_percentage`.
- [Lista completa de ambientes](https://www.datocms.com/docs/content-management-api/resources/environment/instances): retorna todos os ambientes; não há paginação nesse endpoint.
- [Limites CMA](https://www.datocms.com/docs/content-management-api/technical-limits): 60 requisições a cada 3 segundos, parâmetros globais de plugin limitados a 10 KB e retry automático dos clientes oficiais.
- [Serviço público de backup](https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function/blob/master/services/backupService.ts): `executeScopedBackup`, `executeCadencesAndPersistState` e `getBackupStatus`.
- [Handler backup-now](https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function/blob/master/api/datocms/backup-now.ts): 409 `CADENCE_NOT_ENABLED` e contrato de conclusão.
- [Fetch Standard](https://fetch.spec.whatwg.org/#fetch-method) e [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after): aborto de fetch/corpo, semântica de retry e header de espera.

## Validação

Os testes usam fetch/CMA simulados, streams sintéticos e relógio falso. As fixtures de escala representam 200.000 records e 10.000 assets por contagens/metadata, sem materializar entidades reais. Cobrem quatro cadências, operações longas, falhas parciais, 409, rate limiting, timeout de corpo, cancelamento, snapshots inconsistentes, IDs ambíguos, datas/locales/timezones e persistência concorrente.

Este plugin não define `npm run lint`. O Biome 2.4.10 já instalado em um plugin irmão foi usado com o `biome.json` comum, sem alterar arquivos fora desta pasta. O `run-checks.js` da raiz não inclui este plugin e instala dependências/builds de outros plugins; não foi executado por estar fora do escopo.

Resultados finais:

- `npm run test`: TypeScript (`tsc --noEmit`) e 254 testes em 17 arquivos passaram.
- `npm run build`: passou; 518 módulos, JavaScript de 373,19 kB (106,65 kB gzip).
- Biome nos 28 arquivos TypeScript/TSX alterados: passou sem erros ou avisos.
- `git diff --check -- .`: passou.
- Biome em todo `src`: encontrou sete pendências preexistentes em arquivos não alterados — formatação em `StatusBox.tsx`, `StepSection.tsx`, `StepTimeline.tsx`, `generateAuthSecret.test.ts` e `pluginParams.test.ts`; organização de imports em `StepTimeline.tsx` e `ConfigScreen.tsx`. Elas foram preservadas para evitar alterações alheias à auditoria.

A alteração preexistente de `package-lock.json` foi preservada; nenhuma dependência foi adicionada ou atualizada nesta entrega. O build gerou somente a saída ignorada do plugin. Não foi feita verificação visual no dashboard nem execução em ambiente real.

## Integração com master — 2026-10-03

A integração preserva a versão 0.7.2, CMA 6, SDK 2.3, o assistente Secret/Deploy/Connect/Schedule, as permissões existentes, o estado `dueNow` e o resultado booleano de `saveSchedule`. A URL continua sendo salva antes do teste de conexão; ambos os passos usam a fila autoritativa. O resumo atual do master foi preservado e mostra o progresso das operações, sem transportar o checklist anterior. Nenhum lockfile ou dependência deste plugin foi alterado.

Validação no estado integrado: TypeScript e 250 testes em 17 arquivos passaram; o build passou com 535 módulos e JavaScript de 359,22 kB (106,15 kB gzip). Essas verificações continuam usando fixtures sintéticas e não executam backups reais.

A formatação dos 27 arquivos TypeScript/TSX alterados passou. O check opcional do Biome encontrou somente a complexidade de `StepConnect.tsx`: 28 tanto no master quanto no estado integrado, acima do limite comum de 15. Essa pendência preexistente foi preservada; o plugin continua sem script local de lint.
