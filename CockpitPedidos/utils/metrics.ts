/**
 * Funções puras de agregação para o Dashboard.
 * Nenhuma depende de React ou PCF — fáceis de testar isoladamente.
 */

import {
  IOrcamentosPayload,
  IPedido,
  ISetorAggregate,
  ISubcategoriaAggregate,
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

/** Contagem de pedidos por responsável (Luciana / Luciano / Outros). */
export function agregarPorResponsavel(
  pedidos: IPedido[],
): Array<{ responsavel: string; quantidade: number; valorTotal: number }> {
  const grupos = new Map<string, { qtd: number; valor: number }>();
  pedidos.forEach((p) => {
    const key = p.responsavel?.trim() || "Não atribuído";
    if (!grupos.has(key)) grupos.set(key, { qtd: 0, valor: 0 });
    const g = grupos.get(key)!;
    g.qtd += 1;
    g.valor += p.valor ?? 0;
  });

  return Array.from(grupos.entries())
    .map(([responsavel, v]) => ({
      responsavel,
      quantidade: v.qtd,
      valorTotal: v.valor,
    }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

/** Top N pedidos com maior `valor` — usado no gráfico "Top 10 pedidos".
 *  Pedidos sem valor (ou ≤ 0) são descartados. */
export function agregarTopPedidos(
  pedidos: IPedido[],
  limit: number = 10,
): IPedido[] {
  return [...pedidos]
    .filter((p) => Number.isFinite(p.valor) && (p.valor ?? 0) > 0)
    .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0))
    .slice(0, Math.max(1, limit));
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
