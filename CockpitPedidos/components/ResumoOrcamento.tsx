import * as React from "react";
import {
  IOrcamentosPayload,
  IPedido,
  ISetorAggregate,
  ISubcategoriaAggregate,
  OrcamentosMap,
} from "../types";
import {
  agregarPorSubcategoria,
  parseOrcamentoValor,
  serializeOrcamentosPayload,
} from "../utils/metrics";
import { getSubcategoriasParaSetor, setorLabelExibicao } from "../constants/setoresOrganizacao";
import { PieChartSubcategorias } from "./PieChartSubcategorias";

export interface IResumoOrcamentoProps {
  orcamentosPayload: IOrcamentosPayload;
  agregados: ReadonlyArray<ISetorAggregate>;
  /** Pedidos completos — necessários para abrir as subcategorias e o gráfico de pizza. */
  pedidos: ReadonlyArray<IPedido>;
  totalOrcamento: number;
  totalRealizado: number;
  totalSaldo: number;
  canEdit?: boolean;
  readOnlyReason?: string;
  onSaveOrcamentos: (payload: IOrcamentosPayload) => void;
}

const formatCurrencyBRL = (n: number): string => {
  if (n === undefined || n === null || isNaN(n)) return "R$ 0,00";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
    }).format(n);
  } catch {
    return `R$ ${n.toFixed(2)}`;
  }
};

const formatCurrencyCompact = (n: number): string => {
  if (isNaN(n)) return "R$ 0";
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R$ ${(n / 1_000).toFixed(1)}k`;
  return formatCurrencyBRL(n);
};

/** Cor da barra conforme % consumido (verde → amarelo → vermelho). */
const percentualColor = (p: number, temOrcamento: boolean): string => {
  if (!temOrcamento) return "var(--owner-auto)";
  if (p >= 100) return "var(--status-danger, #ef4444)";
  if (p >= 80) return "var(--status-analise-fg)";
  return "var(--status-confirmado-fg)";
};

const SubcategoriaItem: React.FC<{
  agg: ISubcategoriaAggregate;
  maxTotal: number;
  editing: boolean;
  onOrcamentoContaChange: (conta: string, n: number) => void;
}> = ({ agg, maxTotal, editing, onOrcamentoContaChange }) => {
  const pct = maxTotal > 0 ? Math.min(100, (agg.total / maxTotal) * 100) : 0;
  const vazio = agg.total === 0 && (agg.orcamento ?? 0) === 0;
  const temOrcConta = (agg.orcamento ?? 0) > 0;
  const pctOrc =
    temOrcConta
      ? Math.min(100, (agg.total / (agg.orcamento ?? 1)) * 100)
      : pct;
  const orcVal = Number.isFinite(agg.orcamento) ? agg.orcamento : 0;
  return (
    <li
      className={`cp-resumo-sub-item${vazio ? " cp-resumo-sub-item--empty" : ""}`}
      data-cp-subconta="1"
    >
      <div className="cp-resumo-sub-head">
        <span className="cp-resumo-sub-name" title={agg.subcategoria}>
          {agg.subcategoria}
        </span>
        <span className="cp-resumo-sub-value" title="Total (realiz.+projet.) na conta">
          {formatCurrencyCompact(agg.total)}
        </span>
      </div>
      <div
        className="cp-resumo-sub-orc-line"
        data-cp-sub-orc="1"
        title={
          editing
            ? "Orçamento alocado a esta conta contábil. Salve no fim com «Salvar» no topo."
            : "Ative «Editar» no topo e edite o valor (R$)."
        }
      >
        <span className="cp-resumo-sub-orc-mono">Orç. desta conta</span>
        <div className="cp-resumo-orcamento-edit">
          <span className="cp-resumo-orcamento-edit-label">R$</span>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            autoComplete="off"
            className="cp-resumo-orcamento-input"
            value={orcVal}
            readOnly={!editing}
            aria-readonly={!editing}
            aria-label={`Orçamento (R$) — conta ${agg.subcategoria}`}
            onChange={(e) => {
              if (!editing) return;
              const v = parseFloat((e.target as HTMLInputElement).value);
              onOrcamentoContaChange(
                agg.subcategoria,
                Number.isFinite(v) ? Math.max(0, v) : 0,
              );
            }}
          />
        </div>
      </div>
      <div className="cp-resumo-sub-bar">
        <div
          className="cp-resumo-sub-bar-fill"
          style={{ width: `${temOrcConta ? pctOrc : pct}%` }}
        />
      </div>
      <div className="cp-resumo-sub-meta">
        <span>
          Realizado {formatCurrencyCompact(agg.realizado)}
          {agg.projetado > 0 ? ` · Projetado ${formatCurrencyCompact(agg.projetado)}` : ""}
          {temOrcConta && !editing
            ? ` · Orç. conta ${formatCurrencyCompact(agg.orcamento)}${
                agg.orcamento > 0
                  ? ` (${Math.min(100, (agg.total / agg.orcamento) * 100).toFixed(0)}% consumido)`
                  : ""
              }`
            : null}
        </span>
        <span>
          {agg.quantidadePedidos} pedido{agg.quantidadePedidos === 1 ? "" : "s"}
        </span>
      </div>
    </li>
  );
};

const SetorRow: React.FC<{
  agg: ISetorAggregate;
  editing: boolean;
  orcamentoDraft: number;
  onOrcamentoChange: (n: number) => void;
  contasMerged: Readonly<Record<string, number>>;
  onContaChange: (conta: string, n: number) => void;
  pedidos: ReadonlyArray<IPedido>;
  expandido: boolean;
  onToggleExpand: () => void;
  onAbrirPizza: () => void;
}> = ({
  agg,
  editing,
  orcamentoDraft,
  onOrcamentoChange,
  contasMerged,
  onContaChange,
  pedidos,
  expandido,
  onToggleExpand,
  onAbrirPizza,
}) => {
  const temOrcamento = agg.orcamento > 0;
  const barColor = percentualColor(agg.percentualConsumido, temOrcamento);
  const overflow = temOrcamento && agg.realizado > agg.orcamento;

  const subcategorias = React.useMemo<ISubcategoriaAggregate[]>(() => {
    if (!expandido) return [];
    const base = getSubcategoriasParaSetor(agg.setor);
    return agregarPorSubcategoria(
      pedidos as IPedido[],
      agg.setor,
      base,
      contasMerged,
    );
  }, [expandido, pedidos, agg.setor, contasMerged]);

  const maxTotal = React.useMemo(
    () =>
      subcategorias.reduce(
        (m, s) => Math.max(m, s.total, s.orcamento ?? 0),
        0,
      ),
    [subcategorias],
  );

  const setorRotulo = setorLabelExibicao(agg.setor);

  return (
    <div className={`cp-resumo-row${expandido ? " cp-resumo-row--open" : ""}`}>
      <div className="cp-resumo-row-head">
        <button
          type="button"
          className="cp-resumo-row-expand"
          onClick={onToggleExpand}
          aria-expanded={expandido}
          aria-label={
            expandido
              ? `Recolher subcategorias de ${setorRotulo}`
              : `Ver subcategorias de ${setorRotulo}`
          }
        >
          <span className="cp-resumo-row-chevron" aria-hidden="true">
            {expandido ? "▾" : "▸"}
          </span>
          <span className="cp-resumo-row-title" title={setorRotulo}>
            {setorRotulo}
          </span>
        </button>
        <div className="cp-resumo-row-actions">
          <span className="cp-resumo-row-count">
            {agg.quantidadePedidos} pedido{agg.quantidadePedidos === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="cp-resumo-row-pie"
            onClick={onAbrirPizza}
            title={`Ver gráfico de pizza por conta contábil — ${setorRotulo}`}
            aria-label={`Abrir gráfico de pizza do setor ${setorRotulo}`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5H8V1.5z"
                fill="currentColor"
                opacity="0.85"
              />
              <path
                d="M9 1.5V7h5.5A6.5 6.5 0 0 0 9 1.5z"
                fill="currentColor"
              />
            </svg>
            Pizza
          </button>
        </div>
      </div>

      <div className="cp-resumo-row-numbers">
        <span className="cp-resumo-realizado">{formatCurrencyCompact(agg.realizado)}</span>
        <span className="cp-resumo-separator">/</span>
        {editing ? (
          <label className="cp-resumo-orcamento-edit">
            <span className="cp-resumo-orcamento-edit-label">R$</span>
            <input
              type="number"
              className="cp-resumo-orcamento-input"
              min={0}
              step="any"
              inputMode="decimal"
              value={Number.isFinite(orcamentoDraft) ? orcamentoDraft : 0}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onOrcamentoChange(Number.isFinite(v) ? Math.max(0, v) : 0);
              }}
              aria-label={`Orçamento do setor ${setorRotulo}`}
            />
          </label>
        ) : (
          <span className="cp-resumo-orcamento">
            {temOrcamento ? formatCurrencyCompact(agg.orcamento) : "sem orçamento"}
          </span>
        )}
      </div>

      <div className="cp-resumo-bar">
        <div
          className="cp-resumo-bar-fill"
          style={{
            width: `${Math.min(100, agg.percentualConsumido)}%`,
            background: barColor,
          }}
        />
      </div>

      <div className="cp-resumo-row-foot">
        <span className="cp-resumo-pct">
          {temOrcamento ? `${agg.percentualConsumido.toFixed(1)}% consumido` : "—"}
        </span>
        <span className={`cp-resumo-saldo${overflow ? " cp-resumo-saldo-negative" : ""}`}>
          Saldo: {formatCurrencyCompact(agg.saldo)}
        </span>
      </div>

      {expandido && (
        <div className="cp-resumo-sub-wrap">
          {editing && subcategorias.length > 0 && (
            <p className="cp-resumo-sub-hint" role="status">
              Ajuste o orçamento <strong>por conta contábil</strong> (campos R$) em cada linha; no
              fim use <strong>Salvar</strong> no topo do painel.
            </p>
          )}
          {subcategorias.length === 0 ? (
            <div className="cp-resumo-sub-empty">
              Nenhuma conta contábil cadastrada para este setor.
            </div>
          ) : (
            <ul className="cp-resumo-sub-list" key={editing ? "modo-edicao" : "modo-leitura"}>
              {subcategorias.map((s) => (
                <SubcategoriaItem
                  key={s.subcategoria}
                  agg={s}
                  maxTotal={maxTotal}
                  editing={editing}
                  onOrcamentoContaChange={onContaChange}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
SetorRow.displayName = "SetorRow";

function buildVisualAggregates(
  agregados: ReadonlyArray<ISetorAggregate>,
  editing: boolean,
  draft: Record<string, number>,
): ISetorAggregate[] {
  return agregados.map((a) => {
    const orc = editing ? (draft[a.setor] ?? a.orcamento) : a.orcamento;
    const saldo = orc - a.realizado;
    const percentualConsumido =
      orc > 0 ? Math.min(100, (a.realizado / orc) * 100) : 0;
    return {
      ...a,
      orcamento: orc,
      saldo,
      percentualConsumido,
    };
  });
}

export const ResumoOrcamento: React.FC<IResumoOrcamentoProps> = ({
  orcamentosPayload,
  agregados,
  pedidos,
  totalOrcamento,
  totalRealizado,
  totalSaldo: _totalSaldo,
  canEdit = true,
  readOnlyReason,
  onSaveOrcamentos,
}) => {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, number>>({});
  const [draftContas, setDraftContas] = React.useState<Record<string, number>>({});
  const [expandedSetor, setExpandedSetor] = React.useState<string | null>(null);
  const [pieSetor, setPieSetor] = React.useState<string | null>(null);

  const payloadSig = React.useMemo(
    () => serializeOrcamentosPayload(orcamentosPayload),
    [orcamentosPayload],
  );

  const agregadosRef = React.useRef(agregados);
  const orcamentosPayloadRef = React.useRef(orcamentosPayload);
  agregadosRef.current = agregados;
  orcamentosPayloadRef.current = orcamentosPayload;

  const setorListKey = React.useMemo(
    () => agregados.map((a) => a.setor).join("\0"),
    [agregados],
  );

  /** Alinha rascunho quando o JSON do servidor muda e não estamos em edição. */
  React.useLayoutEffect(() => {
    if (editing) return;
    const ag = agregadosRef.current;
    const op = orcamentosPayloadRef.current;
    const d: Record<string, number> = {};
    ag.forEach((a) => {
      const fromPayload = op.setores[a.setor];
      d[a.setor] = Number.isFinite(fromPayload)
        ? (fromPayload as number)
        : a.orcamento;
    });
    setDraft(d);
    setDraftContas({ ...op.contas });
  }, [payloadSig, editing]);

  /** Novos setores sem mudança no JSON gravado. */
  React.useLayoutEffect(() => {
    if (editing) return;
    setDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      const ag = agregadosRef.current;
      const op = orcamentosPayloadRef.current;
      ag.forEach((a) => {
        if (next[a.setor] === undefined) {
          const fromPayload = op.setores[a.setor];
          next[a.setor] = Number.isFinite(fromPayload)
            ? (fromPayload as number)
            : a.orcamento;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [setorListKey, editing]);

  const contasMerged = React.useMemo(
    () => ({ ...orcamentosPayload.contas, ...draftContas }),
    [orcamentosPayload.contas, draftContas],
  );

  const rowsVisual = React.useMemo(
    () => buildVisualAggregates(agregados, editing, draft),
    [agregados, editing, draft],
  );

  const totalOrcVis = React.useMemo(() => {
    if (!editing) return totalOrcamento;
    return agregados.reduce((s, a) => s + (draft[a.setor] ?? a.orcamento), 0);
  }, [editing, agregados, draft, totalOrcamento]);

  const totalSaldoVis = React.useMemo(
    () => totalOrcVis - totalRealizado,
    [totalOrcVis, totalRealizado],
  );

  const temOrcamentoGlobal = totalOrcVis > 0;
  const pctGlobal =
    temOrcamentoGlobal ? Math.min(100, (totalRealizado / totalOrcVis) * 100) : 0;

  const startEditing = React.useCallback(() => {
    const d: Record<string, number> = {};
    agregados.forEach((a) => {
      d[a.setor] = a.orcamento;
    });
    setDraft(d);
    setDraftContas({ ...orcamentosPayload.contas });
    setEditing(true);
  }, [agregados, orcamentosPayload.contas]);

  const cancelEditing = React.useCallback(() => {
    setEditing(false);
    setDraft({});
    setDraftContas({});
  }, []);

  const saveEditing = React.useCallback(() => {
    const setores: OrcamentosMap = {};
    agregados.forEach((a) => {
      const raw = draft[a.setor] ?? a.orcamento;
      const n = parseOrcamentoValor(raw);
      setores[a.setor] =
        n !== undefined && n >= 0 ? Math.max(0, n) : 0;
    });
    const merged: Record<string, number | string> = {
      ...orcamentosPayload.contas,
      ...draftContas,
    };
    const contas: Record<string, number> = {};
    Object.keys(merged).forEach((k) => {
      // Não usar Number.isFinite(v) em bruto: valores vindos do JSON/Dataverse
      // podem ser string ("12345") e seriam descartados — contas não gravavam.
      const n = parseOrcamentoValor(merged[k]);
      if (n !== undefined && n >= 0) contas[k] = n;
    });
    onSaveOrcamentos({ setores, contas });
    setEditing(false);
    setDraft({});
    setDraftContas({});
  }, [agregados, draft, draftContas, onSaveOrcamentos, orcamentosPayload.contas]);

  const temLinhas = agregados.length > 0;
  const podeEditar = canEdit && temLinhas;

  const pieAgregados = React.useMemo<ISubcategoriaAggregate[]>(() => {
    if (!pieSetor) return [];
    const base = getSubcategoriasParaSetor(pieSetor);
    return agregarPorSubcategoria(
      pedidos as IPedido[],
      pieSetor,
      base,
      contasMerged,
    );
  }, [pieSetor, pedidos, contasMerged]);

  const orcamentosVazios =
    Object.keys(orcamentosPayload.setores).length === 0 &&
    Object.keys(orcamentosPayload.contas).length === 0;

  return (
    <div className="cp-resumo">
      <header
        className="cp-dash-panel-head cp-dash-panel-head--resumo"
        aria-labelledby="cp-panel-resumo-title"
      >
        <div className="cp-dash-panel-head-top">
          <h2 id="cp-panel-resumo-title" className="cp-dash-panel-title">
            Resumo de orçamento por setor
          </h2>
          {podeEditar && (
            <div className="cp-resumo-head-actions" role="toolbar" aria-label="Ações de orçamento">
              {!editing ? (
                <button
                  type="button"
                  className="cp-btn cp-btn-ghost cp-btn-sm"
                  onClick={startEditing}
                  title="Editar orçamentos (setor e contas)"
                >
                  Editar
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="cp-btn cp-btn-primary cp-btn-sm"
                    onClick={saveEditing}
                    title="Aplicar alterações de orçamento"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="cp-btn cp-btn-ghost cp-btn-sm"
                    onClick={cancelEditing}
                  >
                    Cancelar
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {!canEdit && readOnlyReason && (
          <div className="cp-dash-panel-hint">{readOnlyReason}</div>
        )}
        {orcamentosVazios && canEdit && (
          <div className="cp-dash-panel-hint">
            Orçamentos ainda vazios: use <strong>Editar</strong> acima
            ou injete <code>orcamentosJson</code> no Canvas. No OnChange de{" "}
            <code>orcamentosJsonOutput</code>, faça <code>Set</code> na variável ligada a{" "}
            <code>orcamentosJson</code>.
          </div>
        )}
      </header>

      <div className="cp-resumo-totals">
        <div className="cp-resumo-total">
          <span className="cp-resumo-total-label">Orçamento</span>
          <span className="cp-resumo-total-value">{formatCurrencyCompact(totalOrcVis)}</span>
        </div>
        <div className="cp-resumo-total">
          <span className="cp-resumo-total-label">Realizado</span>
          <span className="cp-resumo-total-value cp-resumo-total-value-accent">
            {formatCurrencyCompact(totalRealizado)}
          </span>
        </div>
        <div className="cp-resumo-total">
          <span className="cp-resumo-total-label">Saldo</span>
          <span
            className={`cp-resumo-total-value${totalSaldoVis < 0 ? " cp-resumo-saldo-negative" : ""}`}
          >
            {formatCurrencyCompact(totalSaldoVis)}
          </span>
        </div>
      </div>

      {temOrcamentoGlobal && (
        <div className="cp-resumo-global-bar" aria-label="Consumo total do orçamento">
          <div className="cp-resumo-global-bar-fill" style={{ width: `${pctGlobal}%` }} />
        </div>
      )}

      <div className="cp-resumo-divider" />

      <div className="cp-resumo-list">
        {!temLinhas ? (
          <div className="cp-resumo-empty">
            Nenhum setor cadastrado ainda.
            <br />
            <small>
              Edite um pedido e informe o campo <em>Setor</em> para popular este painel.
            </small>
          </div>
        ) : (
          rowsVisual.map((agg) => (
            <SetorRow
              key={agg.setor}
              agg={agg}
              editing={editing}
              orcamentoDraft={draft[agg.setor] ?? agg.orcamento}
              onOrcamentoChange={(n) =>
                setDraft((prev) => ({
                  ...prev,
                  [agg.setor]: n,
                }))
              }
              contasMerged={contasMerged}
              onContaChange={(conta, n) =>
                setDraftContas((prev) => ({ ...prev, [conta]: n }))
              }
              pedidos={pedidos}
              expandido={expandedSetor === agg.setor}
              onToggleExpand={() =>
                setExpandedSetor((cur) => (cur === agg.setor ? null : agg.setor))
              }
              onAbrirPizza={() => setPieSetor(agg.setor)}
            />
          ))
        )}
      </div>

      {pieSetor && (
        <PieChartSubcategorias
          setor={pieSetor}
          agregados={pieAgregados}
          onClose={() => setPieSetor(null)}
        />
      )}
    </div>
  );
};

export default ResumoOrcamento;
