import * as React from "react";
import { ChartMetric, IOrcamentosPayload, IPedido, ISetorAggregate, OrcamentosMap } from "../types";
import {
  agregarPorContaContabil,
  agregarPorMes,
  agregarPorResponsavel,
  agregarPorStatus,
  agregarTopPedidos,
  totaisProjecao,
} from "../utils/metrics";
import { findSetorBySubcategoria, getSubcategoriasParaSetor, setorLabelExibicao } from "../constants/setoresOrganizacao";

export interface IGraficosBarrasProps {
  pedidos: ReadonlyArray<IPedido>;
  agregadosSetor: ReadonlyArray<ISetorAggregate>;
  /** Orçamentos (setores + contas) — KPIs usam só o teto por setor. */
  orcamentos: IOrcamentosPayload;
}

interface IMetricOption {
  id: ChartMetric;
  label: string;
  description: string;
  icon: string;
}

const METRICS: ReadonlyArray<IMetricOption> = [
  {
    id: "orcamento-vs-realizado",
    label: "Orçado × Realizado × Saldo",
    description: "Por setor — só Confirmados consomem orçamento.",
    icon: "📊",
  },
  {
    id: "orcamento-vs-projetado",
    label: "Orçado × Realizado × Saldo Projetado",
    description: "Inclui Em Análise + Novo — projeção do impacto se tudo for aprovado.",
    icon: "🧭",
  },
  {
    id: "orcamento-vs-realizado-contas",
    label: "Contas: Orçado × Realizado × Saldo",
    description: "Por conta contábil — só Confirmados consomem o orçamento da conta (mapa orçamentos.contas).",
    icon: "📒",
  },
  {
    id: "orcamento-vs-projetado-contas",
    label: "Contas: Orçado × Projetado",
    description: "Por conta contábil — projeção se pedidos pendentes forem aprovados.",
    icon: "🧾",
  },
  {
    id: "qtd-por-status",
    label: "Pedidos por Status",
    description: "Distribuição: Novo / Em Análise / Confirmado.",
    icon: "🏷️",
  },
  {
    id: "evolucao-mensal",
    label: "Evolução Mensal",
    description: "Valor total dos pedidos ao longo do tempo.",
    icon: "📈",
  },
  {
    id: "qtd-por-responsavel",
    label: "Por Responsável",
    description: "Carga de pedidos por aprovador.",
    icon: "👥",
  },
  {
    id: "top-pedidos",
    label: "Top 10 Pedidos",
    description: "Maiores pedidos — onde o orçamento mais pesa.",
    icon: "🏆",
  },
];

// =============================================================================
// Helpers de formatação
// =============================================================================

const formatBRL = (n: number): string => {
  if (!Number.isFinite(n)) return "R$ 0,00";
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
  if (!Number.isFinite(n)) return "R$ 0";
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R$ ${(n / 1_000).toFixed(1)}k`;
  return `R$ ${n.toFixed(0)}`;
};

const formatPct = (n: number, digits: number = 1): string => {
  if (!Number.isFinite(n)) return "0%";
  return `${n.toFixed(digits)}%`;
};

// =============================================================================
// Eixo Y "humanizado": calcula ticks bonitos para o intervalo dado.
// =============================================================================

const niceStep = (raw: number): number => {
  if (raw <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const mantissa = raw / exp;
  const niceM = mantissa < 1.5 ? 1 : mantissa < 3 ? 2 : mantissa < 7 ? 5 : 10;
  return niceM * exp;
};

const buildTicks = (max: number, target: number = 4): number[] => {
  if (max <= 0) return [0];
  const step = niceStep(max / target);
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) {
    ticks.push(v);
    if (ticks.length > 12) break;
  }
  return ticks;
};

// =============================================================================
// Cores — ligadas ao tema via CSS vars.
// =============================================================================

const COLORS = {
  orcamento: "#9aa0a6",
  realizado: "#22c55e",
  saldo: "#06b6d4",
  saldoNeg: "#ef4444",
  emAnalise: "#f59e0b",
  novo: "#7c5cff",
  alert: "#ef4444",
  accent: "#7c5cff",
};

const STATUS_COLORS: Record<string, string> = {
  novo: COLORS.novo,
  "em análise": COLORS.emAnalise,
  "em analise": COLORS.emAnalise,
  confirmado: COLORS.realizado,
  cancelado: "#9aa0a6",
};

// =============================================================================
// Empty state
// =============================================================================

const EmptyChart: React.FC<{ label: string }> = ({ label }) => (
  <div className="cp-chart-empty">
    <span className="cp-chart-empty-icon" aria-hidden="true">📉</span>
    <span>{label}</span>
  </div>
);

// =============================================================================
// Filtro de setores (multi-select) — local ao painel de gráficos.
// Permite Luciano/Luciana focar em 1 setor, em vários setores ou comparar
// dois setores lado a lado, sem alterar os filtros globais do dashboard.
// =============================================================================

const setorEfetivoDe = (p: IPedido): string =>
  (p.setor ?? "").trim() || findSetorBySubcategoria(p.contaContabil) || "";

interface IChipFiltroSetorProps {
  setoresDisponiveis: ReadonlyArray<string>;
  selecionados: ReadonlySet<string>;
  onToggle: (setor: string) => void;
  onSelecionarTodos: () => void;
  onLimpar: () => void;
  totalPedidosVisiveis: number;
  totalPedidosOriginal: number;
  valorTotalVisivel: number;
}

const ChipFiltroSetor: React.FC<IChipFiltroSetorProps> = ({
  setoresDisponiveis,
  selecionados,
  onToggle,
  onSelecionarTodos,
  onLimpar,
  totalPedidosVisiveis,
  totalPedidosOriginal,
  valorTotalVisivel,
}) => {
  const todos = selecionados.size === 0;
  const qtdSel = selecionados.size;

  return (
    <div className="cp-chart-filter" role="group" aria-label="Filtrar setores nos gráficos">
      <div className="cp-chart-filter-head">
        <span className="cp-chart-filter-title">Foco da análise</span>
        <span className="cp-chart-filter-summary">
          {todos
            ? `Todos os setores · ${totalPedidosOriginal} pedido${totalPedidosOriginal === 1 ? "" : "s"}`
            : `${qtdSel} setor${qtdSel === 1 ? "" : "es"} · ${totalPedidosVisiveis} pedido${totalPedidosVisiveis === 1 ? "" : "s"} · ${formatCurrencyCompact(valorTotalVisivel)}`}
        </span>
      </div>
      <div className="cp-chart-filter-chips">
        <button
          type="button"
          className={`cp-chart-chip cp-chart-chip--all${todos ? " cp-chart-chip--active" : ""}`}
          onClick={onSelecionarTodos}
          aria-pressed={todos}
          title="Mostrar todos os setores"
        >
          Todos
        </button>
        {setoresDisponiveis.map((s) => {
          const ativo = selecionados.has(s);
          const rotulo = setorLabelExibicao(s);
          return (
            <button
              key={s}
              type="button"
              className={`cp-chart-chip${ativo ? " cp-chart-chip--active" : ""}`}
              onClick={() => onToggle(s)}
              aria-pressed={ativo}
              title={
                ativo
                  ? `Remover ${rotulo} do foco`
                  : `Adicionar ${rotulo} ao foco (clique para incluir)`
              }
            >
              <span className="cp-chart-chip-dot" aria-hidden="true" />
              {rotulo}
            </button>
          );
        })}
        {!todos && (
          <button
            type="button"
            className="cp-chart-chip cp-chart-chip--clear"
            onClick={onLimpar}
            title="Limpar seleção"
          >
            Limpar
          </button>
        )}
      </div>
      {qtdSel === 2 && (
        <div className="cp-chart-filter-hint">
          Modo comparação: visualizando os dois setores selecionados lado a lado.
        </div>
      )}
    </div>
  );
};

// =============================================================================
// KPI strip — visão executiva sempre visível no topo do painel
// =============================================================================

const Kpi: React.FC<{
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "danger" | "accent";
}> = ({ label, value, hint, tone = "neutral" }) => (
  <div className={`cp-chart-kpi cp-chart-kpi--${tone}`}>
    <div className="cp-chart-kpi-label">{label}</div>
    <div className="cp-chart-kpi-value">{value}</div>
    {hint && <div className="cp-chart-kpi-hint">{hint}</div>}
  </div>
);

const KpiStrip: React.FC<{
  pedidos: ReadonlyArray<IPedido>;
  orcamentos: OrcamentosMap;
}> = ({ pedidos, orcamentos }) => {
  const t = React.useMemo(
    () => totaisProjecao(pedidos as IPedido[], orcamentos),
    [pedidos, orcamentos],
  );

  const saldoProjTone =
    t.saldoProjetadoTotal < 0
      ? "danger"
      : t.percentualComprometido >= 80
        ? "warn"
        : "good";

  const compromTone =
    t.percentualComprometido > 100
      ? "danger"
      : t.percentualComprometido >= 80
        ? "warn"
        : "neutral";

  return (
    <div className="cp-chart-kpis" role="group" aria-label="Indicadores executivos">
      <Kpi label="Orçamento" value={formatCurrencyCompact(t.orcamentoTotal)} tone="neutral" />
      <Kpi
        label="Realizado"
        value={formatCurrencyCompact(t.realizadoTotal)}
        hint={
          t.orcamentoTotal > 0
            ? `${formatPct(t.percentualConsumido)} consumido`
            : `${t.qtdConfirmado} confirmados`
        }
        tone="good"
      />
      <Kpi
        label="Em Análise"
        value={formatCurrencyCompact(t.emAnaliseTotal)}
        hint={`${t.qtdEmAnalise} pedido${t.qtdEmAnalise === 1 ? "" : "s"}`}
        tone="warn"
      />
      <Kpi
        label="Novos"
        value={formatCurrencyCompact(t.novoTotal)}
        hint={`${t.qtdNovo} pedido${t.qtdNovo === 1 ? "" : "s"}`}
        tone="accent"
      />
      <Kpi
        label="Comprometido"
        value={formatCurrencyCompact(t.comprometidoTotal)}
        hint={
          t.orcamentoTotal > 0
            ? `${formatPct(t.percentualComprometido)} do orçamento`
            : "—"
        }
        tone={compromTone}
      />
      <Kpi
        label="Saldo Projetado"
        value={formatCurrencyCompact(t.saldoProjetadoTotal)}
        hint={
          t.saldoProjetadoTotal < 0
            ? "Excede orçamento se tudo aprovar"
            : "Sobra após tudo aprovar"
        }
        tone={saldoProjTone}
      />
    </div>
  );
};

// =============================================================================
// Subgráfico 1: Orçado × Realizado × Saldo (SVG agrupado)
// =============================================================================

interface IGroupedBarsProps {
  setores: ReadonlyArray<ISetorAggregate>;
  /** Quais valores extrair de cada agregado. */
  series: ReadonlyArray<{
    key: keyof ISetorAggregate;
    label: string;
    color: string;
    /** Quando true (saldo), valores negativos viram vermelho e usam |valor| no eixo. */
    signed?: boolean;
  }>;
  emptyMessage?: string;
  /** Comprimento máximo no eixo X (contas longas precisam mais caracteres visíveis). */
  xLabelMax?: number;
  ariaLabel?: string;
}

const GroupedBarsSvg: React.FC<IGroupedBarsProps> = ({
  setores,
  series,
  emptyMessage = "Sem setores cadastrados ainda.",
  xLabelMax = 14,
  ariaLabel = "Gráfico de barras por setor",
}) => {
  if (setores.length === 0) {
    return <EmptyChart label={emptyMessage} />;
  }

  // Geometria do gráfico — escala via viewBox para acompanhar o container.
  const PADDING = { top: 14, right: 14, bottom: 56, left: 64 };
  const HEIGHT = 320;
  const PER_GROUP_WIDTH = 110;
  const innerW = Math.max(560, setores.length * PER_GROUP_WIDTH);
  const W = innerW + PADDING.left + PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  const maxValor = Math.max(
    1,
    ...setores.flatMap((d) =>
      series.map((s) => Math.abs((d[s.key] as number) ?? 0)),
    ),
  );
  const ticks = buildTicks(maxValor, 4);
  const yMax = ticks[ticks.length - 1] || maxValor;

  const yFor = (v: number) => PADDING.top + innerH * (1 - v / yMax);
  const xFor = (gi: number) => PADDING.left + gi * PER_GROUP_WIDTH + 6;

  const groupInnerW = PER_GROUP_WIDTH - 12;
  const barW = Math.max(10, Math.min(28, groupInnerW / series.length - 6));
  const barGap = (groupInnerW - barW * series.length) / (series.length + 1);

  return (
    <div className="cp-chart-svg-wrap">
      <div className="cp-chart-legend">
        {series.map((s) => (
          <span key={s.key as string} className="cp-chart-legend-item">
            <span
              className="cp-chart-sw"
              style={{ background: s.color }}
              aria-hidden="true"
            />
            {s.label}
          </span>
        ))}
      </div>

      <div className="cp-chart-svg-scroll">
        <svg
          className="cp-chart-svg"
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width={W}
          height={HEIGHT}
          role="img"
          aria-label={ariaLabel}
        >
          {/* Grade horizontal + eixo Y */}
          {ticks.map((t) => (
            <g key={`tick-${t}`}>
              <line
                x1={PADDING.left}
                x2={W - PADDING.right}
                y1={yFor(t)}
                y2={yFor(t)}
                className="cp-chart-grid"
              />
              <text
                x={PADDING.left - 8}
                y={yFor(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="cp-chart-axis-text"
              >
                {formatCurrencyCompact(t)}
              </text>
            </g>
          ))}
          {/* Eixo X */}
          <line
            x1={PADDING.left}
            x2={W - PADDING.right}
            y1={HEIGHT - PADDING.bottom}
            y2={HEIGHT - PADDING.bottom}
            className="cp-chart-axis"
          />

          {/* Grupos (um por setor) */}
          {setores.map((d, gi) => {
            const gx = xFor(gi);
            const rotuloSetor = setorLabelExibicao(d.setor);
            return (
              <g key={d.setor} className="cp-chart-vgroup">
                {series.map((s, si) => {
                  const raw = (d[s.key] as number) ?? 0;
                  const isNeg = !!s.signed && raw < 0;
                  const v = Math.abs(raw);
                  const h = yMax > 0 ? (v / yMax) * innerH : 0;
                  const x = gx + barGap + si * (barW + barGap);
                  const y = HEIGHT - PADDING.bottom - h;
                  const fill = isNeg ? COLORS.saldoNeg : s.color;
                  return (
                    <g key={s.key as string}>
                      <rect
                        x={x}
                        y={y}
                        width={barW}
                        height={Math.max(1, h)}
                        rx={3}
                        ry={3}
                        fill={fill}
                        className="cp-chart-svg-bar"
                      >
                        <title>
                          {`${rotuloSetor}\n${s.label}: ${formatBRL(raw)}`}
                        </title>
                      </rect>
                      {h > 18 && (
                        <text
                          x={x + barW / 2}
                          y={y - 4}
                          textAnchor="middle"
                          className={`cp-chart-bar-label${isNeg ? " cp-chart-bar-label--neg" : ""}`}
                        >
                          {formatCurrencyCompact(raw)}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Label do setor */}
                <text
                  x={gx + groupInnerW / 2 + 6}
                  y={HEIGHT - PADDING.bottom + 14}
                  textAnchor="middle"
                  className="cp-chart-x-label"
                >
                  {truncate(rotuloSetor, xLabelMax)}
                </text>
                <text
                  x={gx + groupInnerW / 2 + 6}
                  y={HEIGHT - PADDING.bottom + 28}
                  textAnchor="middle"
                  className="cp-chart-x-sublabel"
                >
                  {d.quantidadePedidos} pedido{d.quantidadePedidos === 1 ? "" : "s"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

// =============================================================================
// Subgráfico 2: Orçado × Comprometido (stacked) × Saldo Projetado
// =============================================================================

const ProjecaoBarsSvg: React.FC<{
  setores: ReadonlyArray<ISetorAggregate>;
  emptyMessage?: string;
  xLabelMax?: number;
  ariaLabel?: string;
}> = ({
  setores,
  emptyMessage = "Sem setores cadastrados ainda.",
  xLabelMax = 16,
  ariaLabel = "Projeção orçamentária por setor",
}) => {
  if (setores.length === 0) {
    return <EmptyChart label={emptyMessage} />;
  }

  const PADDING = { top: 14, right: 14, bottom: 60, left: 64 };
  const HEIGHT = 340;
  const PER_GROUP_WIDTH = 130;
  const innerW = Math.max(640, setores.length * PER_GROUP_WIDTH);
  const W = innerW + PADDING.left + PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  const maxValor = Math.max(
    1,
    ...setores.flatMap((d) => [
      d.orcamento,
      d.comprometido,
      Math.abs(d.saldoProjetado),
    ]),
  );
  const ticks = buildTicks(maxValor, 4);
  const yMax = ticks[ticks.length - 1] || maxValor;

  const yFor = (v: number) => PADDING.top + innerH * (1 - v / yMax);
  const xFor = (gi: number) => PADDING.left + gi * PER_GROUP_WIDTH + 6;

  const groupInnerW = PER_GROUP_WIDTH - 12;
  // 3 barras por setor (Orç, Compromet, Saldo Proj) — barras ligeiramente largas.
  const barW = Math.max(14, Math.min(34, groupInnerW / 3 - 8));
  const barGap = (groupInnerW - barW * 3) / 4;

  return (
    <div className="cp-chart-svg-wrap">
      <div className="cp-chart-legend">
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: COLORS.orcamento }} aria-hidden="true" />
          Orçamento
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: COLORS.realizado }} aria-hidden="true" />
          Realizado (Confirmado)
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: COLORS.emAnalise }} aria-hidden="true" />
          Em Análise
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: COLORS.novo }} aria-hidden="true" />
          Novo
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: COLORS.saldo }} aria-hidden="true" />
          Saldo Projetado
        </span>
      </div>

      <div className="cp-chart-svg-scroll">
        <svg
          className="cp-chart-svg"
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width={W}
          height={HEIGHT}
          role="img"
          aria-label={ariaLabel}
        >
          {ticks.map((t) => (
            <g key={`tick-${t}`}>
              <line
                x1={PADDING.left}
                x2={W - PADDING.right}
                y1={yFor(t)}
                y2={yFor(t)}
                className="cp-chart-grid"
              />
              <text
                x={PADDING.left - 8}
                y={yFor(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="cp-chart-axis-text"
              >
                {formatCurrencyCompact(t)}
              </text>
            </g>
          ))}
          <line
            x1={PADDING.left}
            x2={W - PADDING.right}
            y1={HEIGHT - PADDING.bottom}
            y2={HEIGHT - PADDING.bottom}
            className="cp-chart-axis"
          />

          {setores.map((d, gi) => {
            const gx = xFor(gi);
            const rotuloSetor = setorLabelExibicao(d.setor);

            // Barra 1 — Orçamento
            const x1 = gx + barGap;
            const h1 = (d.orcamento / yMax) * innerH;
            const y1 = HEIGHT - PADDING.bottom - h1;

            // Barra 2 — Comprometido (empilhado: Realizado / EmAnálise / Novo)
            const x2 = x1 + barW + barGap;
            // Cada segmento é proporcional ao seu valor; topo da barra = comprometido.
            const segs = [
              { k: "real", v: d.realizado, color: COLORS.realizado, label: "Realizado" },
              { k: "anal", v: d.emAnalise, color: COLORS.emAnalise, label: "Em Análise" },
              { k: "novo", v: d.novo, color: COLORS.novo, label: "Novo" },
            ].filter((s) => s.v > 0);
            const hCompr = (d.comprometido / yMax) * innerH;
            const yComprTop = HEIGHT - PADDING.bottom - hCompr;
            const stackOverflow = d.orcamento > 0 && d.comprometido > d.orcamento;

            // Barra 3 — Saldo Projetado (verde se positivo, vermelho se negativo)
            const x3 = x2 + barW + barGap;
            const sp = d.saldoProjetado;
            const h3 = (Math.abs(sp) / yMax) * innerH;
            const y3 = HEIGHT - PADDING.bottom - h3;
            const c3 = sp < 0 ? COLORS.saldoNeg : COLORS.saldo;

            // Linha de referência do orçamento dentro do grupo (auxilia leitura)
            const showOrcLine = d.orcamento > 0;

            return (
              <g key={d.setor}>
                {/* Orçamento */}
                <rect
                  x={x1}
                  y={y1}
                  width={barW}
                  height={Math.max(1, h1)}
                  rx={3}
                  ry={3}
                  fill={COLORS.orcamento}
                  opacity={0.85}
                  className="cp-chart-svg-bar"
                >
                  <title>{`${rotuloSetor}\nOrçamento: ${formatBRL(d.orcamento)}`}</title>
                </rect>

                {/* Comprometido (stacked) */}
                {(() => {
                  let yCursor = HEIGHT - PADDING.bottom;
                  return segs.map((s, idx) => {
                    const segH = (s.v / yMax) * innerH;
                    const yTop = yCursor - segH;
                    const rect = (
                      <rect
                        key={s.k}
                        x={x2}
                        y={yTop}
                        width={barW}
                        height={Math.max(1, segH)}
                        fill={s.color}
                        rx={idx === segs.length - 1 ? 3 : 0}
                        ry={idx === segs.length - 1 ? 3 : 0}
                        className="cp-chart-svg-bar"
                      >
                        <title>{`${rotuloSetor}\n${s.label}: ${formatBRL(s.v)}`}</title>
                      </rect>
                    );
                    yCursor = yTop;
                    return rect;
                  });
                })()}
                {/* Linha pontilhada do orçamento sobre a barra de Comprometido */}
                {showOrcLine && (
                  <line
                    x1={x2 - 2}
                    x2={x2 + barW + 2}
                    y1={y1}
                    y2={y1}
                    className="cp-chart-ref-line"
                  />
                )}
                {/* Tag superior da barra de Comprometido */}
                {hCompr > 18 && (
                  <text
                    x={x2 + barW / 2}
                    y={yComprTop - 4}
                    textAnchor="middle"
                    className={`cp-chart-bar-label${stackOverflow ? " cp-chart-bar-label--neg" : ""}`}
                  >
                    {formatCurrencyCompact(d.comprometido)}
                    {stackOverflow ? " ⚠" : ""}
                  </text>
                )}

                {/* Saldo Projetado */}
                <rect
                  x={x3}
                  y={y3}
                  width={barW}
                  height={Math.max(1, h3)}
                  rx={3}
                  ry={3}
                  fill={c3}
                  className="cp-chart-svg-bar"
                >
                  <title>{`${rotuloSetor}\nSaldo Projetado: ${formatBRL(sp)}${sp < 0 ? "  (excede orçamento)" : ""}`}</title>
                </rect>
                {h3 > 18 && (
                  <text
                    x={x3 + barW / 2}
                    y={y3 - 4}
                    textAnchor="middle"
                    className={`cp-chart-bar-label${sp < 0 ? " cp-chart-bar-label--neg" : ""}`}
                  >
                    {formatCurrencyCompact(sp)}
                  </text>
                )}

                {/* Label do setor */}
                <text
                  x={gx + groupInnerW / 2 + 6}
                  y={HEIGHT - PADDING.bottom + 14}
                  textAnchor="middle"
                  className="cp-chart-x-label"
                >
                  {truncate(rotuloSetor, xLabelMax)}
                </text>
                <text
                  x={gx + groupInnerW / 2 + 6}
                  y={HEIGHT - PADDING.bottom + 28}
                  textAnchor="middle"
                  className={`cp-chart-x-sublabel${stackOverflow ? " cp-chart-x-sublabel--alert" : ""}`}
                >
                  {d.orcamento > 0
                    ? `${formatPct(d.percentualComprometido, 0)} comprometido`
                    : "sem orçamento"}
                </text>
                {stackOverflow && (
                  <text
                    x={gx + groupInnerW / 2 + 6}
                    y={HEIGHT - PADDING.bottom + 42}
                    textAnchor="middle"
                    className="cp-chart-x-alert"
                  >
                    ⚠ excede em {formatCurrencyCompact(d.comprometido - d.orcamento)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// =============================================================================
// Subgráfico 3: Pedidos por Status (vertical bars, agora SVG)
// =============================================================================

const StatusBarsSvg: React.FC<{ pedidos: ReadonlyArray<IPedido> }> = ({
  pedidos,
}) => {
  const dados = React.useMemo(
    () => agregarPorStatus(pedidos as IPedido[]),
    [pedidos],
  );
  if (dados.length === 0) return <EmptyChart label="Sem pedidos." />;

  const PADDING = { top: 14, right: 14, bottom: 56, left: 56 };
  const HEIGHT = 320;
  const PER_GROUP_WIDTH = 130;
  const innerW = Math.max(560, dados.length * PER_GROUP_WIDTH);
  const W = innerW + PADDING.left + PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  const maxQtd = Math.max(...dados.map((d) => d.quantidade), 1);
  const ticks = buildTicks(maxQtd, 4);
  const yMax = ticks[ticks.length - 1] || maxQtd;

  const yFor = (v: number) => PADDING.top + innerH * (1 - v / yMax);
  const xFor = (gi: number) => PADDING.left + gi * PER_GROUP_WIDTH + 6;
  const groupInnerW = PER_GROUP_WIDTH - 12;
  const barW = Math.min(60, groupInnerW - 16);

  return (
    <div className="cp-chart-svg-wrap">
      <div className="cp-chart-svg-scroll">
        <svg
          className="cp-chart-svg"
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width={W}
          height={HEIGHT}
          role="img"
          aria-label="Pedidos por status"
        >
          {ticks.map((t) => (
            <g key={`tick-${t}`}>
              <line
                x1={PADDING.left}
                x2={W - PADDING.right}
                y1={yFor(t)}
                y2={yFor(t)}
                className="cp-chart-grid"
              />
              <text
                x={PADDING.left - 8}
                y={yFor(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="cp-chart-axis-text"
              >
                {Math.round(t)}
              </text>
            </g>
          ))}
          <line
            x1={PADDING.left}
            x2={W - PADDING.right}
            y1={HEIGHT - PADDING.bottom}
            y2={HEIGHT - PADDING.bottom}
            className="cp-chart-axis"
          />

          {dados.map((d, gi) => {
            const gx = xFor(gi);
            const cor =
              STATUS_COLORS[d.status.toLowerCase()] ?? COLORS.accent;
            const h = (d.quantidade / yMax) * innerH;
            const x = gx + (groupInnerW - barW) / 2 + 6;
            const y = HEIGHT - PADDING.bottom - h;
            return (
              <g key={d.status}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(1, h)}
                  rx={4}
                  ry={4}
                  fill={cor}
                  className="cp-chart-svg-bar"
                >
                  <title>{`${d.status}\n${d.quantidade} pedidos · ${formatBRL(d.valorTotal)}`}</title>
                </rect>
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  className="cp-chart-bar-label"
                >
                  {d.quantidade}
                </text>
                <text
                  x={gx + groupInnerW / 2 + 6}
                  y={HEIGHT - PADDING.bottom + 16}
                  textAnchor="middle"
                  className="cp-chart-x-label"
                >
                  {d.status}
                </text>
                <text
                  x={gx + groupInnerW / 2 + 6}
                  y={HEIGHT - PADDING.bottom + 30}
                  textAnchor="middle"
                  className="cp-chart-x-sublabel"
                >
                  {formatCurrencyCompact(d.valorTotal)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// =============================================================================
// Subgráfico 4: Evolução mensal — barras + linha cumulativa
// =============================================================================

const EvolucaoSvg: React.FC<{ pedidos: ReadonlyArray<IPedido> }> = ({
  pedidos,
}) => {
  const dados = React.useMemo(
    () => agregarPorMes(pedidos as IPedido[]),
    [pedidos],
  );
  if (dados.length === 0) {
    return <EmptyChart label="Nenhum pedido com data válida ainda." />;
  }

  const PADDING = { top: 14, right: 14, bottom: 50, left: 64 };
  const HEIGHT = 320;
  const PER_GROUP_WIDTH = 90;
  const innerW = Math.max(560, dados.length * PER_GROUP_WIDTH);
  const W = innerW + PADDING.left + PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  const maxValor = Math.max(...dados.map((d) => d.valorTotal), 1);
  const ticks = buildTicks(maxValor, 4);
  const yMax = ticks[ticks.length - 1] || maxValor;

  const yFor = (v: number) => PADDING.top + innerH * (1 - v / yMax);
  const xFor = (gi: number) => PADDING.left + gi * PER_GROUP_WIDTH + 6;
  const groupInnerW = PER_GROUP_WIDTH - 12;
  const barW = Math.min(40, groupInnerW - 12);

  // Linha cumulativa (acumulado mês a mês — útil para enxergar a tendência)
  let cumul = 0;
  const cumulPoints = dados.map((d, gi) => {
    cumul += d.valorTotal;
    const x = xFor(gi) + groupInnerW / 2 + 6;
    return { x, y: yFor(Math.min(cumul, yMax)), cumul };
  });
  const cumulPath = cumulPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
  const cumulMax = cumul; // total geral

  return (
    <div className="cp-chart-svg-wrap">
      <div className="cp-chart-legend">
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: COLORS.accent }} aria-hidden="true" />
          Valor do mês
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw cp-chart-sw-line" aria-hidden="true" />
          Acumulado
        </span>
      </div>
      <div className="cp-chart-svg-scroll">
        <svg
          className="cp-chart-svg"
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width={W}
          height={HEIGHT}
          role="img"
          aria-label="Evolução mensal"
        >
          {ticks.map((t) => (
            <g key={`tick-${t}`}>
              <line
                x1={PADDING.left}
                x2={W - PADDING.right}
                y1={yFor(t)}
                y2={yFor(t)}
                className="cp-chart-grid"
              />
              <text
                x={PADDING.left - 8}
                y={yFor(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="cp-chart-axis-text"
              >
                {formatCurrencyCompact(t)}
              </text>
            </g>
          ))}
          <line
            x1={PADDING.left}
            x2={W - PADDING.right}
            y1={HEIGHT - PADDING.bottom}
            y2={HEIGHT - PADDING.bottom}
            className="cp-chart-axis"
          />

          {dados.map((d, gi) => {
            const gx = xFor(gi);
            const h = (d.valorTotal / yMax) * innerH;
            const x = gx + (groupInnerW - barW) / 2 + 6;
            const y = HEIGHT - PADDING.bottom - h;
            return (
              <g key={d.mesISO}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(1, h)}
                  rx={3}
                  ry={3}
                  fill={COLORS.accent}
                  opacity={0.92}
                  className="cp-chart-svg-bar"
                >
                  <title>{`${d.mesLabel}\n${d.qtd} pedidos · ${formatBRL(d.valorTotal)}`}</title>
                </rect>
                {h > 18 && (
                  <text
                    x={x + barW / 2}
                    y={y - 4}
                    textAnchor="middle"
                    className="cp-chart-bar-label"
                  >
                    {formatCurrencyCompact(d.valorTotal)}
                  </text>
                )}
                <text
                  x={gx + groupInnerW / 2 + 6}
                  y={HEIGHT - PADDING.bottom + 16}
                  textAnchor="middle"
                  className="cp-chart-x-label"
                >
                  {d.mesLabel}
                </text>
                <text
                  x={gx + groupInnerW / 2 + 6}
                  y={HEIGHT - PADDING.bottom + 30}
                  textAnchor="middle"
                  className="cp-chart-x-sublabel"
                >
                  {d.qtd} pedido{d.qtd === 1 ? "" : "s"}
                </text>
              </g>
            );
          })}

          {/* Linha cumulativa */}
          <path
            d={cumulPath}
            className="cp-chart-line"
            fill="none"
          />
          {cumulPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={3.5}
              className="cp-chart-line-dot"
            >
              <title>{`Acumulado: ${formatBRL(p.cumul)}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="cp-chart-foot-note">
        Total acumulado no período: <strong>{formatBRL(cumulMax)}</strong>
      </div>
    </div>
  );
};

// =============================================================================
// Subgráfico 5: Por Responsável — barras horizontais ordenadas
// =============================================================================

const ResponsavelHBars: React.FC<{ pedidos: ReadonlyArray<IPedido> }> = ({
  pedidos,
}) => {
  const dados = React.useMemo(
    () => agregarPorResponsavel(pedidos as IPedido[]),
    [pedidos],
  );
  if (dados.length === 0) return <EmptyChart label="Sem pedidos." />;

  const maxQtd = Math.max(...dados.map((d) => d.quantidade), 1);

  return (
    <div className="cp-chart-hbars">
      {dados.map((d) => {
        const pct = (d.quantidade / maxQtd) * 100;
        return (
          <div key={d.responsavel} className="cp-chart-hbar-row">
            <div className="cp-chart-hbar-label" title={d.responsavel}>
              {d.responsavel}
            </div>
            <div className="cp-chart-hbar-track">
              <div
                className="cp-chart-hbar-fill"
                style={{ width: `${pct}%`, background: COLORS.accent }}
              />
              <span className="cp-chart-hbar-text">
                {d.quantidade} pedido{d.quantidade === 1 ? "" : "s"} ·{" "}
                {formatCurrencyCompact(d.valorTotal)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// =============================================================================
// Subgráfico 6: Top 10 Pedidos — barras horizontais com detalhe
// =============================================================================

const STATUS_LABEL: Record<string, string> = {
  novo: "Novo",
  "em análise": "Em Análise",
  "em analise": "Em Análise",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
};

const TopPedidosHBars: React.FC<{ pedidos: ReadonlyArray<IPedido> }> = ({
  pedidos,
}) => {
  const dados = React.useMemo(
    () => agregarTopPedidos(pedidos as IPedido[], 10),
    [pedidos],
  );
  if (dados.length === 0)
    return <EmptyChart label="Nenhum pedido com valor cadastrado ainda." />;

  const maxValor = Math.max(...dados.map((d) => d.valor ?? 0), 1);

  return (
    <div className="cp-chart-hbars">
      {dados.map((p, i) => {
        const pct = ((p.valor ?? 0) / maxValor) * 100;
        const stKey = (p.status ?? "").toLowerCase();
        const cor = STATUS_COLORS[stKey] ?? COLORS.accent;
        const setorLinha = p.setor
          ? setorLabelExibicao(p.setor)
          : "Sem setor";
        return (
          <div key={p.id} className="cp-chart-hbar-row cp-chart-hbar-row--top">
            <div className="cp-chart-hbar-rank" aria-hidden="true">
              #{i + 1}
            </div>
            <div className="cp-chart-hbar-label cp-chart-hbar-label--multiline">
              <span className="cp-chart-hbar-title" title={p.fornecedor || "Sem fornecedor"}>
                {p.fornecedor || "—"}
              </span>
              <span className="cp-chart-hbar-sublabel" title={setorLinha}>
                {setorLinha} · {STATUS_LABEL[stKey] ?? p.status ?? "—"}
              </span>
            </div>
            <div className="cp-chart-hbar-track">
              <div
                className="cp-chart-hbar-fill"
                style={{ width: `${pct}%`, background: cor }}
              />
              <span className="cp-chart-hbar-text">
                {formatBRL(p.valor ?? 0)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// =============================================================================
// Componente principal
// =============================================================================

export const GraficosBarras: React.FC<IGraficosBarrasProps> = ({
  pedidos,
  agregadosSetor,
  orcamentos,
}) => {
  const [metric, setMetric] = React.useState<ChartMetric>("orcamento-vs-realizado");
  // Conjunto vazio = "Todos os setores".
  const [setoresFoco, setSetoresFoco] = React.useState<Set<string>>(new Set());

  // Lista de setores disponíveis = todos que aparecem nos agregados (catálogo
  // canônico + setores extras já presentes nos pedidos).
  const setoresDisponiveis = React.useMemo(
    () => agregadosSetor.map((a) => a.setor),
    [agregadosSetor],
  );

  // Se um setor sumir do dataset (ex: filtro global mudou), remove do foco.
  React.useEffect(() => {
    if (setoresFoco.size === 0) return;
    const validos = new Set(setoresDisponiveis);
    let mudou = false;
    const novo = new Set<string>();
    setoresFoco.forEach((s) => {
      if (validos.has(s)) novo.add(s);
      else mudou = true;
    });
    if (mudou) setSetoresFoco(novo);
  }, [setoresDisponiveis, setoresFoco]);

  const todosSelecionados = setoresFoco.size === 0;

  const pedidosVisiveis = React.useMemo<IPedido[]>(() => {
    if (todosSelecionados) return pedidos as IPedido[];
    return (pedidos as IPedido[]).filter((p) =>
      setoresFoco.has(setorEfetivoDe(p)),
    );
  }, [pedidos, setoresFoco, todosSelecionados]);

  const agregadosVisiveis = React.useMemo<ISetorAggregate[]>(() => {
    if (todosSelecionados) return agregadosSetor as ISetorAggregate[];
    return (agregadosSetor as ISetorAggregate[]).filter((a) =>
      setoresFoco.has(a.setor),
    );
  }, [agregadosSetor, setoresFoco, todosSelecionados]);

  // Orçamentos limitados ao foco — KPIs usam teto por setor; contas filtradas pelos setores.
  const orcamentosVisiveis = React.useMemo<IOrcamentosPayload>(() => {
    if (todosSelecionados) return orcamentos;
    const setores: OrcamentosMap = {};
    Object.keys(orcamentos.setores).forEach((s) => {
      if (setoresFoco.has(s)) setores[s] = orcamentos.setores[s];
    });
    const contas: Record<string, number> = {};
    setoresFoco.forEach((setor) => {
      getSubcategoriasParaSetor(setor).forEach((sub) => {
        if (orcamentos.contas[sub] !== undefined) {
          contas[sub] = orcamentos.contas[sub];
        }
      });
    });
    return { setores, contas };
  }, [orcamentos, setoresFoco, todosSelecionados]);

  const valorTotalVisivel = React.useMemo(
    () =>
      pedidosVisiveis.reduce(
        (acc, p) => acc + (Number.isFinite(p.valor) ? (p.valor ?? 0) : 0),
        0,
      ),
    [pedidosVisiveis],
  );

  const agregadosConta = React.useMemo<ISetorAggregate[]>(
    () =>
      agregarPorContaContabil(
        pedidosVisiveis as IPedido[],
        orcamentosVisiveis.contas,
      ),
    [pedidosVisiveis, orcamentosVisiveis.contas],
  );

  const toggleSetor = React.useCallback((setor: string) => {
    setSetoresFoco((prev) => {
      const next = new Set(prev);
      if (next.has(setor)) next.delete(setor);
      else next.add(setor);
      return next;
    });
  }, []);

  const selecionarTodos = React.useCallback(() => setSetoresFoco(new Set()), []);
  const limpar = React.useCallback(() => setSetoresFoco(new Set()), []);

  const current = METRICS.find((m) => m.id === metric) ?? METRICS[0];

  return (
    <div className="cp-chart">
      <KpiStrip pedidos={pedidosVisiveis} orcamentos={orcamentosVisiveis.setores} />

      <ChipFiltroSetor
        setoresDisponiveis={setoresDisponiveis}
        selecionados={setoresFoco}
        onToggle={toggleSetor}
        onSelecionarTodos={selecionarTodos}
        onLimpar={limpar}
        totalPedidosVisiveis={pedidosVisiveis.length}
        totalPedidosOriginal={pedidos.length}
        valorTotalVisivel={valorTotalVisivel}
      />

      <div className="cp-chart-head">
        <div className="cp-chart-tabs" role="tablist" aria-label="Selecionar gráfico">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={metric === m.id}
              className={`cp-chart-tab${metric === m.id ? " cp-chart-tab-active" : ""}`}
              onClick={() => setMetric(m.id)}
              title={m.description}
            >
              <span className="cp-chart-tab-icon" aria-hidden="true">{m.icon}</span>
              <span className="cp-chart-tab-label">{m.label}</span>
            </button>
          ))}
        </div>
        <div className="cp-chart-head-desc">{current.description}</div>
      </div>

      <div className="cp-chart-body">
        {metric === "orcamento-vs-realizado" && (
          <GroupedBarsSvg
            setores={agregadosVisiveis}
            series={[
              { key: "orcamento", label: "Orçamento", color: COLORS.orcamento },
              { key: "realizado", label: "Realizado", color: COLORS.realizado },
              { key: "saldo", label: "Saldo", color: COLORS.saldo, signed: true },
            ]}
          />
        )}
        {metric === "orcamento-vs-projetado" && (
          <ProjecaoBarsSvg setores={agregadosVisiveis} />
        )}
        {metric === "orcamento-vs-realizado-contas" && (
          <GroupedBarsSvg
            setores={agregadosConta}
            series={[
              { key: "orcamento", label: "Orçamento", color: COLORS.orcamento },
              { key: "realizado", label: "Realizado", color: COLORS.realizado },
              { key: "saldo", label: "Saldo", color: COLORS.saldo, signed: true },
            ]}
            emptyMessage="Nenhuma conta contábil nos pedidos nem no orçamento."
            xLabelMax={22}
            ariaLabel="Gráfico de barras por conta contábil"
          />
        )}
        {metric === "orcamento-vs-projetado-contas" && (
          <ProjecaoBarsSvg
            setores={agregadosConta}
            emptyMessage="Nenhuma conta contábil nos pedidos nem no orçamento."
            xLabelMax={22}
            ariaLabel="Projeção orçamentária por conta contábil"
          />
        )}
        {metric === "qtd-por-status" && <StatusBarsSvg pedidos={pedidosVisiveis} />}
        {metric === "evolucao-mensal" && <EvolucaoSvg pedidos={pedidosVisiveis} />}
        {metric === "qtd-por-responsavel" && (
          <ResponsavelHBars pedidos={pedidosVisiveis} />
        )}
        {metric === "top-pedidos" && <TopPedidosHBars pedidos={pedidosVisiveis} />}
      </div>
    </div>
  );
};

export default GraficosBarras;
