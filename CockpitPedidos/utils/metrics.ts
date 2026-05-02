/**
 * Funções puras de agregação para o Dashboard.
 * Nenhuma depende de React ou PCF — fáceis de testar isoladamente.
 */

import {
  IHistoricoOrcamentos,
  IOrcamentosPayload,
  IPedido,
  ISetorAggregate,
  ISubcategoriaAggregate,
  MesISO,
  OrcamentosContasMap,
  OrcamentosMap,
} from "../types";
import { findSetorBySubcategoria } from "../constants/setoresOrganizacao";

const SEM_SETOR_LABEL = "Sem setor";

const normalizarStatus = (status?: string): string =>
  (status ?? "").toLowerCase().trim();

/** Só pedidos com status Confirmado entram no "realizado" (consumo de orçamento). */
const isConfirmado = (status?: string): boolean =>
  normalizarStatus(status) === "confirmado";

const isEmAnalise = (status?: string): boolean => {
  const s = normalizarStatus(status);
  return s === "em análise" || s === "em analise";
};

const isNovo = (status?: string): boolean => normalizarStatus(status) === "novo";

/** Soma de valores apenas de pedidos confirmados. */
const sumValorRealizado = (pedidos: IPedido[]): number =>
  pedidos
    .filter((p) => isConfirmado(p.status))
    .reduce((acc, p) => acc + (p.valor ?? 0), 0);

/** Soma dos valores de pedidos ainda não confirmados (projeção até virar realizado). */
const sumValorProjetado = (pedidos: IPedido[]): number =>
  pedidos
    .filter((p) => !isConfirmado(p.status))
    .reduce((acc, p) => acc + (p.valor ?? 0), 0);

interface IBucketStatus {
  realizado: number;
  emAnalise: number;
  novo: number;
  outros: number;
}

/** Soma os valores por status (Confirmado, Em Análise, Novo, demais) num único pass. */
const bucketizarPorStatus = (pedidos: IPedido[]): IBucketStatus => {
  const out: IBucketStatus = { realizado: 0, emAnalise: 0, novo: 0, outros: 0 };
  pedidos.forEach((p) => {
    const v = p.valor ?? 0;
    if (isConfirmado(p.status)) out.realizado += v;
    else if (isEmAnalise(p.status)) out.emAnalise += v;
    else if (isNovo(p.status)) out.novo += v;
    else out.outros += v;
  });
  return out;
};

/** Lista única e ordenada dos setores presentes nos pedidos.
 *  Usada no autocomplete do PedidoForm. */
export function distinctSetores(pedidos: IPedido[]): string[] {
  const set = new Set<string>();
  pedidos.forEach((p) => {
    const s = (p.setor ?? "").trim();
    if (s) set.add(s);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Ordem de exibição na lista: quem chegou primeiro (data de solicitação mais antiga)
 * fica em cima. Sem data válida vai para o fim; empate por id.
 */
export function ordenarPedidosPorChegada(pedidos: ReadonlyArray<IPedido>): IPedido[] {
  return [...pedidos].sort((a, b) => {
    const ta = a.dataSolicitacao?.getTime();
    const tb = b.dataSolicitacao?.getTime();
    const aOk = ta != null && !isNaN(ta);
    const bOk = tb != null && !isNaN(tb);
    if (aOk && bOk && ta !== tb) return ta - tb;
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    return a.id.localeCompare(b.id);
  });
}

/** Agrega pedidos por setor, cruzando com o mapa de orçamentos.
 *  Regras:
 *   - "Realizado" = soma dos valores dos pedidos do setor com status **Confirmado**.
 *   - Setores que aparecem em pedidos MAS não estão em `orcamentos` têm
 *     orçamento=0 (saldo negativo → indica extrapolação).
 *   - Setores em `orcamentos` SEM pedidos ainda aparecem (saldo = orçamento).
 *   - Setores passados em `setoresBase` SEMPRE aparecem (mesmo sem pedido
 *     e sem orçamento) — útil para manter os 6 aglutinadores oficiais
 *     visíveis no painel "Resumo de orçamento por setor".
 *
 * Ordenação: mantém a ordem de `setoresBase` para os setores conhecidos e
 * desempata os demais por realizado desc.
 */
export function agregarPorSetor(
  pedidos: IPedido[],
  orcamentos: OrcamentosMap,
  setoresBase: ReadonlyArray<string> = [],
): ISetorAggregate[] {
  const grupos = new Map<string, IPedido[]>();

  pedidos.forEach((p) => {
    const key = (p.setor ?? "").trim() || SEM_SETOR_LABEL;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(p);
  });

  Object.keys(orcamentos).forEach((setor) => {
    if (!grupos.has(setor)) grupos.set(setor, []);
  });

  setoresBase.forEach((setor) => {
    if (!grupos.has(setor)) grupos.set(setor, []);
  });

  // Ordem canônica dos setores base (05 → 10, etc.) para usar como desempate.
  const indiceCanonico = new Map<string, number>();
  setoresBase.forEach((s, i) => indiceCanonico.set(s, i));

  const result: ISetorAggregate[] = [];
  grupos.forEach((pedidosDoSetor, setor) => {
    const buckets = bucketizarPorStatus(pedidosDoSetor);
    const { realizado, emAnalise, novo, outros } = buckets;
    const comprometido = realizado + emAnalise + novo;
    const orcamento = orcamentos[setor] ?? 0;
    const saldo = orcamento - realizado;
    const saldoProjetado = orcamento - comprometido;
    const percentualConsumido =
      orcamento > 0 ? Math.min(100, (realizado / orcamento) * 100) : 0;
    const percentualComprometido =
      orcamento > 0 ? (comprometido / orcamento) * 100 : 0;

    result.push({
      setor,
      orcamento,
      realizado,
      emAnalise,
      novo,
      outros,
      comprometido,
      saldo,
      saldoProjetado,
      percentualConsumido,
      percentualComprometido,
      quantidadePedidos: pedidosDoSetor.length,
    });
  });

  return result.sort((a, b) => {
    // 1) Setores canônicos primeiro, em ordem de catálogo (05 → 10).
    const ia = indiceCanonico.has(a.setor)
      ? indiceCanonico.get(a.setor)!
      : Number.POSITIVE_INFINITY;
    const ib = indiceCanonico.has(b.setor)
      ? indiceCanonico.get(b.setor)!
      : Number.POSITIVE_INFINITY;
    if (ia !== ib) return ia - ib;
    // 2) Demais (não canônicos) por realizado desc.
    return b.realizado - a.realizado;
  });
}

const SEM_CONTA_LABEL = "Sem conta contábil";

/**
 * Agrega pedidos por **conta contábil** (campo `contaContabil`), cruzando com
 * `orcamentos.contas`. Reutiliza `ISetorAggregate` com `setor` = rótulo da conta.
 *
 * Regras alinhadas a `agregarPorSetor`: realizado só com Confirmado; contas
 * presentes só no orçamento aparecem com pedidos vazios; «Sem conta contábil» por último.
 */
export function agregarPorContaContabil(
  pedidos: IPedido[],
  orcamentosContas: Readonly<OrcamentosContasMap>,
): ISetorAggregate[] {
  const grupos = new Map<string, IPedido[]>();

  pedidos.forEach((p) => {
    const key = (p.contaContabil ?? "").trim() || SEM_CONTA_LABEL;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(p);
  });

  Object.keys(orcamentosContas).forEach((conta) => {
    if (!grupos.has(conta)) grupos.set(conta, []);
  });

  const catalogKeys = Object.keys(orcamentosContas).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const indiceCanonico = new Map<string, number>();
  catalogKeys.forEach((k, i) => indiceCanonico.set(k, i));

  const result: ISetorAggregate[] = [];
  grupos.forEach((pedidosDaConta, setor) => {
    const buckets = bucketizarPorStatus(pedidosDaConta);
    const { realizado, emAnalise, novo, outros } = buckets;
    const comprometido = realizado + emAnalise + novo;
    const orcamento = orcamentosContas[setor] ?? 0;
    const saldo = orcamento - realizado;
    const saldoProjetado = orcamento - comprometido;
    const percentualConsumido =
      orcamento > 0 ? Math.min(100, (realizado / orcamento) * 100) : 0;
    const percentualComprometido =
      orcamento > 0 ? (comprometido / orcamento) * 100 : 0;

    result.push({
      setor,
      orcamento,
      realizado,
      emAnalise,
      novo,
      outros,
      comprometido,
      saldo,
      saldoProjetado,
      percentualConsumido,
      percentualComprometido,
      quantidadePedidos: pedidosDaConta.length,
    });
  });

  return result.sort((a, b) => {
    const semA = a.setor === SEM_CONTA_LABEL;
    const semB = b.setor === SEM_CONTA_LABEL;
    if (semA !== semB) return semA ? 1 : -1;
    const ia = indiceCanonico.has(a.setor)
      ? indiceCanonico.get(a.setor)!
      : Number.POSITIVE_INFINITY;
    const ib = indiceCanonico.has(b.setor)
      ? indiceCanonico.get(b.setor)!
      : Number.POSITIVE_INFINITY;
    if (ia !== ib) return ia - ib;
    return b.realizado - a.realizado;
  });
}

/**
 * Agrega os pedidos de UM setor por subcategoria (Conta Contábil).
 *
 * Regras:
 *  - Pertencem ao setor os pedidos cujo `setor` bate (após trim) com o `setor`
 *    pedido OU cuja `contaContabil` aponta para o mesmo setor canônico
 *    (`findSetorBySubcategoria`). Isso cobre pedidos antigos que ficaram com
 *    `setor` em branco.
 *  - Cada conta contábil distinta vira uma linha. Pedidos sem `contaContabil`
 *    são agrupados em "Sem conta contábil".
 *  - `subcategoriasBase` (catálogo oficial do setor) garante que toda subcategoria
 *    apareça mesmo sem pedido — o gráfico de pizza ignora as zeradas, mas a
 *    lista expandida no resumo continua mostrando todas.
 */
export function agregarPorSubcategoria(
  pedidos: IPedido[],
  setor: string,
  subcategoriasBase: ReadonlyArray<string> = [],
  orcamentosConta: Readonly<Record<string, number>> = {},
): ISubcategoriaAggregate[] {
  const setorAlvo = (setor ?? "").trim();
  if (!setorAlvo) return [];

  const grupos = new Map<string, IPedido[]>();

  pedidos.forEach((p) => {
    const setorDoPedido =
      (p.setor ?? "").trim() ||
      findSetorBySubcategoria(p.contaContabil) ||
      "";
    if (setorDoPedido !== setorAlvo) return;

    const conta = (p.contaContabil ?? "").trim() || SEM_CONTA_LABEL;
    if (!grupos.has(conta)) grupos.set(conta, []);
    grupos.get(conta)!.push(p);
  });

  subcategoriasBase.forEach((sub) => {
    const k = sub.trim();
    if (k && !grupos.has(k)) grupos.set(k, []);
  });

  const indiceCanonico = new Map<string, number>();
  subcategoriasBase.forEach((s, i) => indiceCanonico.set(s.trim(), i));

  const result: ISubcategoriaAggregate[] = [];
  grupos.forEach((pedidosDaConta, subcategoria) => {
    const realizado = sumValorRealizado(pedidosDaConta);
    const projetado = sumValorProjetado(pedidosDaConta);
    const orcConta = orcamentosConta[subcategoria] ?? 0;
    result.push({
      subcategoria,
      realizado,
      projetado,
      total: realizado + projetado,
      quantidadePedidos: pedidosDaConta.length,
      orcamento: Number.isFinite(orcConta) ? Math.max(0, orcConta) : 0,
    });
  });

  return result.sort((a, b) => {
    const ia = indiceCanonico.has(a.subcategoria)
      ? indiceCanonico.get(a.subcategoria)!
      : Number.POSITIVE_INFINITY;
    const ib = indiceCanonico.has(b.subcategoria)
      ? indiceCanonico.get(b.subcategoria)!
      : Number.POSITIVE_INFINITY;
    if (ia !== ib) return ia - ib;
    if (b.total !== a.total) return b.total - a.total;
    return a.subcategoria.localeCompare(b.subcategoria, "pt-BR");
  });
}

/** Totais globais para o topo do dashboard. */
export function totaisGlobais(
  pedidos: IPedido[],
  orcamentos: OrcamentosMap,
): {
  orcamentoTotal: number;
  realizadoTotal: number;
  projetadoTotal: number;
  saldoTotal: number;
  qtdPedidos: number;
  qtdPendentes: number;
} {
  const orcamentoTotal = Object.values(orcamentos).reduce(
    (acc, v) => acc + (v ?? 0),
    0,
  );
  const realizadoTotal = sumValorRealizado(pedidos);
  const projetadoTotal = sumValorProjetado(pedidos);
  const qtdPendentes = pedidos.filter(
    (p) => (p.status ?? "").toLowerCase() !== "confirmado",
  ).length;

  return {
    orcamentoTotal,
    realizadoTotal,
    projetadoTotal,
    saldoTotal: orcamentoTotal - realizadoTotal,
    qtdPedidos: pedidos.length,
    qtdPendentes,
  };
}

/** Contagem de pedidos por status (para o gráfico "Qtd por status"). */
export function agregarPorStatus(
  pedidos: IPedido[],
): Array<{ status: string; quantidade: number; valorTotal: number }> {
  const grupos = new Map<string, { qtd: number; valor: number }>();
  pedidos.forEach((p) => {
    const key = p.status?.trim() || "Sem status";
    if (!grupos.has(key)) grupos.set(key, { qtd: 0, valor: 0 });
    const g = grupos.get(key)!;
    g.qtd += 1;
    g.valor += p.valor ?? 0;
  });

  return Array.from(grupos.entries())
    .map(([status, v]) => ({
      status,
      quantidade: v.qtd,
      valorTotal: v.valor,
    }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

/** Evolução mensal do valor total (para gráfico de série temporal). */
export function agregarPorMes(
  pedidos: IPedido[],
): Array<{ mesISO: string; mesLabel: string; valorTotal: number; qtd: number }> {
  const grupos = new Map<string, { valor: number; qtd: number }>();

  pedidos.forEach((p) => {
    const d = p.dataSolicitacao;
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!grupos.has(key)) grupos.set(key, { valor: 0, qtd: 0 });
    const g = grupos.get(key)!;
    g.valor += p.valor ?? 0;
    g.qtd += 1;
  });

  const labels = [
    "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
    "Jul", "Ago", "Set", "Out", "Nov", "Dez",
  ];

  return Array.from(grupos.entries())
    .map(([key, v]) => {
      const [y, m] = key.split("-").map(Number);
      return {
        mesISO: key,
        mesLabel: `${labels[m - 1]}/${String(y).slice(2)}`,
        valorTotal: v.valor,
        qtd: v.qtd,
      };
    })
    .sort((a, b) => a.mesISO.localeCompare(b.mesISO));
}

/** Contagem e valor total por fornecedor. */
export function agregarPorFornecedor(
  pedidos: IPedido[],
): Array<{ fornecedor: string; quantidade: number; valorTotal: number }> {
  const grupos = new Map<string, { qtd: number; valor: number }>();
  pedidos.forEach((p) => {
    const key = p.fornecedor?.trim() || "Sem fornecedor";
    if (!grupos.has(key)) grupos.set(key, { qtd: 0, valor: 0 });
    const g = grupos.get(key)!;
    g.qtd += 1;
    g.valor += p.valor ?? 0;
  });

  return Array.from(grupos.entries())
    .map(([fornecedor, v]) => ({
      fornecedor,
      quantidade: v.qtd,
      valorTotal: v.valor,
    }))
    .sort((a, b) => b.valorTotal - a.valorTotal);
}

/** Snapshot completo da projeção orçamentária — alimenta os KPIs de cabeçalho dos gráficos. */
export function totaisProjecao(
  pedidos: IPedido[],
  orcamentos: OrcamentosMap,
): {
  orcamentoTotal: number;
  realizadoTotal: number;
  emAnaliseTotal: number;
  novoTotal: number;
  comprometidoTotal: number;
  saldoTotal: number;
  saldoProjetadoTotal: number;
  percentualConsumido: number;
  percentualComprometido: number;
  qtdPedidos: number;
  qtdEmAnalise: number;
  qtdNovo: number;
  qtdConfirmado: number;
} {
  const orcamentoTotal = Object.values(orcamentos).reduce(
    (acc, v) => acc + (v ?? 0),
    0,
  );
  const buckets = bucketizarPorStatus(pedidos);
  const realizadoTotal = buckets.realizado;
  const emAnaliseTotal = buckets.emAnalise;
  const novoTotal = buckets.novo;
  const comprometidoTotal = realizadoTotal + emAnaliseTotal + novoTotal;
  const saldoTotal = orcamentoTotal - realizadoTotal;
  const saldoProjetadoTotal = orcamentoTotal - comprometidoTotal;
  const percentualConsumido =
    orcamentoTotal > 0 ? (realizadoTotal / orcamentoTotal) * 100 : 0;
  const percentualComprometido =
    orcamentoTotal > 0 ? (comprometidoTotal / orcamentoTotal) * 100 : 0;

  let qtdEmAnalise = 0;
  let qtdNovo = 0;
  let qtdConfirmado = 0;
  pedidos.forEach((p) => {
    if (isConfirmado(p.status)) qtdConfirmado += 1;
    else if (isEmAnalise(p.status)) qtdEmAnalise += 1;
    else if (isNovo(p.status)) qtdNovo += 1;
  });

  return {
    orcamentoTotal,
    realizadoTotal,
    emAnaliseTotal,
    novoTotal,
    comprometidoTotal,
    saldoTotal,
    saldoProjetadoTotal,
    percentualConsumido,
    percentualComprometido,
    qtdPedidos: pedidos.length,
    qtdEmAnalise,
    qtdNovo,
    qtdConfirmado,
  };
}

/** Só o mapa por setor (legado) — gera o novo JSON com `contas` vazio. */
export function serializeOrcamentosJson(map: OrcamentosMap): string {
  return serializeOrcamentosPayload({ setores: map, contas: {} });
}

/** Formato canônico na saída: `setores` + `contas`. */
export function serializeOrcamentosPayload(p: IOrcamentosPayload): string {
  const setores: Record<string, number> = {};
  Object.keys(p.setores)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .forEach((k) => {
      setores[k] = p.setores[k];
    });
  const contas: Record<string, number> = {};
  Object.keys(p.contas)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .forEach((k) => {
      contas[k] = p.contas[k];
    });
  return JSON.stringify({ setores, contas });
}

/** Converte valor JSON (número ou string numérica pt-BR/US) para número finito. */
function parseOrcamentoValor(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.trim().replace(/\s/g, "");
    if (!t) return undefined;
    let n = Number(t);
    if (!Number.isNaN(n)) return n;
    // pt-BR: 1.234,56 → 1234.56
    const br = t.replace(/\./g, "").replace(",", ".");
    n = Number(br);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

const CONTAS_KEY = "contas";
const SETORES_KEY = "setores";

function numMapFromUnknown(
  src: Record<string, unknown> | null | undefined,
): Record<string, number> {
  if (!src || typeof src !== "object") return {};
  const out: Record<string, number> = {};
  Object.entries(src).forEach(([k, v]) => {
    const n = parseOrcamentoValor(v);
    if (n !== undefined && !Number.isNaN(n)) out[k] = n;
  });
  return out;
}

/**
 * Faz o parse de `orcamentosJson`.
 * - Formato **novo**: `{ "setores": {…}, "contas": {…} }`
 * - Formato **antigo** (só teto por setor): `{"05.…": 1, "06.…": 2}` cai
 *   inteiro em `setores`.
 * - Misto: `{ "05.…": 1, "contas": { "33… - …": 2 } }` (setores no root + chave contas)
 */
export function parseOrcamentosPayload(
  raw?: string | null,
): IOrcamentosPayload {
  if (raw == null || typeof raw !== "string") {
    return { setores: {}, contas: {} };
  }
  let s = raw.trim();
  if (!s) return { setores: {}, contas: {} };
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { setores: {}, contas: {} };
    }
    const o = parsed as Record<string, unknown>;

    if (SETORES_KEY in o) {
      const setores = numMapFromUnknown(o[SETORES_KEY] as Record<string, unknown>);
      const contas = CONTAS_KEY in o
        ? numMapFromUnknown(o[CONTAS_KEY] as Record<string, unknown>)
        : {};
      return { setores, contas };
    }

    const contas = CONTAS_KEY in o
      ? numMapFromUnknown(o[CONTAS_KEY] as Record<string, unknown>)
      : {};
    const setores: Record<string, number> = {};
    Object.entries(o).forEach(([k, v]) => {
      if (k === CONTAS_KEY) return;
      if (k === SETORES_KEY) return;
      const n = parseOrcamentoValor(v);
      if (n !== undefined && !Number.isNaN(n)) setores[k] = n;
    });
    return { setores, contas };
  } catch {
    return { setores: {}, contas: {} };
  }
}

/**
 * Só a coluna/linha de "contas" (mapa rótulo → R$).
 * Aceita `{"contas":{…}}` ou o mapa plano `{"33… - …": 1}`.
 */
export function parseOrcamentosContasSoltos(
  raw?: string | null,
): Record<string, number> {
  if (raw == null || typeof raw !== "string") return {};
  let s = raw.trim();
  if (!s) return {};
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const o = parsed as Record<string, unknown>;
    if (CONTAS_KEY in o) {
      return numMapFromUnknown(
        o[CONTAS_KEY] as Record<string, unknown>,
      );
    }
    const copy: Record<string, unknown> = { ...o };
    if (SETORES_KEY in copy) delete copy[SETORES_KEY];
    return numMapFromUnknown(copy);
  } catch {
    return {};
  }
}

/**
 * Junta 1.ª coluna (mapa geral) + 2.ª (só contas) num único `IOrcamentosPayload`.
 * As contas da 2.ª têm prioridade se a chave chocar.
 */
export function buildOrcamentosFromInputs(
  rawMain: string,
  rawContas: string,
): IOrcamentosPayload {
  const a = parseOrcamentosPayload(rawMain);
  const c2 = rawContas.trim() ? parseOrcamentosContasSoltos(rawContas) : {};
  return {
    setores: { ...a.setores },
    contas: { ...a.contas, ...c2 },
  };
}

/** Mapa { chave: número } → string JSON, chaves em ordem pt-BR. */
export function serializeNumberMap(
  map: Readonly<Record<string, number>>,
): string {
  const out: Record<string, number> = {};
  Object.keys(map)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .forEach((k) => {
      out[k] = map[k];
    });
  return JSON.stringify(out);
}

/**
 * @deprecated use `parseOrcamentosPayload` — retorna **apenas** `setores` para
 * código muito legado. Preferir `parseOrcamentosPayload`.
 */
export function parseOrcamentosJson(raw?: string | null): Record<string, number> {
  return { ...parseOrcamentosPayload(raw).setores };
}

// =============================================================================
// Histórico mensal de orçamentos
// =============================================================================

const MES_ISO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `MesISO` da data dada (calendário **local**). `undefined` se inválida. */
export function mesISODe(d: Date | undefined | null): MesISO | undefined {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return undefined;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** `MesISO` do "agora" — usa o relógio do dispositivo do utilizador. */
export function mesISOAtual(now: Date = new Date()): MesISO {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function isMesISOValido(s: string): s is MesISO {
  return typeof s === "string" && MES_ISO_REGEX.test(s);
}

/**
 * Normaliza chaves vindas do Dataverse / Power Fx: `2026-2`, espaços, etc.
 * → `2026-02`. Chaves inválidas → `undefined`.
 */
export function normalizarChaveCompetenciaMesISO(k: string): MesISO | undefined {
  const s = k.trim();
  if (isMesISOValido(s)) return s;
  const m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (!m) return undefined;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return undefined;
  const canon = `${m[1]}-${String(mo).padStart(2, "0")}`;
  return isMesISOValido(canon) ? canon : undefined;
}

/** Rótulo curto pt-BR da competência. Ex.: `2026-05` → `Maio/26`. */
export function mesISOLabel(mes: MesISO): string {
  if (!isMesISOValido(mes)) return mes;
  const [yStr, mStr] = mes.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const NOMES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return `${NOMES[m - 1]}/${String(y).slice(2)}`;
}

/**
 * Faz parse do JSON do histórico. Aceita:
 * - `{ "2026-04": { "setores": {...}, "contas": {...} }, "2026-05": { ... } }` (canônico)
 * - Valores por mês podem vir como objeto ou como **string JSON** (coluna texto).
 * - Chaves `YYYY-M` são normalizadas para `YYYY-MM`.
 */
export function parseHistoricoOrcamentos(
  raw?: string | null,
): IHistoricoOrcamentos {
  if (raw == null || typeof raw !== "string") return {};
  let s = raw.trim();
  if (!s) return {};
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<MesISO, IOrcamentosPayload> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([k, v]) => {
    const mesKey = normalizarChaveCompetenciaMesISO(k);
    if (!mesKey) return;

    let obj: unknown = v;
    if (typeof v === "string") {
      try {
        const inner = JSON.parse(v.trim());
        if (inner && typeof inner === "object" && !Array.isArray(inner)) {
          obj = inner;
        } else {
          return;
        }
      } catch {
        return;
      }
    }

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    const o = obj as Record<string, unknown>;
    const setores = numMapFromUnknown(
      (o[SETORES_KEY] ?? {}) as Record<string, unknown>,
    );
    const contas = numMapFromUnknown(
      (o[CONTAS_KEY] ?? {}) as Record<string, unknown>,
    );
    out[mesKey] = { setores, contas };
  });
  return out;
}

/** JSON canônico do histórico — chaves ordenadas crescentes. */
export function serializeHistoricoOrcamentos(h: IHistoricoOrcamentos): string {
  const sorted: Record<string, { setores: Record<string, number>; contas: Record<string, number> }> = {};
  Object.keys(h)
    .filter(isMesISOValido)
    .sort()
    .forEach((mes) => {
      const p = h[mes];
      const setores: Record<string, number> = {};
      Object.keys(p.setores)
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .forEach((k) => {
          setores[k] = p.setores[k];
        });
      const contas: Record<string, number> = {};
      Object.keys(p.contas)
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .forEach((k) => {
          contas[k] = p.contas[k];
        });
      sorted[mes] = { setores, contas };
    });
  return JSON.stringify(sorted);
}

/** Lista as competências arquivadas, ordem crescente. */
export function mesesArquivados(h: IHistoricoOrcamentos): MesISO[] {
  return Object.keys(h).filter(isMesISOValido).sort();
}

/** Devolve o payload daquele mês (vazio se inexistente). */
export function orcamentosDoMes(
  h: IHistoricoOrcamentos,
  mes: MesISO,
): IOrcamentosPayload {
  const p = h[mes];
  return p ?? { setores: {}, contas: {} };
}

/**
 * Garante que o slot do `mes` existe em `h`. Se não existir, cria com payload
 * vazio (decisão do produto: novo mês começa zerado). Devolve o histórico novo
 * e um flag `criou` para o chamador saber que deve emitir aos outputs.
 */
export function garantirSlotDoMes(
  h: IHistoricoOrcamentos,
  mes: MesISO,
): { historico: IHistoricoOrcamentos; criou: boolean } {
  if (!isMesISOValido(mes)) return { historico: h, criou: false };
  if (h[mes]) return { historico: h, criou: false };
  return {
    historico: { ...h, [mes]: { setores: {}, contas: {} } },
    criou: true,
  };
}

/** Substitui o slot do `mes` por `payload` (cópia rasa). */
export function setSlotDoMes(
  h: IHistoricoOrcamentos,
  mes: MesISO,
  payload: IOrcamentosPayload,
): IHistoricoOrcamentos {
  return {
    ...h,
    [mes]: {
      setores: { ...payload.setores },
      contas: { ...payload.contas },
    },
  };
}

/** Avança um mês (calendário gregoriano). */
export function mesISOProximo(mes: MesISO): MesISO {
  if (!isMesISOValido(mes)) return mesISOAtual();
  const [yS, mS] = mes.split("-");
  let y = Number(yS);
  let m = Number(mS);
  m += 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Lista cada `MesISO` de `inclusive` a `inclusive` (ordem crescente). */
export function enumerateMesesInclusive(inicio: MesISO, fim: MesISO): MesISO[] {
  const lo = inicio <= fim ? inicio : fim;
  const hi = inicio <= fim ? fim : inicio;
  const out: MesISO[] = [];
  let cur: MesISO = lo;
  for (let guard = 0; guard < 600; guard++) {
    out.push(cur);
    if (cur === hi) break;
    cur = mesISOProximo(cur);
  }
  return out;
}

/**
 * Soma os orçamentos (setores + contas) de todos os meses no intervalo
 * [mesInicio, mesFim] usando o histórico — para análise de período nos gráficos.
 */
export function somarOrcamentosNoIntervalo(
  historico: IHistoricoOrcamentos,
  mesInicio: MesISO,
  mesFim: MesISO,
): IOrcamentosPayload {
  const meses = enumerateMesesInclusive(mesInicio, mesFim);
  const setores: Record<string, number> = {};
  const contas: Record<string, number> = {};
  meses.forEach((m) => {
    const p = orcamentosDoMes(historico, m);
    Object.keys(p.setores).forEach((k) => {
      setores[k] = (setores[k] ?? 0) + p.setores[k];
    });
    Object.keys(p.contas).forEach((k) => {
      contas[k] = (contas[k] ?? 0) + p.contas[k];
    });
  });
  return { setores, contas };
}

/** Pedidos cuja data de solicitação cai em algum mês ∈ [mesInicio, mesFim]. */
export function pedidosNoIntervaloMeses(
  pedidos: ReadonlyArray<IPedido>,
  mesInicio: MesISO,
  mesFim: MesISO,
): IPedido[] {
  const lo = mesInicio <= mesFim ? mesInicio : mesFim;
  const hi = mesInicio <= mesFim ? mesFim : mesInicio;
  return (pedidos as IPedido[]).filter((p) => {
    const m = mesISODe(p.dataSolicitacao);
    if (!m) return false;
    return m >= lo && m <= hi;
  });
}

/** Parcela mensal do orçamento por setor na faixa (para linhas-guia na barra). */
export function orcamentoSetorPorMesNaFaixa(
  historico: IHistoricoOrcamentos,
  mesInicio: MesISO,
  mesFim: MesISO,
  setor: string,
): ReadonlyArray<{ mes: MesISO; valor: number }> {
  return enumerateMesesInclusive(mesInicio, mesFim).map((m) => ({
    mes: m,
    valor: orcamentosDoMes(historico, m).setores[setor] ?? 0,
  }));
}

/** Parcela mensal do orçamento por conta contábil na faixa. */
export function orcamentoContaPorMesNaFaixa(
  historico: IHistoricoOrcamentos,
  mesInicio: MesISO,
  mesFim: MesISO,
  contaRotulo: string,
): ReadonlyArray<{ mes: MesISO; valor: number }> {
  return enumerateMesesInclusive(mesInicio, mesFim).map((m) => ({
    mes: m,
    valor: orcamentosDoMes(historico, m).contas[contaRotulo] ?? 0,
  }));
}

/** Rótulo curto para marcas no gráfico: `2026-02` → `02/26`. */
export function mesISOCompacto(mes: MesISO): string {
  if (!isMesISOValido(mes)) return mes;
  return `${mes.slice(5, 7)}/${mes.slice(2, 4)}`;
}
export function mesesDisponiveisParaGrafico(
  historico: IHistoricoOrcamentos,
  pedidos: ReadonlyArray<IPedido>,
): MesISO[] {
  const set = new Set<MesISO>();
  mesesArquivados(historico).forEach((m) => set.add(m));
  pedidos.forEach((p) => {
    const m = mesISODe(p.dataSolicitacao);
    if (m) set.add(m);
  });
  set.add(mesISOAtual());
  const arr = Array.from(set).filter(isMesISOValido).sort();
  /* Preenche meses intermédios entre o mínimo e o máximo já conhecidos —
   * útil para escolher um intervalo contínuo (ex.: jan–mar) mesmo sem linha
   * explícita para cada mês na tabela. */
  if (arr.length >= 2) {
    enumerateMesesInclusive(arr[0], arr[arr.length - 1]).forEach((m) =>
      set.add(m),
    );
  }
  return Array.from(set).filter(isMesISOValido).sort();
}
