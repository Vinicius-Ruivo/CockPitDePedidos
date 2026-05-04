import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import { Dashboard, IDashboardProps } from "./components/Dashboard";
import {
  DATAVERSE_TO_IPEDIDO,
  emptyHistoricoOrcamentos,
  emptyOrcamentosPayload,
  IHistoricoOrcamentos,
  IOrcamentosPayload,
  IPedido,
  IPedidoData,
  IEditedPayload,
  MesISO,
  PEDIDO_COLUMNS,
} from "./types";
import {
  applyInferredSetorForSave,
  findSetorBySubcategoria,
} from "./constants/setoresOrganizacao";
import {
  buildOrcamentosFromInputs,
  garantirSlotDoMes,
  mesISOAtual,
  orcamentosDoMes,
  parseHistoricoOrcamentos,
  serializeHistoricoOrcamentos,
  serializeNumberMap,
  serializeOrcamentosPayload,
  setSlotDoMes,
} from "./utils/metrics";

/**
 * Cockpit de Pedidos de Compra — PCF Virtual Dataset Control.
 *
 * Fluxo de dados:
 *   Microsoft Forms ─▶ Power Automate ─▶ SharePoint List "Pedidos"
 *                                               │
 *                                               ▼
 *                                       Canvas App (bind) ─▶ PCF (este)
 *
 * Edição:
 *   Luciana/Luciano clicam num card ─▶ drawer abre ─▶ editam ─▶ Salvar
 *   ─▶ PCF emite `lastEditedJson` + `lastEditedTimestamp`
 *   ─▶ Canvas App reage via OnChange e chama Patch() na List.
 *
 * Orçamentos (resumo): Editar na UI → «Salvar orçamentos» emite `orcamentosJsonOutput`,
 * `orcamentosContasJsonOutput` e `orcamentosUpdatedTimestamp`. No OnChange do controlo,
 * atualize as variáveis ligadas a `orcamentosJson` / `orcamentosContasJson` (Set/Patch).
 *
 * Histórico mensal: o controlo mantém um `IHistoricoOrcamentos` (mapa
 * `YYYY-MM` → payload) recebido por `historicoOrcamentoJson` (input). Em todo
 * `updateView` o mês corrente do dispositivo é resolvido (`mesISOAtual()`) e,
 * se não houver slot para ele, é criado automaticamente vazio (decisão de
 * produto: cada novo mês começa do zero). O slot do mês corrente passa a ser
 * a fonte de verdade para os gráficos/UI; meses anteriores ficam congelados
 * no histórico para análise futura. O slot vazio do mês corrente é só em
 * memória até «Salvar orçamentos»; não se atualiza `lastHistoricoEmitted` aqui,
 * para o timestamp do histórico não enganar o OnChange do Canvas após F5.
 *
 * Nenhum `webAPI.updateRecord` é chamado aqui de propósito: Canvas Apps
 * gerenciam persistência pelo próprio formulário de dados, o que preserva
 * rastreabilidade, offline e políticas de DLP.
 */
export class CockpitPedidos
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private notifyOutputChanged!: () => void;
  private context!: ComponentFramework.Context<IInputs>;

  /** Último pedido editado — espelhado nos outputs. */
  private lastEdited?: IEditedPayload;

  /** Id do pedido selecionado (card clicado). Persiste entre renders. */
  private selectedRecordId?: string;

  private cachedOrcamentos: IOrcamentosPayload = emptyOrcamentosPayload();

  /** "rawMain\ncaixaConta" (evita reparse quando nada muda). */
  private cachedInputSignature?: string;

  /**
   * Assinatura dos dois JSON de entrada após o último "Salvar orçamentos" —
   * alinha o eco do Canvas (evita stale a apagar o cache cedo de mais).
   */
  private lastInputSignatureAfterSave?: string;

  private lastOrcamentosSaved?: { json: string; at: number; contasOut: string };

  // ---------------------------------------------------------------------------
  // Histórico mensal
  // ---------------------------------------------------------------------------

  /** Mapa { "YYYY-MM": IOrcamentosPayload } — fonte de verdade do orçamento mês a mês. */
  private historico: IHistoricoOrcamentos = emptyHistoricoOrcamentos();

  /** Mês corrente (recalculado a cada updateView). */
  private mesAtual: MesISO = mesISOAtual();

  /**
   * Última versão do histórico emitida (canônica). Usada para:
   *   1) detectar mudanças reais e disparar `historicoUpdatedTimestamp`,
   *   2) evitar que o eco do Canvas (input antigo a chegar tarde) sobrescreva
   *      o cache otimista logo após salvar, e
   *   3) servir como output estável em `getOutputs()` mesmo quando o Canvas
   *      ainda não devolveu o valor recém-salvo.
   */
  private lastHistoricoEmitted?: { json: string; at: number; mes: MesISO; payloadDoMes: string };

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    state: ComponentFramework.Dictionary,
  ): void {
    void state;
    this.context = context;
    this.notifyOutputChanged = notifyOutputChanged;
    this.context.mode.trackContainerResize(true);
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>,
  ): React.ReactElement {
    this.context = context;

    const dataset = context.parameters.pedidos;
    const loading = dataset.loading;
    const pedidos = loading ? [] : this.mapDatasetToPedidos(dataset);

    // 1) Resolver mês corrente (recalculado a cada render → a virada do mês
    //    é detectada na próxima abertura/refresh do dashboard).
    this.mesAtual = mesISOAtual();

    // 2) Sincronizar `historico` com o input vindo do Canvas (Dataverse).
    //    O input pode estar vazio numa primeira instalação — nesse caso
    //    seguimos o legado (orcamentosJson + orcamentosContasJson) como
    //    seed do mês corrente.
    const rawHistorico = context.parameters.historicoOrcamentoJson?.raw ?? "";
    const rawLegacyMain = context.parameters.orcamentosJson.raw ?? "";
    const rawLegacyContas = context.parameters.orcamentosContasJson?.raw ?? "";
    const inputSignature = `${rawHistorico}\n${rawLegacyMain}\n${rawLegacyContas}`;

    if (inputSignature !== this.cachedInputSignature) {
      this.absorverInputs({ rawHistorico, rawLegacyMain, rawLegacyContas });
      this.cachedInputSignature = inputSignature;
    }

    // 3) Garantir que o slot do mês corrente existe — vira-de-mês automática.
    //    Não chamar `markHistoricoChanged` aqui: mesmo com persistir:false ele
    //    preenche `lastHistoricoEmitted` e `historicoUpdatedTimestamp`. O próximo
    //    `notifyOutputChanged` (ex.: clicar num pedido) faz o OnChange do Canvas
    //    com `varLastHistoricoTs=0` no OnStart e dispara Patch com payload vazio
    //    do mês civil — corrompe o Dataverse na 2.ª visita / F5.
    const ensured = garantirSlotDoMes(this.historico, this.mesAtual);
    if (ensured.criou) {
      this.historico = ensured.historico;
    }

    // 4) `cachedOrcamentos` (consumido pelo Dashboard) sempre reflete o slot
    //    do mês corrente — gráficos e KPIs do "topo" passam a ser do mês.
    this.cachedOrcamentos = orcamentosDoMes(this.historico, this.mesAtual);

    const props: IDashboardProps = {
      pedidos,
      orcamentos: this.cachedOrcamentos,
      historicoOrcamentos: this.historico,
      loading,
      selectedRecordId: this.selectedRecordId,
      width: context.mode.allocatedWidth,
      height: context.mode.allocatedHeight,
      canLoadMore: !loading && dataset.paging?.hasNextPage === true,
      onLoadMore: this.handleLoadMore,
      onSelectPedido: this.handleSelectPedido,
      onSavePedido: this.handleSavePedido,
      onSaveOrcamentos: this.handleSaveOrcamentos,
    };

    return React.createElement(Dashboard, props);
  }

  /**
   * Lê os 3 inputs e decide o que vira "histórico em memória":
   *   - Se há `historicoOrcamentoJson` com pelo menos uma chave válida → essa
   *     é a fonte principal. Os legados **completam só o mês corrente** se
   *     esse slot ainda não existir no JSON (ex.: Dataverse com meses antigos
   *     mas sem linha para o mês atual — antes ignorávamos o legado por
   *     completo e o orçamento sumia após F5).
   *   - Caso contrário → tratamos os legados como o orçamento do mês corrente.
   * Implementa anti-stale para o eco do Canvas logo após "Salvar".
   */
  private absorverInputs(args: {
    rawHistorico: string;
    rawLegacyMain: string;
    rawLegacyContas: string;
  }): void {
    const legacyPayload = buildOrcamentosFromInputs(
      args.rawLegacyMain,
      args.rawLegacyContas,
    );

    const parsedHistorico = parseHistoricoOrcamentos(args.rawHistorico);
    const historicoTemDados = Object.keys(parsedHistorico).length > 0;

    const cacheTemDados = Object.keys(this.historico).length > 0;
    const lastEmitted = this.lastHistoricoEmitted;
    /** Evita que o eco antigo do Canvas (varHistoricoJson sem Refresh após Patch) apague o
     *  orçamento logo após «Salvar». Com ~8s bastava falhar se o utilizador ou o host demorar.
     */
    const withinGraceMs = 120_000;
    const dentroDoGrace =
      lastEmitted && Date.now() - lastEmitted.at < withinGraceMs;

    if (historicoTemDados) {
      const merged = historicoComMesAtualDoLegadoSeAusente(
        parsedHistorico,
        this.mesAtual,
        legacyPayload,
      );
      const incomingCanon = serializeHistoricoOrcamentos(merged);
      const staleDivergente =
        dentroDoGrace && lastEmitted!.json !== incomingCanon;
      if (!staleDivergente) {
        this.historico = merged;
      }
      return;
    }

    // Sem histórico nos inputs: pode ser primeira execução OU Canvas a enviar
    // vazio temporário durante o eco. Se o cache tem dados E estamos na janela
    // de grace pós-save, mantemos. Caso contrário, fazemos seed pelo legado.
    if (cacheTemDados && dentroDoGrace) return;

    const seed = legacyPayload;
    const seedTemDados =
      Object.keys(seed.setores).length > 0 || Object.keys(seed.contas).length > 0;
    if (seedTemDados) {
      this.historico = { [this.mesAtual]: seed };
      return;
    }

    if (!cacheTemDados) {
      this.historico = {};
    }
  }

  /**
   * Marca o histórico como modificado: atualiza o cache canônico e, se
   * `persistir`, agenda emissão para o Canvas via `notifyOutputChanged`.
   */
  private markHistoricoChanged(opts: { persistir: boolean; mes?: MesISO }): void {
    const mes = opts.mes ?? this.mesAtual;
    const json = serializeHistoricoOrcamentos(this.historico);
    const payloadDoMes = serializeOrcamentosPayload(
      orcamentosDoMes(this.historico, mes),
    );
    this.lastHistoricoEmitted = {
      json,
      at: Date.now(),
      mes,
      payloadDoMes,
    };
    if (opts.persistir) {
      this.notifyOutputChanged();
    }
  }

  public getOutputs(): IOutputs {
    /**
     * `orcamentosJsonOutput` não pode depender *apenas* de "Salvar orçamentos"
     * na sessão: se ficar `undefined` em `getOutputs`, o Canvas pode anular
     * variáveis ligadas ao output e fórmulas de `OnChange` que leem o JSON
     * (ex.: `ParseJSON(orcamentosJsonOutput)`) falham — parece "só grava
     * pedido depois de ter salvo orçamento". Ecoamos o cache/entrada atuais.
     * Ainda assim `orcamentosUpdatedTimestamp` só muda no save explícito do
     * painel, para o Patch na Configuração disparar só quando apropriado.
     */
    const c = this.cachedOrcamentos;
    const outFull =
      this.lastOrcamentosSaved?.json ??
      (Object.keys(c.setores).length > 0 || Object.keys(c.contas).length > 0
        ? serializeOrcamentosPayload(c)
        : undefined);
    const outContas =
      this.lastOrcamentosSaved?.contasOut ??
      (Object.keys(c.contas).length > 0 ? serializeNumberMap(c.contas) : undefined);

    // Outputs do histórico mensal: sempre eco do cache canônico para que o
    // Canvas, em qualquer reload, encontre valores estáveis. O timestamp,
    // contudo, só muda quando há mudança real (save manual ou virada do mês).
    const histJson = this.lastHistoricoEmitted?.json
      ?? (Object.keys(this.historico).length > 0
        ? serializeHistoricoOrcamentos(this.historico)
        : undefined);
    const mesPayload = this.lastHistoricoEmitted?.payloadDoMes
      ?? serializeOrcamentosPayload(c);

    return {
      selectedRecordId: this.selectedRecordId,
      lastEditedJson: this.lastEdited ? JSON.stringify(this.lastEdited) : undefined,
      lastEditedTimestamp: this.lastEdited?.at,
      orcamentosJsonOutput: outFull,
      orcamentosContasJsonOutput: outContas,
      orcamentosUpdatedTimestamp: this.lastOrcamentosSaved?.at,
      historicoOrcamentoJsonOutput: histJson,
      mesAtualCompetencia: this.lastHistoricoEmitted?.mes ?? this.mesAtual,
      mesAtualPayloadJson: mesPayload,
      historicoUpdatedTimestamp: this.lastHistoricoEmitted?.at,
    };
  }

  public destroy(): void {
    this.lastEdited = undefined;
    this.lastOrcamentosSaved = undefined;
    this.lastInputSignatureAfterSave = undefined;
    this.cachedInputSignature = undefined;
    this.lastHistoricoEmitted = undefined;
    this.selectedRecordId = undefined;
    this.cachedOrcamentos = emptyOrcamentosPayload();
    this.historico = emptyHistoricoOrcamentos();
  }

  // ---------------------------------------------------------------------------
  // Handlers expostos ao React
  // ---------------------------------------------------------------------------

  private handleSelectPedido = (recordId: string | undefined): void => {
    if (this.selectedRecordId === recordId) return;
    this.selectedRecordId = recordId;
    this.notifyOutputChanged();
  };

  /** Chamado pelo EditDrawer após o Salvar.
   *  Emite o pedido editado nos outputs para o Canvas fazer o Patch. */
  private handleSavePedido = (recordId: string, fields: IPedidoData): void => {
    this.lastEdited = {
      id: recordId,
      fields: applyInferredSetorForSave(fields),
      at: Date.now(),
    };
    this.notifyOutputChanged();
  };

  /**
   * Saída 1 = JSON completo (igual a antes) para uma coluna / variável.
   * Saída 2 = só contas, para 2.ª célula ou tabela, sem tocar a fórmula que já existia.
   * Saída 3 = histórico mensal (novo) — atualiza o slot da competência filtrada.
   */
  private handleSaveOrcamentos = (payload: IOrcamentosPayload, mes?: MesISO): void => {
    const mesDestino = mes ?? this.mesAtual;
    const next: IOrcamentosPayload = {
      setores: { ...payload.setores },
      contas: { ...payload.contas },
    };
    const json = serializeOrcamentosPayload(next);
    const contasOut = serializeNumberMap(next.contas);

    // Atualiza o slot da competência ativa no filtro do Dashboard.
    this.historico = setSlotDoMes(this.historico, mesDestino, next);
    if (mesDestino === this.mesAtual) {
      this.cachedOrcamentos = next;
    }

    this.lastOrcamentosSaved = { json, at: Date.now(), contasOut };
    // Ainda mantemos a assinatura para retrocompat. Após este save, o Canvas
    // re-emite `historicoOrcamentoJson` com a nova versão; o anti-stale em
    // `absorverInputs` impede que o eco antigo apague o cache otimista.
    this.lastInputSignatureAfterSave = `${json}\n${contasOut}`;
    this.cachedInputSignature = undefined; // força reabsorver no próximo updateView

    this.markHistoricoChanged({ persistir: false, mes: mesDestino });
    this.notifyOutputChanged();
  };

  private handleLoadMore = (): void => {
    const dataset = this.context.parameters.pedidos;
    if (dataset.paging?.hasNextPage) {
      dataset.paging.loadNextPage();
    }
  };

  // ---------------------------------------------------------------------------
  // Dataset → IPedido[]
  // ---------------------------------------------------------------------------

  /**
   * Converte o dataset PCF em uma lista de IPedido tipada.
   * Observação: o PCF expõe `getValue(columnName)` com tipo `unknown`. Fazemos
   * coerção defensiva para string / number / Date conforme o tipo declarado
   * no manifest.
   */
  private mapDatasetToPedidos(
    dataset: ComponentFramework.PropertyTypes.DataSet,
  ): IPedido[] {
    const ids = dataset.sortedRecordIds;
    const pedidos: IPedido[] = new Array(ids.length);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const r = dataset.records[id];
      if (!r) continue;

      const p: IPedido = { id };
      for (const logical of PEDIDO_COLUMNS) {
        const v = r.getValue(logical);
        if (v === null || v === undefined || v === "") continue;
        const field = DATAVERSE_TO_IPEDIDO[logical];
        if (!field) continue;
        assignPedidoColumn(p, field, v);
      }
      // Se a coluna Setor não veio no dataset (comum: esqueceu de marcar no
      // componente) ou ainda está vazia no Dataverse, deduz a partir da Conta
      // contábil para o drawer não reabrir com o campo vazio.
      if (!((p.setor ?? "").trim()) && p.contaContabil) {
        const inferred = findSetorBySubcategoria(p.contaContabil);
        if (inferred) p.setor = inferred;
      }
      pedidos[i] = p;
    }
    return pedidos.filter(Boolean);
  }
}

// -----------------------------------------------------------------------------
// Helpers de coerção (fora da classe para ficar puro/testável)
// -----------------------------------------------------------------------------

/** Chaves em IPedido (nomes da UI), não nomes Dataverse. */
const NUMBER_COLUMNS = new Set<keyof IPedidoData>(["valor"]);
const DATE_COLUMNS = new Set<keyof IPedidoData>(["dataSolicitacao"]);

/**
 * Quando o Canvas envia histórico com meses antigos mas o **mês corrente**
 * falta ou veio como objeto vazio na tabela (Patch incompleto / linha criada
 * pelo slot automático), injeta `orcamentosJson`/`orcamentosContasJson` legados
 * só para essa competência. Antes, qualquer chave em `historicoOrcamentoJson`
 * fazia ignorar o legado por completo — ao dar F5 o orçamento editado sumia.
 */
function historicoComMesAtualDoLegadoSeAusente(
  h: IHistoricoOrcamentos,
  mes: MesISO,
  legacy: IOrcamentosPayload,
): IHistoricoOrcamentos {
  const legacyHasData =
    Object.keys(legacy.setores).length > 0 ||
    Object.keys(legacy.contas).length > 0;
  if (!legacyHasData) return h;

  const slot = h[mes];
  const slotSemOrcamento =
    slot === undefined ||
    (Object.keys(slot.setores).length === 0 &&
      Object.keys(slot.contas).length === 0);

  if (!slotSemOrcamento) return h;
  return setSlotDoMes(h, mes, legacy);
}

function assignPedidoColumn(
  target: IPedido,
  col: keyof IPedidoData,
  raw: unknown,
): void {
  // IPedido não tem index signature por design (preferimos chaves explícitas
  // nas outras partes do código). O dispatch abaixo é o único ponto onde
  // escrevemos dinamicamente pelo nome de coluna; o cast duplo via `unknown`
  // é idiomático aqui.
  const bag = target as unknown as Record<string, unknown>;

  if (NUMBER_COLUMNS.has(col)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!isNaN(n)) bag[col] = n;
    return;
  }
  if (DATE_COLUMNS.has(col)) {
    if (raw instanceof Date) {
      bag[col] = raw;
      return;
    }
    if (typeof raw === "string" || typeof raw === "number") {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) bag[col] = d;
    }
    return;
  }
  bag[col] = String(raw);
}
