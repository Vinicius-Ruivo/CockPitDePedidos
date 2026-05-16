/**
 * Paleta oficial Ânima — manual de marca (março 2023), secção «Cores».
 * Referência Pantone → hex conforme documento.
 */
export const ANIMA_BRAND = {
  purple: "#5B2D82",
  magenta: "#B51E84",
  blue: "#42B4E4",
  green: "#6FBF4A",
  orange: "#F58220",
  teal: "#00B4AA",
  yellow: "#F4E501",
  red: "#F0483E",
  pink: "#E84683",
  purpleDeep: "#3F2259",
  bgDark: "#1A0F26",
  neutral: "#9AA0A6",
} as const;

/** Hierarquia web do manual (Roboto → Open Sans → Helvetica → Arial). */
export const ANIMA_FONT_STACK =
  'Roboto, "Open Sans", Helvetica, Arial, sans-serif';

/** Gradiente institucional (roxo → magenta), uso em fundos e destaques. */
export const ANIMA_GRADIENT_HERO = `linear-gradient(90deg, ${ANIMA_BRAND.purple} 0%, ${ANIMA_BRAND.magenta} 100%)`;

/** Gradiente escuro (painéis / modo noturno). */
export const ANIMA_GRADIENT_DARK = `linear-gradient(180deg, ${ANIMA_BRAND.purple} 0%, #3f2259 45%, #1a0f26 100%)`;

/** Fatias de gráficos — combinações vivas da paleta. */
export const ANIMA_CHART_PALETTE: readonly string[] = [
  ANIMA_BRAND.purple,
  ANIMA_BRAND.magenta,
  ANIMA_BRAND.teal,
  ANIMA_BRAND.blue,
  ANIMA_BRAND.green,
  ANIMA_BRAND.orange,
  ANIMA_BRAND.pink,
  ANIMA_BRAND.red,
  ANIMA_BRAND.yellow,
];
