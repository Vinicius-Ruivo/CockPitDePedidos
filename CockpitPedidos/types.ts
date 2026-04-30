/**
 * Tipos compartilhados entre:
 *  - index.ts           (ciclo PCF)
 *  - components/*.tsx   (UI)
 *  - utils/metrics.ts   (agregações)
 *
 * Dataset no manifest usa nomes lógicos Dataverse (cr660_...) para o Canvas
 * ligar direto à tabela sem RenameColumns. IPedido mantém nomes curtos na UI.
 */

/** Nomes lógicos das colunas no Dataverse (1:1 com property-set no manifest). Prefixo cr660 = publisher. */
export const PEDIDO_COLUMNS = [
  "cr660_titulodopedido",
  "cr660_datasolicitacao",
  "cr660_marca",
  "cr660_diretoria",
  "cr660_despesa",
  "cr660_quantidade",
  "cr660_solicitante",

  "cr660_fornecedor",
  "cr660_cnpj",
  "cr660_numerodoorcamento",
  "cr660_valor",
  "cr660_responsavel",
  "cr660_numerodechamado",
  "cr660_natureza",
  "cr660_numeroderequisicao",

  "cr660_centrodecusto",
  "cr660_contacontabil",

  "cr660_numerodanota",
  "cr660_vencimento",
  "cr660_ordemdecompra",

  "cr660_status",
  "cr660_setor",
] as const;

export type PedidoColumn = (typeof PEDIDO_COLUMNS)[number];

/** Shape canônico de um pedido (1 registro do dataset).
 *  `id` vem do dataset.records[*].getRecordId(). */
export interface IPedido {
  id: string;

  // Automáticos / Forms (Dataverse: título, data/hora solicitação, etc.)
  tituloPedido?: string;
  dataSolicitacao?: Date;
  marca?: string;
  diretoria?: string;
  despesa?: string;
  /** Texto livre (ex.: "17" ou "5, 15, 4") — alinhado a colunas texto no Dataverse. */
  quantidade?: string;
  solicitante?: string;

  // Responsabilidade — Luciana
  fornecedor?: string;
  cnpj?: string;
  numeroOrcamento?: string;
  valor?: number;
  responsavel?: string;
  numeroChamado?: string;
  natureza?: string;
  numeroRequisicao?: string;

  // Responsabilidade — Luciano
  centroCusto?: string;
  contaContabil?: string;

  // Compartilhados / Condicionais
  numeroNota?: string;
  /** Texto livre (ex.: dd/mm/aaaa ou qualquer formato acordado). */
  vencimento?: string;
  ordemCompra?: string;

  // Controle de fluxo
  status?: string;

  // Categorização livre (Luciana/Luciano definem)
  setor?: string;
}

/** Shape usado pelo PedidoForm (sem id — é só os campos editáveis). */
export type IPedidoData = Omit<IPedido, "id">;

/** Mapeia coluna Dataverse → chave em IPedido / IPedidoData. */
export const DATAVERSE_TO_IPEDIDO: Record<string, keyof IPedidoData> = {
  cr660_titulodopedido: "tituloPedido",
  cr660_datasolicitacao: "dataSolicitacao",
  cr660_marca: "marca",
  cr660_diretoria: "diretoria",
  cr660_despesa: "despesa",
  cr660_quantidade: "quantidade",
  cr660_solicitante: "solicitante",

  cr660_fornecedor: "fornecedor",
  cr660_cnpj: "cnpj",
  cr660_numerodoorcamento: "numeroOrcamento",
  cr660_valor: "valor",
  cr660_responsavel: "responsavel",
  cr660_numerodechamado: "numeroChamado",
  cr660_natureza: "natureza",
  cr660_numeroderequisicao: "numeroRequisicao",

  cr660_centrodecusto: "centroCusto",
  cr660_contacontabil: "contaContabil",

  cr660_numerodanota: "numeroNota",
  cr660_vencimento: "vencimento",
  cr660_ordemdecompra: "ordemCompra",

  cr660_status: "status",
  cr660_setor: "setor",
};

/** Status canônicos. O campo aceita qualquer string (flexibilidade total). */
export const STATUS_OPTIONS = ["Novo", "Em Análise", "Confirmado"] as const;
export type PedidoStatus = (typeof STATUS_OPTIONS)[number];

/** Payload emitido via output `lastEditedJson`.
 *  O Canvas App usa esse shape para fazer Patch() na SharePoint List. */
export interface IEditedPayload {
  id: string;
  fields: IPedidoData;
  /** Timestamp epoch ms — Canvas App pode usar como key de OnChange. */
  at: number;
}

/** Mapa de orçamentos por setor.
 *  Ex: { "TI": 50000, "Marketing": 30000 } */
export type OrcamentosMap = Record<string, number>;

/** Orçamento por **conta contábil** (texto exato = chave, mesmo valor usado no pedido e no catálogo).
 *  Soma de `setores` e de `contas` são **independentes** — o teto de negócio
 *  continua nos setores; as contas são submetas (planejamento por subcategoria). */
export type OrcamentosContasMap = Record<string, number>;

/**
 * Estrutura do JSON `orcamentosJson` (novo). Formato em disco:
 * `{ "setores": { "05.…": 100000, … }, "contas": { "33107010 - …": 5000, … } }`
 * Antigo (só setor): ainda lido com compatibilidade retroativa.
 */
export interface IOrcamentosPayload {
  readonly setores: Readonly<OrcamentosMap>;
  readonly contas: Readonly<OrcamentosContasMap>;
}

export function emptyOrcamentosPayload(): IOrcamentosPayload {
  return { setores: {}, contas: {} };
}

/** Métrica selecionada no painel de gráficos. */
export type ChartMetric =
  | "orcamento-vs-realizado"
  | "orcamento-vs-projetado"
  | "orcamento-vs-realizado-contas"
  | "orcamento-vs-projetado-contas"
  | "qtd-por-status"
  | "evolucao-mensal"
  | "qtd-por-fornecedor";

/** Agregação por setor (linha do "Resumo de orçamento por setor"). */
export interface ISetorAggregate {
  setor: string;
  orcamento: number;
  /** Soma dos pedidos com status Confirmado. */
  realizado: number;
  /** Soma dos pedidos com status "Em Análise" (em avaliação). */
  emAnalise: number;
  /** Soma dos pedidos com status Novo (recém-cadastrados, ainda não avaliados). */
  novo: number;
  /** Soma dos demais status (Cancelado, Recusado, etc.) — não entra na projeção. */
  outros: number;
  /** realizado + emAnalise + novo — total que pesará no orçamento se todos virarem confirmados. */
  comprometido: number;
  /** orcamento - realizado (saldo já efetivamente livre). */
  saldo: number;
  /** orcamento - comprometido (saldo se TODOS os pedidos pendentes forem aprovados). */
  saldoProjetado: number;
  /** realizado / orcamento (clipado em 100). */
  percentualConsumido: number;
  /** comprometido / orcamento (NÃO clipado — pode passar de 100% indicando risco). */
  percentualComprometido: number;
  quantidadePedidos: number;
}

/** Agregação por subcategoria (Conta Contábil) dentro de um setor. */
export interface ISubcategoriaAggregate {
  /** Texto exato da Conta Contábil (ex: "33107010 - Serviços de Higiene e Limpeza"). */
  subcategoria: string;
  /** Soma de pedidos com status Confirmado. */
  realizado: number;
  /** Soma de pedidos ainda não confirmados (Novo / Em Análise / outros). */
  projetado: number;
  /** realizado + projetado — usado pelo gráfico de pizza. */
  total: number;
  /** Quantidade de pedidos vinculados à conta. */
  quantidadePedidos: number;
  /** Orçamento alocado a esta Conta Contábil (0 se não definido). */
  orcamento: number;
}
