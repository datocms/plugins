# Auditoria de escala — All Records Viewer

Escopo: navegar e operar seleções em projetos com 200.000 registros, muitos modelos e locales, conteúdo complexo e 10.000 assets usados nos previews. Nenhuma API de produção foi consultada e nenhuma entidade real foi criada ou alterada.

## Diagnóstico inicial

- A avaliação da seleção bloqueava operações acima de 200 registros; o executor tratava toda a seleção como uma única chamada bulk.
- “Show selection” resolvia e renderizava todos os registros selecionados, sem paginação.
- A seleção e os caches de previews acumulavam conteúdo completo ao navegar.
- Hidratação por IDs e campos lançava Promise.all sem limite de concorrência.
- Ordenação por modelo sondava cada modelo anterior à página, repetindo milhares de consultas.
- O SDK instalado permitia reenviar mutações após timeout; o polling de jobs crescia sem limite de espera.

## Correções

A seleção guarda IDs, modelo, criador e metadados, descartando atributos. A coleta de todos os resultados avança continuamente em páginas de até 200, mantém contagens e detecta duplicatas, páginas vazias prematuras e alterações detectáveis. A busca global é coletada por modelo: o código oficial local da API confirma que a busca global usa relevância e ignora order_by, enquanto o filtro por um modelo respeita ordenação por ID.

As quatro operações — publicar, despublicar, excluir e mover de etapa — enviam lotes sequenciais de até 200 e aguardam cada job. O progresso agrega contagens confirmadas. Cancelamento impede próximos lotes; um job aceito termina. Falhas parciais permitem continuar os outros lotes; erros de autenticação, rate limit esgotado ou resultado incerto interrompem novos envios. Não há pausa/retomada nem checkpoints obrigatórios.

Resultados incertos não são reenviados. Contagens inconsistentes da API também não viram sucesso presumido. Uma falha retornada por um job já aceito é conservadoramente incerta, mesmo quando seu status é 4xx: ela não comprova que nenhum registro foi alterado. A API retorna contagens, sem IDs de cada sucesso/falha; por isso lotes parcialmente falhos permanecem selecionados integralmente. Registros excluídos pela avaliação de permissões permanecem selecionados.

O transporte usa até quatro requisições simultâneas, intervalo mínimo de 150 ms e cooldown compartilhado nesta instância. Leituras podem repetir até três vezes após a tentativa inicial; mutações repetem apenas após 429 explícito. Cada tentativa HTTP inclui corpo no timeout real de 30 segundos. Cooldowns acima de 60 segundos falham sem antecipar o próximo envio. Polling consulta o job aceito a cada 1–5 segundos por até 30 minutos.

Os previews e a seleção visível carregam apenas a página atual. Hidratação usa grupos de até 100 IDs e até dois loaders. Caches LRU guardam até 500 registros, 250 uploads e campos de 100 modelos. Structured Text é percorrido sem recursão, com proteção contra ciclos e interrupção após obter o título. Consultas obsoletas deixam de agendar trabalho.

A ordenação por modelo conta grupos de até 50 modelos e detalha somente grupos necessários à página; não mantém cache de contagens que poderia ficar obsoleto. Todas as ordenações sem busca incluem desempate por ID.

## Principais arquivos

- `src/data/query.ts`, `partitionedOrdering.ts` e `collectSelection.ts`: paginação, ordenação e coleta completa.
- `src/data/requests.ts` e `cma.ts`: concorrência, cooldown, retries seguros, timeouts e polling.
- `src/data/loadById.ts`, `src/state/useSelectedItemsPage.ts` e `selection.ts`: hidratação limitada e seleção compacta.
- `src/operations/candidates.ts`, `permissions.ts`, `execute.ts`, `results.ts` e `types.ts`: elegibilidade, lotes, progresso e resultados.
- `src/presentation/resolver.ts`, `formatters.ts`, `fields.ts`, `src/state/usePresentations.ts` e `useItemsPage.ts`: caches e descarte de trabalho obsoleto.
- `src/entrypoints/AllRecordsPage.tsx` e `src/components/SelectionActionBar.tsx`: seleção paginada e controles condicionais.
- Testes adjacentes, `README.md` e esta auditoria: fixtures, instruções e evidências.

## Fontes oficiais

- [Bulk publish](https://www.datocms.com/docs/content-management-api/resources/item/bulk_publish), [bulk unpublish](https://www.datocms.com/docs/content-management-api/resources/item/bulk_unpublish), [bulk destroy](https://www.datocms.com/docs/content-management-api/resources/item/bulk_destroy), [bulk move to stage](https://www.datocms.com/docs/content-management-api/resources/item/bulk_move_to_stage): máximo de 200 registros por requisição.
- [Limites técnicos da CMA](https://www.datocms.com/docs/content-management-api/technical-limits): 60 requisições por 3 segundos; headers de refill em segundos.
- [Listagem de registros](https://www.datocms.com/docs/content-management-api/resources/item/instances) e [paginação](https://www.datocms.com/docs/content-management-api/pagination): paginação por offset; regular até 500 e nested até 30. O plugin mantém páginas de até 200 e nested:false.
- [Jobs assíncronos](https://www.datocms.com/docs/content-management-api/async-jobs): 202 identifica o job a consultar. O código instalado do SDK foi auditado para retries e polling.
- Fonte oficial local: `api/app/queries/item_version_query.rb`, método `order`, confirma ordenação global por metadados sem busca e a precedência de relevância na busca global. Nenhum arquivo da API foi modificado.

## Validação sintética

Fixtures geram páginas e IDs incrementalmente, sem criar entidades reais:

- 200.000 IDs em cada uma das quatro operações: 1.000 lotes, no máximo um job em voo.
- Coleta de 200.000 registros em 31 modelos, páginas curtas, inconsistências e cancelamento.
- 200.000 registros/10.000 modelos: última página de 200 registros com até 261 consultas e concorrência máxima de quatro.
- Hidratação sintética de 10.000 IDs, lotes de até 100 e concorrência máxima de dois.
- UI com 401 selecionados: 50/200 linhas visíveis, publicação 200/200/1, confirmação única, cancelamento, falhas parciais e troca de ambiente.
- Retries, headers, timeouts, conteúdo inválido, jobs e descarte de trabalho obsoleto com mocks e timers controlados.

Resultados finais em 02/10/2026: **197/197 testes passaram em 22 arquivos** (11,90 s na rodada consolidada); **Biome passou em 78 arquivos**; **typecheck TypeScript e build Vite passaram**. Os testes do transporte usam também o SDK instalado com fetch mockado, incluindo um único POST seguido de polling e job aceito que termina com status 422.

Comandos completos de validação:

```sh
npm run test -- --pool=threads --maxWorkers=1 --no-file-parallelism --testTimeout=15000
npm run build
biome check src
```

Não existe script lint nem typecheck separado neste pacote. Foi usado o binário Biome 2.4.10 já instalado de fonte oficial, com a configuração do repositório; o build executa `tsc -b` antes do Vite. `../run-checks.js` não inclui este plugin e executa instalação/checks em outros plugins; não foi executado para preservar o escopo autorizado. As primeiras tentativas da suíte sofreram timeouts de inicialização dos workers no sandbox sob carga de outras threads; a rodada consolidada passou fora dele, com um worker e apenas mocks locais.

## Limites residuais

- Mocks verificam limites e lógica; não comprovam latência, memória ou throughput de produção.
- Offset não fornece snapshot transacional. Mudanças concorrentes que preservem contagens podem escapar das verificações.
- A seleção ainda exige memória proporcional à quantidade de identidades/metadados; caches limitam quantidade, não bytes de cada entidade.
- Leituras já iniciadas pelo SDK podem terminar após cancelamento local. Não há rollback de jobs aceitos.
- Após 30 minutos sem confirmação de um job, o resultado fica incerto e o job remoto pode continuar.
- O limiter coordena esta instância do plugin, não os outros plugins ou editores. A API continua sendo autoridade final de permissões, validações, referências e transições de workflow.
- Dependências entre registros em lotes distintos podem causar falhas parciais. O plugin não supõe atomicidade global nem repete automaticamente lotes parcialmente aplicados.
- Mover de etapa mantém a restrição existente de selecionar registros de um único modelo com workflow.
- Fechar o iframe encerra a execução local; não foi introduzida persistência ou retomada manual.
