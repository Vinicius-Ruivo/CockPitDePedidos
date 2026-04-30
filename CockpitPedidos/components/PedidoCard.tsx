import * as React from "react";
import { setorLabelExibicao } from "../constants/setoresOrganizacao";
import { IPedido } from "../types";

export interface IPedidoCardProps {
  pedido: IPedido;
  selected?: boolean;
  onOpen: (id: string) => void;
}

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

const codigoCurto = (p: IPedido): string =>
  p.numeroRequisicao ||
  p.numeroOrcamento ||
  p.numeroChamado ||
  p.ordemCompra ||
  `#${p.id.slice(0, 6)}`;

const chamadoLinha = (p: IPedido): string => (p.numeroChamado ?? "").trim();

/** Identificador para leitor de ecrã quando não há número de chamado visível. */
const rotuloAcessivelPedido = (p: IPedido): string =>
  chamadoLinha(p) || codigoCurto(p);

/**
 * Card compacto de pedido — linha principal: quem solicitou; código; valor/status.
 * É clicável (toda a área) e tem um botão explícito no canto para abrir o drawer.
 */
export const PedidoCard: React.FC<IPedidoCardProps> = React.memo(
  ({ pedido, selected = false, onOpen }) => {
    const statusKey = (pedido.status || "Novo").toLowerCase().replace(/\s+/g, "-");
    const chamado = chamadoLinha(pedido);
    const setorTxt = (pedido.setor ?? "").trim();
    const contaTxt = (pedido.contaContabil ?? "").trim();
    const handleClick = React.useCallback(() => onOpen(pedido.id), [onOpen, pedido.id]);
    const handleKey = React.useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(pedido.id);
        }
      },
      [onOpen, pedido.id],
    );

    return (
      <div
        className={`cp-card${selected ? " cp-card-selected" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`Abrir pedido ${rotuloAcessivelPedido(pedido)} — ${pedido.tituloPedido || pedido.solicitante || "solicitante não informado"}`}
        onClick={handleClick}
        onKeyDown={handleKey}
        data-status={statusKey}
      >
        <div className="cp-card-body">
          <div className="cp-card-supplier">
            {(pedido.tituloPedido || pedido.solicitante) || (
              <span className="cp-card-supplier-empty">Solicitante não informado</span>
            )}
          </div>
          {chamado !== "" && <div className="cp-card-code">{chamado}</div>}

          {(setorTxt || contaTxt) && (
            <div className="cp-card-meta">
              {setorTxt !== "" && (
                <div
                  className="cp-card-setor"
                  title={`Setor: ${setorLabelExibicao(setorTxt)}`}
                >
                  <span className="cp-card-setor-dot" aria-hidden="true" />
                  {setorLabelExibicao(setorTxt)}
                </div>
              )}
              {contaTxt !== "" && (
                <div className="cp-card-conta" title={`Conta contábil: ${contaTxt}`}>
                  {contaTxt}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="cp-card-aside">
          <span className="cp-card-value">{formatCurrencyBRL(pedido.valor)}</span>
          <div className={`cp-status-pill cp-status-${statusKey}`}>
            <span className="cp-status-dot" aria-hidden="true" />
            <span className="cp-status-text">{pedido.status || "NOVO"}</span>
          </div>
        </div>

        <button
          type="button"
          className="cp-card-open"
          aria-label="Abrir detalhes"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(pedido.id);
          }}
          title="Abrir detalhes"
        >
          ⤴
        </button>
      </div>
    );
  },
);

PedidoCard.displayName = "PedidoCard";
