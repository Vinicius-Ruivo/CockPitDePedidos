# Referência — Cockpit de pedidos (estado base validado)

Este ficheiro é o **ponto de partida** para futuros updates: descreve o que está a funcionar no repositório (PCF) e o que deve existir na **Canvas App** (Power Fx, ligações). Ao mudar algo, compara com isto para ver o que divergiu.

**Versão PCF publicada (modelo base):** `1.1.97` — alinhar sempre `CockpitPedidos/ControlManifest.Input.xml` (`<control version="…">`) e `CockpitPedidos/constants/controlVersion.ts` (badge no header do dashboard).

> **Marco:** a partir de **1.1.97** este repositório define o **estado base validado** (overlay de análise, animações, limpeza de código morto, CI com lint). Use este commit/versão como referência para evoluções futuras.

**Cópia “fonte” dos fragmentos Canvas:** pasta `powerfx/` na raiz do repo (ficheiros `.txt` em Power Fx). Se alterares a app, atualiza também esses ficheiros para o Git refletir a verdade.

| Ficheiro | Uso |
|----------|-----|
| `powerfx/CockpitPedidos-OnChange.txt` | OnChange do controlo (pedido + orçamentos + histórico + Notificacao) |
| `powerfx/CockpitPedidos-OnStart-varHistoricoJson.txt` | OnStart / OnVisible — carregar `varHistoricoJson` |

---

## 1. Fluxo de dados (resumo)

1. **Pedidos:** dataset `PEDIDOS` → propriedade `Items` do código → PCF mostra cards e drawer.
2. **Histórico de orçamento mensal:** variável global `varHistoricoJson` (JSON com chaves `YYYY-MM`) → input `historicoOrcamentoJson` do PCF.
3. **Legado (opcional):** `orcamentosJson` / `orcamentosContasJson` ligados à **Configuração Cockpit** — o PCF ainda usa como *seed* quando o histórico não cobre o mês.
4. **Persistência:** o PCF **não** grava no Dataverse; emite outputs. O **OnChange** do controlo no Canvas faz `Patch` em `PEDIDOS`, `Notificacao` (quando há nº de chamado), `Configuração Cockpit` e `Histórico de Orçamento`.
5. **Novos pedidos:** entram via Forms / Power Automate (não há “criar pedido” no PCF).

---

## 2. Ligações do componente no Canvas (ex.: `CockpitPedidos1`)

| Propriedade | Valor de referência |
|-------------|---------------------|
| **Items** | `Filter( PEDIDOS; varAtualizaTela = varAtualizaTela )` — força reavaliação quando `varAtualizaTela` muda (ex. após `Patch` de pedido). Inicializar `varAtualizaTela` no `OnStart` (ex. `Now()`). |
| **historicoOrcamentoJson** | `varHistoricoJson` |
| **orcamentosJson** | Variável ligada ao JSON de orçamento na config (ex. `varOrcamentosJSON`) |
| **orcamentosContasJson** | Segunda variável se existir coluna só de contas; senão pode ficar em branco |

Ajustar o **nome do controlo** (`CockpitPedidos1`) nas fórmulas abaixo se for diferente.

---

## 3. Variáveis globais (Canvas)

| Variável | Uso |
|----------|-----|
| `varHistoricoJson` | Texto JSON: `{ "2026-05": { "setores": {...}, "contas": {...} }, … }` |
| `varLastHistoricoTs` | Último `historicoUpdatedTimestamp` processado no `OnChange` |
| `varLastOrcTimestamp` | Último `orcamentosUpdatedTimestamp` processado |
| `varOrcamentosJSON` | Eco do output de orçamentos para Patch na config |
| `gEdit` | Resultado de `ParseJSON(lastEditedJson)` no fluxo de pedidos |
| `varAtualizaTela` | “Relógio” para o `Filter` dos `Items` |

---

## 4. App `OnStart` — carregar histórico (referência)

Fonte canónica: `powerfx/CockpitPedidos-OnStart-varHistoricoJson.txt`.

Incluir **após** `Refresh` da tabela. Nomes **lógicos** da app: `'Histórico de Orçamento'`, `Competencia`, `PayloadJson` — trocar se no ambiente forem outros (ex. prefixo `cr660_`).

Recomendação: repetir a mesma lógica no **`OnVisible`** do ecrã principal (ou após `Refresh` manual) para dados alinhados quando se entra na tela sem fechar a app.

---

## 5. `OnChange` do controlo — referência

**Fonte canónica:** `powerfx/CockpitPedidos-OnChange.txt` (colar no OnChange do código no Power Apps Studio).

Três blocos encadeados com `;;`:

1. **Pedido** — se `lastEditedJson` não estiver em branco: `Patch` em `PEDIDOS` com todos os campos do formulário (inclui `COMPETENCIA`, `CENTRODECUSTO`, `TEMPOUM`, `TEMPODOIS`, etc.).
2. **Notificacao** — se `numeroChamado` não estiver em branco: `Patch` ou `Patch`+`Defaults` em `Notificacao` com **`NUMERODECHAMADO`** (não usar `NUMERODEREQUISICAO` nesta tabela).
3. **Orçamentos (config)** — se `orcamentosUpdatedTimestamp` avançou: `Patch` em `'Configuração Cockpit'`.
4. **Histórico mensal** — se `historicoUpdatedTimestamp` avançou: `Patch` na linha do mês em `'Histórico de Orçamento'` e reconstruir `varHistoricoJson`.

**Detalhe importante:** no bloco do histórico, `Set( varLastHistoricoTs; … )` está **no fim** do `With`, fora do `If` interno do `Patch`, para o timestamp avançar sempre que o controlo sinaliza alteração — evita ficar preso se `mes`/`payload` falharem uma vez.

**Após salvar pedido:** `Set( varAtualizaTela; Now() )` (não só `UpdateContext`).

---

## 6. PCF — comportamento assumido (v1.1.97)

### Ficheiros principais

| Área | Ficheiros |
|------|-----------|
| Ciclo PCF / outputs | `CockpitPedidos/index.ts` |
| Dashboard | `components/Dashboard.tsx`, `Dashboard.css` |
| Formulário / drawer | `components/PedidoForm.tsx`, `components/EditDrawer.tsx`, `PedidoForm.css` |
| Orçamento | `components/ResumoOrcamento.tsx` |
| Gráficos | `components/GraficosBarras.tsx`, `components/PieChartSubcategorias.tsx`, `utils/chartBarGradients.tsx` |
| Métricas / histórico | `utils/metrics.ts` |
| Exportação planilha | `utils/pedidosExport.ts` |
| Marca Ânima | `constants/animaBrand.ts`, `animaBrand.css` (cores + Roboto/Open Sans) |
| Centro de custo | `constants/centrosCusto.ts` |
| Notificação (constantes) | `constants/notificacao.ts` |

### Comportamento funcional

- **Filtro “Mês de chegada”:** usa `dataSolicitacao` do pedido (não `COMPETENCIA`). Persistido em `localStorage` (`cp-cockpit-filtro-mes`). Opção “todos” mostra todos os pedidos; orçamento no resumo segue o mês selecionado ou o mês atual quando “todos”.
- **Orçamento por mês:** slot `YYYY-MM` em `historicoOrcamentoJson`; novo mês começa vazio até “Salvar orçamentos”. O PCF **não** emite `historicoUpdatedTimestamp` ao criar só o slot vazio (evita Patch fantasma no Canvas após F5).
- **Drawer “Editar pedido”:** `PedidoForm` com `embedded` e **`autoSave={false}`** — grava com botão **Salvar** (ou Fechar sem auto-save).
- **Exportação:** botões **Exportar EC** (11 colunas layout EC) e **Exportar Tudo** (todos os campos), sobre pedidos **já filtrados** na lista. Ficheiros: `EMPENHADO & COMPROMETIDO (mês).csv` e `PEDIDOS (mês).csv` (ou `TODOS-OS-MESES`).
- **Centro de custo:** `<select>` com catálogo fixo em `centrosCusto.ts`; valores fora do catálogo (legado) continuam visíveis no registo.
- **Gráfico de pizza:** revelação horária (0→360°) ao abrir o modal; gradientes nas fatias; donut com raio interno reduzido.
- **Gráficos de barras:** crescimento 4 s, stagger esquerda→direita; gradientes SVG; rótulos acima das barras sem prefixo `R$` (eixo/KPIs mantêm moeda).
- **Análise de orçamento:** overlay em tela cheia (`cp-dash-graficos-overlay`) — fundo roxo + barra + gráficos **sobem e descem juntos** (0,82 s); o cockpit permanece visível por baixo até o painel cobrir; barra recolhida na grelha quando fechado.

### Temas visuais (toggle ☀️ / 🌙 no header)

| Toggle | Classe CSS | Descrição |
|--------|------------|-----------|
| 🌙 (padrão) | *(sem `--light`)* | Modo escuro — gradiente roxo institucional (`#5B2D82` → fundo profundo) |
| ☀️ | `cp-dash-root--light` | Tema **vibrante Ânima** — gradiente roxo → magenta (`#5B2D82` → `#B51E84`), painéis em vidro (sem blocos brancos sólidos) |

Preferência guardada em `localStorage` (`cp-cockpit-theme`: `dark` | `light`).

**Paleta oficial** (manual de marca, março 2023): `constants/animaBrand.ts` + variáveis CSS em `animaBrand.css` — roxo `#5B2D82`, magenta `#B51E84`, teal `#00B4AA` (acento/CTA), azul `#42B4E4`, laranja `#F58220` (projetado/análise), etc.

**Tipografia:** Google Fonts **Roboto** (400/500/700) e **Open Sans** como fallback (`animaBrand.css`), conforme hierarquia web do manual. **Amsi Pro** não é embutida (licença proprietária).

### `index.ts` — regras que não devem regredir

- Não chamar `markHistoricoChanged` ao criar **apenas** o slot vazio do mês corrente.
- Não atualizar `lastHistoricoEmitted` nesse caso (evita eco falso no OnChange após refresh).
- `parseHistoricoOrcamentos` tolerante (vírgulas finais, `setores`/`contas` case-insensitive).

Documentação operacional extra: `README.md` (bindings, troubleshooting).

---

## 7. Histórico de versões PCF (resumo)

| Versão | Notas |
|--------|--------|
| 1.1.41–1.1.45 | Anti-stale do histórico; não Patch ao criar slot vazio; `lastHistoricoEmitted` |
| 1.1.46–1.1.47 | Persistência de contas contábeis no orçamento; parse robusto |
| 1.1.48+ | Evoluções de histórico mensal e filtro por mês (ver commits) |
| 1.1.72–1.1.74 | Painel “Análise de orçamento” com animação de expansão |
| 1.1.75 | Pizza: fatia 100% visível |
| 1.1.77 | Centro de custo (select com catálogo) |
| 1.1.79–1.1.80 | Modo claro: selects legíveis; correção seta duplicada em dropdowns |
| 1.1.81 | Drawer: remoção da faixa roxa no rodapé (modo claro) |
| 1.1.82 | Painéis/chips no tema vibrante sem branco sólido |
| 1.1.83 | Paleta oficial Ânima (`animaBrand.ts`); gráficos e KPIs alinhados |
| 1.1.84 | `animaBrand.css`: Roboto/Open Sans; paleta Ânima unificada |
| 1.1.85–1.1.94 | Animação barras; pizza; gradientes; overlay análise (subida) |
| 1.1.95–1.1.96 | Overlay: fundo sobe com animação; fecho simétrico (descida) |
| **1.1.97** | **Modelo base:** limpeza CSS morto (`graficos-fullscreen`/`immersive`); remoção `@fluentui/react` npm; CI com `npm run lint`; refatorações lint |

---

## 8. CI no GitHub

Workflow: `.github/workflows/ci.yml`

- Dispara em **push** e **pull_request** (qualquer branch).
- Passos: `npm ci` → `npm run lint` → `npm run build` (compila o PCF; **não** faz deploy ao ambiente).
- Node.js **20** no `ubuntu-latest`.

O badge de status pode ser adicionado ao `README.md` após o primeiro run no repositório remoto.

---

## 9. Ao fazer um update no futuro

1. Comparar este documento + `powerfx/*.txt` com o que está na app publicada.
2. Comparar `ControlManifest.Input.xml` / `index.ts` / `Dashboard.tsx` / `metrics.ts` / `pedidosExport.ts` com o branch atual.
3. Depois de alterar o PCF: incrementar versão no manifest + `controlVersion.ts`, `npm run deploy` (ou `npm run ship`), conforme regra em `.cursor/rules/pcf-deploy-always.mdc`.
4. Republicar a Canvas App e confirmar que a versão do controlo no maker é a nova (ex. **1.1.97** no canto do header).
5. Confirmar que o workflow **CI** passou no GitHub antes de fazer merge (se usarem PRs).

---

## 10. Checklist rápido pós-deploy

- [ ] Header mostra `v1.1.97` (ou versão atual).
- [ ] Abrir/fechar «Análise de orçamento» — painel sobe e desce por cima do cockpit (sem fundo roxo instantâneo).
- [ ] Editar pedido → Salvar → dados refletem em `PEDIDOS` após `varAtualizaTela`.
- [ ] Com nº de chamado preenchido → registo em `Notificacao` com `NUMERODECHAMADO`.
- [ ] Salvar orçamentos → mês correto em `Histórico de Orçamento`.
- [ ] Filtro de mês altera cards e exportação.
- [ ] Exportar EC / Exportar Tudo geram CSV com pedidos filtrados.

---

*Último alinhamento com o repo: versão PCF **1.1.97** (modelo base); OnChange e OnStart iguais a `powerfx/CockpitPedidos-OnChange.txt` e `powerfx/CockpitPedidos-OnStart-varHistoricoJson.txt`.*
