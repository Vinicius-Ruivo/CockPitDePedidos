import * as React from "react";
import { ChartMetric, IHistoricoOrcamentos, IOrcamentosPayload, IPedido, ISetorAggregate, MesISO, OrcamentosMap } from "../types";
import {
  agregarPorContaContabil,
  agregarPorFornecedor,
  agregarPorMes,
  agregarPorSetor,
  agregarPorStatus,
  mesesDisponiveisParaGrafico,
  mesISOLabel,
  mesISOAtual,
  orcamentoContaPorMesNaFaixa,
  orcamentoSetorPorMesNaFaixa,
  pedidosNoIntervaloMeses,
  somarOrcamentosNoIntervalo,
  totaisProjecao,
} from "../utils/metrics";
import { findSetorBySubcategoria, getSubcategoriasParaSetor, setorLabelExibicao, SETOR_LABELS_CANONICOS } from "../constants/setoresOrganizacao";
import {
  ChartBarGradientDefs,
  ChartBarGradKey,
  chartBarFill,
  chartBarLegendBg,
  chartBarLegendBgH,
  statusBarFill,
} from "../utils/chartBarGradients";

export interface IGraficosBarrasProps {
  pedidos: ReadonlyArray<IPedido>;
  /** Histórico mensal (Dataverse) — somado no período selecionado. */
  historicoOrcamentos: IHistoricoOrcamentos;
  /** Quando o Dashboard está filtrado por um mês, a análise acompanha esse mês. */
  mesTravado?: MesISO;
  /**
   * Incrementa cada vez que o painel «Análise de orçamento» abre — dispara animação
   * das barras de cima para baixo (após o slide do painel).
   */
  barGrowEpoch?: number;
}

/** Alinhado à transição do painel (.cp-dash-graficos-expand-inner ≈ 0,82s). */
const BAR_GROW_PANEL_MS = 860;
/** Duração de cada barra (deve coincidir com Dashboard.css). */
const BAR_GROW_DURATION_MS = 4000;
/** Intervalo entre colunas — esquerda → direita (gi). */
const BAR_GROW_STAGGER_MS = 420;

export interface IChartBarGrowAnim {
  active: boolean;
  styleForBar: (gi: number, si?: number) => React.CSSProperties | undefined;
}

export function useChartBarGrow(barGrowEpoch = 0): IChartBarGrowAnim {
  const [active, setActive] = React.useState(false);

  React.useEffect(() => {
    if (!barGrowEpoch) return;
    setActive(false);
    const t = window.setTimeout(() => setActive(true), BAR_GROW_PANEL_MS);
    return () => window.clearTimeout(t);
  }, [barGrowEpoch]);

  const styleForBar = React.useCallback(
    (gi: number, _si = 0): React.CSSProperties | undefined => {
      void _si;
      if (!active) return undefined;
      // Mesmo atraso para todas as barras da mesma coluna (só gi define a ordem L→R).
      return {
        animationDelay: `${gi * BAR_GROW_STAGGER_MS}ms`,
        animationDuration: `${BAR_GROW_DURATION_MS}ms`,
      };
    },
    [active],
  );

  return { active, styleForBar };
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
    label: "Aglutinador Real",
    description: "Por setor — só Confirmados consomem orçamento.",
    icon: "📊",
  },
  {
    id: "orcamento-vs-projetado",
    label: "Aglutinador Projetado",
    description: "Inclui Em Análise + Novo — projeção se tudo for aprovado.",
    icon: "🧭",
  },
  {
    id: "orcamento-vs-realizado-contas",
    label: "Contas Real",
    description: "Por conta contábil — só Confirmados (mapa orçamentos.contas).",
    icon: "📒",
  },
  {
    id: "orcamento-vs-projetado-contas",
    label: "Contas Projetado",
    description: "Por conta contábil — projeção com pedidos pendentes.",
    icon: "🧾",
  },
  {
    id: "qtd-por-status",
    label: "Por Status",
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
    id: "qtd-por-fornecedor",
    label: "Por fornecedor",
    description: "Soma de valor e quantidade de pedidos por fornecedor.",
    icon: "🏪",
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

/** Rótulo acima da barra — só o valor (eixo e KPIs mantêm R$). */
const formatBarValueCompact = (n: number): string => {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${abs.toFixed(0)}`;
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
  barGrow?: IChartBarGrowAnim;
  setores: ReadonlyArray<ISetorAggregate>;
  /** Quais valores extrair de cada agregado. */
  series: ReadonlyArray<{
    key: keyof ISetorAggregate;
    label: string;
    gradKey: ChartBarGradKey;
    /** Quando true (saldo), valores negativos viram vermelho e usam |valor| no eixo. */
    signed?: boolean;
  }>;
  /**
   * Por rótulo do grupo (setor ou conta): parcelas mensais do orçamento no período.
   * Usado para linhas horizontais cumulativas na barra «Orçamento».
   */
  orcamentoPorMesPorRotulo?: ReadonlyMap<
    string,
    ReadonlyArray<{ mes: MesISO; valor: number }>
  >;
  emptyMessage?: string;
  /** Comprimento máximo no eixo X (contas longas precisam mais caracteres visíveis). */
  xLabelMax?: number;
  ariaLabel?: string;
}

/** Largura explícita em px para o conteúdo do SVG — evita encolher à largura do painel e ativa o scroll horizontal. */
const chartSvgInnerStyle = (w: number): React.CSSProperties => ({
  width: w,
  minWidth: w,
  maxWidth: "none",
  flexShrink: 0,
});

/** Impede o host (Canvas/Fluent) de forçar o SVG a 100% da largura — mantém W px para o scroll. */
const chartSvgElementStyle = (w: number, h: number): React.CSSProperties => ({
  width: w,
  minWidth: w,
  maxWidth: w,
  height: h,
  display: "block",
  flexShrink: 0,
});

/** Mesmo espírito do PieChartSubcategorias: coluna ativa “salta”, demais esmaecem. */
const CHART_COL_HOVER_DIM = 0.52;
const CHART_COL_HOVER_LIFT = 6;

function chartColumnGroupProps(
  gi: number,
  hoverGi: number | null,
  setHover: React.Dispatch<React.SetStateAction<number | null>>,
): Pick<
  React.SVGProps<SVGGElement>,
  "className" | "style" | "onMouseEnter" | "onMouseLeave"
> {
  const active = hoverGi === gi;
  const dimmed = hoverGi !== null && !active;
  return {
    className: "cp-chart-vgroup",
    style: {
      cursor: "pointer",
      transition: "opacity 0.18s ease, transform 0.18s ease",
      opacity: dimmed ? CHART_COL_HOVER_DIM : 1,
      transform: active
        ? `translate(0px, ${-CHART_COL_HOVER_LIFT}px)`
        : "translate(0px, 0px)",
    },
    onMouseEnter: () => setHover(gi),
    onMouseLeave: () => setHover(null),
  };
}

/** Área invisível por coluna para hover mesmo com barras finas */
const ChartColumnHitRect: React.FC<{
  slotLeft: number;
  slotWidth: number;
  top: number;
  height: number;
}> = ({ slotLeft, slotWidth, top, height }) => (
  <rect
    x={slotLeft}
    y={top}
    width={slotWidth}
    height={height}
    fill="transparent"
    pointerEvents="all"
    aria-hidden
  />
);

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

/** Linhas horizontais cumulativas na barra de orçamento (limite entre meses). */
function OrcamentoMesDividerLines(props: {
  grupoKey: string;
  x: number;
  barW: number;
  totalOrc: number;
  yFor: (v: number) => number;
  breakdown: ReadonlyArray<{ mes: MesISO; valor: number }> | undefined;
}): React.ReactElement | null {
  const { grupoKey, x, barW, totalOrc, yFor, breakdown } = props;
  if (!breakdown || breakdown.length < 2 || totalOrc <= 0) return null;
  let cum = 0;
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < breakdown.length - 1; i++) {
    cum += breakdown[i].valor;
    if (cum >= totalOrc - 1e-4) break;
    const yy = yFor(cum);
    lines.push(
      <g key={`${grupoKey}-orc-div-${breakdown[i].mes}`}>
        <title>{`Acumulado até ${mesISOLabel(breakdown[i].mes)}: ${formatBRL(cum)} · segmento seguinte: ${mesISOLabel(breakdown[i + 1].mes)}`}</title>
        <line
          x1={x}
          x2={x + barW}
          y1={yy}
          y2={yy}
          className="cp-chart-orc-mes-divider"
          pointerEvents="none"
        />
      </g>,
    );
  }
  if (lines.length === 0) return null;
  return <g className="cp-chart-orc-mes-dividers">{lines}</g>;
}

const GroupedBarsSvg: React.FC<IGroupedBarsProps> = ({
  barGrow,
  setores,
  series,
  orcamentoPorMesPorRotulo,
  emptyMessage = "Sem setores cadastrados ainda.",
  xLabelMax = 14,
  ariaLabel = "Gráfico de barras por setor",
}) => {
  const [hoverGi, setHoverGi] = React.useState<number | null>(null);

  if (setores.length === 0) {
    return <EmptyChart label={emptyMessage} />;
  }

  // Geometria do gráfico — escala via viewBox para acompanhar o container.
  const PADDING = { top: 14, right: orcamentoPorMesPorRotulo ? 40 : 14, bottom: 56, left: 64 };
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
    <div
      className={`cp-chart-svg-wrap${barGrow?.active ? " cp-chart-svg-wrap--bar-grow" : ""}`}
    >
      <div className="cp-chart-legend">
        {series.map((s) => (
          <span key={s.key as string} className="cp-chart-legend-item">
            <span
              className="cp-chart-sw"
              style={{ background: chartBarLegendBg(s.gradKey) }}
              aria-hidden="true"
            />
            {s.label}
          </span>
        ))}
        {orcamentoPorMesPorRotulo && (
          <span className="cp-chart-legend-item cp-chart-legend-item--mes-div">
            <span className="cp-chart-sw cp-chart-sw-line cp-chart-sw-line--orc-mes" aria-hidden="true" />
            Limite entre meses (orçamento)
          </span>
        )}
      </div>

      <div
        className="cp-chart-svg-scroll"
        role="region"
        aria-label="Gráfico: use a barra de rolagem horizontal para ver todas as categorias"
      >
        <div className="cp-chart-svg-inner" style={chartSvgInnerStyle(W)}>
        <svg
          className="cp-chart-svg"
          style={chartSvgElementStyle(W, HEIGHT)}
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width={W}
          height={HEIGHT}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label={ariaLabel}
        >
          <ChartBarGradientDefs />
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
            const slotLeft = PADDING.left + gi * PER_GROUP_WIDTH;
            const rotuloSetor = setorLabelExibicao(d.setor);
            return (
              <g key={d.setor} {...chartColumnGroupProps(gi, hoverGi, setHoverGi)}>
                <ChartColumnHitRect
                  slotLeft={slotLeft}
                  slotWidth={PER_GROUP_WIDTH}
                  top={PADDING.top}
                  height={HEIGHT - PADDING.top}
                />
                {series.map((s, si) => {
                  const raw = (d[s.key] as number) ?? 0;
                  const isNeg = !!s.signed && raw < 0;
                  const v = Math.abs(raw);
                  const h = yMax > 0 ? (v / yMax) * innerH : 0;
                  const x = gx + barGap + si * (barW + barGap);
                  const y = HEIGHT - PADDING.bottom - h;
                  const fill = chartBarFill(isNeg ? "saldoNeg" : s.gradKey);
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
                        style={barGrow?.styleForBar(gi, si)}
                      >
                        <title>
                          {`${rotuloSetor}\n${s.label}: ${formatBRL(raw)}`}
                        </title>
                      </rect>
                      {s.key === "orcamento" && (
                        <OrcamentoMesDividerLines
                          grupoKey={`${d.setor}-${String(s.key)}`}
                          x={x}
                          barW={barW}
                          totalOrc={Math.abs((d.orcamento as number) ?? 0)}
                          yFor={yFor}
                          breakdown={orcamentoPorMesPorRotulo?.get(d.setor)}
                        />
                      )}
                      {h > 18 && (
                        <text
                          x={x + barW / 2}
                          y={y - 4}
                          textAnchor="middle"
                          className={`cp-chart-bar-label${isNeg ? " cp-chart-bar-label--neg" : ""}`}
                        >
                          {formatBarValueCompact(raw)}
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
    </div>
  );
};

// =============================================================================
// Subgráfico 2: Orçado × Comprometido (stacked) × Saldo Projetado
// =============================================================================

const ProjecaoBarsSvg: React.FC<{
  barGrow?: IChartBarGrowAnim;
  setores: ReadonlyArray<ISetorAggregate>;
  orcamentoPorMesPorRotulo?: ReadonlyMap<
    string,
    ReadonlyArray<{ mes: MesISO; valor: number }>
  >;
  emptyMessage?: string;
  xLabelMax?: number;
  ariaLabel?: string;
}> = ({
  barGrow,
  setores,
  orcamentoPorMesPorRotulo,
  emptyMessage = "Sem setores cadastrados ainda.",
  xLabelMax = 16,
  ariaLabel = "Projeção orçamentária por setor",
}) => {
  const [hoverGi, setHoverGi] = React.useState<number | null>(null);

  if (setores.length === 0) {
    return <EmptyChart label={emptyMessage} />;
  }

  const PADDING = { top: 14, right: orcamentoPorMesPorRotulo ? 40 : 14, bottom: 60, left: 64 };
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
    <div
      className={`cp-chart-svg-wrap${barGrow?.active ? " cp-chart-svg-wrap--bar-grow" : ""}`}
    >
      <div className="cp-chart-legend">
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: chartBarLegendBg("orcamento") }} aria-hidden="true" />
          Orçamento
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: chartBarLegendBg("realizado") }} aria-hidden="true" />
          Realizado (Confirmado)
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: chartBarLegendBg("emAnalise") }} aria-hidden="true" />
          Em Análise
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: chartBarLegendBg("novo") }} aria-hidden="true" />
          Novo
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: chartBarLegendBg("saldo") }} aria-hidden="true" />
          Saldo Projetado
        </span>
        {orcamentoPorMesPorRotulo && (
          <span className="cp-chart-legend-item cp-chart-legend-item--mes-div">
            <span className="cp-chart-sw cp-chart-sw-line cp-chart-sw-line--orc-mes" aria-hidden="true" />
            Limite entre meses (orçamento)
          </span>
        )}
      </div>

      <div
        className="cp-chart-svg-scroll"
        role="region"
        aria-label="Gráfico: use a barra de rolagem horizontal para ver todas as categorias"
      >
        <div className="cp-chart-svg-inner" style={chartSvgInnerStyle(W)}>
        <svg
          className="cp-chart-svg"
          style={chartSvgElementStyle(W, HEIGHT)}
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width={W}
          height={HEIGHT}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label={ariaLabel}
        >
          <ChartBarGradientDefs />
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
            const segs = (
              [
                { k: "real", v: d.realizado, gradKey: "realizado" as const, label: "Realizado" },
                { k: "anal", v: d.emAnalise, gradKey: "emAnalise" as const, label: "Em Análise" },
                { k: "novo", v: d.novo, gradKey: "novo" as const, label: "Novo" },
              ] as const
            ).filter((s) => s.v > 0);
            const hCompr = (d.comprometido / yMax) * innerH;
            const yComprTop = HEIGHT - PADDING.bottom - hCompr;
            const stackOverflow = d.orcamento > 0 && d.comprometido > d.orcamento;

            // Barra 3 — Saldo Projetado (verde se positivo, vermelho se negativo)
            const x3 = x2 + barW + barGap;
            const sp = d.saldoProjetado;
            const h3 = (Math.abs(sp) / yMax) * innerH;
            const y3 = HEIGHT - PADDING.bottom - h3;
            const fillSaldo = chartBarFill(sp < 0 ? "saldoNeg" : "saldo");

            // Linha de referência do orçamento dentro do grupo (auxilia leitura)
            const showOrcLine = d.orcamento > 0;

            const slotLeft = PADDING.left + gi * PER_GROUP_WIDTH;

            return (
              <g key={d.setor} {...chartColumnGroupProps(gi, hoverGi, setHoverGi)}>
                <ChartColumnHitRect
                  slotLeft={slotLeft}
                  slotWidth={PER_GROUP_WIDTH}
                  top={PADDING.top}
                  height={HEIGHT - PADDING.top}
                />
                {/* Orçamento */}
                <rect
                  x={x1}
                  y={y1}
                  width={barW}
                  height={Math.max(1, h1)}
                  rx={3}
                  ry={3}
                  fill={chartBarFill("orcamento")}
                  opacity={0.92}
                  className="cp-chart-svg-bar"
                  style={barGrow?.styleForBar(gi, 0)}
                >
                  <title>{`${rotuloSetor}\nOrçamento: ${formatBRL(d.orcamento)}`}</title>
                </rect>
                <OrcamentoMesDividerLines
                  grupoKey={`${d.setor}-proj`}
                  x={x1}
                  barW={barW}
                  totalOrc={d.orcamento}
                  yFor={yFor}
                  breakdown={orcamentoPorMesPorRotulo?.get(d.setor)}
                />

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
                        fill={chartBarFill(s.gradKey)}
                        rx={idx === segs.length - 1 ? 3 : 0}
                        ry={idx === segs.length - 1 ? 3 : 0}
                        className="cp-chart-svg-bar"
                        style={barGrow?.styleForBar(gi, 1 + idx)}
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
                    {formatBarValueCompact(d.comprometido)}
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
                  fill={fillSaldo}
                  className="cp-chart-svg-bar"
                  style={barGrow?.styleForBar(gi, 2)}
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
                    {formatBarValueCompact(sp)}
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
    </div>
  );
};

// =============================================================================
// Subgráfico 3: Pedidos por Status (vertical bars, agora SVG)
// =============================================================================

const StatusBarsSvg: React.FC<{
  pedidos: ReadonlyArray<IPedido>;
  barGrow?: IChartBarGrowAnim;
}> = ({ pedidos, barGrow }) => {
  const [hoverGi, setHoverGi] = React.useState<number | null>(null);

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
    <div
      className={`cp-chart-svg-wrap${barGrow?.active ? " cp-chart-svg-wrap--bar-grow" : ""}`}
    >
      <div
        className="cp-chart-svg-scroll"
        role="region"
        aria-label="Gráfico: use a barra de rolagem horizontal para ver todas as categorias"
      >
        <div className="cp-chart-svg-inner" style={chartSvgInnerStyle(W)}>
        <svg
          className="cp-chart-svg"
          style={chartSvgElementStyle(W, HEIGHT)}
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width={W}
          height={HEIGHT}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label="Pedidos por status"
        >
          <ChartBarGradientDefs />
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
            const cor = statusBarFill(d.status);
            const h = (d.quantidade / yMax) * innerH;
            const x = gx + (groupInnerW - barW) / 2 + 6;
            const y = HEIGHT - PADDING.bottom - h;
            const slotLeft = PADDING.left + gi * PER_GROUP_WIDTH;

            return (
              <g key={d.status} {...chartColumnGroupProps(gi, hoverGi, setHoverGi)}>
                <ChartColumnHitRect
                  slotLeft={slotLeft}
                  slotWidth={PER_GROUP_WIDTH}
                  top={PADDING.top}
                  height={HEIGHT - PADDING.top}
                />
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(1, h)}
                  rx={4}
                  ry={4}
                  fill={cor}
                  className="cp-chart-svg-bar"
                  style={barGrow?.styleForBar(gi, 0)}
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
    </div>
  );
};

// =============================================================================
// Subgráfico 4: Evolução mensal — barras + linha cumulativa
// =============================================================================

const EvolucaoSvg: React.FC<{
  pedidos: ReadonlyArray<IPedido>;
  barGrow?: IChartBarGrowAnim;
}> = ({ pedidos, barGrow }) => {
  const [hoverGi, setHoverGi] = React.useState<number | null>(null);

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
  const cumulAcc = dados.reduce<{ points: { x: number; y: number; cumul: number }[]; cumul: number }>(
    (acc, d, gi) => {
      const cumul = acc.cumul + d.valorTotal;
      const x = xFor(gi) + groupInnerW / 2 + 6;
      acc.points.push({ x, y: yFor(Math.min(cumul, yMax)), cumul });
      acc.cumul = cumul;
      return acc;
    },
    { points: [], cumul: 0 },
  );
  const cumulPoints = cumulAcc.points;
  const cumulPath = cumulPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
  const cumulMax = cumulAcc.cumul;

  return (
    <div
      className={`cp-chart-svg-wrap${barGrow?.active ? " cp-chart-svg-wrap--bar-grow" : ""}`}
    >
      <div className="cp-chart-legend">
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw" style={{ background: chartBarLegendBg("accent") }} aria-hidden="true" />
          Valor do mês
        </span>
        <span className="cp-chart-legend-item">
          <span className="cp-chart-sw cp-chart-sw-line" aria-hidden="true" />
          Acumulado
        </span>
      </div>
      <div
        className="cp-chart-svg-scroll"
        role="region"
        aria-label="Gráfico: use a barra de rolagem horizontal para ver todas as categorias"
      >
        <div className="cp-chart-svg-inner" style={chartSvgInnerStyle(W)}>
        <svg
          className="cp-chart-svg"
          style={chartSvgElementStyle(W, HEIGHT)}
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width={W}
          height={HEIGHT}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label="Evolução mensal"
        >
          <ChartBarGradientDefs />
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
            const slotLeft = PADDING.left + gi * PER_GROUP_WIDTH;

            return (
              <g key={d.mesISO} {...chartColumnGroupProps(gi, hoverGi, setHoverGi)}>
                <ChartColumnHitRect
                  slotLeft={slotLeft}
                  slotWidth={PER_GROUP_WIDTH}
                  top={PADDING.top}
                  height={HEIGHT - PADDING.top}
                />
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(1, h)}
                  rx={3}
                  ry={3}
                  fill={chartBarFill("accent")}
                  opacity={0.95}
                  className="cp-chart-svg-bar"
                  style={barGrow?.styleForBar(gi, 0)}
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
                    {formatBarValueCompact(d.valorTotal)}
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
            style={{
              opacity: hoverGi === null ? 1 : 0.35,
              transition: "opacity 0.18s ease",
            }}
          />
          {cumulPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={3.5}
              className="cp-chart-line-dot"
              opacity={hoverGi === null || hoverGi === i ? 1 : 0.45}
              style={{ transition: "opacity 0.18s ease" }}
            >
              <title>{`Acumulado: ${formatBRL(p.cumul)}`}</title>
            </circle>
          ))}
        </svg>
        </div>
      </div>
      <div className="cp-chart-foot-note">
        Total acumulado no período: <strong>{formatBRL(cumulMax)}</strong>
      </div>
    </div>
  );
};

// =============================================================================
// Subgráfico: Por fornecedor — barras horizontais (largura ∝ valor total)
// =============================================================================

const FornecedorHBars: React.FC<{
  pedidos: ReadonlyArray<IPedido>;
  barGrow?: IChartBarGrowAnim;
}> = ({ pedidos, barGrow }) => {
  const dados = React.useMemo(
    () => agregarPorFornecedor(pedidos as IPedido[]),
    [pedidos],
  );
  if (dados.length === 0) return <EmptyChart label="Sem pedidos." />;

  const maxValor = Math.max(...dados.map((d) => d.valorTotal), 1);

  return (
    <div className={`cp-chart-hbars${barGrow?.active ? " cp-chart-hbars--bar-grow" : ""}`}>
      {dados.map((d, gi) => {
        const pct = (d.valorTotal / maxValor) * 100;
        return (
          <div key={d.fornecedor} className="cp-chart-hbar-row">
            <div className="cp-chart-hbar-label" title={d.fornecedor}>
              {d.fornecedor}
            </div>
            <div className="cp-chart-hbar-track">
              <div
                className="cp-chart-hbar-fill"
                style={{
                  width: `${pct}%`,
                  background: chartBarLegendBgH("accent"),
                  ...barGrow?.styleForBar(gi, 0),
                }}
              />
              <span className="cp-chart-hbar-text">
                {formatBRL(d.valorTotal)} · {d.quantidade} pedido
                {d.quantidade === 1 ? "" : "s"}
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
  historicoOrcamentos,
  mesTravado,
  barGrowEpoch = 0,
}) => {
  const barGrow = useChartBarGrow(barGrowEpoch);
  const [metric, setMetric] = React.useState<ChartMetric>("orcamento-vs-realizado");
  // Conjunto vazio = "Todos os setores".
  const [setoresFoco, setSetoresFoco] = React.useState<Set<string>>(new Set());

  const opcoesMeses = React.useMemo(
    () =>
      mesTravado
        ? [mesTravado]
        : mesesDisponiveisParaGrafico(historicoOrcamentos, pedidos as IPedido[]),
    [historicoOrcamentos, mesTravado, pedidos],
  );

  /** 1.ª sincronização com as opções: intervalo completo (min→max), não só o mês «hoje». */
  const periodoPadraoAplicado = React.useRef(false);
  const [mesDe, setMesDe] = React.useState(() => mesISOAtual());
  const [mesAte, setMesAte] = React.useState(() => mesISOAtual());

  React.useLayoutEffect(() => {
    if (opcoesMeses.length === 0) return;
    if (mesTravado) {
      periodoPadraoAplicado.current = true;
      setMesDe(mesTravado);
      setMesAte(mesTravado);
      return;
    }
    if (!periodoPadraoAplicado.current) {
      periodoPadraoAplicado.current = true;
      setMesDe(opcoesMeses[0]);
      setMesAte(opcoesMeses[opcoesMeses.length - 1]);
      return;
    }
    setMesDe((prev) => (opcoesMeses.includes(prev) ? prev : opcoesMeses[0]));
    setMesAte((prev) =>
      opcoesMeses.includes(prev) ? prev : opcoesMeses[opcoesMeses.length - 1],
    );
  }, [opcoesMeses]);

  const pedidosPeriodo = React.useMemo(
    () => pedidosNoIntervaloMeses(pedidos as IPedido[], mesDe, mesAte),
    [pedidos, mesDe, mesAte],
  );

  const orcamentosPeriodo = React.useMemo(
    () => somarOrcamentosNoIntervalo(historicoOrcamentos, mesDe, mesAte),
    [historicoOrcamentos, mesDe, mesAte],
  );

  const agregadosSetor = React.useMemo(
    () =>
      agregarPorSetor(
        pedidosPeriodo,
        orcamentosPeriodo.setores,
        SETOR_LABELS_CANONICOS,
      ),
    [pedidosPeriodo, orcamentosPeriodo],
  );

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
    const base = pedidosPeriodo as IPedido[];
    if (todosSelecionados) return base;
    return base.filter((p) => setoresFoco.has(setorEfetivoDe(p)));
  }, [pedidosPeriodo, setoresFoco, todosSelecionados]);

  const agregadosVisiveis = React.useMemo<ISetorAggregate[]>(() => {
    if (todosSelecionados) return agregadosSetor as ISetorAggregate[];
    return (agregadosSetor as ISetorAggregate[]).filter((a) =>
      setoresFoco.has(a.setor),
    );
  }, [agregadosSetor, setoresFoco, todosSelecionados]);

  // Orçamentos limitados ao foco — KPIs usam teto por setor; contas filtradas pelos setores.
  const orcamentosVisiveis = React.useMemo<IOrcamentosPayload>(() => {
    if (todosSelecionados) return orcamentosPeriodo;
    const setores: OrcamentosMap = {};
    Object.keys(orcamentosPeriodo.setores).forEach((s) => {
      if (setoresFoco.has(s)) setores[s] = orcamentosPeriodo.setores[s];
    });
    const contas: Record<string, number> = {};
    setoresFoco.forEach((setor) => {
      getSubcategoriasParaSetor(setor).forEach((sub) => {
        if (orcamentosPeriodo.contas[sub] !== undefined) {
          contas[sub] = orcamentosPeriodo.contas[sub];
        }
      });
    });
    return { setores, contas };
  }, [orcamentosPeriodo, setoresFoco, todosSelecionados]);

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

  /** Parcelas mensais do orçamento por setor — linhas na barra cinza. */
  const orcamentoPorMesPorRotuloSetor = React.useMemo(() => {
    const m = new Map<string, ReadonlyArray<{ mes: MesISO; valor: number }>>();
    agregadosVisiveis.forEach((a) => {
      m.set(
        a.setor,
        orcamentoSetorPorMesNaFaixa(historicoOrcamentos, mesDe, mesAte, a.setor),
      );
    });
    return m;
  }, [agregadosVisiveis, historicoOrcamentos, mesDe, mesAte]);

  const orcamentoPorMesPorRotuloConta = React.useMemo(() => {
    const m = new Map<string, ReadonlyArray<{ mes: MesISO; valor: number }>>();
    agregadosConta.forEach((a) => {
      m.set(
        a.setor,
        orcamentoContaPorMesNaFaixa(historicoOrcamentos, mesDe, mesAte, a.setor),
      );
    });
    return m;
  }, [agregadosConta, historicoOrcamentos, mesDe, mesAte]);

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

  const onChangeMesDe = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value;
      setMesDe(v);
      setMesAte((prev) => (v > prev ? v : prev));
    },
    [],
  );

  const onChangeMesAte = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value;
      setMesAte(v);
      setMesDe((prev) => (v < prev ? v : prev));
    },
    [],
  );

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
        totalPedidosOriginal={pedidosPeriodo.length}
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
        <div className="cp-chart-head-side">
          <div className="cp-chart-head-desc">{current.description}</div>
          <div className="cp-chart-period cp-chart-period--inline" role="group" aria-label="Período da análise">
            <div className="cp-chart-period-controls">
              <label className="cp-chart-period-field">
                <span className="cp-chart-period-label">De</span>
                <select
                  className="cp-chart-period-select"
                  value={mesDe}
                  onChange={onChangeMesDe}
                  aria-label="Mês inicial"
                >
                  {opcoesMeses.map((m) => (
                    <option key={m} value={m}>
                      {mesISOLabel(m)} ({m})
                    </option>
                  ))}
                </select>
              </label>
              <label className="cp-chart-period-field">
                <span className="cp-chart-period-label">Até</span>
                <select
                  className="cp-chart-period-select"
                  value={mesAte}
                  onChange={onChangeMesAte}
                  aria-label="Mês final"
                >
                  {opcoesMeses.map((m) => (
                    <option key={`ate-${m}`} value={m}>
                      {mesISOLabel(m)} ({m})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="cp-chart-body">
        {metric === "orcamento-vs-realizado" && (
          <GroupedBarsSvg
            barGrow={barGrow}
            setores={agregadosVisiveis}
            series={[
              { key: "orcamento", label: "Orçamento", gradKey: "orcamento" },
              { key: "realizado", label: "Realizado", gradKey: "realizado" },
              { key: "saldo", label: "Saldo", gradKey: "saldo", signed: true },
            ]}
            orcamentoPorMesPorRotulo={orcamentoPorMesPorRotuloSetor}
          />
        )}
        {metric === "orcamento-vs-projetado" && (
          <ProjecaoBarsSvg
            barGrow={barGrow}
            setores={agregadosVisiveis}
            orcamentoPorMesPorRotulo={orcamentoPorMesPorRotuloSetor}
          />
        )}
        {metric === "orcamento-vs-realizado-contas" && (
          <GroupedBarsSvg
            barGrow={barGrow}
            setores={agregadosConta}
            series={[
              { key: "orcamento", label: "Orçamento", gradKey: "orcamento" },
              { key: "realizado", label: "Realizado", gradKey: "realizado" },
              { key: "saldo", label: "Saldo", gradKey: "saldo", signed: true },
            ]}
            emptyMessage="Nenhuma conta contábil nos pedidos nem no orçamento."
            xLabelMax={22}
            ariaLabel="Gráfico de barras por conta contábil"
            orcamentoPorMesPorRotulo={orcamentoPorMesPorRotuloConta}
          />
        )}
        {metric === "orcamento-vs-projetado-contas" && (
          <ProjecaoBarsSvg
            barGrow={barGrow}
            setores={agregadosConta}
            emptyMessage="Nenhuma conta contábil nos pedidos nem no orçamento."
            xLabelMax={22}
            ariaLabel="Projeção orçamentária por conta contábil"
            orcamentoPorMesPorRotulo={orcamentoPorMesPorRotuloConta}
          />
        )}
        {metric === "qtd-por-status" && (
          <StatusBarsSvg pedidos={pedidosVisiveis} barGrow={barGrow} />
        )}
        {metric === "evolucao-mensal" && (
          <EvolucaoSvg pedidos={pedidosVisiveis} barGrow={barGrow} />
        )}
        {metric === "qtd-por-fornecedor" && (
          <FornecedorHBars pedidos={pedidosVisiveis} barGrow={barGrow} />
        )}
      </div>
    </div>
  );
};

export default GraficosBarras;
