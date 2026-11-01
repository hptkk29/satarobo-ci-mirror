// Nhãn trạng thái + SLA của hồ sơ chờ. Server Component thuần (không state). Luôn có CHỮ — không mã hoá chỉ bằng màu (PRODUCT.md, Accessibility).
import { NHAN_SLA, laQuaHan, type MucSla } from "@/lib/ai-lead/dich-vu/sla";
import { ViTrang } from "../_components/nhan-trang-thai";
import { NHAN_TRANG_THAI, TONE_SLA } from "./hien-thi";

export function NhanTrangThai({ state }: { state: string }) {
  const m = NHAN_TRANG_THAI[state] ?? { nhan: state, tone: "muted" as const };
  return <ViTrang tone={m.tone}>{m.nhan}</ViTrang>;
}

export function NhanSla({ muc }: { muc: MucSla }) {
  if (muc === "KHONG_AP_DUNG") return <span className="text-muted-foreground">—</span>;
  return (
    <ViTrang tone={TONE_SLA[muc]} className={laQuaHan(muc) ? "ring-1 ring-inset ring-[color:var(--state-danger)]" : undefined}>
      {NHAN_SLA[muc]}
    </ViTrang>
  );
}
