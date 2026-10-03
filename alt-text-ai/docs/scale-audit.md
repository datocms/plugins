# Auditoria de escala do Alt Text AI

## Escopo e diagnóstico

A auditoria cobre os dropdowns de assets, arquivo e galeria, todos os locales da seleção de assets, os quatro provedores e a gravação de metadados. Foram preservadas as alterações já existentes de configuração e interface. Não foram modificados arquivos compartilhados, dependências ou outros plugins; não houve chamadas pagas, mutações reais no DatoCMS, commits ou publicação.

O fluxo anterior carregava a seleção inteira, expandia `assets × locales`, acumulava todas as respostas de IA e só depois gravava os metadados. Uma execução de 10.000 assets poderia gastar memória e perder resultados de várias horas antes da primeira gravação. Outros riscos eram cliques duplicados, retry de uma gravação com resultado desconhecido, downloads de imagem sem limite e escrita de galerias a partir de um snapshot antigo do formulário.

## Implementação

- `src/services/altTextGeneration.ts`: seleção deduplicada; carregamento de até 50 assets por lote; três workers; locales processados por asset sem materializar o produto cartesiano; gravação a cada dez alts gerados por asset; progresso agregado durante leitura, geração e gravação. Assets não imagem são ignorados. Os primeiros resultados são salvos antes de carregar o próximo lote. A execução prossegue automaticamente, sem checkpoints ou retomada manual.
- O modo de regeneração continua pedindo a confirmação existente. Tanto regeneração quanto geração de ausentes preservam alterações de alt feitas após o snapshot inicial. A imagem é relida antes da gravação: se sua URL mudou, as descrições antigas não são aplicadas. Patches enviam somente os locales gerados e preservam títulos, custom data, ponto focal, poster time e outros locales.
- As galerias aplicam lotes de até 50 entradas, preservando metadados atuais por ocorrência. Um cache por execução guarda somente respostas compactas para não cobrar novamente por ocorrências repetidas da mesma imagem/locale. Erros fatais encerram o agendamento de novas chamadas; resultados de chamadas já ativas ainda são aplicados quando seguros. Diagnósticos mantêm oito amostras, com comprimento limitado e contagem total.
- `src/services/fieldContext.ts` e `src/index.tsx`: acompanham snapshots recentes apenas durante execuções, impedem reentrância, detectam remoção/reordenação de blocos ancestrais e protegem alterações observadas do editor. Drafts sem identidade pública de formulário são tratados conservadoramente.
- `src/services/cmaTransport.ts`: transporte compartilhado entre as execuções do iframe, até três requests ativos, espaçamento de 100 ms, cooldown compartilhado para 429, três tentativas e deadline de 120 segundos por operação. Cada tentativa aborta a rede e a leitura do corpo após 30 segundos. O retry automático do SDK foi desligado. GETs podem repetir falhas transitórias; PUTs repetem somente rejeições 429 confirmadas. Uma gravação sem confirmação é reconciliada por leitura e nunca reenviada às cegas.
- `src/providers/http.ts`, `errors.ts`, `shared.ts`, `modelDiscovery.ts` e `GeminiProvider.ts`: retry limitado com jitter e respeito a Retry-After; cooldown de provedor compartilhado; POSTs pagos não repetem network/timeout/5xx ambíguos. Erros de credenciais, quota, modelo/configuração e rate limit esgotado encerram novos agendamentos. Cada request de IA permanece limitada a 60 segundos; o watchdog externo de 365 segundos acomoda os budgets de leitura CMA, download e retry sem interromper um Retry-After válido. Downloads e respostas são lidos com limite (JSON até 8 MiB); imagens inline têm limite de 12 MiB e o corpo Gemini é limitado a 20 MB. Descoberta de modelos percorre páginas iterativamente e detecta ciclos; atingir o limite de segurança de 50 páginas falha explicitamente.

## Contratos verificados

A [CMA documenta 60 requests a cada três segundos e X-RateLimit-Reset em segundos](https://www.datocms.com/docs/content-management-api/technical-limits). O espaçamento do plugin deixa margem para o dashboard; outros clientes e outras janelas ainda compartilham os limites do projeto.

A [atualização de upload aceita patches parciais de metadados](https://www.datocms.com/docs/content-management-api/resources/upload/update). O merge interno por locale também foi confirmado no backend local, em `api/app/models/upload/default_field_metadata/field_keyed.rb` e seus testes `api/spec/commands/api/cma/upload/update_manual_attrs_spec.rb`. A integração com o cliente CMA 6 mantém o contrato field-keyed normalizado pelo SDK e envia somente o patch `alt` dos locales gerados.

Foram consultadas também as documentações oficiais de [rate limits OpenAI](https://developers.openai.com/api/docs/guides/rate-limits), [rate limits Anthropic](https://platform.claude.com/docs/en/api/rate-limits), [imagens Gemini](https://ai.google.dev/gemini-api/docs/image-understanding), [modelos Gemini](https://ai.google.dev/api/models) e [modelos Anthropic](https://platform.claude.com/docs/en/api/models/list). A página de documentação AltText.ai não estava legível pelo acesso usado; comportamento de cobrança/idempotência não foi comprovado.

O hook do SDK entrega um array de uploads explicitamente selecionados; não fornece filtro ou cursor para selecionar todo o projeto. No host local, selecionar todos usa a página carregada. A [paginação da CMA](https://www.datocms.com/docs/content-management-api/pagination) seria necessária para uma listagem de coleção, mas não há essa listagem neste plugin. Não são carregados records, modelos ou referências do projeto para gerar alt text, independentemente de haver 200.000 records.

## Validação

Os testes usam somente fetch/CMA/provedores mockados e fixtures sintéticas. Cobrem 10.000 assets com três e vinte locales, 10.000 entradas de galeria, descoberta de 10.000 modelos, limites de concorrência e buffering, gravação incremental, metadados field-keyed, preservação de locales, falhas parciais/fatais, retries e deadlines, abort de streams, reentrância e gravação com resposta perdida. Os testes de transporte incluem o cliente CMA real conectado apenas a fetch mockado.

Validação da rodada de auditoria, anterior à integração em master:

- `npm run test -- --maxWorkers=1 --no-file-parallelism --testTimeout=60000`: 173 testes passaram em 11 arquivos; 6,07 segundos na rodada final. O timeout maior pertence ao harness, sem mudar os deadlines do produto. As fixtures de escala usam watchdogs sintéticos sem histórico de chamadas; os testes de timeout usam relógio fake com deadlines reais assertados.
- `node_modules/.bin/tsc --noEmit`: aprovado. `npm run build` repetiu o typecheck e gerou o bundle Vite com sucesso.
- Biome 2.4.10, `lint src`: 29 arquivos verificados, sem erros ou avisos. Foi usado o binário oficial já presente no cache npm; nenhuma instalação ou alteração de dependência foi necessária.
- `git diff --check -- .`: aprovado.

Rodadas anteriores sob contenção do host tiveram timeouts do harness. A rodada final passou após reduzir os workers de teste e remover o custo de timers reais do happy path massivo, mantendo os testes específicos de deadlines. As inconsistências de tipos nas novas fixtures também foram corrigidas antes do build final.

O plugin não define script `lint`; foi aplicada a configuração Biome compartilhada. A skill `plugins/.agents/skills/verify/SKILL.md` exige build e testes disponíveis. O agregado `plugins/run-checks.js` não inclui `alt-text-ai` e executa instalação e checks em outros plugins, portanto não é aplicável a este escopo.

## Limites residuais

- Fixtures comprovam invariantes e comportamento; não comprovam throughput, memória total do navegador ou desempenho em produção. 10.000 × vinte locales significa até 200.000 gerações pagas numa execução real, com duração dependente do provedor, latência e quotas.
- Não existe compare-and-swap documentado para metadados de upload. A releitura reduz a janela de concorrência, mas outra escrita no mesmo locale pode ocorrer entre leitura e update. Campos também dependem do último snapshot observado: o SDK não fornece escrita condicional atômica nem identidade pública de cada formulário. Locks locais não abrangem outras janelas ou usuários.
- A seleção e sua renderização pertencem ao dashboard. O plugin processa integralmente os IDs recebidos, mas não pode garantir que o seletor nativo entregue todos os 10.000 assets do projeto.
- O formulário/array selecionado e o cache compacto de galeria continuam proporcionais à seleção. As respostas de uploads adicionais ficam limitadas ao lote; buffers de imagem ficam limitados aos workers ativos.
- Galerias sintéticas de 10.000 entradas não autorizam ultrapassar o limite real de tamanho de record da CMA. O plugin não reescreve records, blocos ou referências por CMA e não altera publicação.
- Fechar o navegador encerra o processo em memória. Assets já gravados ficam preservados; alterações de campos continuam no formulário e seguem o fluxo normal de salvar o record. Não foi adicionado workflow de pausa/retomada.
- Não foram verificadas credenciais/CORS, comportamento de quota real, permissões granulares nem tempos em produção. Uma resposta perdida de IA pode ter sido cobrada; por segurança não é repetida automaticamente. Uma gravação cujo estado não possa ser relido é reportada como resultado não verificável.
