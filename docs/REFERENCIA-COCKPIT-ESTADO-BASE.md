# Referência — Cockpit de pedidos (estado base validado)

Este ficheiro é o **ponto de partida** para futuros updates: descreve o que estava a funcionar no repositório (PCF) e o que deve existir na **Canvas App** (Power Fx, ligações). Ao mudar algo, compara com isto para ver o que divergiu.

**Versão PCF publicada (base):** `1.1.45` — alinhar sempre `CockpitPedidos/ControlManifest.Input.xml` (`<control version="…">`) e `CockpitPedidos/constants/controlVersion.ts`.

**Cópia “fonte” dos fragmentos Canvas:** pasta `powerfx/` na raiz do repo (ficheiros `.txt` em Power Fx). Se alterares a app, atualiza também esses ficheiros para o Git refletir a verdade.

---

## 1. Fluxo de dados (resumo)

1. **Pedidos:** dataset `PEDIDOS` → propriedade `Items` do código → PCF mostra cards e drawer.
2. **Histórico de orçamento mensal:** variável global `varHistoricoJson` (JSON com chaves `YYYY-MM`) → input `historicoOrcamentoJson` do PCF.
3. **Legado (opcional):** `orcamentosJson` / `orcamentosContasJson` ligados a variáveis da **Configuração Cockpit** — o PCF ainda usa como *seed* quando o histórico não cobre o mês.
4. **Persistência:** o PCF **não** grava no Dataverse; emite outputs. O **OnChange** do controlo no Canvas faz `Patch` em `PEDIDOS`, `Configuração Cockpit` e `Histórico de Orçamento`.

---

## 2. Ligações do componente no Canvas (ex.: `CockpitPedidos1`)

| Propriedade | Valor de referência |
|--------------|---------------------|
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

Incluir **após** `Refresh` da tabela. Nomes **lógicos** da app do utilizador: `'Histórico de Orçamento'`, `Competencia`, `PayloadJson` — trocar se no teu ambiente forem outros (ex. prefixo `cr660_`).

```powerfx
Refresh( 'Histórico de Orçamento' );;
Set(
    varHistoricoJson;
    "{" &
    Concat(
        ForAll(
            Sort( 'Histórico de Orçamento'; Competencia ) As R;
            """" & R.Competencia & """:" & R.PayloadJson
        );
        Value;
        ","
    ) &
    "}"
);;
Set( varLastHistoricoTs; 0 )
```

Recomendação: repetir a mesma lógica no **`OnVisible`** do ecrã principal (ou após `Refresh` manual da tabela) para dados alinhados quando se entra na tela sem fechar a app.

---

## 5. `OnChange` do controlo — referência completa

Colar no **OnChange** do código (Power Apps Studio). Três blocos encadeados com `;;`.

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
        'Configuração Cockpit';
        LookUp( 'Configuração Cockpit'; Nome = "Default" );
        { 'Orçamentos JSON': varOrcamentosJSON }
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
                'Histórico de Orçamento';
                Coalesce(
                    LookUp( 'Histórico de Orçamento'; Competencia = mes );
                    Defaults( 'Histórico de Orçamento' )
                );
                {
                    Competencia: mes;
                    PayloadJson: payload
                }
            )
        );;
        Set( varHistoricoJson; CockpitPedidos1.historicoOrcamentoJsonOutput );;
        Refresh( 'Histórico de Orçamento' );;
        Set(
            varHistoricoJson;
            "{" &
            Concat(
                'Histórico de Orçamento';
                """" & Competencia & """:" & PayloadJson;
                ","
            ) &
            "}"
        );;
        Set( varLastHistoricoTs; CockpitPedidos1.historicoUpdatedTimestamp )
    )
)
```

**Detalhe importante:** no bloco do histórico, `Set( varLastHistoricoTs; … )` está **no fim** do `With`, fora do `If` interno do `Patch`, para o timestamp avançar sempre que o controlo sinaliza uma alteração de histórico — evita ficar preso se `mes`/`payload` falharem uma vez.

---

## 6. PCF — o que este estado base assume (comportamento)

Ficheiros principais:

- `CockpitPedidos/index.ts` — dataset, `absorverInputs`, `handleSaveOrcamentos`, outputs; **não** chama `markHistoricoChanged` ao criar só o slot vazio do mês (evita `historicoUpdatedTimestamp` “falso” e Patch vazio no Canvas após F5).
- `CockpitPedidos/components/Dashboard.tsx` — filtro **Mês de chegada** persistido em `localStorage` (`cp-cockpit-filtro-mes`).
- `CockpitPedidos/utils/metrics.ts` — `parseHistoricoOrcamentos` tolerante (vírgulas finais, chaves `setores`/`contas` case-insensitive, mapa plano por mês).

Documentação extra: `README.md` (Dataverse, bindings, troubleshooting).

---

## 7. Histórico de versões PCF (resumo do que corrigiu bugs)

| Versão | Notas |
|--------|--------|
| 1.1.41 | Janela anti-stale maior no input do histórico |
| 1.1.42 | Não disparar Patch ao criar slot vazio com input ainda vazio |
| 1.1.43 | Nunca `notify` ao criar slot vazio |
| 1.1.44 | Parse de histórico mais robusto; guia OnStart com `ForAll` |
| **1.1.45** | **Não** atualizar `lastHistoricoEmitted` ao criar slot vazio — evita Patch fantasma ao clicar num pedido com `varLastHistoricoTs = 0` após F5 |

---

## 8. Ao fazer um update no futuro

1. Comparar este documento + `powerfx/*.txt` com o que está na app publicada.
2. Comparar `ControlManifest.Input.xml` / `index.ts` / `Dashboard.tsx` / `metrics.ts` com o branch atual.
3. Depois de alterar o PCF: incrementar versão no manifest + `controlVersion.ts`, `npm run deploy` (ou `npm run ship`), conforme regra do projeto em `.cursor/rules/`.

---

*Última alinhamento com o repo: versão PCF `1.1.45` e conteúdos em `powerfx/` iguais aos blocos acima.*
