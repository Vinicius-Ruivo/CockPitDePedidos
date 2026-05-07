# ReferÃªncia â€” Cockpit de pedidos (estado base validado)

Este ficheiro Ã© o **ponto de partida** para futuros updates: descreve o que estava a funcionar no repositÃ³rio (PCF) e o que deve existir na **Canvas App** (Power Fx, ligaÃ§Ãµes). Ao mudar algo, compara com isto para ver o que divergiu.

**VersÃ£o PCF publicada (base):** `1.1.47` â€” alinhar sempre `CockpitPedidos/ControlManifest.Input.xml` (`<control version="â€¦">`) e `CockpitPedidos/constants/controlVersion.ts`.

**CÃ³pia â€œfonteâ€ dos fragmentos Canvas:** pasta `powerfx/` na raiz do repo (ficheiros `.txt` em Power Fx). Se alterares a app, atualiza tambÃ©m esses ficheiros para o Git refletir a verdade.

---

## 1. Fluxo de dados (resumo)

1. **Pedidos:** dataset `PEDIDOS` â†’ propriedade `Items` do cÃ³digo â†’ PCF mostra cards e drawer.
2. **HistÃ³rico de orÃ§amento mensal:** variÃ¡vel global `varHistoricoJson` (JSON com chaves `YYYY-MM`) â†’ input `historicoOrcamentoJson` do PCF.
3. **Legado (opcional):** `orcamentosJson` / `orcamentosContasJson` ligados a variÃ¡veis da **ConfiguraÃ§Ã£o Cockpit** â€” o PCF ainda usa como *seed* quando o histÃ³rico nÃ£o cobre o mÃªs.
4. **PersistÃªncia:** o PCF **nÃ£o** grava no Dataverse; emite outputs. O **OnChange** do controlo no Canvas faz `Patch` em `PEDIDOS`, `ConfiguraÃ§Ã£o Cockpit` e `HistÃ³rico de OrÃ§amento`.

---

## 2. LigaÃ§Ãµes do componente no Canvas (ex.: `CockpitPedidos1`)

| Propriedade | Valor de referÃªncia |
|--------------|---------------------|
| **Items** | `Filter( PEDIDOS; varAtualizaTela = varAtualizaTela )` â€” forÃ§a reavaliaÃ§Ã£o quando `varAtualizaTela` muda (ex. apÃ³s `Patch` de pedido). Inicializar `varAtualizaTela` no `OnStart` (ex. `Now()`). |
| **historicoOrcamentoJson** | `varHistoricoJson` |
| **orcamentosJson** | VariÃ¡vel ligada ao JSON de orÃ§amento na config (ex. `varOrcamentosJSON`) |
| **orcamentosContasJson** | Segunda variÃ¡vel se existir coluna sÃ³ de contas; senÃ£o pode ficar em branco |

Ajustar o **nome do controlo** (`CockpitPedidos1`) nas fÃ³rmulas abaixo se for diferente.

---

## 3. VariÃ¡veis globais (Canvas)

| VariÃ¡vel | Uso |
|----------|-----|
| `varHistoricoJson` | Texto JSON: `{ "2026-05": { "setores": {...}, "contas": {...} }, â€¦ }` |
| `varLastHistoricoTs` | Ãšltimo `historicoUpdatedTimestamp` processado no `OnChange` |
| `varLastOrcTimestamp` | Ãšltimo `orcamentosUpdatedTimestamp` processado |
| `varOrcamentosJSON` | Eco do output de orÃ§amentos para Patch na config |
| `gEdit` | Resultado de `ParseJSON(lastEditedJson)` no fluxo de pedidos |
| `varAtualizaTela` | â€œRelÃ³gioâ€ para o `Filter` dos `Items` |

---

## 4. App `OnStart` â€” carregar histÃ³rico (referÃªncia)

Incluir **apÃ³s** `Refresh` da tabela. Nomes **lÃ³gicos** da app do utilizador: `'HistÃ³rico de OrÃ§amento'`, `Competencia`, `PayloadJson` â€” trocar se no teu ambiente forem outros (ex. prefixo `cr660_`).

```powerfx
Refresh( 'HistÃ³rico de OrÃ§amento' );;
Set(
    varHistoricoJson;
    "{" &
    Concat(
        ForAll(
            Sort( 'HistÃ³rico de OrÃ§amento'; Competencia ) As R;
            """" & R.Competencia & """:" & R.PayloadJson
        );
        Value;
        ","
    ) &
    "}"
);;
Set( varLastHistoricoTs; 0 )
```

RecomendaÃ§Ã£o: repetir a mesma lÃ³gica no **`OnVisible`** do ecrÃ£ principal (ou apÃ³s `Refresh` manual da tabela) para dados alinhados quando se entra na tela sem fechar a app.

---

## 5. `OnChange` do controlo â€” referÃªncia completa

Colar no **OnChange** do cÃ³digo (Power Apps Studio). TrÃªs blocos encadeados com `;;`.

```powerfx
If(
    !IsBlank( CockpitPedidos1.lastEditedJson );
    Set( gEdit; ParseJSON( CockpitPedidos1.lastEditedJson ) );;
    Patch(
        PEDIDOS;
        LookUp( PEDIDOS; PEDIDOS = GUID( Text( gEdit.id ) ) );
        {
            STATUS:              Text( gEdit.fields.status );
            DATASOLICITACAO:     DateTimeValue( Text( gEdit.fields.dataSolicitacao ) );
            FORNECEDOR:          Text( gEdit.fields.fornecedor );
            CONTACONTABIL:       Text( gEdit.fields.contaContabil );
            DESPESA:             Text( gEdit.fields.despesa );
            QUANTIDADE:          Text( gEdit.fields.quantidade );
            RESPONSAVEL:         Text( gEdit.fields.responsavel );
            NATUREZA:            Text( gEdit.fields.natureza );
            SETOR:               Text( gEdit.fields.setor );
            CNPJ:                Text( gEdit.fields.cnpj );
            NUMERODECHAMADO:     Text( gEdit.fields.numeroChamado );
            VALOR:               Value( gEdit.fields.valor );
            CENTRODECUSTO:       Text( gEdit.fields.centroCusto );
            NUMERODEREQUISICAO:  Text( gEdit.fields.numeroRequisicao );
            ORDEMDECOMPRA:       Text( gEdit.fields.ordemCompra );
            NUMERODANOTA:        Text( gEdit.fields.numeroNota );
            NUMERODOORCAMENTO:   Text( gEdit.fields.numeroOrcamento );
            VENCIMENTO:          If( IsBlank( gEdit.fields.vencimento ); Blank(); DateValue( Text( gEdit.fields.vencimento ) ) )
        }
    );;
    Refresh( PEDIDOS );;
    UpdateContext({ varAtualizaTela: Now() })
);;

If(
    !IsBlank( CockpitPedidos1.orcamentosJsonOutput ) &&
    !IsBlank( CockpitPedidos1.orcamentosUpdatedTimestamp ) &&
    Coalesce( CockpitPedidos1.orcamentosUpdatedTimestamp; 0 ) > varLastOrcTimestamp;
    Set( varOrcamentosJSON; CockpitPedidos1.orcamentosJsonOutput );;
    Patch(
        'ConfiguraÃ§Ã£o Cockpit';
        LookUp( 'ConfiguraÃ§Ã£o Cockpit'; Nome = "Default" );
        { 'OrÃ§amentos JSON': varOrcamentosJSON }
    );;
    Set( varLastOrcTimestamp; CockpitPedidos1.orcamentosUpdatedTimestamp )
);;

If(
    Coalesce( CockpitPedidos1.historicoUpdatedTimestamp; 0 ) > varLastHistoricoTs;
    With(
        {
            mes: CockpitPedidos1.mesAtualCompetencia;
            payload: CockpitPedidos1.mesAtualPayloadJson
        };
        If(
            !IsBlank( mes ) && !IsBlank( payload );
            Patch(
                'HistÃ³rico de OrÃ§amento';
                Coalesce(
                    LookUp( 'HistÃ³rico de OrÃ§amento'; Competencia = mes );
                    Defaults( 'HistÃ³rico de OrÃ§amento' )
                );
                {
                    Competencia: mes;
                    PayloadJson: payload
                }
            )
        );;
        Set( varHistoricoJson; CockpitPedidos1.historicoOrcamentoJsonOutput );;
        Refresh( 'HistÃ³rico de OrÃ§amento' );;
        Set(
            varHistoricoJson;
            "{" &
            Concat(
                'HistÃ³rico de OrÃ§amento';
                """" & Competencia & """:" & PayloadJson;
                ","
            ) &
            "}"
        );;
        Set( varLastHistoricoTs; CockpitPedidos1.historicoUpdatedTimestamp )
    )
)
```

**Detalhe importante:** no bloco do histÃ³rico, `Set( varLastHistoricoTs; â€¦ )` estÃ¡ **no fim** do `With`, fora do `If` interno do `Patch`, para o timestamp avanÃ§ar sempre que o controlo sinaliza uma alteraÃ§Ã£o de histÃ³rico â€” evita ficar preso se `mes`/`payload` falharem uma vez.

---

## 6. PCF â€” o que este estado base assume (comportamento)

Ficheiros principais:

- `CockpitPedidos/index.ts` â€” dataset, `absorverInputs`, `handleSaveOrcamentos`, outputs; **nÃ£o** chama `markHistoricoChanged` ao criar sÃ³ o slot vazio do mÃªs (evita `historicoUpdatedTimestamp` â€œfalsoâ€ e Patch vazio no Canvas apÃ³s F5).
- `CockpitPedidos/components/Dashboard.tsx` â€” filtro **MÃªs de chegada** persistido em `localStorage` (`cp-cockpit-filtro-mes`).
- `CockpitPedidos/utils/metrics.ts` â€” `parseHistoricoOrcamentos` tolerante (vÃ­rgulas finais, chaves `setores`/`contas` case-insensitive, mapa plano por mÃªs).

DocumentaÃ§Ã£o extra: `README.md` (Dataverse, bindings, troubleshooting).

---

## 7. HistÃ³rico de versÃµes PCF (resumo do que corrigiu bugs)

| VersÃ£o | Notas |
|--------|--------|
| 1.1.41 | Janela anti-stale maior no input do histÃ³rico |
| 1.1.42 | NÃ£o disparar Patch ao criar slot vazio com input ainda vazio |
| 1.1.43 | Nunca `notify` ao criar slot vazio |
| 1.1.44 | Parse de histÃ³rico mais robusto; guia OnStart com `ForAll` |
| **1.1.45** | **NÃ£o** atualizar `lastHistoricoEmitted` ao criar slot vazio â€” evita Patch fantasma ao clicar num pedido com `varLastHistoricoTs = 0` apÃ³s F5 |
| **1.1.46** | **Salvar orÃ§amento (contas):** no `ResumoOrcamento`, deixou de usar `Number.isFinite` em brutos nos valores de `contas` â€” strings vindas do JSON (Dataverse) eram descartadas e as contas contÃ¡beis nÃ£o persistiam. |
| **1.1.47** | **Contas contÃ¡beis:** `draftContasRef` no salvar (Ãºltimo estado sÃ­ncrono); `serializeOrcamentosPayload` normaliza nÃºmeros; `agregarPorSubcategoria` lÃª orÃ§amento de conta com `parseOrcamentoValor` (strings apÃ³s F5); `handleSaveOrcamentos` tolera `contas` indefinido. |

---

## 8. Ao fazer um update no futuro

1. Comparar este documento + `powerfx/*.txt` com o que estÃ¡ na app publicada.
2. Comparar `ControlManifest.Input.xml` / `index.ts` / `Dashboard.tsx` / `metrics.ts` com o branch atual.
3. Depois de alterar o PCF: incrementar versÃ£o no manifest + `controlVersion.ts`, `npm run deploy` (ou `npm run ship`), conforme regra do projeto em `.cursor/rules/`.

---

*Ãšltima alinhamento com o repo: versÃ£o PCF `1.1.47` e conteÃºdos em `powerfx/` iguais aos blocos acima.*








