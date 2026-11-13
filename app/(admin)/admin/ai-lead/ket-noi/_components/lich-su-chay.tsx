// Lịch sử các lần kiểm chứng (L1–L4). Component hiển thị thuần (server). Lần chạy MOCK_ONLY luôn gắn nhãn "CHỈ GIẢ LẬP" — không bao giờ trông như một kết quả thật.
import type { ChayGanDay } from "@/lib/ai-lead/dich-vu/ket-noi";
import { gioVn } from "../../_components/dinh-dang";
import { CHU_NGUON_BANG_CHUNG } from "@/lib/ai-lead/dich-vu/ket-noi-thuan";
import { NhanDon, type Tone } from "../../_components/nhan-trang-thai";

const TONE: Record<ChayGanDay["status"], Tone> = { PASS: "info", FAIL: "danger", BLOCKED: "danger", NOT_RUN: "muted", MOCK_ONLY: "muted", STALE: "warning" };
const CHU: Record<ChayGanDay["status"], string> = {
  PASS: "PASS",
  FAIL: "FAIL",
  BLOCKED: "BLOCKED",
  NOT_RUN: "Chưa chạy",
  MOCK_ONLY: "CHỈ GIẢ LẬP",
  STALE: "Hết hạn",
};

export function LichSuChay({ rows }: { rows: ChayGanDay[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <p className="text-sm font-semibold">Chưa có lần kiểm chứng nào</p>
        <p className="mt-1 text-sm text-muted-foreground">Lần chạy L1 ghi từ nút “Ghi nhận lần kiểm chứng”; L2 sinh ra khi Agent xác nhận một lần thăm dò.</p>
      </div>
    );
  }
  return (
    <ul className="grid gap-2 xl:grid-cols-2">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm" data-run={r.id} data-mock={r.mock ? "true" : "false"} data-nguon={r.nguon}>
          <span className="font-semibold">{r.level}</span>
          <NhanDon tone={TONE[r.status]}>{CHU[r.status]}</NhanDon>
          <NhanDon tone={r.nguon === "HE_THONG" ? "info" : "muted"}>{r.nguon === "HE_THONG" ? "Hệ thống đo" : "Người ghi tay"}</NhanDon>
          <span className="text-xs text-muted-foreground">
            {r.kind} · {gioVn(r.createdAt)}
            {r.correlationId ? <> · {r.correlationId}</> : null}
          </span>
          {r.nguon === "THU_CONG" ? <span className="basis-full text-xs text-muted-foreground [overflow-wrap:anywhere]">{CHU_NGUON_BANG_CHUNG.THU_CONG}.</span> : null}
        </li>
      ))}
    </ul>
  );
}
