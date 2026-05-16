import * as React from "react";
import { ANIMA_BRAND } from "../constants/animaBrand";

/** Chaves de gradiente das barras (SVG + legenda). */
export type ChartBarGradKey =
  | "orcamento"
  | "realizado"
  | "saldo"
  | "saldoNeg"
  | "emAnalise"
  | "novo"
  | "accent"
  | "neutral";

export const CHART_BAR_GRADIENTS: Record<
  ChartBarGradKey,
  { base: string; light: string; dark: string }
> = {
  orcamento: { base: ANIMA_BRAND.neutral, light: "#C5CBD1", dark: "#6B7279" },
  realizado: { base: ANIMA_BRAND.green, light: "#9FE082", dark: "#4D9A32" },
  saldo: { base: ANIMA_BRAND.teal, light: "#4DD9D0", dark: "#008A82" },
  saldoNeg: { base: ANIMA_BRAND.red, light: "#FF8A82", dark: "#C42E25" },
  emAnalise: { base: ANIMA_BRAND.orange, light: "#FFAD5C", dark: "#D06A12" },
  novo: { base: ANIMA_BRAND.blue, light: "#7FD4F5", dark: "#2A94C4" },
  accent: { base: ANIMA_BRAND.purple, light: "#9B6FC4", dark: "#3D1F5C" },
  neutral: { base: ANIMA_BRAND.neutral, light: "#C5CBD1", dark: "#6B7279" },
};

export const chartBarGradId = (key: ChartBarGradKey): string =>
  `cp-chart-bar-grad-${key}`;

export const chartBarFill = (key: ChartBarGradKey): string =>
  `url(#${chartBarGradId(key)})`;

/** Legenda — barras verticais (de baixo para cima, como no SVG). */
export const chartBarLegendBg = (key: ChartBarGradKey): string => {
  const { light, base, dark } = CHART_BAR_GRADIENTS[key];
  return `linear-gradient(180deg, ${light} 0%, ${base} 48%, ${dark} 100%)`;
};

/** Barras horizontais (fornecedor). */
export const chartBarLegendBgH = (key: ChartBarGradKey): string => {
  const { light, base, dark } = CHART_BAR_GRADIENTS[key];
  return `linear-gradient(90deg, ${dark} 0%, ${base} 50%, ${light} 100%)`;
};

export const ChartBarGradientDefs: React.FC = () => (
  <defs>
    {(Object.keys(CHART_BAR_GRADIENTS) as ChartBarGradKey[]).map((key) => {
      const { light, base, dark } = CHART_BAR_GRADIENTS[key];
      return (
        <linearGradient
          key={key}
          id={chartBarGradId(key)}
          x1="0"
          y1="1"
          x2="0"
          y2="0"
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0%" stopColor={dark} />
          <stop offset="48%" stopColor={base} />
          <stop offset="100%" stopColor={light} />
        </linearGradient>
      );
    })}
  </defs>
);

const STATUS_GRAD_KEYS: Record<string, ChartBarGradKey> = {
  novo: "novo",
  "em análise": "emAnalise",
  "em analise": "emAnalise",
  confirmado: "realizado",
  cancelado: "neutral",
};

export const statusBarGradKey = (status: string): ChartBarGradKey =>
  STATUS_GRAD_KEYS[status.toLowerCase()] ?? "accent";

export const statusBarFill = (status: string): string =>
  chartBarFill(statusBarGradKey(status));

// =============================================================================
// Pizza / donut — uma cor da paleta por fatia (índice da fatia no gráfico)
// =============================================================================

/** Tons claro/escuro por cor da `ANIMA_CHART_PALETTE` (mesma ordem). */
export const PIE_SLICE_GRADIENTS: ReadonlyArray<{
  base: string;
  light: string;
  dark: string;
}> = [
  { base: ANIMA_BRAND.purple, light: "#9B6FC4", dark: "#3D1F5C" },
  { base: ANIMA_BRAND.magenta, light: "#E85CAD", dark: "#8A1559" },
  { base: ANIMA_BRAND.teal, light: "#4DD9D0", dark: "#008A82" },
  { base: ANIMA_BRAND.blue, light: "#7FD4F5", dark: "#2A94C4" },
  { base: ANIMA_BRAND.green, light: "#9FE082", dark: "#4D9A32" },
  { base: ANIMA_BRAND.orange, light: "#FFAD5C", dark: "#D06A12" },
  { base: ANIMA_BRAND.pink, light: "#FF8CB8", dark: "#C42A66" },
  { base: ANIMA_BRAND.red, light: "#FF8A82", dark: "#C42E25" },
  { base: ANIMA_BRAND.yellow, light: "#FFF06A", dark: "#C4B800" },
];

export const pieSliceGradId = (sliceIndex: number): string =>
  `cp-pie-slice-grad-${sliceIndex}`;

export const pieSliceFill = (sliceIndex: number): string =>
  `url(#${pieSliceGradId(sliceIndex)})`;

export const pieSliceLegendBg = (sliceIndex: number): string => {
  const { light, base, dark } =
    PIE_SLICE_GRADIENTS[sliceIndex % PIE_SLICE_GRADIENTS.length];
  return `linear-gradient(135deg, ${light} 0%, ${base} 48%, ${dark} 100%)`;
};

export function pieSliceGradientCoords(
  midAngle: number,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: cx + rIn * Math.cos(midAngle),
    y1: cy + rIn * Math.sin(midAngle),
    x2: cx + rOut * Math.cos(midAngle),
    y2: cy + rOut * Math.sin(midAngle),
  };
}

export const PieSliceGradientDefs: React.FC<{
  slices: ReadonlyArray<{ sliceIndex: number; start: number; end: number }>;
  cx: number;
  cy: number;
  rIn: number;
  rOut: number;
}> = ({ slices, cx, cy, rIn, rOut }) => (
  <>
    {slices.map((s) => {
      const mid = (s.start + s.end) / 2;
      const { x1, y1, x2, y2 } = pieSliceGradientCoords(mid, cx, cy, rIn, rOut);
      const { light, base, dark } =
        PIE_SLICE_GRADIENTS[s.sliceIndex % PIE_SLICE_GRADIENTS.length];
      return (
        <linearGradient
          key={pieSliceGradId(s.sliceIndex)}
          id={pieSliceGradId(s.sliceIndex)}
          gradientUnits="userSpaceOnUse"
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
        >
          <stop offset="0%" stopColor={dark} />
          <stop offset="48%" stopColor={base} />
          <stop offset="100%" stopColor={light} />
        </linearGradient>
      );
    })}
  </>
);
