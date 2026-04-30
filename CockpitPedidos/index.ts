import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import { Dashboard, IDashboardProps } from "./components/Dashboard";
import {
  DATAVERSE_TO_IPEDIDO,
  emptyOrcamentosPayload,
  IOrcamentosPayload,
  IPedido,
  IPedidoData,
  IEditedPayload,
  PEDIDO_COLUMNS,
} from "./types";
import {
  applyInferredSetorForSave,
  findSetorBySubcategoria,
} from "./constants/setoresOrganizacao";
import {
  buildOrcamentosFromInputs,
  serializeNumberMap,
  serializeOrcamentosPayload,
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

    const raw = context.parameters.orcamentosJson.raw ?? "";
    const rawContas = context.parameters.orcamentosContasJson?.raw ?? "";

    const inputSignature = `${raw}\n${rawContas}`;

    if (inputSignature !== this.cachedInputSignature) {
      const parsed = buildOrcamentosFromInputs(raw, rawContas);
      const incomingEmpty =
        Object.keys(parsed.setores).length === 0 &&
        Object.keys(parsed.contas).length === 0;
      const cacheHasBudgets =
        Object.keys(this.cachedOrcamentos.setores).length > 0 ||
        Object.keys(this.cachedOrcamentos.contas).length > 0;
      const savedAt = this.lastOrcamentosSaved?.at ?? 0;
      const withinGraceMs = 8000;
      const staleEmptyHost =
        incomingEmpty &&
        cacheHasBudgets &&
        Date.now() - savedAt < withinGraceMs &&
        (this.lastInputSignatureAfterSave == null ||
          inputSignature !== this.lastInputSignatureAfterSave);

      // O Canvas costuma reenviar o JSON *antigo* logo após o save, antes do
      // Set/Patch atualizar a variável — isso sobrescrevia o cache otimista e
      // o número na tela "não mudava" na hora.
      const incomingCanon = serializeOrcamentosPayload(parsed);
      const lastJson = this.lastOrcamentosSaved?.json;
      const staleDivergentHost =
        lastJson &&
        Date.now() - savedAt < withinGraceMs &&
        incomingCanon !== lastJson;

      if (!staleEmptyHost && !staleDivergentHost) {
        this.cachedOrcamentos = {
          setores: { ...parsed.setores },
          contas: {
            ...this.cachedOrcamentos.contas,
            ...parsed.contas,
          },
        };
        this.cachedInputSignature = inputSignature;
      }
    }
    const orcamentos = this.cachedOrcamentos;

    const props: IDashboardProps = {
      pedidos,
      orcamentos,
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

    return {
      selectedRecordId: this.selectedRecordId,
      lastEditedJson: this.lastEdited ? JSON.stringify(this.lastEdited) : undefined,
      lastEditedTimestamp: this.lastEdited?.at,
      orcamentosJsonOutput: outFull,
      orcamentosContasJsonOutput: outContas,
      orcamentosUpdatedTimestamp: this.lastOrcamentosSaved?.at,
    };
  }

  public destroy(): void {
    this.lastEdited = undefined;
    this.lastOrcamentosSaved = undefined;
    this.lastInputSignatureAfterSave = undefined;
    this.cachedInputSignature = undefined;
    this.selectedRecordId = undefined;
    this.cachedOrcamentos = emptyOrcamentosPayload();
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
   */
  private handleSaveOrcamentos = (payload: IOrcamentosPayload): void => {
    const next: IOrcamentosPayload = {
      setores: { ...payload.setores },
      contas: { ...payload.contas },
    };
    const json = serializeOrcamentosPayload(next);
    const contasOut = serializeNumberMap(next.contas);
    this.lastInputSignatureAfterSave = `${json}\n${contasOut}`;
    this.lastOrcamentosSaved = { json, at: Date.now(), contasOut };
    this.cachedOrcamentos = next;
    this.cachedInputSignature = this.lastInputSignatureAfterSave;
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
