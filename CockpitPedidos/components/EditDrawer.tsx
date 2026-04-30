import * as React from "react";
import { IPedido, IPedidoData } from "../types";
import { PedidoForm } from "./PedidoForm";

export interface IEditDrawerProps {
  pedido: IPedido | null;
  setoresConhecidos: ReadonlyArray<string>;
  onSave: (recordId: string, fields: IPedidoData) => void;
  onClose: () => void;
}

/**
 * Drawer lateral que sobrepõe o dashboard e abriga o PedidoForm em modo
 * `embedded`. Fecha com ESC, clique no backdrop ou botão explícito.
 */
export const EditDrawer: React.FC<IEditDrawerProps> = ({
  pedido,
  setoresConhecidos,
  onSave,
  onClose,
}) => {
  const open = pedido !== null;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!pedido) return null;

  const handleSave = (fields: IPedidoData) => {
    onSave(pedido.id, fields);
  };

  const codigoCurto =
    pedido.numeroRequisicao ||
    pedido.numeroOrcamento ||
    pedido.numeroChamado ||
    pedido.ordemCompra ||
    `#${pedido.id.slice(0, 6)}`;

  return (
    <div className="cp-drawer-root" role="dialog" aria-modal="true" aria-label="Editar pedido">
      <div className="cp-drawer-backdrop" onClick={onClose} />
      <aside className="cp-drawer">
        <header className="cp-drawer-header">
          <div className="cp-drawer-header-main">
            <div className="cp-drawer-header-eyebrow">Editar pedido</div>
            <div className="cp-drawer-header-title">
              {pedido.tituloPedido || pedido.solicitante || "Solicitante não informado"}
            </div>
            <div className="cp-drawer-header-subtitle">{codigoCurto}</div>
          </div>
          <button
            type="button"
            className="cp-drawer-close"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            ×
          </button>
        </header>

        <div className="cp-drawer-body">
          <PedidoForm
            key={pedido.id}
            embedded
            autoSave={false}
            pedido={stripId(pedido)}
            setoresConhecidos={setoresConhecidos}
            onSave={handleSave}
            onClose={onClose}
          />
        </div>
      </aside>
    </div>
  );
};

function stripId(p: IPedido): IPedidoData {
  const rest = { ...p } as Partial<IPedido>;
  delete rest.id;
  return rest as IPedidoData;
}

export default EditDrawer;
