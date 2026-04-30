import * as React from "react";
import "../PedidoForm.css";
import {
  SETORES_ORGANIZACAO,
  SUBCATEGORIAS_TODAS,
  applyInferredSetorForSave,
  findSetorBySubcategoria,
  getSubcategoriasParaSetor,
  mergeSetoresComCatalogo,
  setorLabelExibicao,
} from "../constants/setoresOrganizacao";
import { IPedidoData, STATUS_OPTIONS } from "../types";

export type { IPedidoData } from "../types";

export interface IPedidoFormProps {
  /** Dados iniciais do pedido (fonte de verdade do Canvas App). */
  pedido: IPedidoData;
  /** Setores já existentes na base (autocomplete do campo "Setor"). */
  setoresConhecidos?: ReadonlyArray<string>;
  /** Chamado quando o usuário clica em "Salvar" ou pelo auto-save. Recebe o estado atual. */
  onSave?: (fields: IPedidoData) => void;
  /** Chamado quando o usuário clica em cancelar/fechar drawer. */
  onClose?: () => void;
  /**
   * Se `true`, o formulário roda em modo "dentro de um drawer": remove o
   * background gradient, reduz paddings externos e mostra footer com botões
   * Salvar/Cancelar. Sem isso, funciona standalone (field control mode).
   */
  embedded?: boolean;
  /**
   * Em modo embedded: se `true`, cada alteração agenda `onSave` após debounce.
   * Se `false`, só envia ao clicar em Salvar. Default `true` (o drawer usa `false`).
   */
  autoSave?: boolean;
  /** Debounce do auto-save em ms. Default 700. */
  autoSaveDebounceMs?: number;
  /** Legado/field-control: callback síncrono por tecla. Ignorado se embedded=true. */
  onFieldChange?: <K extends keyof IPedidoData>(
    field: K,
    value: IPedidoData[K],
  ) => void;
  width?: number;
  height?: number;
}

type Owner = "auto" | "luciana" | "luciano" | "shared";

const OWNER_META: Record<Owner, { label: string; emoji: string }> = {
  auto:     { label: "Automático",    emoji: "⚙️" },
  luciana:  { label: "Luciana",       emoji: "🙋‍♀️" },
  luciano:  { label: "Luciano",       emoji: "🙋‍♂️" },
  shared:   { label: "Compartilhado", emoji: "🤝" },
};

/** Detecta mudança nos dados vindos do dataset (ex.: após Patch/Refresh no Canvas). */
function snapshotPedidoData(p: IPedidoData): string {
  try {
    return JSON.stringify(p, (_, v) =>
      v instanceof Date ? v.toISOString() : v,
    );
  } catch {
    return "";
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** `datetime-local` (DATASOLICITACAO no Dataverse). */
const toDateTimeLocalValue = (d?: Date): string => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
};

const fromDateTimeLocalValue = (value: string): Date | undefined => {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
};

const toNumberInputValue = (n?: number): string =>
  n === undefined || n === null || isNaN(n) ? "" : String(n);

const formatCurrencyBRL = (n?: number): string => {
  if (n === undefined || n === null || isNaN(n)) return "R$ —";
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

const formatDateTimeBR = (d?: Date): string => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

// -----------------------------------------------------------------------------
// Subcomponentes
// -----------------------------------------------------------------------------

const OwnerBadge: React.FC<{ owner: Owner }> = ({ owner }) => {
  const meta = OWNER_META[owner];
  return (
    <span
      className={`cp-badge cp-badge-${owner}`}
      title={`Responsabilidade primária: ${meta.label}`}
    >
      <span className="cp-badge-emoji" aria-hidden="true">{meta.emoji}</span>
      <span className="cp-badge-text">{meta.label}</span>
    </span>
  );
};

interface IFieldProps {
  label: string;
  owner: Owner;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}

const Field: React.FC<IFieldProps> = ({ label, owner, htmlFor, hint, children }) => (
  <div className={`cp-field cp-field-${owner}`}>
    <div className="cp-field-header">
      <label className="cp-label" htmlFor={htmlFor}>{label}</label>
      <OwnerBadge owner={owner} />
    </div>
    {children}
    {hint && <div className="cp-hint">{hint}</div>}
  </div>
);

// -----------------------------------------------------------------------------
// Componente principal
// -----------------------------------------------------------------------------

export const PedidoForm: React.FC<IPedidoFormProps> = ({
  pedido,
  setoresConhecidos = [],
  onSave,
  onClose,
  embedded = false,
  autoSave = true,
  autoSaveDebounceMs = 700,
  onFieldChange,
  width,
  height,
}) => {
  /**
   * Em modo embedded (drawer), buffer local. Com `autoSave`, cada alteração
   * agenda `onSave` após debounce; com `autoSave={false}` (drawer), só envia
   * ao clicar em Salvar. Fora do embedded, cada alteração vira `onFieldChange`.
   */
  const [buffer, setBuffer] = React.useState<IPedidoData>(pedido);
  const [dirty, setDirty] = React.useState<boolean>(false);
  /** Estado do auto-save para o indicador visual no footer. */
  const [saveStatus, setSaveStatus] = React.useState<
    "idle" | "pending" | "saved"
  >("idle");

  const pedidoFromServerKey = React.useMemo(
    () => snapshotPedidoData(pedido),
    [pedido],
  );

  const autoSaveTimerRef = React.useRef<number | null>(null);
  const latestBufferRef = React.useRef<IPedidoData>(pedido);

  /**
   * Quando o dataset do Canvas atualiza (novos valores vindos do servidor), alinha o buffer.
   * Enquanto `dirty`, não sobrescreve — evita apagar o rascunho e desativar o Salvar antes do Patch.
   */
  React.useEffect(() => {
    if (!embedded) return;
    if (dirty) return;
    setBuffer(pedido);
    latestBufferRef.current = pedido;
    setSaveStatus("idle");
  }, [embedded, pedidoFromServerKey, dirty, pedido]);

  React.useEffect(() => {
    latestBufferRef.current = buffer;
  }, [buffer]);

  const clearAutoSaveTimer = React.useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const flushSave = React.useCallback(
    (payloadOverride?: IPedidoData) => {
      clearAutoSaveTimer();
      if (!onSave) return;
      // Usa a ref (estado mais recente), não o `buffer` do closure, para não
      // perder o setor preenchido junto com a conta contábil no último clique.
      const raw = payloadOverride ?? latestBufferRef.current;
      const payload = applyInferredSetorForSave(raw);
      onSave(payload);
      if (raw.setor !== payload.setor) {
        setBuffer(payload);
      }
      setDirty(false);
      setSaveStatus("saved");
    },
    [clearAutoSaveTimer, onSave],
  );

  const scheduleAutoSave = React.useCallback(
    (next: IPedidoData) => {
      if (!embedded || !autoSave || !onSave) return;
      clearAutoSaveTimer();
      setSaveStatus("pending");
      autoSaveTimerRef.current = window.setTimeout(() => {
        autoSaveTimerRef.current = null;
        onSave(applyInferredSetorForSave(next));
        setDirty(false);
        setSaveStatus("saved");
      }, autoSaveDebounceMs);
    },
    [autoSave, autoSaveDebounceMs, clearAutoSaveTimer, embedded, onSave],
  );

  // Flush em unmount ou troca de pedido (ex.: drawer fechando).
  React.useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
        if (embedded && autoSave) {
          onSave?.(applyInferredSetorForSave(latestBufferRef.current));
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateField = React.useCallback(
    <K extends keyof IPedidoData>(field: K, value: IPedidoData[K]) => {
      if (embedded) {
        setBuffer((b) => {
          const next = { ...b, [field]: value } as IPedidoData;
          if (field === "contaContabil") {
            // Regra de negócio: ao definir a Conta Contábil, se bater com uma
            // subcategoria conhecida, o Setor é preenchido automaticamente com
            // o aglutinador correspondente (sobrescreve valor anterior).
            const auto = findSetorBySubcategoria(value as unknown as string);
            if (auto && next.setor !== auto) {
              (next as { setor?: string }).setor = auto;
            }
          }
          scheduleAutoSave(next);
          // Atualiza a ref no mesmo passo do setState — o useEffect [buffer] corre
          // *depois* do paint; sem isso, "Salvar" imediato após editar pode enviar
          // payload antigo (buffer da renderização anterior) ao Dataverse.
          latestBufferRef.current = next;
          return next;
        });
        setDirty(true);
        setSaveStatus((s) => (s === "saved" ? "idle" : s));
      } else {
        onFieldChange?.(field, value);
        if (field === "contaContabil") {
          const auto = findSetorBySubcategoria(value as unknown as string);
          if (auto) {
            onFieldChange?.(
              "setor" as K,
              auto as unknown as IPedidoData[K],
            );
          }
        }
      }
    },
    [embedded, onFieldChange, scheduleAutoSave],
  );

  const current = embedded ? buffer : pedido;

  const handleText =
    (field: keyof IPedidoData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      updateField(field, e.target.value as IPedidoData[typeof field]);
    };

  const handleNumber =
    (field: keyof IPedidoData) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      updateField(
        field,
        (v === "" ? undefined : Number(v)) as IPedidoData[typeof field],
      );
    };

  const handleDateTime =
    (field: keyof IPedidoData) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateField(
        field,
        fromDateTimeLocalValue(e.target.value) as IPedidoData[typeof field],
      );
    };

  const handleSave = () => {
    flushSave();
  };

  const handleCancel = () => {
    clearAutoSaveTimer();
    setBuffer(pedido);
    latestBufferRef.current = pedido;
    setDirty(false);
    setSaveStatus("idle");
    onClose?.();
  };

  const statusKey = (current.status || "Novo").toLowerCase().replace(/\s+/g, "-");

  const containerStyle: React.CSSProperties = embedded
    ? {}
    : {
        width: width ? `${width}px` : "100%",
        ...(height && height > 0 ? { minHeight: `${height}px` } : {}),
      };

  const codigoPedido =
    current.numeroRequisicao ||
    current.numeroOrcamento ||
    current.numeroChamado ||
    current.ordemCompra ||
    "SEM Nº";

  const rootClass = embedded ? "cp-root cp-root-embedded" : "cp-root";

  // ID estável e determinístico para o datalist (evita Math.random em render).
  const datalistId = React.useMemo(
    () =>
      `cp-setores-${
        (
          current.numeroRequisicao ||
          current.numeroOrcamento ||
          current.numeroChamado ||
          current.ordemCompra ||
          current.fornecedor ||
          "default"
        )
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      }`,
    [
      current.numeroRequisicao,
      current.numeroOrcamento,
      current.numeroChamado,
      current.ordemCompra,
      current.fornecedor,
    ],
  );

  const datalistDespesaId = `${datalistId}-despesa`;

  const setorOptions = React.useMemo(
    () => mergeSetoresComCatalogo([...setoresConhecidos]),
    [setoresConhecidos],
  );

  const subcategoriasSugeridas = React.useMemo(
    () => [...getSubcategoriasParaSetor(current.setor)],
    [current.setor],
  );

  // Todas as contas contábeis do catálogo (sugestões para o campo Conta Contábil).
  // Mantemos a lista completa porque o setor é derivado automaticamente ao escolher.
  const contasContabeisSugeridas = React.useMemo(
    () => [...SUBCATEGORIAS_TODAS],
    [],
  );

  return (
    <div className={rootClass} style={containerStyle} data-status={statusKey}>
      {/* ---- Lista para o autocomplete de Setor ---- */}
      <datalist id={datalistId}>
        {setorOptions.map((s) => (
          <option key={s} value={s}>
            {setorLabelExibicao(s)}
          </option>
        ))}
      </datalist>
      {subcategoriasSugeridas.length > 0 && (
        <datalist id={datalistDespesaId}>
          {subcategoriasSugeridas.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}

      {/* ====== HEADER ====== */}
      {!embedded && (
        <header className="cp-header">
          <div className="cp-header-left">
            <div className="cp-header-title">CockPit - Pedidos de Requisição</div>
            <div className="cp-header-subtitle">
              {current.tituloPedido || current.solicitante
                ? `Solicitante: ${current.tituloPedido || current.solicitante}`
                : "Preencha os campos abaixo para registrar um pedido"}
            </div>
          </div>
          <div className="cp-metrics" aria-label="Métricas do pedido">
            <div className="cp-metric">
              <span className="cp-metric-label">Valor</span>
              <span className="cp-metric-value cp-metric-value-accent">
                {formatCurrencyBRL(current.valor)}
              </span>
            </div>
            <div className="cp-metric">
              <span className="cp-metric-label">Data</span>
              <span className="cp-metric-value">{formatDateTimeBR(current.dataSolicitacao)}</span>
            </div>
            <div className="cp-metric">
              <span className="cp-metric-label">Vencimento</span>
              <span className="cp-metric-value">{current.vencimento?.trim() ? current.vencimento : "—"}</span>
            </div>
            <div className="cp-metric">
              <span className="cp-metric-label">Quantidade</span>
              <span className="cp-metric-value">
                {current.quantidade !== undefined && current.quantidade !== null
                  ? current.quantidade
                  : "—"}
              </span>
            </div>
          </div>
        </header>
      )}

      {/* ====== SUMMARY CARD ====== */}
      <section className="cp-summary" aria-label="Resumo do pedido">
        <div className="cp-summary-icon" aria-hidden="true">⤴</div>
        <div className="cp-summary-left">
          <div className="cp-summary-supplier">
            {current.tituloPedido || current.solicitante || (
              <span className="cp-summary-supplier-placeholder">
                Solicitante não informado
              </span>
            )}
          </div>
          <div className="cp-summary-code">{codigoPedido}</div>
          <div className="cp-summary-status-row">
            <div className={`cp-status-pill cp-status-${statusKey}`}>
              <span className="cp-status-dot" aria-hidden="true" />
              <select
                className="cp-status-select"
                value={current.status || ""}
                onChange={handleText("status")}
                aria-label="Status do pedido"
              >
                <option value="" disabled>Selecione…</option>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="cp-summary-right">
          <span className="cp-summary-value-label">Valor</span>
          <span className="cp-summary-value">{formatCurrencyBRL(current.valor)}</span>
        </div>
      </section>

      {/* ====== SEÇÃO 1 — AUTOMÁTICOS ====== */}
      <section className="cp-section cp-section-auto">
        <div className="cp-section-head">
          <h3 className="cp-section-title">
            <span className="cp-section-icon">⚙️</span> Dados do Formulário
          </h3>
          <p className="cp-section-desc">
            Vindos automaticamente do Forms. Editáveis se necessário.
          </p>
        </div>
        <div className="cp-grid">
          <Field label="Título do pedido" owner="auto" htmlFor="cp-tituloPedido">
            <input id="cp-tituloPedido" type="text" className="cp-input"
              value={current.tituloPedido ?? ""}
              onChange={handleText("tituloPedido")}
              placeholder="Nome de quem solicitou (campo primário)" />
          </Field>
          <Field label="Data e hora da solicitação" owner="auto" htmlFor="cp-dataSolicitacao">
            <input id="cp-dataSolicitacao" type="datetime-local" className="cp-input"
              value={toDateTimeLocalValue(current.dataSolicitacao)}
              onChange={handleDateTime("dataSolicitacao")} />
          </Field>
          <Field label="Marca" owner="auto" htmlFor="cp-marca">
            <input id="cp-marca" type="text" className="cp-input"
              value={current.marca ?? ""} onChange={handleText("marca")}
              placeholder="Ex.: Marca X" />
          </Field>
          <Field label="Diretoria" owner="auto" htmlFor="cp-diretoria">
            <input id="cp-diretoria" type="text" className="cp-input"
              value={current.diretoria ?? ""} onChange={handleText("diretoria")}
              placeholder="Ex.: Diretoria Comercial" />
          </Field>
          <Field
            label="Despesa"
            owner="auto"
            htmlFor="cp-despesa"
            hint={
              subcategoriasSugeridas.length > 0
                ? `Linhas do plano para o setor atual (${subcategoriasSugeridas.length} sugestões)`
                : "Defina o Setor (05–10) para sugerir a linha de despesa; texto livre continua permitido."
            }
          >
            <input
              id="cp-despesa"
              type="text"
              className="cp-input"
              value={current.despesa ?? ""}
              onChange={handleText("despesa")}
              list={subcategoriasSugeridas.length > 0 ? datalistDespesaId : undefined}
              placeholder="Ex.: 33107010 - Serviços de Higiene e Limpeza"
            />
          </Field>
          <Field label="Quantidade" owner="auto" htmlFor="cp-quantidade">
            <input id="cp-quantidade" type="text" className="cp-input"
              value={current.quantidade ?? ""}
              onChange={handleText("quantidade")}
              placeholder="Ex.: 1 ou 5, 15, 4" />
          </Field>
          <Field label="Solicitante" owner="auto" htmlFor="cp-solicitante">
            <input id="cp-solicitante" type="text" className="cp-input"
              value={current.solicitante ?? ""}
              onChange={handleText("solicitante")} />
          </Field>
        </div>
      </section>

      {/* ====== SEÇÃO 2 — LUCIANA ====== */}
      <section className="cp-section cp-section-luciana">
        <div className="cp-section-head">
          <h3 className="cp-section-title">
            <span className="cp-section-icon">🙋‍♀️</span> Tratamento — Luciana
          </h3>
          <p className="cp-section-desc">
            Responsabilidade primária de compras. Qualquer pessoa pode editar.
          </p>
        </div>
        <div className="cp-grid">
          <Field label="Fornecedor" owner="luciana" htmlFor="cp-fornecedor">
            <input id="cp-fornecedor" type="text" className="cp-input"
              value={current.fornecedor ?? ""} onChange={handleText("fornecedor")}
              placeholder="Razão social" />
          </Field>
          <Field label="CNPJ" owner="luciana" htmlFor="cp-cnpj">
            <input id="cp-cnpj" type="text" className="cp-input"
              value={current.cnpj ?? ""} onChange={handleText("cnpj")}
              placeholder="00.000.000/0000-00" />
          </Field>
          <Field label="Nº Orçamento" owner="luciana" htmlFor="cp-numeroOrcamento">
            <input id="cp-numeroOrcamento" type="text" className="cp-input"
              value={current.numeroOrcamento ?? ""}
              onChange={handleText("numeroOrcamento")} />
          </Field>
          <Field label="Valor" owner="luciana" htmlFor="cp-valor" hint="R$ — moeda">
            <input id="cp-valor" type="number" step="0.01" min={0}
              className="cp-input cp-input-currency"
              value={toNumberInputValue(current.valor)}
              onChange={handleNumber("valor")} placeholder="0,00" />
          </Field>
          <Field label="Responsável" owner="luciana" htmlFor="cp-responsavel">
            <input id="cp-responsavel" type="text" className="cp-input"
              value={current.responsavel ?? ""}
              onChange={handleText("responsavel")} />
          </Field>
          <Field label="Número de Chamado" owner="luciana" htmlFor="cp-numeroChamado">
            <input id="cp-numeroChamado" type="text" className="cp-input"
              value={current.numeroChamado ?? ""}
              onChange={handleText("numeroChamado")} />
          </Field>
          <Field label="Natureza" owner="luciana" htmlFor="cp-natureza">
            <input id="cp-natureza" type="text" className="cp-input"
              value={current.natureza ?? ""} onChange={handleText("natureza")} />
          </Field>
          <Field label="Número de Requisição" owner="luciana" htmlFor="cp-numeroRequisicao">
            <input id="cp-numeroRequisicao" type="text" className="cp-input"
              value={current.numeroRequisicao ?? ""}
              onChange={handleText("numeroRequisicao")} />
          </Field>
        </div>
      </section>

      {/* ====== SEÇÃO 3 — LUCIANO ====== */}
      <section className="cp-section cp-section-luciano">
        <div className="cp-section-head">
          <h3 className="cp-section-title">
            <span className="cp-section-icon">🙋‍♂️</span> Financeiro — Luciano
          </h3>
          <p className="cp-section-desc">
            Responsabilidade primária contábil. Qualquer pessoa pode editar.
          </p>
        </div>
        <div className="cp-grid">
          <Field label="Centro de Custo" owner="luciano" htmlFor="cp-centroCusto">
            <input id="cp-centroCusto" type="text" className="cp-input"
              value={current.centroCusto ?? ""}
              onChange={handleText("centroCusto")} />
          </Field>
          <Field
            label="Conta Contábil"
            owner="luciano"
            htmlFor="cp-contaContabil"
            hint="Escolha na lista; o Setor é preenchido automaticamente."
          >
            <select
              id="cp-contaContabil"
              className="cp-input cp-select"
              value={
                contasContabeisSugeridas.includes(current.contaContabil ?? "")
                  ? current.contaContabil ?? ""
                  : (current.contaContabil ?? "") === ""
                    ? ""
                    : "__custom__"
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__custom__") return;
                updateField("contaContabil", v);
              }}
            >
              <option value="">— selecionar —</option>
              {SETORES_ORGANIZACAO.map((grupo) => (
                <optgroup key={grupo.setor} label={setorLabelExibicao(grupo.setor)}>
                  {grupo.subcategorias.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </optgroup>
              ))}
              {current.contaContabil &&
                !contasContabeisSugeridas.includes(current.contaContabil) && (
                  <option value="__custom__">
                    {current.contaContabil} (fora do catálogo)
                  </option>
                )}
            </select>
          </Field>
        </div>
      </section>

      {/* ====== SEÇÃO 4 — COMPARTILHADOS ====== */}
      <section className="cp-section cp-section-shared">
        <div className="cp-section-head">
          <h3 className="cp-section-title">
            <span className="cp-section-icon">🤝</span> Compartilhados
          </h3>
          <p className="cp-section-desc">
            Preenchidos conforme o andamento do pedido.
          </p>
        </div>
        <div className="cp-grid">
          <Field label="Nº Nota" owner="shared" htmlFor="cp-numeroNota">
            <input id="cp-numeroNota" type="text" className="cp-input"
              value={current.numeroNota ?? ""} onChange={handleText("numeroNota")} />
          </Field>
          <Field label="Vencimento" owner="shared" htmlFor="cp-vencimento"
            hint="Texto livre (ex.: dd/mm/aaaa).">
            <input id="cp-vencimento" type="text" className="cp-input"
              value={current.vencimento ?? ""}
              onChange={handleText("vencimento")}
              placeholder="Ex.: 17/04/2026" />
          </Field>
          <Field label="Ordem de Compra" owner="shared" htmlFor="cp-ordemCompra">
            <input id="cp-ordemCompra" type="text" className="cp-input"
              value={current.ordemCompra ?? ""}
              onChange={handleText("ordemCompra")} />
          </Field>

          {/* Campo Setor — aprendizado orgânico via datalist */}
          <Field
            label="Setor"
            owner="shared"
            htmlFor="cp-setor"
            hint={
              setorOptions.length > 0
                ? `Catálogo com setores 05–10; ${setorOptions.length} valor(es) na lista (inclui já usados na base).`
                : "Escolha ou digite o setor — alinhe ao orçamento quando possível."
            }
          >
            <input
              id="cp-setor"
              type="text"
              className="cp-input"
              list={datalistId}
              value={current.setor ?? ""}
              onChange={handleText("setor")}
              placeholder="Ex.: Serv. Terceiros"
            />
          </Field>
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      {embedded ? (
        <footer className="cp-drawer-footer">
          <div
            className={`cp-autosave-status cp-autosave-${saveStatus}`}
            role="status"
            aria-live="polite"
          >
            {saveStatus === "pending" && (
              <>
                <span className="cp-autosave-dot" aria-hidden="true" />
                Salvando…
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <span className="cp-autosave-check" aria-hidden="true">✓</span>
                Alterações salvas
              </>
            )}
            {saveStatus === "idle" && autoSave && (
              <span className="cp-autosave-hint">
                As alterações são salvas automaticamente
              </span>
            )}
            {saveStatus === "idle" && !autoSave && dirty && (
              <span className="cp-autosave-hint">Alterações não enviadas — clique em Salvar</span>
            )}
            {saveStatus === "idle" && !autoSave && !dirty && (
              <span className="cp-autosave-hint">
                Use <strong>Salvar</strong> para enviar este pedido ao Dataverse (também se só confirmar o estado atual)
              </span>
            )}
          </div>
          <div className="cp-drawer-footer-actions">
            <button
              type="button"
              className="cp-btn cp-btn-ghost"
              onClick={handleCancel}
            >
              Fechar
            </button>
            <button
              type="button"
              className="cp-btn cp-btn-primary"
              onClick={handleSave}
              disabled={autoSave ? !dirty && saveStatus !== "pending" : false}
              title={
                autoSave
                  ? dirty || saveStatus === "pending"
                    ? "Salvar agora (sem esperar o auto-save)"
                    : "Nenhuma alteração pendente"
                  : "Gravar o estado atual no Dataverse (saída lastEditedJson do componente)"
              }
            >
              {autoSave ? "Salvar agora" : "Salvar"}
            </button>
          </div>
        </footer>
      ) : (
        <footer className="cp-footer" aria-label="Legenda de responsabilidades">
          <span className="cp-footer-title">Legenda</span>
          <span className="cp-legend-item"><OwnerBadge owner="auto" /> Dados automáticos</span>
          <span className="cp-legend-item"><OwnerBadge owner="luciana" /> Tratamento inicial</span>
          <span className="cp-legend-item"><OwnerBadge owner="luciano" /> Financeiro / Contábil</span>
          <span className="cp-legend-item"><OwnerBadge owner="shared" /> Compartilhado</span>
        </footer>
      )}
    </div>
  );
};

export default PedidoForm;
