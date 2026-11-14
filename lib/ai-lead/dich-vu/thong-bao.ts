import "server-only";
// lib/ai-lead/dich-vu/thong-bao.ts — THÔNG BÁO NHÂN SỰ của cổng AI Lead (ba tiền tố: `ai_lead.draft:` · `ai_lead.sla:` · `ai_lead.su_co:`).
//
// ⚠️ NỘI DUNG KHÔNG BAO GIỜ chứa SĐT / tên Facebook / psid (panel chuông mở giữa chỗ đông người; `ghiThongBaoNhanSu` còn che SĐT nhưng không che tên). Chỉ nói "có việc" + link.
// ⚠️ GỌI SAU KHI GIAO DỊCH ĐÃ COMMIT (hàm này không nhận `tx`). Lỗi gửi thông báo KHÔNG BAO GIỜ đổi phản hồi của Agent — mọi hàm ở đây tự nuốt lỗi và chỉ ghi mã.
//
// dedupeKey ghép THEO ĐỊNH DẠNG DƯỚI ĐÂY (đừng đổi — bản ghi cũ thành mồ côi): lưới `[CAT-SONG]` của catalog tìm chuỗi tiền tố này trong mã nguồn.
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { notifyStaff } from "@/lib/notifications/notify";
import { nguoiDuyetCoSo } from "./nguoi-duyet-co-so";
import { maLoiNoiBo } from "../loi-he-thong";
import { ngayVnLaDate } from "../ngay-vn";
import { cacBacThongBao, type BacThongBao } from "./bo-quy-tac";
import { docBoHienHanh } from "./bo-quy-tac-db";
import type { NhomNguoiNhan, SuKienThongBao } from "./bo-quy-tac-schema";

/** Trang danh sách hồ sơ chờ (lát C). `[id]` do lát C sở hữu — dẫn vào danh sách để không trỏ vào trang chưa chắc tồn tại. */
export const HREF_HO_SO_CHO = "/ai-lead";
export const HREF_KET_NOI = "/ai-lead/ket-noi";

/** Người có MỘT quyền qua vai còn hiệu lực (nguồn quyền thật của RBAC v2: UserOrgRole → RoleDef → RolePermission). Tài khoản khoá/đã xoá bị loại. */
export async function nguoiCoQuyen(action: string, now: Date, opts?: { chiNeoOHoiSo?: boolean }): Promise<string[]> {
  const donViHo = opts?.chiNeoOHoiSo
    ? (await db.orgUnit.findMany({ where: { centerId: null, deletedAt: null }, select: { id: true } })).map((o) => o.id)
    : null;
  if (donViHo !== null && donViHo.length === 0) return [];
  const vai = await db.userOrgRole.findMany({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      role: { isActive: true, permissions: { some: { action } } },
      ...(donViHo !== null ? { orgUnitId: { in: donViHo } } : {}),
    },
    select: { userId: true },
  });
  if (vai.length === 0) return [];
  const con = await db.user.findMany({
    where: { id: { in: [...new Set(vai.map((v) => v.userId))] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  return con.map((u) => u.id);
}

/** Người xử lý hồ sơ: Quản lý cơ sở của cơ sở xử lý; chưa biết cơ sở (`centerId` null) ⇒ người duyệt neo ở Hội sở (không phải "ai cũng thấy"). */
export async function nguoiXuLyHoSo(centerId: string | null, now: Date): Promise<string[]> {
  return centerId ? nguoiDuyetCoSo(centerId, now) : nguoiCoQuyen("ai-leads:review", now, { chiNeoOHoiSo: true });
}

/** Tên hành động audit khi gửi thông báo nội bộ LỖI — Trung tâm kết nối đếm theo tên này (`ket-noi.ts`). */
export const HANH_DONG_THONG_BAO_LOI = "AI_LEAD_THONG_BAO_LOI";

/** Mỗi (kênh, mã) chỉ để lại MỘT dòng audit mỗi chừng này: cron 10 phút lặp mọi hồ sơ × bậc, nếu `notifyStaff` hỏng kéo dài thì không được đẻ hàng nghìn dòng (số «lỗi 24h» đếm DÒNG GHI, không đếm từng lần thử). */
export const GIAN_CACH_AUDIT_LOI_MS = 10 * 60_000;
const lanGhiLoiCuoi = new Map<string, number>();
/** Chỉ cho test: xoá bộ nhớ giới hạn tần suất (trạng thái cấp tiến trình). */
export function datLaiGioiHanAuditLoi(): void {
  lanGhiLoiCuoi.clear();
}

async function an(viec: Promise<unknown>, noi: string, now: Date): Promise<void> {
  try {
    await viec;
  } catch (err) {
    const ma = maLoiNoiBo(err);
    console.error(`[ai-lead:${noi}] gửi thông báo lỗi loi=${ma}`);
    // Lỗi gửi chỉ nằm trong log thì người trực không bao giờ biết nhân viên không nhận được chuông (review: «lỗi bị nuốt»). Ghi MỘT dòng audit BỀN — mã lỗi + kênh, KHÔNG PII, KHÔNG nội dung lỗi —
    // để Trung tâm kết nối đếm được. Ghi audit lỗi ⇒ nuốt tiếp (thông báo là phụ, không được làm hỏng phản hồi Agent / cron).
    const khoa = `${noi}|${ma}`;
    const truoc = lanGhiLoiCuoi.get(khoa);
    if (truoc !== undefined && now.getTime() - truoc < GIAN_CACH_AUDIT_LOI_MS) return;
    lanGhiLoiCuoi.set(khoa, now.getTime());
    await writeAudit({
      actor: { id: null, name: "Hệ thống (AI Lead)" },
      module: "ai-lead",
      entityType: "AiLeadThongBao",
      entityId: noi,
      action: HANH_DONG_THONG_BAO_LOI,
      newValues: { kenh: noi, ma },
    }).catch(() => undefined);
  }
}

/** Nhóm người nhận (enum ĐÓNG của bộ quy tắc) → danh sách user, qua nguồn quyền thật. `CENTER_MANAGER` khi chưa biết cơ sở ⇒ người duyệt neo ở Hội sở (như `nguoiXuLyHoSo`). */
export async function nguoiTheoNhom(nhom: NhomNguoiNhan, centerId: string | null, now: Date): Promise<string[]> {
  switch (nhom) {
    case "CENTER_MANAGER":
      return nguoiXuLyHoSo(centerId, now);
    case "HO_REVIEWERS":
      return nguoiCoQuyen("ai-leads:review", now, { chiNeoOHoiSo: true });
    case "HO_CONFIGURERS":
      return nguoiCoQuyen("ai-leads:configure", now, { chiNeoOHoiSo: true });
    case "INTEGRATION_VIEWERS":
      return nguoiCoQuyen("ai-integration:view", now);
  }
}

export async function nguoiTheoBac(bac: Pick<BacThongBao, "to">, centerId: string | null, now: Date): Promise<string[]> {
  const ds = await Promise.all(bac.to.map((n) => nguoiTheoNhom(n, centerId, now)));
  return [...new Set(ds.flat())];
}

/** Các bậc báo của sự kiện theo bộ quy tắc HIỆN HÀNH. Đọc lỗi ⇒ bậc mặc định (= hành vi trước Rule Builder): thông báo không bao giờ im lặng vì quy tắc hỏng. */
export async function docBacThongBao(event: SuKienThongBao, centerId: string | null): Promise<BacThongBao[]> {
  let bo: Awaited<ReturnType<typeof docBoHienHanh>> = null;
  try {
    bo = await docBoHienHanh();
  } catch (err) {
    console.error(`[ai-lead:thong-bao] doc bo quy tac loi=${maLoiNoiBo(err)}`);
  }
  return cacBacThongBao(bo?.bo ?? null, event, centerId);
}

/** Hồ sơ MỚI cần người (hoặc vừa chuyển sang cần người). Một thông báo / hồ sơ (dedupe theo id) — gọi lặp không rung lại. Người nhận = bậc 0 của quy tắc `DRAFT_NEEDS_STAFF` (mặc định: quản lý cơ sở). */
export async function baoHoSoCanXuLy(x: { draftId: string; centerId: string | null; now: Date; bac?: BacThongBao }): Promise<void> {
  await an(
    (async () => {
      // `bac` có mặt = bậc LEO THANG (afterMinutes > 0) do cron gọi; vắng = bậc 0 lúc hồ sơ vừa cần người.
      const bacs = x.bac ? [x.bac] : (await docBacThongBao("DRAFT_NEEDS_STAFF", x.centerId)).filter((b) => b.afterMinutes === 0);
      const leo = (x.bac?.afterMinutes ?? 0) > 0;
      const nguoi = (await Promise.all(bacs.map((b) => nguoiTheoBac(b, x.centerId, x.now)))).flat();
      if (nguoi.length === 0) {
        console.warn(`[ai-lead:thong-bao] hồ sơ ${x.draftId}: không có người nhận (centerId ${x.centerId ?? "null"})`);
        return;
      }
      await notifyStaff({
        userIds: [...new Set(nguoi)],
        dedupeKey: leo ? `ai_lead.draft:${x.draftId}:m${x.bac!.afterMinutes}` : `ai_lead.draft:${x.draftId}`,
        title: `${leo ? "LEO THANG — " : ""}Có hồ sơ khách từ AI Messenger cần xử lý`,
        body: "Một hồ sơ do AI Messenger thu thập đang chờ nhân viên xem và xử lý.",
        href: `${HREF_HO_SO_CHO}/${x.draftId}`,
      });
    })(),
    "draft",
    x.now,
  );
}

/**
 * Quá hạn NHẬN / XỬ LÝ hồ sơ, theo BẬC của quy tắc NOTIFY (leo thang: bậc `afterMinutes > 0` báo THÊM nhóm khác sau chừng đó phút kể từ hạn).
 * Nội dung TẤT ĐỊNH (không ghi "quá bao nhiêu phút"): nội dung đổi mỗi lượt cron ⇒ rung lại mỗi lượt. Khoá dedupe theo (hồ sơ, sự kiện, bậc) ⇒ chạy lặp cron không báo lại.
 * Khoá bậc 0 của quá hạn NHẬN GIỮ NGUYÊN dạng cũ `ai_lead.sla:<draftId>` (bản ghi đã gửi trước Rule Builder không bị báo lại).
 */
export async function baoQuaHan(x: { draftId: string; centerId: string | null; event: "SLA_CLAIM_OVERDUE" | "SLA_RESOLVE_OVERDUE"; bac: BacThongBao; now: Date }): Promise<void> {
  await an(
    (async () => {
      const nguoi = await nguoiTheoBac(x.bac, x.centerId, x.now);
      if (nguoi.length === 0) {
        console.warn(`[ai-lead:thong-bao] ${x.event} bậc +${x.bac.afterMinutes}′: không có người nhận (centerId ${x.centerId ?? "null"})`);
        return;
      }
      const nhan = x.event === "SLA_CLAIM_OVERDUE" ? "nhận" : "xử lý";
      // Bậc định danh bằng `afterMinutes` (ổn định khi Admin thêm/bớt bậc khác), không bằng vị trí trong danh sách.
      const khoa = x.event === "SLA_CLAIM_OVERDUE" && x.bac.afterMinutes === 0 ? `ai_lead.sla:${x.draftId}` : `ai_lead.sla:${x.draftId}:${x.event}:${x.bac.afterMinutes}`;
      await notifyStaff({
        userIds: nguoi,
        dedupeKey: khoa,
        title: `${x.bac.afterMinutes > 0 ? "LEO THANG — " : ""}Hồ sơ AI Messenger quá hạn ${nhan}`,
        body: `Hồ sơ khách từ AI Messenger đã quá hạn mà chưa ${x.event === "SLA_CLAIM_OVERDUE" ? "có ai nhận xử lý" : "được xử lý xong"}.`,
        href: `${HREF_HO_SO_CHO}/${x.draftId}`,
      });
    })(),
    "sla",
    x.now,
  );
}

/**
 * Hồ sơ AI không tạo được lead vì NGUỒN lead chưa cấu hình. QLCS không sửa được cấu hình nguồn (cần `sources:manage`), nên báo người SỬA ĐƯỢC: `sources:manage` ∪ `ai-leads:configure`.
 * MỘT thông báo / (Page, mã, ngày VN) — 100 hồ sơ cùng Page không sinh 100 thông báo. Không PII (không SĐT/tên/psid). Gọi SAU commit; lỗi gửi bị nuốt.
 */
export async function baoCauHinhNguonThieu(x: { pageId: string; ma: string; now: Date }): Promise<void> {
  await an(
    (async () => {
      const [a, b] = await Promise.all([nguoiCoQuyen("sources:manage", x.now), nguoiCoQuyen("ai-leads:configure", x.now)]);
      const nguoi = [...new Set([...a, ...b])];
      if (nguoi.length === 0) {
        console.warn(`[ai-lead:thong-bao] cấu hình nguồn thiếu (${x.ma}): không có người nhận`);
        return;
      }
      const ngay = ngayVnLaDate(x.now.getTime()).toISOString().slice(0, 10);
      await notifyStaff({
        userIds: nguoi,
        dedupeKey: `ai_lead.nguon:${x.pageId}:${x.ma}:${ngay}`,
        title: "Lead từ AI Messenger chưa tạo được: nguồn lead chưa cấu hình",
        body: "Một Page của AI Messenger chưa được gán nguồn lead (nhóm «Marketing HO»). Các hồ sơ đang chờ ở Ngoại lệ; cấu hình nguồn rồi bấm «Thử lại».",
        href: HREF_KET_NOI,
      });
    })(),
    "nguon",
    x.now,
  );
}

/** Sự cố Agent mức HIGH/CRITICAL (MỚI hoặc vừa leo thang) theo bậc của quy tắc NOTIFY `INCIDENT` (mặc định: người xem Trung tâm kết nối AI). Bậc 0 giữ khoá cũ `ai_lead.su_co:<id>`; bậc sau là LEO THANG khi chưa ai ACK. */
export async function baoSuCoAgent(x: { incidentId: string; severity: "HIGH" | "CRITICAL"; now: Date; bac?: BacThongBao; lanMoLai?: number }): Promise<void> {
  await an(
    (async () => {
      const bac = x.bac ?? (await docBacThongBao("INCIDENT", null)).find((b) => b.afterMinutes === 0);
      if (!bac) return;
      const nguoi = await nguoiTheoBac(bac, null, x.now);
      if (nguoi.length === 0) return;
      await notifyStaff({
        userIds: nguoi,
        // Tái diễn sau khi đã đóng: khoá RIÊNG theo lần (số đếm lúc mở lại) — khoá bậc 0 cũ đã dùng ở lần trước và sẽ bị dedupe nuốt.
        dedupeKey:
          x.lanMoLai !== undefined
            ? `ai_lead.su_co:${x.incidentId}:r${x.lanMoLai}${bac.afterMinutes > 0 ? `:m${bac.afterMinutes}` : ""}`
            : bac.afterMinutes === 0
              ? `ai_lead.su_co:${x.incidentId}`
              : `ai_lead.su_co:${x.incidentId}:m${bac.afterMinutes}`,
        title: `${x.lanMoLai !== undefined ? "MỞ LẠI — " : ""}${bac.afterMinutes > 0 ? "LEO THANG — " : ""}${x.severity === "CRITICAL" ? "Agent AI Messenger báo sự cố NGHIÊM TRỌNG" : "Agent AI Messenger báo sự cố mức cao"}`,
        body: "Agent AI Messenger vừa báo một sự cố cần kiểm tra ở Trung tâm kết nối AI.",
        href: HREF_KET_NOI,
      });
    })(),
    "su-co",
    x.now,
  );
}
