/**
 * Opções fixas de Centro de Custo (valor gravado = rótulo completo no Dataverse).
 */
export const CENTROS_CUSTO_OPCOES = [
  "AC010002 - Comercial Contact Center Nacional",
  "AC070011 - Pós Vendas Regional",
  "AC070017 - Comercial Contact Center Regional",
  "AC010054 - EAD - Sales Sul",
] as const;

export type CentroCustoOpcao = (typeof CENTROS_CUSTO_OPCOES)[number];

const CENTROS_CUSTO_SET = new Set<string>(CENTROS_CUSTO_OPCOES);

export function isCentroCustoCatalogado(valor: string | undefined | null): boolean {
  const v = (valor ?? "").trim();
  return v !== "" && CENTROS_CUSTO_SET.has(v);
}
