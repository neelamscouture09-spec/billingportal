import { X } from "lucide-react";
import type { ReactNode } from "react";

export function ActionDialog({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal-card ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={17} /></button></header>{children}</section></div>;
}

export function ConfirmAction({ title, description, confirmLabel = "Confirm", danger = false, onCancel, onConfirm, pending = false }: { title?: string; description: string; confirmLabel?: string; danger?: boolean; onCancel: () => void; onConfirm: () => void; pending?: boolean }) {
  return <div className="modal-body"><p style={{ margin: "0 0 8px", color: "#475569", fontSize: 11, lineHeight: 1.6 }}>{description}</p><footer className="modal-footer" style={{ padding: "15px 0 0" }}><button className="btn-outline" onClick={onCancel}>Cancel</button><button className={danger ? "btn-outline btn-danger" : "btn-primary"} onClick={onConfirm} disabled={pending}>{pending ? "Please wait…" : confirmLabel}</button></footer></div>;
}
