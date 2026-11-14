"use client";
/**
 * Màn «Tủ sách gia đình» của cổng phụ huynh (08/11/2026): giao diện sinh từ artifact «Cổng Phụ Huynh — Thiết kế lại» (Tu-sach.dc.html) + view-model thật.
 * Nằm TRONG vỏ cổng phụ huynh (menu bên / thanh tab đã do layout dựng), nên chỉ vẽ phần nội dung và thông báo nổi.
 */
import { TuSachCongView } from "./tu-sach-cong-view";
import { useTuSachCongVm, type TuSachCongProps } from "./vm";

export function TuSachCong(props: TuSachCongProps) {
  const vm = useTuSachCongVm(props);
  return (
    <div style={{ fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, sans-serif", color: "#241133" }}>
      <TuSachCongView vm={vm} />
      {vm.coToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 104,
            transform: "translateX(-50%)",
            zIndex: 50,
            width: "max-content",
            maxWidth: "min(92vw, 420px)",
            boxSizing: "border-box",
            padding: "12px 16px",
            borderRadius: 14,
            background: "#241133",
            color: "#ffffff",
            fontSize: 14,
            lineHeight: "20px",
            boxShadow: "0 8px 24px rgba(36,17,51,0.25)",
          }}
        >
          {vm.toast}
        </div>
      )}
    </div>
  );
}
