# Auditoria de schemas grandes e complexos

## Escopo e diagnóstico inicial

Este plugin transporta o **schema**, incluindo modelos, blocos, campos, fieldsets e plugins. Não lista, exporta nem importa records ou assets. Um projeto com 200.000 records e 10.000 assets não exige 200.000 modelos nem provoca uma leitura desses conteúdos. O volume relevante é o número de entidades de schema, suas referências e o tamanho dos defaults/parameters localizados.

Foram preservadas as alterações existentes em README, exportação, hooks e ProjectSchema. As correções ficaram dentro da pasta deste plugin, sem mutações reais em DatoCMS.

Riscos encontrados:

- Importação com pools aninhados chegando a 12 criações de campos simultâneas, progresso contando falhas como conclusão e erros de finalização/ordenação ocultados.
- Promessas rejeitadas permanentemente no cache, listas fora da fila e transferência incorreta dos slots de concorrência.
- Grafos calculados antes do limite visual, ciclos incompatíveis com a hierarquia D3, travessias recursivas e buscas repetidas por nó/aresta.
- Cobertura incompleta de componentes cíclicos, plugins sem referência direta e dependências de modelos reutilizados.
- Renderização de milhares de opções, conflitos e formulários fechados; validação de renomes sem considerar colisões entre as novas entidades.
- Documento exportado e JSON integral duplicados em memória; metadata de editores sem timeout; parâmetros de editores plugin descartados durante remapeamento.

## Correções

- `ProjectSchema`: cache de leituras deduplicado, falhas liberam o cache, fila justa, pacing de 60 ms, retries limitados adicionais para falhas de leitura e invalidação por geração após importações completas ou parciais. Os fieldsets de blocos também são consultados.
- Exportação: trabalhos limitados, cancelamento entre unidades, espera dos trabalhos iniciados e serialização do download por entidade em partes binárias de aproximadamente 256 KiB. O helper que retorna um documento em memória permanece disponível.
- Importação: quatro workers globais, pacing de 75 ms incluindo polling de jobs, fases que criam todos os modelos antes dos campos, remapeamento sem modificar o arquivo original, parâmetros preservados e falhas propagadas. Progresso avança apenas após sucesso.
- Retry de criação: 429 e erros explicitamente transitórios recebem backoff automático. Timeout/falha de rede em POST não provoca replay cego. Uma consulta pelo ID prealocado permite continuar quando a entidade encontrada corresponde ao payload enviado. Resultado ausente ou divergente encerra a operação com erro e preserva as mudanças já aplicadas.
- Grafos: workers limitados, deduplicação de plugins, índices de consulta, análise iterativa de ciclos e hierarquia visual sem ciclos. Acima dos 60 nós já usados pela interface, o posicionamento inicial usa uma grade em vez de D3; a opção de exibir o grafo continua disponível.
- Importação de arquivos: validação de IDs duplicados, pais, fieldsets e referências ausentes antes das mutações; cobertura dirigida das raízes e inclusão de todas as entidades do bundle.
- Arquivos legados: IDs numéricos são normalizados também nas relações, validators e referências de plugins. Atributos essenciais e tipos de campo desconhecidos são rejeitados antes da importação.
- A inclusão completa do bundle é explícita: dependências incluídas no arquivo continuam sendo importadas quando sua raiz é reutilizada. Isso corrige a divergência entre a lista apresentada e as entidades criadas, mas pode criar dependências que o modelo reutilizado não usa.
- Interface: paginação somente em listas grandes, conteúdo de formulários fechados desmontado e seleção limitada em volumes altos. O fluxo habitual de arquivos pequenos continua igual.
- Recipes e metadata de editores recebem timeout e abort na leitura HTTP. Metadata inválida/indisponível usa os defaults locais. A lista vazia de plugins instalados é distinguida de uma lista indisponível.
- O overlay permanece visível durante cancelamento. Falhas na análise de conflitos mostram erro e ação para repetir a leitura, em vez de um spinner permanente. Guards síncronos impedem duas execuções causadas por duplo clique.

Não há pausa, checkpoint persistido ou retomada manual como etapa da execução. Batches, intervalos de atualização e retries são internos e contínuos.

## Limites oficiais verificados

Consulta à documentação oficial durante esta auditoria:

- A CMA permite **60 requests em 3 segundos**. Os headers de 429 informam o reset; o cliente oficial trata esses erros automaticamente. O limite é compartilhado com outras atividades do projeto, portanto a cadência local não garante ausência de 429. [Limites CMA](https://www.datocms.com/docs/content-management-api/technical-limits).
- As listagens utilizadas para [modelos/blocos](https://www.datocms.com/docs/content-management-api/resources/item-type/instances), [campos](https://www.datocms.com/docs/content-management-api/resources/field/instances), [fieldsets](https://www.datocms.com/docs/content-management-api/resources/fieldset/instances) e [plugins](https://www.datocms.com/docs/content-management-api/resources/plugin/instances) retornam as coleções completas, sem parâmetro de paginação nesses endpoints. Não foi aplicada a paginação própria de records/assets a essas entidades.
- O tamanho permitido de configurações de plugin e extensões de campo é 10 KiB. Records têm limites próprios de 300 KiB, 500 blocos e cinco níveis de blocos aninhados; são limites de **conteúdo**, não de quantidade de modelos do schema. [Limites CMA](https://www.datocms.com/docs/content-management-api/technical-limits).
- A hierarquia D3 exige uma raiz e ausência de ciclos; a hierarquia visual agora é derivada preservando separadamente as arestas cíclicas do schema. [D3 stratify](https://d3js.org/d3-hierarchy/stratify#stratify_parentId).

Não há uma chamada bulk de records/assets neste plugin. Não foi introduzido um limite artificial de 200.000 modelos nem prometida compatibilidade com esse volume.

## Fixtures e validação

As fixtures determinísticas representam volumes plausíveis de schema enterprise/custom, sem afirmar que qualquer plano comercial aceita esses números:

- 1.000 modelos/blocos com 30.000 campos em um ciclo para validar indexação e cobertura de importação.
- Grafo com 1.000 modelos/blocos, 20.000 campos, 2.000 fieldsets e 25 plugins.
- Exportação de 512 modelos/blocos com 40 campos cada, 512 fieldsets e 128 plugins: 21.632 entidades, com conferência do JSON gerado por partes.
- Importação com dezenas de modelos, milhares de campos, centenas de fieldsets, plugins e múltiplos locales, usando HTTP mock e relógio simulado.
- Falhas de API, rate limiting, respostas perdidas, cancelamento, cache invalidado, parâmetros, referências, renomes e progresso.

Comandos locais: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` e o agregado `npm run check`. O `run-checks.js` do repositório não inclui este plugin e instala/executa comandos em outras pastas; não foi executado para preservar o escopo e o trabalho paralelo.

Resultado final: **`npm run check` terminou com exit code 0**. Biome verificou 104 arquivos sem diagnósticos; o typecheck da aplicação e das fixtures passou; **82 testes em nove arquivos passaram**; Vite gerou o build de produção com sucesso. `git diff --check -- .` também passou.

O build emitiu avisos não fatais de Browserslist desatualizado e chunk `vendor-react` vazio. Os metadados de compilação rastreados foram restaurados ao estado inicial após a validação; `dist/` continua sendo saída gerada ignorada.

Houve uma rodada inicial sem coleta de testes por timeout interno dos workers durante congestionamento do ambiente. O runner final usa dois workers; as rodadas que falharam não foram consideradas aprovação. Uma fixture e os erros de tipos encontrados durante integração foram corrigidos antes da rodada final acima.

## Limites residuais

- O schema de origem/destino e o Blob final ainda ocupam memória proporcional ao seu tamanho. Parsing do arquivo de importação é integral; não há alegação de consumo constante de memória.
- O browser/iframe precisa permanecer aberto durante a operação. Fechá-lo interrompe o trabalho.
- Defaults legítimos de campos de links/assets/blocos são nulos no schema do SDK instalado e na validação da API local; não é necessário migrar records/assets para preservá-los. Strings/JSON podem conter IDs como texto arbitrário, sem informação semântica suficiente para remapeamento automático.
- Importação é aditiva, sem transação ou rollback global. Cancelamento/falha pode deixar entidades parciais; o cache e os conflitos são atualizados para refletir o destino. Reutilizar um modelo parcial não significa completar automaticamente seus campos faltantes.
- Cancelamento para novos trabalhos e espera as chamadas conhecidas já iniciadas. O cliente SDK pode continuar uma leitura/retry em curso; um timeout de criação não prova que o servidor deixou de processá-la.
- Retries de importação são finitos. Indisponibilidade prolongada, permissões, quotas do plano e schema inválido continuam podendo encerrar uma operação.
- Metadata indisponível limita o reconhecimento de editores alternativos aos defaults locais.
- A opção explícita de renderizar um grafo enorme ainda pode consumir bastante CPU/memória.
- Os testes verificam lógica, integridade e limites de agendamento com mocks. Não medem desempenho real, latência, memória máxima ou comportamento do serviço em produção. Nenhuma chave, conta de produção ou mutação real foi utilizada.
