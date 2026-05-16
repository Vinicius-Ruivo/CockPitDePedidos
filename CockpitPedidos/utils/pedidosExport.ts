import * as XLSX from "xlsx";
import { IPedido } from "../types";

export type ExportPedidoColumn = {
  header: string;
  value: (p: IPedido) => string;
};

const formatCurrencyExport = (n?: number): string => {
  if (n == null || !Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
};

const formatDateTimeExport = (d?: Date): string => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
};

const formatCompetenciaExport = (
  competencia?: string,
  dataSolicitacao?: Date,
): string => {
  if ((competencia ?? "").trim()) return competencia?.trim() ?? "";
  const d = dataSolicitacao;
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
  const meses = [
    "JANEIRO",
    "FEVEREIRO",
    "MARCO",
    "ABRIL",
    "MAIO",
    "JUNHO",
    "JULHO",
    "AGOSTO",
    "SETEMBRO",
    "OUTUBRO",
    "NOVEMBRO",
    "DEZEMBRO",
  ] as const;
  return `${meses[d.getMonth()]}/${d.getFullYear()}`;
};

const cell = (v: unknown): string => (v == null ? "" : String(v));

/** Colunas do export «Empenhado & Comprometido» (layout EC legado). */
export const EXPORT_EC_COLUMNS: ReadonlyArray<ExportPedidoColumn> = [
  { header: "MARCA", value: (p) => cell(p.marca) },
  { header: "DIRETORIA", value: (p) => cell(p.diretoria) },
  { header: "CENTRO DE CUSTO", value: (p) => cell(p.centroCusto) },
  { header: "FORNECEDOR", value: (p) => cell(p.fornecedor) },
  { header: "DESPESA", value: (p) => cell(p.despesa) },
  { header: "VALOR", value: (p) => formatCurrencyExport(p.valor) },
  {
    header: "COMPETENCIA",
    value: (p) => formatCompetenciaExport(p.competencia, p.dataSolicitacao),
  },
  { header: "STATUS", value: (p) => cell(p.status) },
  { header: "NUMERO DE REQUISICAO", value: (p) => cell(p.numeroRequisicao) },
  { header: "N° NOTA", value: (p) => cell(p.numeroNota) },
  { header: "CONTA CONTABIL", value: (p) => cell(p.contaContabil) },
];

/** Todas as colunas do pedido no Cockpit / Dataverse. */
export const EXPORT_TUDO_COLUMNS: ReadonlyArray<ExportPedidoColumn> = [
  { header: "ID", value: (p) => cell(p.id) },
  { header: "TITULO DO PEDIDO", value: (p) => cell(p.tituloPedido) },
  { header: "DATA SOLICITACAO", value: (p) => formatDateTimeExport(p.dataSolicitacao) },
  {
    header: "COMPETENCIA",
    value: (p) => formatCompetenciaExport(p.competencia, p.dataSolicitacao),
  },
  { header: "MARCA", value: (p) => cell(p.marca) },
  { header: "DIRETORIA", value: (p) => cell(p.diretoria) },
  { header: "DESPESA", value: (p) => cell(p.despesa) },
  { header: "QUANTIDADE", value: (p) => cell(p.quantidade) },
  { header: "SOLICITANTE", value: (p) => cell(p.solicitante) },
  { header: "FORNECEDOR", value: (p) => cell(p.fornecedor) },
  { header: "CNPJ", value: (p) => cell(p.cnpj) },
  { header: "NUMERO DE ORCAMENTO", value: (p) => cell(p.numeroOrcamento) },
  { header: "VALOR", value: (p) => formatCurrencyExport(p.valor) },
  { header: "RESPONSAVEL", value: (p) => cell(p.responsavel) },
  { header: "NUMERO DE CHAMADO", value: (p) => cell(p.numeroChamado) },
  { header: "TEMPO UM", value: (p) => cell(p.tempoUm) },
  { header: "NATUREZA", value: (p) => cell(p.natureza) },
  { header: "NUMERO DE REQUISICAO", value: (p) => cell(p.numeroRequisicao) },
  { header: "TEMPO DOIS", value: (p) => cell(p.tempoDois) },
  { header: "CENTRO DE CUSTO", value: (p) => cell(p.centroCusto) },
  { header: "CONTA CONTABIL", value: (p) => cell(p.contaContabil) },
  { header: "NUMERO DA NOTA", value: (p) => cell(p.numeroNota) },
  { header: "VENCIMENTO", value: (p) => cell(p.vencimento) },
  { header: "ORDEM DE COMPRA", value: (p) => cell(p.ordemCompra) },
  { header: "STATUS", value: (p) => cell(p.status) },
  { header: "SETOR", value: (p) => cell(p.setor) },
];

export function exportPedidosPlanilha(
  pedidos: ReadonlyArray<IPedido>,
  columns: ReadonlyArray<ExportPedidoColumn>,
  downloadFilename: string,
): void {
  const headers = columns.map((c) => c.header);
  const rows = pedidos.map((p) => columns.map((c) => c.value(p)));
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = headers.map((_, colIdx) => {
    const maxLen = aoa.reduce((acc, row) => {
      const cellText = String(row[colIdx] ?? "");
      return Math.max(acc, cellText.length);
    }, 0);
    return { wch: Math.min(60, Math.max(12, maxLen + 2)) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pedidos");
  const xlsxBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([xlsxBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = downloadFilename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
