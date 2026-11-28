"use client";
/**
 * Màn «Sức khỏe cả nhà» của cổng phụ huynh (08/11/2026): hai màn sinh từ artifact «Cổng Phụ Huynh — Thiết kế lại» (Suc-khoe.dc.html + Suc-khoe-khao-sat.dc.html)
 * + view-model thật. Nằm TRONG vỏ cổng (menu bên / thanh tab do layout dựng) nên chỉ vẽ phần nội dung và thông báo nổi. Chuyển giữa hai màn bằng trạng thái (không route con).
 */
import { KhaoSatCongView } from "./khao-sat-cong-view";
import { SucKhoeCongView } from "./suc-khoe-cong-view";
import { useSucKhoeCongVm } from "./vm";
import { layHomNay } from "@/lib/suc-khoe/dong-co-goc";

export function SucKhoeCong() {
  const vm = useSucKhoeCongVm();
  return (
    <div style={{ fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, sans-serif", color: "#241133" }}>
      {vm.man === "tq" ? <SucKhoeCongView vm={vm.tq} homNay={layHomNay()} /> : <KhaoSatCongView vm={vm.ks} />}
      {vm.tq.coNguoi && vm.man === "tq" && (
        <p style={{ margin: "16px 0 0", fontSize: 13, color: "#6b5a78" }}>
          Số đo và câu trả lời nằm trên máy này.{" "}
          <button type="button" onClick={vm.tq.saoLuu} style={{ background: "none", border: "none", padding: 0, color: "#620c8b", fontWeight: 700, textDecoration: "underline", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
            Tải bản sao lưu
          </button>{" "}
          để không mất khi đổi máy.
        </p>
      )}
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
