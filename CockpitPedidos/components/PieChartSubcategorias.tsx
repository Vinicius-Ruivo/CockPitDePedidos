import * as React from "react";
import { setorLabelExibicao } from "../constants/setoresOrganizacao";
import { ISubcategoriaAggregate } from "../types";

export interface IPieChartSubcategoriasProps {
  setor: string;
  /** Já vem ordenado (ver agregarPorSubcategoria). */
  agregados: ReadonlyArray<ISubcategoriaAggregate>;
  /** Solicita o fechamento do modal (clique no X / fora / ESC). */
  onClose: () => void;
}

const formatCurrencyBRL = (n: number): string => {
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
  return formatCurrencyBRL(n);
};

/** Percentual a partir da fração (0–1), vírgula decimal pt-BR. */
const formatPctDisplay = (ratio: number, fractionDigits: number = 1): string => {
  if (!Number.isFinite(ratio)) return "0%";
  return `${(ratio * 100).toFixed(fractionDigits).replace(".", ",")}%`;
};

const truncatePieCenter = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

/** Paleta de cores estável (um índice = uma cor) — boa contrast em fundo escuro/claro. */
const PALETTE = [
  "#7c5cff", // roxo (cor de marca do app)
  "#22c55e", // verde
  "#f59e0b", // âmbar
  "#ef4444", // vermelho
  "#06b6d4", // ciano
  "#ec4899", // rosa
  "#84cc16", // lima
  "#a855f7", // violeta
  "#f97316", // laranja
  "#14b8a6", // teal
  "#eab308", // amarelo
  "#3b82f6", // azul
];

const colorFor = (i: number): string => PALETTE[i % PALETTE.length];

interface ISlice {
  agg: ISubcategoriaAggregate;
  start: number;
  end: number;
  color: string;
  pct: number;
}

const TAU = Math.PI * 2;

/**
 * Índice da fatia sob o ponteiro a partir de coordenadas no espaço do SVG.
 * Usado porque em alguns hosts (ex.: PCF no Canvas) o hit-test dos <path> da rosca falha;
 * a legenda continua usando hover direto nos <li>.
 */
function sliceIndexFromDonutPoint(
  slices: ReadonlyArray<ISlice>,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  x: number,
  y: number,
): number | null {
  if (slices.length === 0) return null;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  const margin = 14;
  if (dist < rInner - 1 || dist > rOuter + margin) return null;

  // Ângulo horário a partir do topo (12h), em [0, TAU)
  const t = ((Math.atan2(dy, dx) + Math.PI / 2) % TAU + TAU) % TAU;

  let cursor = 0;
  for (let i = 0; i < slices.length; i++) {
    const span = slices[i].pct * TAU;
    const end = cursor + span;
    const last = i === slices.length - 1;
    if (last) {
      if (t + 1e-10 >= cursor && t - 1e-10 <= end) return i;
    } else if (t + 1e-10 >= cursor && t < end - 1e-10) {
      return i;
    }
    cursor = end;
  }
  return null;
}

/** Converte ângulo (rad) → ponto na borda do círculo de raio r centrado em (cx, cy). */
const polar = (cx: number, cy: number, r: number, angle: number) => ({
  x: cx + r * Math.cos(angle),
  y: cy + r * Math.sin(angle),
});

/** Path SVG de uma fatia de donut (anel) entre dois ângulos. */
const arcPath = (
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string => {
  const largeArc = end - start > Math.PI ? 1 : 0;
  const p1 = polar(cx, cy, rOuter, start);
  const p2 = polar(cx, cy, rOuter, end);
  const p3 = polar(cx, cy, rInner, end);
  const p4 = polar(cx, cy, rInner, start);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
};

/** Geometria fixa do SVG (viewBox) — usada no hit por ângulo e no desenho. */
const PIE_SIZE = 280;
const PIE_CX = PIE_SIZE / 2;
const PIE_CY = PIE_SIZE / 2;
const PIE_R_OUT = 120;
const PIE_R_IN = 70;

export const PieChartSubcategorias: React.FC<IPieChartSubcategoriasProps> = ({
  setor,
  agregados,
  onClose,
}) => {
  const setorRotulo = setorLabelExibicao(setor);
  // Mostra apenas subcategorias com algum valor — o pie não faz sentido com fatias 0.
  const slicesBase = React.useMemo(
    () => agregados.filter((a) => a.total > 0),
    [agregados],
  );

  const total = React.useMemo(
    () => slicesBase.reduce((s, a) => s + a.total, 0),
    [slicesBase],
  );

  const slices: ISlice[] = React.useMemo(() => {
    if (total <= 0) return [];
    let acc = -Math.PI / 2; // começa no topo (12h)
    return slicesBase.map((agg, i) => {
      const pct = agg.total / total;
      const start = acc;
      const end = acc + pct * TAU;
      acc = end;
      return { agg, start, end, color: colorFor(i), pct };
    });
  }, [slicesBase, total]);

  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const pieSvgRef = React.useRef<SVGSVGElement | null>(null);
  /** Canvas / PCF: eventos no <svg> via React falham; listeners nativos no div cobrem o gráfico. */
  const pieWrapRef = React.useRef<HTMLDivElement | null>(null);

  /**
   * Só mapeamento retângulo → viewBox (sem getScreenCTM): no Power Apps o CTM costuma errar no iframe.
   */
  const updatePieHoverFromClient = React.useCallback(
    (clientX: number, clientY: number) => {
      const svg = pieSvgRef.current;
      if (!svg || slices.length === 0) return;

      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const vw = vb.width || PIE_SIZE;
      const vh = vb.height || PIE_SIZE;
      const curX = ((clientX - r.left) / Math.max(r.width, 1)) * vw;
      const curY = ((clientY - r.top) / Math.max(r.height, 1)) * vh;

      const idx = sliceIndexFromDonutPoint(
        slices,
        PIE_CX,
        PIE_CY,
        PIE_R_IN,
        PIE_R_OUT,
        curX,
        curY,
      );
      setHoverIdx(idx);
    },
    [slices],
  );

  const updatePieHoverRef = React.useRef(updatePieHoverFromClient);
  updatePieHoverRef.current = updatePieHoverFromClient;

  React.useEffect(() => {
    const wrap = pieWrapRef.current;
    if (!wrap || slices.length === 0) return;

    const apply = (cx: number, cy: number) => updatePieHoverRef.current(cx, cy);
    const fromMouse = (e: MouseEvent) => apply(e.clientX, e.clientY);
    const clear = () => setHoverIdx(null);
    const fromTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) apply(t.clientX, t.clientY);
    };

    wrap.addEventListener("mousemove", fromMouse);
    wrap.addEventListener("mouseenter", fromMouse);
    wrap.addEventListener("mouseleave", clear);
    wrap.addEventListener("pointermove", fromMouse as EventListener);
    wrap.addEventListener("pointerdown", fromMouse as EventListener);
    wrap.addEventListener("pointerleave", clear);
    wrap.addEventListener("pointercancel", clear);
    wrap.addEventListener("touchstart", fromTouch, { passive: true });
    wrap.addEventListener("touchmove", fromTouch, { passive: true });

    return () => {
      wrap.removeEventListener("mousemove", fromMouse);
      wrap.removeEventListener("mouseenter", fromMouse);
      wrap.removeEventListener("mouseleave", clear);
      wrap.removeEventListener("pointermove", fromMouse as EventListener);
      wrap.removeEventListener("pointerdown", fromMouse as EventListener);
      wrap.removeEventListener("pointerleave", clear);
      wrap.removeEventListener("pointercancel", clear);
      wrap.removeEventListener("touchstart", fromTouch);
      wrap.removeEventListener("touchmove", fromTouch);
    };
  }, [slices.length]);

  // Fecha no ESC + bloqueia scroll do body enquanto aberto.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const realizadoTotal = slicesBase.reduce((s, a) => s + a.realizado, 0);
  const projetadoTotal = slicesBase.reduce((s, a) => s + a.projetado, 0);

  const hoverSlice =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < slices.length
      ? slices[hoverIdx]
      : null;

  return (
    <div
      className="cp-pie-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Distribuição de contas contábeis do setor ${setorRotulo}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cp-pie-modal">
        <header className="cp-pie-head">
          <div>
            <div className="cp-pie-eyebrow">Distribuição por Conta Contábil</div>
            <h3 className="cp-pie-title" title={setorRotulo}>
              {setorRotulo}
            </h3>
          </div>
          <button
            type="button"
            className="cp-pie-close"
            onClick={onClose}
            aria-label="Fechar gráfico"
          >
            ×
          </button>
        </header>

        <div className="cp-pie-body">
          <div className="cp-pie-canvas-wrap">
            {slices.length === 0 ? (
              <div className="cp-pie-empty">
                Sem pedidos lançados neste setor ainda.
                <br />
                <small>
                  Cadastre pedidos com Conta Contábil deste setor para ver a distribuição.
                </small>
              </div>
            ) : (
              <div ref={pieWrapRef} className="cp-pie-chart-hit">
                <svg
                  ref={pieSvgRef}
                  className="cp-pie-svg"
                  viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}
                  role="img"
                  aria-label="Gráfico de pizza por conta contábil"
                >
                {/*
                  Texto central por baixo das fatias + pointer-events: none.
                  Com hover: nome da conta + % em destaque; sem hover: total geral.
                */}
                {hoverSlice ? (
                  <>
                    <text
                      x={PIE_CX}
                      y={PIE_CY - 8}
                      textAnchor="middle"
                      className="cp-pie-center-hover-name"
                      pointerEvents="none"
                    >
                      {truncatePieCenter(hoverSlice.agg.subcategoria, 26)}
                    </text>
                    <text
                      x={PIE_CX}
                      y={PIE_CY + 18}
                      textAnchor="middle"
                      className="cp-pie-center-hover-pct"
                      pointerEvents="none"
                    >
                      {formatPctDisplay(hoverSlice.pct)}
                    </text>
                  </>
                ) : (
                  <>
                    <text
                      x={PIE_CX}
                      y={PIE_CY - 6}
                      textAnchor="middle"
                      className="cp-pie-center-label"
                      pointerEvents="none"
                    >
                      Total
                    </text>
                    <text
                      x={PIE_CX}
                      y={PIE_CY + 16}
                      textAnchor="middle"
                      className="cp-pie-center-value"
                      pointerEvents="none"
                    >
                      {formatCurrencyCompact(total)}
                    </text>
                  </>
                )}
                <g className="cp-pie-slices">
                  {slices.map((s, i) => {
                    const isHover = hoverIdx === i;
                    // Pequeno deslocamento radial no hover para destacar a fatia.
                    const mid = (s.start + s.end) / 2;
                    const dx = isHover ? Math.cos(mid) * 6 : 0;
                    const dy = isHover ? Math.sin(mid) * 6 : 0;
                    return (
                      <path
                        key={s.agg.subcategoria}
                        className="cp-pie-slice"
                        d={arcPath(PIE_CX, PIE_CY, PIE_R_OUT, PIE_R_IN, s.start, s.end)}
                        fill={s.color}
                        opacity={hoverIdx === null || isHover ? 1 : 0.55}
                        transform={`translate(${dx} ${dy})`}
                        style={{
                          transition: "opacity 0.15s ease, transform 0.15s ease",
                          cursor: "pointer",
                          pointerEvents: "none",
                        }}
                      >
                        <title>
                          {`${s.agg.subcategoria}\n${formatCurrencyBRL(s.agg.total)} (${(s.pct * 100).toFixed(1)}%)`}
                        </title>
                      </path>
                    );
                  })}
                </g>
                </svg>
              </div>
            )}
          </div>

          <ul className="cp-pie-legend">
            {slices.map((s, i) => (
              <li
                key={s.agg.subcategoria}
                className={`cp-pie-legend-item${hoverIdx === i ? " cp-pie-legend-item--hover" : ""}`}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onPointerDown={() => setHoverIdx(i)}
                onClick={() => setHoverIdx(i)}
              >
                <span
                  className="cp-pie-legend-swatch"
                  style={{ background: s.color }}
                  aria-hidden="true"
                />
                <span className="cp-pie-legend-text">
                  <span className="cp-pie-legend-name" title={s.agg.subcategoria}>
                    {s.agg.subcategoria}
                  </span>
                  <span className="cp-pie-legend-meta">
                    {formatCurrencyBRL(s.agg.total)} · {(s.pct * 100).toFixed(1)}% ·{" "}
                    {s.agg.quantidadePedidos} pedido
                    {s.agg.quantidadePedidos === 1 ? "" : "s"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {slices.length > 0 && (
          <footer className="cp-pie-foot">
            <span>
              <strong>Realizado:</strong> {formatCurrencyBRL(realizadoTotal)}
            </span>
            <span>
              <strong>Projetado:</strong> {formatCurrencyBRL(projetadoTotal)}
            </span>
            <span>
              <strong>Total:</strong> {formatCurrencyBRL(total)}
            </span>
          </footer>
        )}
      </div>
    </div>
  );
};

export default PieChartSubcategorias;
