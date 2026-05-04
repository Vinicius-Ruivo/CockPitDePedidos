# Cockpit de Pedidos de Compra — PCF (Power Apps Component Framework)

Componente PCF **virtual (React + TypeScript)** do tipo **dataset control**,
empacotado para importar em um **Canvas App do Microsoft Power Apps**.
Apresenta um dashboard com cards de pedidos, resumo orçamentário por setor e
múltiplos gráficos de análise. Inclui um drawer lateral para edição de cada
pedido, reutilizando o formulário com indicação visual de responsabilidade.

## Fluxo de dados

```
┌────────────────────┐   ┌──────────────────┐   ┌────────────────────┐   ┌─────────────────┐
│  Microsoft Forms   │──▶│  Power Automate  │──▶│ SharePoint List    │◀─▶│  Canvas App     │
│  (solicitação)     │   │  (gravação)      │   │  "Pedidos"         │   │  com PCF        │
└────────────────────┘   └──────────────────┘   └────────────────────┘   └─────────────────┘
                                                                                 │
                                                                                 ▼
                                                                        ┌──────────────────┐
                                                                        │ Luciana/Luciano  │
                                                                        │ tratam + editam  │
                                                                        └──────────────────┘
```

1. **Forms** coleta a solicitação (dados automáticos: data, solicitante, marca, etc.).
2. **Power Automate** dispara e grava uma nova linha em **SharePoint List** "Pedidos".
3. **Canvas App** liga a List ao PCF como fonte de dados do `data-set`.
4. **Luciana/Luciano** abrem qualquer card para tratar o pedido no **drawer**.
5. Ao salvar, o PCF emite `lastEditedJson` e o Canvas App executa `Patch()`.

## Filosofia

- **Flexibilidade total (Excel-like)**: nenhum campo é bloqueado. Qualquer pessoa
  pode editar qualquer campo.
- **Guia visual, não bloqueio**: cada campo exibe um *badge* e uma *borda lateral
  colorida* indicando o responsável primário (Luciana, Luciano, automático ou
  compartilhado).
- **Campo `Setor` auto-aprendente**: os setores preenchidos em pedidos anteriores
  aparecem automaticamente como sugestão (via `<datalist>`) para os próximos.
- **Data-binding reativo**: cada alteração emite `notifyOutputChanged`
  imediatamente, devolvendo o valor ao Power Apps sem lag e sem vazamento de
  memória (sem listeners globais; a UI é 100% controlada por props).

## Estrutura

```
ProjetoGestãoDePedidos/
├── CockpitPedidos/
│   ├── ControlManifest.Input.xml           ← dataset + inputs/outputs auxiliares
│   ├── index.ts                             ← ciclo PCF, coerção de tipos, outputs
│   ├── types.ts                             ← IPedido, ChartMetric, IEditedPayload
│   ├── utils/
│   │   └── metrics.ts                       ← agregações puras (por setor, status…)
│   ├── components/
│   │   ├── Dashboard.tsx                    ← orquestrador (grid 2 + 1)
│   │   ├── Dashboard.css                    ← layout, drawer, gráficos
│   │   ├── PedidoCard.tsx                   ← card clicável
│   │   ├── ResumoOrcamento.tsx              ← painel direito
│   │   ├── GraficosBarras.tsx               ← 4 gráficos com seletor
│   │   ├── EditDrawer.tsx                   ← drawer overlay que abriga o form
│   │   ├── PedidoForm.tsx                   ← form de edição (reaproveitado)
│   │   └── PedidoForm.css                   ← estilo do form (modo embedded)
│   └── strings/
│       ├── CockpitPedidos.1033.resx         ← en-US (fallback obrigatório)
│       └── CockpitPedidos.1046.resx         ← pt-BR (primário)
├── package.json
├── tsconfig.json
├── pcfconfig.json
└── README.md
```

## Uso no Canvas App

Após importar a solução:

### 1) Vincular o dataset à SharePoint List

1. No Canvas App, adicione a fonte de dados **SharePoint → Pedidos** (a lista).
2. **Insert → Get more components → Code → Cockpit de Pedidos de Compra**.
3. Arraste para a tela e, no painel direito, mapeie o dataset:
   ```
   Items  =  Pedidos                 // a própria SharePoint List
   ```
4. Para cada `property-set` (coluna do dataset), informe a coluna correspondente
   da List:

   | Property (PCF)      | Coluna da SharePoint List          |
   |---------------------|------------------------------------|
   | `dataPedido`        | Data                               |
   | `marca`             | Marca                              |
   | `diretoria`         | Diretoria                          |
   | `despesa`           | Despesa                            |
   | `quantidade`        | Quantidade                         |
   | `solicitadoPor`     | Solicitado Por                     |
   | `fornecedor`        | Fornecedor                         |
   | `cnpj`              | CNPJ                               |
   | `numeroOrcamento`   | Nº Orçamento                       |
   | `valor`             | Valor                              |
   | `responsavel`       | Responsável                        |
   | `numeroChamado`     | Nº Chamado                         |
   | `natureza`          | Natureza                           |
   | `numeroRequisicao`  | Nº Requisição                      |
   | `centroCusto`       | Centro de Custo                    |
   | `contaContabil`     | Conta Contábil                     |
   | `numeroNota`        | Nº Nota                            |
   | `vencimento`        | Vencimento                         |
   | `ordemCompra`       | Ordem de Compra                    |
   | `status`            | Status                             |
   | `setor`             | Setor                              |

   > **Importante:** a coluna **Setor** precisa existir na SharePoint List.
   > Crie-a como **Single line of text**. Ela permanece vazia por padrão
   > (o pedido ainda não tem setor definido) e é preenchida por Luciana/Luciano
   > quando tratam o pedido.

### 2) Configurar orçamentos por setor

No `OnStart` ou `OnVisible` da tela, crie uma variável com os orçamentos:

```powerfx
Set(
  varOrcamentos,
  JSON({
    "TI":         50000,
    "Marketing":  30000,
    "Operações":  80000,
    "RH":         15000
  })
)
```

E vincule no PCF:

```
orcamentosJson  =  varOrcamentos
```

> Se preferir manter os orçamentos em outra SharePoint List (recomendado para
> equipes), use algo como:
>
> ```powerfx
> Set(varOrcamentos,
>   JSON(
>     ForAll(Orcamentos, { Setor: Setor, Valor: Valor })
>   )
> )
> ```

Sem esse input o dashboard ainda funciona, mas o painel "Resumo de orçamento
por setor" e o gráfico "Orçado × Realizado × Saldo" mostram apenas o lado
"Realizado".

### 2.1) Histórico mensal de orçamentos (recomendado)

A partir da v1.1.31 o controlo guarda os orçamentos **mês a mês** automaticamente:
no dia 1, ao abrir o dashboard, o controlo deteta a virada e cria um slot vazio
para a nova competência (decisão: o mês novo começa zerado, sem copiar valores
do mês anterior). O orçamento do mês passado fica congelado no histórico —
útil para análises de "Orçamento × Realizado × Saldo ao longo do tempo".

**Modelo de dados (Dataverse).** Crie a tabela `cr660_orcamentohistorico`
(plural automático: `cr660_orcamentohistoricoes`) com:

| Coluna lógica           | Tipo                | Observação                                     |
|-------------------------|---------------------|------------------------------------------------|
| `cr660_competencia`     | Texto (chave única) | `YYYY-MM` (ex.: `2026-05`). Use como nome.     |
| `cr660_payloadjson`     | Texto multilinha    | JSON `{ "setores": {...}, "contas": {...} }`. |
| (opcional) `cr660_orcamentototal` | Moeda     | Para visualizações no Power BI sem parse.      |

**Bindings no Canvas.** No control PCF, ligue:

```
historicoOrcamentoJson = varHistoricoJson
```

**`OnStart` (carregar tudo de uma vez).** Constrói o JSON `{ "AAAA-MM": {...} }`
a partir das linhas existentes da tabela:

```powerfx
Set(varHistoricoJson,
    "{" &
    Concat(
        cr660_orcamentohistoricoes,
        """" & cr660_competencia & """:" & cr660_payloadjson,
        ","
    ) &
    "}"
);
Set(varLastHistoricoTs, 0);
```

**`OnChange` do controlo (Patch automático).** Dispara em qualquer mudança:
salvamento manual ou virada de mês detectada pelo controlo.

```powerfx
If(
    Cockpit1.historicoUpdatedTimestamp > varLastHistoricoTs,
    With(
        {
            mes:     Cockpit1.mesAtualCompetencia,
            payload: Cockpit1.mesAtualPayloadJson
        },
        If(
            !IsBlank(mes) && !IsBlank(payload),
            Patch(
                cr660_orcamentohistoricoes,
                Coalesce(
                    LookUp(cr660_orcamentohistoricoes, cr660_competencia = mes),
                    Defaults(cr660_orcamentohistoricoes)
                ),
                {
                    cr660_competencia: mes,
                    cr660_payloadjson: payload
                }
            )
        )
    );
    Set(varLastHistoricoTs, Cockpit1.historicoUpdatedTimestamp)
)
```

> **Valores voltam a zero após Salvar?** O controlo envia o histórico completo em
> `historicoOrcamentoJsonOutput`. Se o `Patch` gravar no Dataverse mas **`varHistoricoJson`
> (input) continuar igual à cópia antiga**, o PCF acaba por reaplicar dados velhos.
> **Imediatamente após o `Patch`**, faça
> `Set(varHistoricoJson, Cockpit1.historicoOrcamentoJsonOutput)` **ou**
> `Refresh(...);` + o mesmo `Set(varHistoricoJson, …)` do `OnStart` (repor o JSON a partir
> da tabela). Sem isto, o ecrã pode mostrar orçamento a zeros de novo.

> **Como funciona a virada do mês?** Em todo `updateView`, o controlo lê o
> mês corrente do dispositivo (`new Date().getMonth()`). Se não houver slot
> para essa competência no histórico, cria um vazio **só em memória** — não
> dispara Patch automático (evita gravar `{}` no Dataverse). A primeira linha
> do mês novo no histórico é criada quando alguém grava com «Salvar orçamentos».
> O filtro «Mês de chegada» no PCF passa a ser **lembrado no browser** (localStorage)
> após F5, para não parecer que o orçamento «sumiu» ao estar noutro mês.

> **Linhas criadas ou alteradas no Dataverse (maker) e não aparecem no período?**
> A variável `varHistoricoJson` costuma ser montada só no **`OnStart`**. Depois
> de inserir ou editar linhas na tabela **fora** da app, é preciso **recarregar**
> os dados e voltar a montar o JSON, senão o PCF continua com a cópia antiga em
> memória — fevereiro não entra na lista «De / Até». Faça uma destas opções:
>
> - Fechar a app por completo e abrir de novo (dispara `OnStart`), ou  
> - No **`OnVisible`** da tela principal (recomendado):
>
> ```powerfx
> Refresh( 'Histórico de Orçamento' );;
> Set(
>     varHistoricoJson;
>     "{" &
>     Concat(
>         'Histórico de Orçamento';
>         """" & Competencia & """:" & PayloadJson;
>         ","
>     ) &
>     "}"
> )
> ```
>
> Ajuste `'Histórico de Orçamento'`, `Competencia` e `PayloadJson` aos nomes
> que o Power Apps mostrar na sua fonte / colunas.
>
> Opcionalmente, no **`OnChange`** do Cockpit, **depois** do `Patch` que grava
> o histórico, acrescente o mesmo `Set(varHistoricoJson; …)` para a lista
> refletir logo após guardar orçamentos pela UI.

> **Tabela vs. célula única.** Se preferir guardar tudo numa só célula
> (ex.: linha única numa lista de configuração), use
> `historicoOrcamentoJsonOutput` em vez de `mesAtualPayloadJson` —
> e ligue `historicoOrcamentoJson` à mesma variável.

> **Retrocompatibilidade.** Se o `historicoOrcamentoJson` ficar vazio (Canvas
> ainda não wireou a nova feature), o controlo continua a usar
> `orcamentosJson`/`orcamentosContasJson` como ponto de partida do mês
> corrente — nenhum app antigo quebra.

### 3) Reagir ao salvamento (Patch)

Quando Luciana/Luciano clicam em **Salvar** no drawer, o PCF emite:

- `Cockpit1.lastEditedJson` → JSON string com `{ id, fields, at }`
- `Cockpit1.lastEditedTimestamp` → número epoch (ms)

No Canvas App, adicione ao **`OnChange` do Cockpit1**:

```powerfx
With(
  { payload: ParseJSON(Cockpit1.lastEditedJson) },
  If(
    !IsBlank(payload),
    Patch(
      Pedidos,
      LookUp(Pedidos, ID = Value(payload.id)),
      {
        Fornecedor:            Text(payload.fields.fornecedor),
        CNPJ:                  Text(payload.fields.cnpj),
        'Nº Orçamento':        Text(payload.fields.numeroOrcamento),
        Valor:                 Value(payload.fields.valor),
        Responsável:           Text(payload.fields.responsavel),
        'Nº Chamado':          Text(payload.fields.numeroChamado),
        Natureza:              Text(payload.fields.natureza),
        'Nº Requisição':       Text(payload.fields.numeroRequisicao),
        'Centro de Custo':     Text(payload.fields.centroCusto),
        'Conta Contábil':      Text(payload.fields.contaContabil),
        'Nº Nota':             Text(payload.fields.numeroNota),
        Vencimento:            DateValue(Text(payload.fields.vencimento)),
        'Ordem de Compra':     Text(payload.fields.ordemCompra),
        Status:                Text(payload.fields.status),
        Setor:                 Text(payload.fields.setor)
      }
    )
  )
)
```

> **Por que usar `lastEditedTimestamp`?** Se o usuário editar duas vezes com os
> mesmos valores, o `lastEditedJson` fica idêntico e o `OnChange` não dispara.
> Ancore a trigger em `lastEditedTimestamp` se quiser sempre disparar:
>
> ```powerfx
> // Evite; só para casos de retry forçado
> If(Cockpit1.lastEditedTimestamp > varLastSeen,
>    ...
>    Set(varLastSeen, Cockpit1.lastEditedTimestamp)
> )
> ```

## Painéis do dashboard

| Painel                        | Descrição                                                                 |
|-------------------------------|---------------------------------------------------------------------------|
| **Cards de Pedidos**          | Lista clicável de pedidos com fornecedor, Nº, status, valor e setor.      |
| **Resumo de orçamento**       | Barras de progresso por setor: Realizado vs. Orçamento + saldo.           |
| **Gráficos de barras**        | 4 métricas comutáveis: Orçado×Realizado×Saldo, por Status, mensal, por Responsável. |
| **Drawer de edição**          | Abre ao clicar num card. Reutiliza `PedidoForm` em modo `embedded`.       |

## Localização (i18n)

Os `display-name` e `description` de todas as propriedades declaradas no
`ControlManifest.Input.xml` são resolvidos em tempo de build/runtime a partir
dos arquivos `.resx` em `CockpitPedidos/strings/`.

| LCID | Cultura       | Arquivo                          | Status      |
|------|---------------|----------------------------------|-------------|
| 1033 | en-US         | `CockpitPedidos.1033.resx`       | Fallback    |
| 1046 | pt-BR         | `CockpitPedidos.1046.resx`       | Primário    |

**Como o Power Apps escolhe o idioma:**

1. Olha a cultura do ambiente (`Settings → Language`).
2. Se houver um `.resx` correspondente ao LCID, usa-o.
3. Caso contrário, faz fallback para `1033` (por isso ele é obrigatório).

**Para adicionar um novo idioma** (ex: espanhol-Espanha, LCID `3082`):

1. Duplique `CockpitPedidos.1046.resx` como `CockpitPedidos.3082.resx`.
2. Traduza os `<value>` de cada `<data>`.
3. Adicione no `ControlManifest.Input.xml` dentro de `<resources>`:
   ```xml
   <resx path="strings/CockpitPedidos.3082.resx" version="1.0.0" />
   ```
4. Rode `npm run refreshTypes && npm run build` novamente.

> **Importante:** os nomes das **chaves** (`name="..."` em cada `<data>`) devem
> ser **idênticos** entre todos os `.resx` e **idênticos** aos `*-key` usados no
> manifest. Se adicionar/renomear uma chave em um, atualize todos.

## Pré-requisitos

- Node.js 18 LTS
- Power Platform CLI (`pac`) — [guia oficial](https://learn.microsoft.com/power-platform/developer/cli/introduction)
- .NET SDK (apenas se for empacotar como `solution.zip` via `msbuild`)

## Primeiros passos

```powershell
# 1. Instalar dependências
npm install

# 2. Gerar os tipos a partir do Manifest (cria CockpitPedidos/generated/ManifestTypes.d.ts)
npm run refreshTypes

# 3. Rodar o Test Harness localmente
npm start
```

O Test Harness abrirá o componente em `http://localhost:8181` com uma tabela
de pedidos fictícia para simular o dataset.

## Build & Deploy

**Gancho Git `pre-push` (automático):** após `npm install` na raiz, o repositório
fica com `core.hooksPath = .githooks`. **Cada `git push` corre `npm run deploy`**
antes de enviar para o GitHub; se o deploy falhar, o push é cancelado. O fluxo
`npm run ship` evita deploy duplicado nesse passo. Clonar o repo noutra máquina:
`git clone` → `npm install` (ativa os hooks). **Exceção (raro):** em bash `SKIP_PRE_PUSH_DEPLOY=1 git push`; em PowerShell `$env:SKIP_PRE_PUSH_DEPLOY='1'; git push` — pula o deploy no hook; usar só em emergência.

**Atualizar o componente no Power Apps e subir o código para o GitHub** (após
subir a versão no `ControlManifest.Input.xml` quando fizer sentido):

```powershell
npm run ship -- "fix: descrição da alteração"
```

Isto executa `npm run deploy` e, em seguida, `git add`, `commit` (se houver
ficheiros alterados) e `push` para o repositório remoto. Sem mensagem, o
script gera um commit com data/hora.

```powershell
# Build de produção (gera /out)
npm run build

# Empacotar como solution para importar no Power Apps
pac solution init --publisher-name "SeuPublisher" --publisher-prefix "cp"
pac solution add-reference --path .
msbuild /t:build /restore
```

O `.zip` resultante pode ser importado em **Power Apps → Soluções → Importar**.

## Troubleshooting

- **Cards não aparecem no Canvas:** confirme que o `Items` do dataset está
  apontando para a SharePoint List e que o `Cockpit1.Pedidos.Items` retorna
  registros em um teste com `CountRows(Cockpit1.Pedidos.Items)`.
- **"Property not found" ao arrastar no Canvas**: rode `npm run refreshTypes`
  após qualquer mudança no `ControlManifest.Input.xml`.
- **Componente não aparece em "Code"**: verifique se *Code Components for Canvas
  Apps* está habilitado em **Admin Center → Environment → Features**.
- **`OnChange` do `lastEditedJson` não dispara**: é esperado quando o usuário
  salva sem alterar nada. Se precisar forçar, use `lastEditedTimestamp`.
- **Resumo mostra "sem orçamento"**: a propriedade `orcamentosJson` está vazia
  ou em formato inválido. Teste com `Set(varO, "{""TI"":1000}")` e rebinde.
- **Painel direito não soma valores do setor**: confirme que cada pedido tem a
  coluna **Setor** preenchida. Use o drawer para editar um pedido e informe
  o setor — ele ficará disponível para autocomplete dos próximos.
- **`npm start` falhava com `Error: Could not find config file`** (ESLint 9):
  o projeto já vem com `"skipBuildLinting": true` no `pcfconfig.json` — isso
  faz o pcf-scripts pular o ESLint durante o build/start. Para **reativar** o
  lint, remova esse flag e instale os plugins:

  ```powershell
  npm install --save-dev typescript-eslint eslint-plugin-react eslint-plugin-react-hooks globals
  ```

  O `eslint.config.mjs` já carrega cada plugin de forma tolerante (se não
  estiver instalado, a regra correspondente é ignorada), então você pode
  ativar camadas gradualmente.
