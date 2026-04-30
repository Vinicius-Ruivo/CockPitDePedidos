import type { IPedidoData } from "../types";

/**
 * Catálogo oficial de setores (aglutinadores) e subcategorias (contas contábeis).
 *
 * Os rótulos em `setor` devem bater com o valor gravado em `cr660_setor`
 * e com as chaves de `orcamentosJson` por setor.
 *
 * As strings em `subcategorias` são os rótulos canônicos da Conta Contábil
 * (`cr660_contacontabil`): "CÓDIGO - Descrição". O matching aceita o rótulo
 * inteiro ou apenas o código (8 dígitos).
 */
export interface ISetorOrganizacao {
  readonly setor: string;
  readonly subcategorias: readonly string[];
}

export const SETORES_ORGANIZACAO: readonly ISetorOrganizacao[] = [
  {
    setor: "05.Serv. Terceiros",
    subcategorias: [
      "33107010 - Serviços de Higiene e Limpeza",
      "33107012 - Serviços de Assessoria/Consultoria - PJ",
    ],
  },
  {
    setor: "06.Ocupação e Manutenção",
    subcategorias: [
      "33107006 - Serviços de Manutenção de Imóveis e Instalações",
      "33110006 - Materiais de Manutenção de Móveis e Utensílios",
    ],
  },
  {
    setor: "07.Transformação Digital",
    subcategorias: [
      "33107004 - Serviços de Manutenção de Equipamentos de Hardware",
      "33107005 - Serviços de Manutenção/Assistência de Software",
      "33110002 - Materiais de Informátic/Telecomunicações",
      "33112002 - Locação de Máquinas, Equipamentos e Utensílios",
      "33112007 - Leasing Operacional",
    ],
  },
  {
    setor: "08.Deslocamento",
    subcategorias: [
      "33115001 - Transporte",
      "33115003 - Refeições",
    ],
  },
  {
    setor: "09.Outros Custos/ Desp. Operac.",
    subcategorias: [
      "33110001 - Impressos e Materiais de Escritório",
      "33110004 - Materiais, Uniformes e Equipamentos de Segurança",
      "33110010 - Gêneros Alimentícios",
      "33110499 - Outros Materiais de Consumo",
      "33115499 - Outros Gastos Eventuais",
      "33216004 - Brindes, Contribuições e Doações Indedutíveis",
    ],
  },
  {
    setor: "10.Publicidade & Propaganda",
    subcategorias: [
      "33107014 - Serviços de Publicidade / Propaganda / Marketing",
      "33107021 - Serviços Gráficos",
      "33107499 - Outros Serviços de Pessoa Jurídica",
    ],
  },
] as const;

/** Rótulos canônicos dos setores (ordem 05 → 10). */
export const SETOR_LABELS_CANONICOS: readonly string[] = SETORES_ORGANIZACAO.map(
  (s) => s.setor,
);

/** Todas as subcategorias (contas contábeis) em ordem de catálogo. */
export const SUBCATEGORIAS_TODAS: readonly string[] = SETORES_ORGANIZACAO.flatMap(
  (s) => s.subcategorias,
);

// -----------------------------------------------------------------------------
// Normalização + lookup
// -----------------------------------------------------------------------------

/** Extrai o código de 8 dígitos do início do rótulo (ex.: "33110006 - ..."). */
function extrairCodigo(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = /^\s*(\d{8})\b/.exec(raw);
  return m ? m[1] : null;
}

function normalizarSetor(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Remove o prefixo numérico do aglutinador (ex.: `05.`) só para exibição — dados gravados mantêm o canónico. */
export function setorLabelExibicao(setor: string | undefined | null): string {
  if (setor == null || setor === "") return "";
  return setor.replace(/^\d+\.\s*/, "");
}

/**
 * Índice rápido: código da conta contábil → setor.
 * Construído 1x no carregamento do módulo.
 */
const INDICE_CODIGO_SETOR: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const entry of SETORES_ORGANIZACAO) {
    for (const sub of entry.subcategorias) {
      const cod = extrairCodigo(sub);
      if (cod) map.set(cod, entry.setor);
    }
  }
  return map;
})();

/**
 * Dado o valor da Conta Contábil (rótulo inteiro ou só o código),
 * devolve o setor canônico correspondente — ou `undefined` se não houver match.
 */
export function findSetorBySubcategoria(
  contaContabil: string | undefined | null,
): string | undefined {
  if (!contaContabil) return undefined;
  const byCode = extrairCodigo(contaContabil);
  if (byCode && INDICE_CODIGO_SETOR.has(byCode)) {
    return INDICE_CODIGO_SETOR.get(byCode);
  }
  const needle = contaContabil.trim().toLowerCase();
  if (!needle) return undefined;
  for (const entry of SETORES_ORGANIZACAO) {
    for (const sub of entry.subcategorias) {
      if (sub.toLowerCase() === needle) return entry.setor;
    }
  }
  return undefined;
}

/**
 * Garante `setor` alinhado à Conta Contábil antes de enviar o pedido ao Canvas
 * (JSON.stringify omite chaves cujo valor é `undefined` — o Patch do Power Apps
 * precisa receber a string do setor explicitamente no `lastEditedJson`).
 * A conta do catálogo manda: sempre devolve o setor canônico do aglutinador.
 */
export function applyInferredSetorForSave(fields: IPedidoData): IPedidoData {
  const inferred = findSetorBySubcategoria(fields.contaContabil);
  if (inferred) {
    return { ...fields, setor: inferred };
  }
  return { ...fields };
}

/** Subcategorias sugeridas para um setor (texto livre continua permitido). */
export function getSubcategoriasParaSetor(
  setor: string | undefined | null,
): readonly string[] {
  const t = normalizarSetor(setor ?? "");
  if (!t) return [];
  const ig = SETORES_ORGANIZACAO.find(
    (e) => e.setor.toLowerCase() === t.toLowerCase(),
  );
  if (ig) return ig.subcategorias;
  const m = /^(\d{2})\./.exec(t);
  if (m) {
    const prefix = `${m[1]}.`;
    const byNum = SETORES_ORGANIZACAO.find((e) => e.setor.startsWith(prefix));
    if (byNum) return byNum.subcategorias;
  }
  return [];
}

/** Une o catálogo oficial com setores já usados nos pedidos (ordem pt-BR). */
export function mergeSetoresComCatalogo(
  fromPedidos: readonly string[],
): string[] {
  return Array.from(
    new Set<string>([...SETOR_LABELS_CANONICOS, ...fromPedidos]),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
}
