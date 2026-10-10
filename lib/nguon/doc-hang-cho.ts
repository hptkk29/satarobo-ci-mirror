/**
 * lib/nguon/doc-hang-cho.ts — ĐỌC "HÀNG CHỜ NGUỒN" của tab Nguồn (docs/source-commission/06 §4.1, §5.1).
 *
 * Hàng chờ = lead mà nguồn CHƯA ĐỦ CĂN CỨ để tính hoa hồng. Bốn lý do hôm nay có dữ liệu thật:
 *   UNKNOWN          nhóm nguồn = UNKNOWN (hệ thống gán khi không xác định được — 03 T3: mã duy nhất được so)
 *   THIEU_NGUOI      nhóm cần người giới thiệu mà chưa có (`referrerMissing`)
 *   THIEU_GIAI_TRINH nhóm 11 (`requiresNote`) mà chưa có giải trình
 *   CANH_BAO         dòng mang cảnh báo gian lận mức WARNING (`canhBao` không rỗng)
 * Chưa có dữ liệu (PR7): "Page chưa map", "nguồn hết hạn còn nhận lead", "cảnh báo gian lận chưa xử lý"
 * (bảng FraudFlag). Chúng sẽ thành lý do THỨ NĂM… khi bảng có — thêm vào `LY_DO_HANG_CHO`, đừng chế hàng chờ thứ hai.
 *
 * ── Cách ly cơ sở ─────────────────────────────────────────────────────────────────────────────
 * `LeadAttribution` KHÔNG có `centerId`/`orgUnitId` (ngoại lệ có chủ đích luật Nền #3, D20): MỌI lượt đọc đi qua
 * `Lead` đã `scopedDb(actor)`. Hàm này KHÔNG đọc thẳng bảng attribution (lưới `[QN-W11]` cấm ngoài lib/nguon —
 * ở đây nằm TRONG lib/nguon nhưng vẫn đi qua Lead để cách ly cơ sở có hiệu lực). Bộ lọc là điều kiện LỒNG
 * `attribution: { is: … }` — ca `[NCL-03]` đã chứng minh `scopedDb` không rò dòng cơ sở khác qua đường này.
 *
 * ── Một nguồn cho SỐ và DANH SÁCH (luật 12b) ──────────────────────────────────────────────────
 * Số trên pill tab, số trên công tắc "Cần xử lý (N)", số trong route gốc và số dòng của bảng đều đi qua
 * `whereHangCho` — không ai đếm lại bằng điều kiện riêng. PR2 có thể thay hàm đọc này bằng bản có thêm lý do
 * (`MANUAL_REVIEW_REQUIRED`…); giữ nguyên chữ ký `docHangChoNguon` / `demHangChoNguon`.
 *
 * PII: tên phụ huynh đi qua `maskLeadPiiFields` theo `canViewPii` (S-1) — tham số BẮT BUỘC, không mặc định
 * (luật 7: mặc định `true` ở một chỗ gọi quên là rò tên hàng loạt, và không lỗi nào báo).
 */
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { maskLeadPiiFields } from "@/lib/lead/pii";

// Nhãn + danh sách lý do nằm ở `nhan-hien-thi.ts` (THUẦN, không kéo `db` vào trình duyệt) — Sheet "Gán nguồn" là client component
// và cần chúng. Re-export để mọi nơi import cũ từ tệp này vẫn chạy.
export { LY_DO_HANG_CHO, NHAN_CANH_BAO, NHAN_LY_DO, nhanCanhBao, type LyDoHangCho } from "./nhan-hien-thi";
import { LY_DO_HANG_CHO, type LyDoHangCho } from "./nhan-hien-thi";

/** Điều kiện của MỘT lý do trên `LeadAttribution` — nguồn duy nhất của cả đếm lẫn liệt kê. */
export function dieuKienLyDo(lyDo: LyDoHangCho): Prisma.LeadAttributionWhereInput {
  switch (lyDo) {
    case "UNKNOWN":
      return { group: { code: "UNKNOWN" } };
    case "THIEU_NGUOI":
      return { referrerMissing: true };
    case "THIEU_GIAI_TRINH":
      // Tầng ghi đã ép ≥10 ký tự khi KHÁC null (ghi-nguon.ts), nên "chưa có" = null hoặc rỗng.
      return { group: { requiresNote: true }, OR: [{ otherSourceNote: null }, { otherSourceNote: "" }] };
    case "CANH_BAO":
      return { canhBao: { isEmpty: false } };
  }
}

/** `where` của MỘT lượt đọc Lead: chưa xoá + (một lý do cụ thể HOẶC bất kỳ lý do nào). */
export function whereHangCho(lyDo: LyDoHangCho | null, coSoId: string | null): Prisma.LeadWhereInput {
  return {
    deletedAt: null,
    ...(coSoId ? { centerId: coSoId } : {}),
    attribution: { is: lyDo ? dieuKienLyDo(lyDo) : { OR: LY_DO_HANG_CHO.map(dieuKienLyDo) } },
  };
}

type DongAttr = {
  referrerMissing: boolean;
  otherSourceNote: string | null;
  canhBao: string[];
  group: { code: string; requiresNote: boolean };
};

/**
 * Các lý do mà MỘT dòng đang vướng — phép THUẦN, cùng nghĩa với `dieuKienLyDo` (ca đối chiếu hai bên ở
 * `doc-hang-cho.test.ts` + ca DB `[NHH-FE-HC-05]`). Dùng để in pill cho từng dòng đã đọc.
 */
export function lyDoCuaDong(a: DongAttr): LyDoHangCho[] {
  const ra: LyDoHangCho[] = [];
  if (a.group.code === "UNKNOWN") ra.push("UNKNOWN");
  if (a.referrerMissing) ra.push("THIEU_NGUOI");
  if (a.group.requiresNote && (a.otherSourceNote === null || a.otherSourceNote === "")) ra.push("THIEU_GIAI_TRINH");
  if (a.canhBao.length > 0) ra.push("CANH_BAO");
  return ra;
}

export type HangChoNguonDong = {
  leadId: string;
  tenLead: string;
  trangThaiLead: string;
  coSo: { code: string | null; name: string } | null;
  /** `Lead.source` — ĐƯỜNG VÀO cũ (khoá định tuyến), chỉ để tham khảo. */
  duongVao: string | null;
  nguon: { code: string; name: string };
  lyDo: LyDoHangCho[];
  canhBao: string[];
  /** Nhãn cũ của nguồn khi di trú/nhập nhãn lạ (`signals.nhanGoc`) — dữ liệu để người duyệt tay đọc. */
  nhanGoc: string | null;
  tuoiNgay: number;
};

export type KetQuaHangChoNguon = {
  dong: HangChoNguonDong[];
  /** Tổng theo bộ lọc hiện tại (đã phân trang) — số của `QueueToggle`/footer. */
  tong: number;
  trang: number;
  kichThuoc: number;
};

export const KICH_THUOC_TRANG_HANG_CHO = 25;

const NGAY_MS = 24 * 60 * 60 * 1000;

function nhanGocTu(signals: unknown): string | null {
  if (signals && typeof signals === "object" && !Array.isArray(signals)) {
    const v = (signals as Record<string, unknown>).nhanGoc;
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/**
 * Số lead trong hàng chờ (mọi lý do) — cho pill tab, công tắc "Cần xử lý (N)", route gốc.
 * `coSoId` null ⇒ mọi cơ sở trong tầm nhìn; một id ⇒ chỉ cơ sở đó (đã được scope cắt lại).
 */
export async function demHangChoNguon(actor: Actor, coSoId: string | null): Promise<number> {
  return scopedDb(actor).lead.count({ where: whereHangCho(null, coSoId) });
}

/** Số theo từng lý do (chip lọc có số) — cùng `whereHangCho` với bảng. Một lead có thể thuộc nhiều lý do. */
export async function demHangChoTheoLyDo(
  actor: Actor,
  coSoId: string | null,
): Promise<Record<LyDoHangCho, number>> {
  const sdb = scopedDb(actor);
  const so = await Promise.all(LY_DO_HANG_CHO.map((l) => sdb.lead.count({ where: whereHangCho(l, coSoId) })));
  return Object.fromEntries(LY_DO_HANG_CHO.map((l, i) => [l, so[i]!])) as Record<LyDoHangCho, number>;
}

export async function docHangChoNguon(
  actor: Actor,
  p: {
    coSoId: string | null;
    lyDo: LyDoHangCho | null;
    /** 1-based; < 1 coi là 1. */
    trang: number;
    /** Đồng hồ — BẮT BUỘC truyền (hàm không đọc `new Date()` để test cố định được). */
    now: Date;
    /** Có `leads:view-pii` không. BẮT BUỘC, không mặc định — xem đầu tệp. */
    canViewPii: boolean;
  },
): Promise<KetQuaHangChoNguon> {
  const sdb = scopedDb(actor);
  const trang = Math.max(1, Math.trunc(p.trang) || 1);
  const where = whereHangCho(p.lyDo, p.coSoId);

  const [tong, rows] = await Promise.all([
    sdb.lead.count({ where }),
    sdb.lead.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (trang - 1) * KICH_THUOC_TRANG_HANG_CHO,
      take: KICH_THUOC_TRANG_HANG_CHO,
      select: {
        id: true,
        parentName: true,
        status: true,
        source: true,
        createdAt: true,
        center: { select: { code: true, name: true } },
        attribution: {
          select: {
            referrerMissing: true,
            otherSourceNote: true,
            canhBao: true,
            signals: true,
            group: { select: { code: true, name: true, requiresNote: true } },
          },
        },
      },
    }),
  ]);

  const dong: HangChoNguonDong[] = [];
  for (const r of rows) {
    const a = r.attribution;
    if (!a) continue; // lọc where đã đòi attribution — nhánh này chỉ để thu hẹp kiểu
    const ten = maskLeadPiiFields({ parentName: r.parentName }, p.canViewPii).parentName ?? "";
    dong.push({
      leadId: r.id,
      tenLead: ten,
      trangThaiLead: r.status,
      coSo: r.center ? { code: r.center.code, name: r.center.name } : null,
      duongVao: r.source,
      nguon: { code: a.group.code, name: a.group.name },
      lyDo: lyDoCuaDong(a),
      canhBao: a.canhBao,
      nhanGoc: nhanGocTu(a.signals),
      tuoiNgay: Math.max(0, Math.floor((p.now.getTime() - r.createdAt.getTime()) / NGAY_MS)),
    });
  }
  return { dong, tong, trang, kichThuoc: KICH_THUOC_TRANG_HANG_CHO };
}
