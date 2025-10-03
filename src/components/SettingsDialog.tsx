// src/components/SettingsDialog.tsx
import React from "react";
import { createPortal } from "react-dom";

type Props = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export default function SettingsDialog({ title, open, onClose, children }: Props) {
  // keep hook order constant
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const prev = document.body.style.overflow;
    if (open) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  React.useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  if (!open) return null;

  const Z_OVERLAY = 999000;
  const Z_PANEL = Z_OVERLAY + 1;

  const overlayStyle: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.32)",
    backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", zIndex: Z_OVERLAY,
  };
  const panelStyle: React.CSSProperties = {
    position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
    width: "min(820px, 92vw)", maxHeight: "min(80vh, 880px)",
    display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden", zIndex: Z_PANEL,
    background: "var(--bg, #111)", color: "var(--text, #fff)",
    border: "1px solid var(--border, #333)", borderRadius: "var(--radius, 12px)",
    boxShadow: "var(--shadow, 0 10px 30px rgba(0,0,0,.3))", outline: "none",
    animation: "modalIn 140ms ease-out",
  };
  const headerStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border, #333)",
    background: "var(--chip, rgba(255,255,255,0.04))",
  };
  const titleStyle: React.CSSProperties = { fontWeight: 800, letterSpacing: ".2px" };
  const contentStyle: React.CSSProperties = {
    padding: 14, overflow: "auto", background: "var(--bg, #111)", color: "var(--text, #fff)",
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div style={overlayStyle} onClick={onClose} />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={panelStyle}
      >
        <div style={headerStyle}>
          <div style={titleStyle}>{title}</div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close settings"
            onClick={onClose}
            title="Close"
            style={{ color: "var(--text, #fff)" }}
          >
            ✕
          </button>
        </div>
        <div style={contentStyle}>{children}</div>
      </div>

      {/* Local keyframes */}
      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 6px)) scale(0.98); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </>,
    document.body
  );
}
