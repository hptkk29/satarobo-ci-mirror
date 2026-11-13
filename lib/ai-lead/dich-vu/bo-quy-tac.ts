// lib/ai-lead/dich-vu/bo-quy-tac.ts — ENGINE ĐÁNH GIÁ BỘ QUY TẮC. THUẦN: không DB, không env, không đồng hồ (mọi mốc thời gian là THAM SỐ), không import runtime ngoài schema.
//
// Vì sao thuần: `intake.ts` (đường phản hồi Agent) gọi các hàm này mà KHÔNG được chạm CRM (N1); màn Cấu hình gọi CHÍNH các hàm này để hiện «đang áp dụng gì» — màn hình và máy chủ không nói hai điều khác nhau.
// KHÔNG tạo lead, KHÔNG chia sale, KHÔNG quy nguồn ở đây: tự tạo lead vẫn đi `taoLeadTuHoSo → ingestIntakeLead`; engine chỉ quyết «có được thử không / hạn bao lâu / báo ai khi nào».
import type { BoQuyTac, NhomNguoiNhan, QuyTac, QuyTacAutoCreate, QuyTacNotify, QuyTacSla, SuKienThongBao } from "./bo-quy-tac-schema";

// ─── SLA ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type NguonHanSla = "CAMPUS" | "PAGE" | "DEFAULT" | "THAM_SO";
export type HanSlaPhut = { claimMinutes: number; resolveMinutes: number; nguon: NguonHanSla };

/**
 * Hạn SLA theo quy tắc: CAMPUS thắng PAGE thắng DEFAULT; không quy tắc nào ⇒ tham số `ai.slaClaimMinutes`/`ai.slaResolveMinutes` (hành vi trước Rule Builder, KHÔNG đổi).
 * `centerId` null (chưa biết cơ sở) bỏ qua bậc CAMPUS.
 */
export function hanSlaTheoQuyTac(
  b: BoQuyTac | null,
  ctx: { pageId: string; centerId: string | null },
  thamSo: { slaClaimMinutes: number; slaResolveMinutes: number },
): HanSlaPhut {
  const sla = (b?.rules ?? []).filter((r): r is QuyTacSla => r.kind === "SLA");
  const campus = ctx.centerId === null ? undefined : sla.find((r) => r.scope.type === "CAMPUS" && r.scope.centerId === ctx.centerId);
  if (campus) return { claimMinutes: campus.claimMinutes, resolveMinutes: campus.resolveMinutes, nguon: "CAMPUS" };
  const page = sla.find((r) => r.scope.type === "PAGE" && r.scope.pageId === ctx.pageId);
  if (page) return { claimMinutes: page.claimMinutes, resolveMinutes: page.resolveMinutes, nguon: "PAGE" };
  const macDinh = sla.find((r) => r.scope.type === "DEFAULT");
  if (macDinh) return { claimMinutes: macDinh.claimMinutes, resolveMinutes: macDinh.resolveMinutes, nguon: "DEFAULT" };
  return { claimMinutes: thamSo.slaClaimMinutes, resolveMinutes: thamSo.slaResolveMinutes, nguon: "THAM_SO" };
}

// ─── TỰ TẠO LEAD: ràng buộc THU HẸP ─────────────────────────────────────────────────────────────────────────────────────────

export type LyDoThuHep = "KHONG_THU_HEP" | "CAN_DONG_Y" | "NGOAI_DANH_SACH_CO_SO";
export const CAU_LY_DO_THU_HEP: Record<LyDoThuHep, string> = {
  KHONG_THU_HEP: "Không có ràng buộc thu hẹp.",
  CAN_DONG_Y: "Quy tắc đòi khách đã đồng ý liên hệ — hồ sơ này chưa có đồng ý nên chờ nhân viên duyệt.",
  NGOAI_DANH_SACH_CO_SO: "Cơ sở của hồ sơ không nằm trong danh sách được tự tạo lead — chờ nhân viên duyệt.",
};

export function timQuyTacAuto(b: BoQuyTac | null, agentId: string, pageId: string): QuyTacAutoCreate | null {
  return (b?.rules ?? []).find((r): r is QuyTacAutoCreate => r.kind === "AUTO_CREATE" && r.agentId === agentId && r.pageId === pageId) ?? null;
}

/**
 * CHỈ THU HẸP: hàm này không bao giờ trả `allowed: true` cho hồ sơ mà `choPhepTuTaoLead` đã từ chối (chỗ gọi chỉ gọi nó SAU khi cổng đó cho qua), và không có đường nào để quy tắc BẬT thêm.
 * Không có quy tắc / quy tắc không khai ràng buộc ⇒ không thu hẹp. Danh sách cơ sở có mặt mà hồ sơ chưa có cơ sở ⇒ từ chối (không đoán).
 */
export function thuHepTuTao(rule: QuyTacAutoCreate | null, hoSo: { consentAllowed: boolean; campusCenterId: string | null }): { allowed: boolean; lyDo: LyDoThuHep } {
  if (!rule) return { allowed: true, lyDo: "KHONG_THU_HEP" };
  if (rule.requireConsent === true && hoSo.consentAllowed !== true) return { allowed: false, lyDo: "CAN_DONG_Y" };
  const ds = rule.campusCenterIds;
  if (ds && ds.length > 0 && (hoSo.campusCenterId === null || !ds.includes(hoSo.campusCenterId))) return { allowed: false, lyDo: "NGOAI_DANH_SACH_CO_SO" };
  return { allowed: true, lyDo: "KHONG_THU_HEP" };
}

// ─── THÔNG BÁO + LEO THANG ──────────────────────────────────────────────────────────────────────────────────────────────────

export type BacThongBao = { afterMinutes: number; to: readonly NhomNguoiNhan[] };

/** Hành vi TRƯỚC Rule Builder, giữ nguyên khi không có quy tắc NOTIFY nào cho sự kiện (không đổi người nhận của ai đang nhận hôm nay). */
export const BAC_MAC_DINH: Record<SuKienThongBao, readonly BacThongBao[]> = {
  DRAFT_NEEDS_STAFF: [{ afterMinutes: 0, to: ["CENTER_MANAGER"] }],
  SLA_CLAIM_OVERDUE: [{ afterMinutes: 0, to: ["CENTER_MANAGER"] }],
  SLA_RESOLVE_OVERDUE: [{ afterMinutes: 0, to: ["CENTER_MANAGER"] }],
  INCIDENT: [{ afterMinutes: 0, to: ["INTEGRATION_VIEWERS"] }],
};

/**
 * Các bậc báo của MỘT sự kiện tại MỘT cơ sở. Quy tắc RIÊNG của cơ sở (centerId khớp) thay HOÀN TOÀN quy tắc chung (centerId null) — không trộn, để người đọc luôn thấy
 * trọn một chuỗi. Không quy tắc nào ⇒ `BAC_MAC_DINH`. Sắp theo `afterMinutes` tăng dần; cùng mốc thì gộp nhóm người nhận.
 */
export function cacBacThongBao(b: BoQuyTac | null, event: SuKienThongBao, centerId: string | null): BacThongBao[] {
  const nof = (b?.rules ?? []).filter((r): r is QuyTacNotify => r.kind === "NOTIFY" && r.event === event);
  const rieng = centerId === null ? [] : nof.filter((r) => r.centerId === centerId);
  const dung = rieng.length > 0 ? rieng : nof.filter((r) => r.centerId === null);
  if (dung.length === 0) return BAC_MAC_DINH[event].map((x) => ({ afterMinutes: x.afterMinutes, to: [...x.to] }));
  const theoMoc = new Map<number, Set<NhomNguoiNhan>>();
  // Có quy tắc nhưng KHÔNG ai khai bậc 0 ⇒ giữ bậc 0 MẶC ĐỊNH. Thêm một dòng «sau 30 phút báo Marketing» không được lặng lẽ gỡ người đang nhận ngay hôm nay (review độc lập 28/10:
  // QLCS mất thông báo hồ sơ mới). Muốn đổi người nhận ngay thì khai tường minh một dòng 0 phút — khi đó quy tắc của Admin thắng.
  if (!dung.some((r) => r.afterMinutes === 0)) {
    for (const x of BAC_MAC_DINH[event]) if (x.afterMinutes === 0) theoMoc.set(0, new Set<NhomNguoiNhan>(x.to));
  }
  for (const r of dung) {
    const s = theoMoc.get(r.afterMinutes) ?? new Set<NhomNguoiNhan>();
    for (const t of r.to) s.add(t);
    theoMoc.set(r.afterMinutes, s);
  }
  return [...theoMoc.entries()].sort((x, y) => x[0] - y[0]).map(([afterMinutes, to]) => ({ afterMinutes, to: [...to].sort() }));
}

/** Sau mốc cuối cùng của mọi bậc, cron còn quét thêm chừng này phút (chịu được cron/đồng hồ chậm) rồi bỏ hồ sơ khỏi cửa sổ. */
export const DEM_CUA_SO_QUET_PHUT = 24 * 60;

/**
 * ĐÁY của cửa sổ quét cron cho một sự kiện: bậc lớn nhất của MỌI quy tắc NOTIFY của sự kiện (mọi cơ sở) + `DEM_CUA_SO_QUET_PHUT`.
 * Hồ sơ/sự cố quá hạn lâu hơn mức này đã được gửi đủ mọi bậc từ lâu; giữ chúng trong truy vấn `take: 200` chỉ làm bản ghi MỚI bị đói chỗ khi hàng đợi ứ (review độc lập 28/10).
 */
export function cuaSoQuetPhut(b: BoQuyTac | null, event: SuKienThongBao): number {
  const bacLonNhat = Math.max(0, ...(b?.rules ?? []).filter((r): r is QuyTacNotify => r.kind === "NOTIFY" && r.event === event).map((r) => r.afterMinutes));
  return bacLonNhat + DEM_CUA_SO_QUET_PHUT;
}

/**
 * Các bậc ĐÃ ĐẾN HẠN báo tại `nowMs` cho một mốc `mocMs` (hạn SLA / lúc tạo sự cố). `now` là THAM SỐ (luật 19). Bậc 0 đến hạn ngay tại mốc.
 * Trả `chiSo` (vị trí trong danh sách bậc đã sắp) để khoá thông báo ổn định: chạy lặp cron không báo lại.
 */
export function cacBacDenHan(bacs: readonly BacThongBao[], mocMs: number, nowMs: number): { chiSo: number; bac: BacThongBao }[] {
  return bacs.map((bac, chiSo) => ({ chiSo, bac })).filter(({ bac }) => mocMs + bac.afterMinutes * 60_000 <= nowMs);
}

/** Dựng lại bộ quy tắc từ danh sách (tiện cho chỗ gọi). */
export const boTuDanhSach = (rules: QuyTac[]): BoQuyTac => ({ rules });
