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

  const SIZE = 280;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R_OUT = 120;
  const R_IN = 70;

  const realizadoTotal = slicesBase.reduce((s, a) => s + a.realizado, 0);
  const projetadoTotal = slicesBase.reduce((s, a) => s + a.projetado, 0);

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
              <svg
                className="cp-pie-svg"
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                role="img"
                aria-label="Gráfico de pizza por conta contábil"
              >
                <g>
                  {slices.map((s, i) => {
                    const isHover = hoverIdx === i;
                    // Pequeno deslocamento radial no hover para destacar a fatia.
                    const mid = (s.start + s.end) / 2;
                    const dx = isHover ? Math.cos(mid) * 6 : 0;
                    const dy = isHover ? Math.sin(mid) * 6 : 0;
                    return (
                      <path
                        key={s.agg.subcategoria}
                        d={arcPath(CX, CY, R_OUT, R_IN, s.start, s.end)}
                        fill={s.color}
                        opacity={hoverIdx === null || isHover ? 1 : 0.55}
                        transform={`translate(${dx} ${dy})`}
                        onMouseEnter={() => setHoverIdx(i)}
                        onMouseLeave={() => setHoverIdx(null)}
                        style={{ transition: "opacity 0.15s ease, transform 0.15s ease" }}
                      >
                        <title>
                          {`${s.agg.subcategoria}\n${formatCurrencyBRL(s.agg.total)} (${(s.pct * 100).toFixed(1)}%)`}
                        </title>
                      </path>
                    );
                  })}
                </g>
                <text
                  x={CX}
                  y={CY - 6}
                  textAnchor="middle"
                  className="cp-pie-center-label"
                >
                  Total
                </text>
                <text
                  x={CX}
                  y={CY + 16}
                  textAnchor="middle"
                  className="cp-pie-center-value"
                >
                  {formatCurrencyCompact(total)}
                </text>
              </svg>
            )}
          </div>

          <ul className="cp-pie-legend">
            {slices.map((s, i) => (
              <li
                key={s.agg.subcategoria}
                className={`cp-pie-legend-item${hoverIdx === i ? " cp-pie-legend-item--hover" : ""}`}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
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
