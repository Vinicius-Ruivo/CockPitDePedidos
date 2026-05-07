import * as React from "react";
import * as XLSX from "xlsx";
import "../Dashboard.css";
import "../PedidoForm.css";
import { IHistoricoOrcamentos, IOrcamentosPayload, IPedido, IPedidoData, MesISO } from "../types";
import {
  SETOR_LABELS_CANONICOS,
  SUBCATEGORIAS_TODAS,
  findSetorBySubcategoria,
  getSubcategoriasParaSetor,
  mergeSetoresComCatalogo,
} from "../constants/setoresOrganizacao";
import {
  agregarPorSetor,
  distinctSetores,
  isMesISOValido,
  mesISOAtual,
  mesISODe,
  mesISOLabel,
  orcamentosDoMes,
  ordenarPedidosPorChegada,
  somarOrcamentosNoIntervalo,
  totaisGlobais,
} from "../utils/metrics";
import { CONTROL_VERSION } from "../constants/controlVersion";
import { PedidoCard } from "./PedidoCard";
import { ResumoOrcamento } from "./ResumoOrcamento";
import { GraficosBarras } from "./GraficosBarras";
import { EditDrawer } from "./EditDrawer";

export interface IDashboardProps {
  pedidos: ReadonlyArray<IPedido>;
  orcamentos: IOrcamentosPayload;
  /** Histórico mensal (competência → payload) — alimenta períodos nos gráficos. */
  historicoOrcamentos: IHistoricoOrcamentos;
  loading: boolean;
  selectedRecordId?: string;
  width?: number;
  height?: number;
  canLoadMore: boolean;
  onLoadMore: () => void;
  onSelectPedido: (id: string | undefined) => void;
  onSavePedido: (recordId: string, fields: IPedidoData) => void;
  onSaveOrcamentos: (payload: IOrcamentosPayload, mes: MesISO) => void;
}

type StatusFilter = "todos" | "novo" | "em análise" | "confirmado" | "outros";

const THEME_STORAGE_KEY = "cp-cockpit-theme";
/** Lembra o mês do filtro «Mês de chegada» após F5 / reabrir o browser. */
const FILTRO_MES_STORAGE_KEY = "cp-cockpit-filtro-mes";

type ThemeChoice = "dark" | "light";

function readStoredFiltroMes(): MesFiltro {
  try {
    const raw = localStorage.getItem(FILTRO_MES_STORAGE_KEY)?.trim();
    if (!raw) return mesISOAtual();
    if (raw === "todos") return "todos";
    if (isMesISOValido(raw)) return raw;
  } catch {
    /* ignore */
  }
  return mesISOAtual();
}

/** Retorna o bucket de filtro ao qual um status arbitrário pertence. */
const statusBucket = (s?: string): StatusFilter => {
  const k = (s ?? "").toLowerCase().trim();
  if (!k) return "outros";
  if (k === "novo") return "novo";
  if (k === "em análise" || k === "em analise") return "em análise";
  if (k === "confirmado") return "confirmado";
  return "outros";
};

type MesFiltro = MesISO | "todos";

const payloadTemOrcamento = (payload: IOrcamentosPayload): boolean =>
  Object.keys(payload.setores).length > 0 || Object.keys(payload.contas).length > 0;

export const Dashboard: React.FC<IDashboardProps> = ({
  pedidos,
  orcamentos,
  historicoOrcamentos,
  loading,
  selectedRecordId,
  width,
  height,
  canLoadMore,
  onLoadMore,
  onSelectPedido,
  onSavePedido,
  onSaveOrcamentos,
}) => {
  const [filtroMes, setFiltroMes] = React.useState<MesFiltro>(() => readStoredFiltroMes());
  const [filtroTexto, setFiltroTexto] = React.useState<string>("");
  const [filtroStatus, setFiltroStatus] = React.useState<StatusFilter>("todos");
  const [filtroSetor, setFiltroSetor] = React.useState<string>("todos");
  const [filtroSubcategoria, setFiltroSubcategoria] =
    React.useState<string>("todas");
  const [graficosAberto, setGraficosAberto] = React.useState(false);
  const [theme, setTheme] = React.useState<ThemeChoice>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [drawerPedidoId, setDrawerPedidoId] = React.useState<string | undefined>(undefined);

  const mesHoje = mesISOAtual();

  /** Pedidos cuja data de solicitação cai no mês escolhido (ou todos). */
  const pedidosNaVista = React.useMemo(() => {
    if (filtroMes === "todos") return pedidos as IPedido[];
    return (pedidos as IPedido[]).filter((p) => {
      const m = mesISODe(p.dataSolicitacao);
      return m === filtroMes;
    });
  }, [pedidos, filtroMes]);

  /** Meses que existem nos dados + mês atual (para o select). */
  const mesesOpcoesPedidos = React.useMemo(() => {
    const s = new Set<MesISO>();
    (pedidos as IPedido[]).forEach((p) => {
      const m = mesISODe(p.dataSolicitacao);
      if (m && isMesISOValido(m)) s.add(m);
    });
    s.add(mesISOAtual());
    return Array.from(s).sort().reverse();
  }, [pedidos]);

  /** Inclui o mês selecionado nas opções mesmo se ainda não houver pedidos nesse mês no dataset. */
  const mesesParaSelect = React.useMemo(() => {
    const s = new Set<MesISO>(mesesOpcoesPedidos);
    if (filtroMes !== "todos" && isMesISOValido(filtroMes)) s.add(filtroMes);
    return Array.from(s).sort().reverse();
  }, [mesesOpcoesPedidos, filtroMes]);

  const mesesHistorico = React.useMemo(
    () => Object.keys(historicoOrcamentos).filter(isMesISOValido).sort(),
    [historicoOrcamentos],
  );

  const orcamentosDaVista = React.useMemo<IOrcamentosPayload>(() => {
    if (filtroMes === "todos") {
      if (mesesHistorico.length === 0) return orcamentos;
      return somarOrcamentosNoIntervalo(
        historicoOrcamentos,
        mesesHistorico[0],
        mesesHistorico[mesesHistorico.length - 1],
      );
    }

    const payloadDoMes = orcamentosDoMes(historicoOrcamentos, filtroMes);
    if (payloadTemOrcamento(payloadDoMes)) return payloadDoMes;

    // Compatibilidade enquanto o Canvas ainda mantém ConfiguracaoCockpit:
    // se o histórico não trouxe o mês atual, usa o legado apenas nesse mês.
    return filtroMes === mesHoje && payloadTemOrcamento(orcamentos)
      ? orcamentos
      : payloadDoMes;
  }, [filtroMes, historicoOrcamentos, mesHoje, mesesHistorico, orcamentos]);

  const mesOrcamentoEditavel: MesISO = filtroMes === "todos" ? mesHoje : filtroMes;

  React.useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  React.useEffect(() => {
    try {
      localStorage.setItem(FILTRO_MES_STORAGE_KEY, filtroMes);
    } catch {
      /* ignore */
    }
  }, [filtroMes]);
  const drawerPedido = React.useMemo(
    () => (drawerPedidoId ? pedidos.find((p) => p.id === drawerPedidoId) ?? null : null),
    [pedidos, drawerPedidoId],
  );

  // --------------------- Derivados (memoizados) ---------------------

  const setoresConhecidos = React.useMemo(
    () => mergeSetoresComCatalogo(distinctSetores(pedidosNaVista as IPedido[])),
    [pedidosNaVista],
  );

  // Opções canônicas para o filtro de Setor (aglutinador).
  // Começa sempre com os 6 oficiais; acrescenta setores "legados" se existirem.
  const setoresFiltroOptions = React.useMemo<string[]>(() => {
    const extras = setoresConhecidos.filter(
      (s) => !SETOR_LABELS_CANONICOS.includes(s),
    );
    return [...SETOR_LABELS_CANONICOS, ...extras];
  }, [setoresConhecidos]);

  // Subcategorias disponíveis para o filtro — dependem do setor selecionado.
  const subcategoriasFiltroOptions = React.useMemo<string[]>(() => {
    if (filtroSetor === "todos") return [...SUBCATEGORIAS_TODAS];
    return [...getSubcategoriasParaSetor(filtroSetor)];
  }, [filtroSetor]);

  // Ao trocar setor, se a subcategoria selecionada não pertence mais ao setor,
  // volta para "todas".
  React.useEffect(() => {
    if (filtroSubcategoria === "todas") return;
    if (!subcategoriasFiltroOptions.includes(filtroSubcategoria)) {
      setFiltroSubcategoria("todas");
    }
  }, [filtroSubcategoria, subcategoriasFiltroOptions]);

  const agregadosSetor = React.useMemo(
    () =>
      agregarPorSetor(
        pedidosNaVista as IPedido[],
        orcamentosDaVista.setores,
        SETOR_LABELS_CANONICOS,
      ),
    [pedidosNaVista, orcamentosDaVista],
  );

  const totais = React.useMemo(
    () => totaisGlobais(pedidosNaVista as IPedido[], orcamentosDaVista.setores),
    [pedidosNaVista, orcamentosDaVista],
  );

  const totalComprometido = totais.realizadoTotal + totais.projetadoTotal;

  const pedidosFiltrados = React.useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    const filtrados = pedidosNaVista.filter((p) => {
      if (filtroStatus !== "todos" && statusBucket(p.status) !== filtroStatus) {
        return false;
      }
      if (filtroSetor !== "todos") {
        // Setor do pedido = valor gravado OU derivado da conta contábil
        // (robusto a pedidos legados sem `setor`).
        const setorEfetivo =
          (p.setor ?? "").trim() ||
          findSetorBySubcategoria(p.contaContabil) ||
          "";
        if (setorEfetivo !== filtroSetor) return false;
      }
      if (filtroSubcategoria !== "todas") {
        if ((p.contaContabil ?? "").trim() !== filtroSubcategoria) return false;
      }
      if (!q) return true;
      const haystack = [
        p.fornecedor, p.cnpj, p.numeroOrcamento, p.numeroRequisicao,
        p.numeroChamado, p.numeroNota, p.ordemCompra, p.setor,
        p.contaContabil, p.despesa,
        p.responsavel, p.tituloPedido, p.solicitante, p.marca, p.diretoria,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    return ordenarPedidosPorChegada(filtrados);
  }, [pedidosNaVista, filtroTexto, filtroStatus, filtroSetor, filtroSubcategoria]);

  // Counts para as "chips" de filtro
  const counts = React.useMemo(() => {
    const c = { todos: pedidosNaVista.length, novo: 0, "em análise": 0, confirmado: 0, outros: 0 };
    pedidosNaVista.forEach((p) => {
      c[statusBucket(p.status)] += 1;
    });
    return c;
  }, [pedidosNaVista]);

  // --------------------- Handlers ---------------------

  const openDrawer = React.useCallback(
    (id: string) => {
      if (!pedidosNaVista.find((x) => x.id === id)) return;
      setDrawerPedidoId(id);
      onSelectPedido(id);
    },
    [pedidosNaVista, onSelectPedido],
  );

  const closeDrawer = React.useCallback(() => {
    setDrawerPedidoId(undefined);
    onSelectPedido(undefined);
  }, [onSelectPedido]);

  const handleExportPedidosExcel = React.useCallback(() => {
    const headers = [
      "MARCA",
      "DIRETORIA",
      "CENTRO DE CUSTO",
      "FORNECEDOR",
      "DESPESA",
      "VALOR",
      "DATA E HORA DA SOLICITACAO",
      "STATUS",
      "NUMERO DE REQUISICAO",
      "N° NOTA",
      "CONTA CONTABIL",
    ];
    const rows = pedidosFiltrados.map((p) => [
      p.marca ?? "",
      p.diretoria ?? "",
      p.centroCusto ?? "",
      p.fornecedor ?? "",
      p.despesa ?? "",
      formatCurrencyExport(p.valor),
      formatDateTimeExport(p.dataSolicitacao),
      p.status ?? "",
      p.numeroRequisicao ?? "",
      p.numeroNota ?? "",
      p.contaContabil ?? "",
    ]);
    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = headers.map((_, colIdx) => {
      const maxLen = aoa.reduce((acc, row) => {
        const cell = String(row[colIdx] ?? "");
        return Math.max(acc, cell.length);
      }, 0);
      return { wch: Math.min(60, Math.max(12, maxLen + 2)) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pedidos");
    const xlsxBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    // Pedido do utilizador: conteúdo .xlsx, mas nome final do download como .csv.
    const blob = new Blob([xlsxBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const mesExportado = filtroMes === "todos" ? "TODOS-OS-MESES" : filtroMes;
    anchor.href = url;
    anchor.download = `EMPENHADO & COMPROMETIDO (${mesExportado}).csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [filtroMes, pedidosFiltrados]);

  // --------------------- Estilo ---------------------

  const rootStyle: React.CSSProperties = {
    ...(width ? { width: `${width}px` } : {}),
    ...(height && height > 0
      ? { height: `${height}px`, minHeight: `${height}px`, overflow: "hidden" }
      : {}),
    display: "flex",
    flexDirection: "column",
  };

  // --------------------- Render ---------------------

  const themeClass = theme === "light" ? " cp-dash-root--light" : "";

  return (
    <div
      className={`cp-dash-root${height && height > 0 ? " cp-dash-root--viewport" : ""}${themeClass}${graficosAberto ? " cp-dash-root--graficos-immersive" : ""}`}
      style={rootStyle}
      data-cp-theme={theme}
    >
      {/* ================= HEADER ================= */}
      <header className="cp-dash-header">
        <div className="cp-dash-header-title">
          <span className="cp-dash-header-bar" aria-hidden="true" />
          <div className="cp-dash-header-eyebrow">
            <span>CockPit - Pedidos de Requisição</span>
            <span className="cp-control-version" title={`Versão do controlo PCF`}>
              v{CONTROL_VERSION}
            </span>
          </div>
        </div>

        <div className="cp-dash-header-right">
          <button
            type="button"
            className="cp-dash-theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-pressed={theme === "light"}
            aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
            title={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
          >
            <span className="cp-dash-theme-toggle-icon" aria-hidden="true">
              {theme === "dark" ? "☀️" : "🌙"}
            </span>
          </button>

          <div className="cp-dash-header-metrics">
            <HeaderMetric
              label="Pedidos"
              value={String(totais.qtdPedidos)}
              accent={false}
            />
            <HeaderMetric
              label="Pendentes"
              value={String(totais.qtdPendentes)}
              accent={false}
            />
            <HeaderMetric
              label="Projetado"
              value={formatCurrencyCompact(totais.projetadoTotal)}
              projected
            />
            <HeaderMetric
              label="Realizado"
              value={formatCurrencyCompact(totais.realizadoTotal)}
              accent
            />
            <HeaderMetric
              label="Total comprometido"
              value={formatCurrencyCompact(totalComprometido)}
              accent={false}
            />
            <HeaderMetric
              label="Saldo"
              value={formatCurrencyCompact(totais.saldoTotal)}
              accent={false}
              negative={totais.saldoTotal < 0}
            />
          </div>
        </div>
      </header>

      {/* ================= GRID PRINCIPAL ================= */}
      <main className="cp-dash-main">
        <div
          className={`cp-dash-grid${graficosAberto ? " cp-dash-grid--graficos-fullscreen" : ""}`}
        >
        {/* ---- PAINEL CARDS (esquerda, linha 1) ---- */}
        <section
          className="cp-dash-panel cp-dash-panel-cards"
          aria-labelledby="cp-panel-cards-title"
        >
          <header className="cp-dash-panel-head cp-dash-panel-head--cards">
            <h2 id="cp-panel-cards-title" className="cp-dash-panel-title">
              Cards de Pedidos
            </h2>

            <div className="cp-dash-panel-toolbar cp-dash-panel-toolbar--cards-top">
              <div className="cp-dash-search">
                <span className="cp-dash-search-icon" aria-hidden="true">🔍</span>
                <input
                  type="search"
                  className="cp-dash-search-input"
                  placeholder="Buscar por solicitante, Nº, setor…"
                  value={filtroTexto}
                  onChange={(e) => setFiltroTexto(e.target.value)}
                />
              </div>

              <div className="cp-dash-chips" role="tablist" aria-label="Filtrar por status">
                <Chip
                  active={filtroStatus === "todos"}
                  onClick={() => setFiltroStatus("todos")}
                  label="Todos"
                  count={counts.todos}
                />
                <Chip
                  active={filtroStatus === "novo"}
                  onClick={() => setFiltroStatus("novo")}
                  label="Novo"
                  count={counts.novo}
                  variant="novo"
                />
                <Chip
                  active={filtroStatus === "em análise"}
                  onClick={() => setFiltroStatus("em análise")}
                  label="Em Análise"
                  count={counts["em análise"]}
                  variant="analise"
                />
                <Chip
                  active={filtroStatus === "confirmado"}
                  onClick={() => setFiltroStatus("confirmado")}
                  label="Confirmado"
                  count={counts.confirmado}
                  variant="confirmado"
                />
              </div>
            </div>
          </header>

          <div
            className="cp-dash-agg-filters"
            role="group"
            aria-label="Filtrar por mês de chegada, setor e subcategoria"
          >
            <label className="cp-dash-agg-filter">
              <span className="cp-dash-agg-filter-label">Mês de chegada</span>
              <select
                className="cp-dash-agg-select"
                value={filtroMes}
                onChange={(e) => {
                  const v = e.target.value;
                  setFiltroMes(v === "todos" ? "todos" : (v as MesISO));
                }}
                aria-label="Mês da data de solicitação do pedido"
                title="Só entram pedidos cuja data de solicitação está neste mês (calendário local)"
              >
                {mesesParaSelect.map((m) => (
                  <option key={m} value={m}>
                    {mesISOLabel(m)}
                    {m === mesHoje ? " · mês atual" : ""}
                  </option>
                ))}
                <option value="todos">Todos os meses</option>
              </select>
            </label>
            <label className="cp-dash-agg-filter">
              <span className="cp-dash-agg-filter-label">Setor</span>
              <select
                className="cp-dash-agg-select"
                value={filtroSetor}
                onChange={(e) => setFiltroSetor(e.target.value)}
              >
                <option value="todos">Todos os setores</option>
                {setoresFiltroOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="cp-dash-agg-filter">
              <span className="cp-dash-agg-filter-label">Subcategoria</span>
              <select
                className="cp-dash-agg-select"
                value={filtroSubcategoria}
                onChange={(e) => setFiltroSubcategoria(e.target.value)}
              >
                <option value="todas">Todas</option>
                {subcategoriasFiltroOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {(filtroSetor !== "todos" ||
              filtroSubcategoria !== "todas") && (
              <button
                type="button"
                className="cp-dash-agg-clear"
                onClick={() => {
                  setFiltroSetor("todos");
                  setFiltroSubcategoria("todas");
                }}
                aria-label="Limpar filtros de setor e subcategoria"
              >
                Limpar setor
              </button>
            )}
            <button
              type="button"
              className="cp-btn cp-btn-ghost cp-btn-sm"
              onClick={handleExportPedidosExcel}
              disabled={loading || pedidosFiltrados.length === 0}
              title="Exportar pedidos filtrados para CSV (gerado a partir da planilha)"
            >
              Exportar Excel
            </button>
          </div>

          <div className="cp-dash-cards-list">
            {loading ? (
              <LoadingState />
            ) : pedidosFiltrados.length === 0 ? (
              <EmptyState
                hasFilter={
                  !!filtroTexto ||
                  filtroStatus !== "todos" ||
                  filtroSetor !== "todos" ||
                  filtroSubcategoria !== "todas" ||
                  filtroMes !== "todos"
                }
              />
            ) : (
              pedidosFiltrados.map((p) => (
                <PedidoCard
                  key={p.id}
                  pedido={p}
                  selected={p.id === selectedRecordId}
                  onOpen={openDrawer}
                />
              ))
            )}
          </div>

          {canLoadMore && !loading && (
            <div className="cp-dash-load-more">
              <button
                type="button"
                className="cp-btn cp-btn-ghost"
                onClick={onLoadMore}
              >
                Carregar mais pedidos
              </button>
            </div>
          )}
        </section>

        {/* ---- PAINEL RESUMO (direita, linha 1) ---- */}
        <section className="cp-dash-panel cp-dash-panel-resumo">
          <ResumoOrcamento
            orcamentosPayload={orcamentosDaVista}
            agregados={agregadosSetor}
            pedidos={pedidosNaVista as IPedido[]}
            totalOrcamento={totais.orcamentoTotal}
            totalRealizado={totais.realizadoTotal}
            totalSaldo={totais.saldoTotal}
            canEdit={filtroMes !== "todos"}
            readOnlyReason="Selecione um mês específico para editar o orçamento daquela competência."
            onSaveOrcamentos={(payload) => onSaveOrcamentos(payload, mesOrcamentoEditavel)}
          />
        </section>

        {/* ---- PAINEL GRÁFICOS (barra recolhível; linha 2, largura total) ---- */}
        <section
          className={`cp-dash-panel cp-dash-panel-graficos${graficosAberto ? " cp-dash-panel-graficos--open" : " cp-dash-panel-graficos--shut"}`}
          aria-labelledby="cp-panel-graficos-title"
        >
          <button
            type="button"
            id="cp-panel-graficos-title"
            className="cp-dash-graficos-bar"
            onClick={() => setGraficosAberto((v) => !v)}
            aria-expanded={graficosAberto}
            aria-controls="cp-graficos-expand"
            title={graficosAberto ? "Recolher" : "Expandir"}
          >
            <span className="cp-dash-graficos-bar-leading">
              <span className="cp-dash-graficos-bar-dot" aria-hidden="true" />
              <span className="cp-dash-graficos-bar-label">Análise De Orçamento</span>
            </span>
            <span className="cp-dash-graficos-chevron" aria-hidden="true">
              {graficosAberto ? "▲" : "▼"}
            </span>
          </button>
          {graficosAberto && (
            <div
              id="cp-graficos-expand"
              className="cp-dash-graficos-expand"
              role="region"
              aria-label="Análise de orçamento"
            >
              <GraficosBarras
                pedidos={pedidosFiltrados as unknown as IPedido[]}
                historicoOrcamentos={historicoOrcamentos}
                mesTravado={filtroMes === "todos" ? undefined : filtroMes}
              />
            </div>
          )}
        </section>
        </div>
      </main>

      {/* ================= DRAWER (overlay) ================= */}
      <EditDrawer
        pedido={drawerPedido}
        setoresConhecidos={setoresConhecidos}
        onSave={onSavePedido}
        onClose={closeDrawer}
      />
    </div>
  );
};

export default Dashboard;

// -----------------------------------------------------------------------------
// Sub-componentes internos
// -----------------------------------------------------------------------------

const HeaderMetric: React.FC<{
  label: string;
  value: string;
  accent?: boolean;
  /** Valor ainda não confirmado (soma de `valor` fora de status Confirmado). */
  projected?: boolean;
  negative?: boolean;
}> = ({ label, value, accent, projected, negative }) => (
  <div
    className={`cp-dash-metric${accent ? " cp-dash-metric-accent" : ""}${
      projected ? " cp-dash-metric-projetado" : ""
    }`}
  >
    <span className="cp-dash-metric-label">{label}</span>
    <span
      className={`cp-dash-metric-value${negative ? " cp-dash-metric-value-negative" : ""}`}
    >
      {value}
    </span>
  </div>
);

const Chip: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  variant?: "novo" | "analise" | "confirmado";
}> = ({ active, onClick, label, count, variant }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    className={`cp-chip${active ? " cp-chip-active" : ""}${variant ? " cp-chip-" + variant : ""}`}
    onClick={onClick}
  >
    <span>{label}</span>
    <span className="cp-chip-count">{count}</span>
  </button>
);

const LoadingState: React.FC = () => (
  <div className="cp-dash-state">
    <div className="cp-dash-spinner" aria-hidden="true" />
    <span>Carregando pedidos…</span>
  </div>
);

const EmptyState: React.FC<{ hasFilter: boolean }> = ({ hasFilter }) => (
  <div className="cp-dash-state">
    <span className="cp-dash-state-icon" aria-hidden="true">📭</span>
    {hasFilter ? (
      <>
        <div>Nenhum pedido encontrado com os filtros atuais.</div>
        <small>Tente limpar a busca, o mês de chegada ou o status.</small>
      </>
    ) : (
      <>
        <div>Ainda não há pedidos cadastrados.</div>
        <small>Os pedidos aparecerão aqui assim que o Forms for respondido.</small>
      </>
    )}
  </div>
);

// -----------------------------------------------------------------------------
// Helper compartilhado
// -----------------------------------------------------------------------------

function formatCurrencyCompact(n: number): string {
  if (isNaN(n)) return "R$ 0";
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R$ ${(n / 1_000).toFixed(1)}k`;
  return `R$ ${n.toFixed(0)}`;
}

function formatCurrencyExport(n?: number): string {
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
}

function formatDateTimeExport(d?: Date): string {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}


