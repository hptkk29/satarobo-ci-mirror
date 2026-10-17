// lib/nguon/noi-don.ts — NỐI `Order.leadId` CHO ĐƠN CŨ (D8, PR0). THUẦN — không chạm DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ FILE NÀY
//
// Đo prod 06/10/2026: 102/146 đơn chưa chết có `leadId = NULL`. Hoa hồng đọc người hưởng SALE /
// SALE_ADMIN từ `Lead.convertedById` / `Lead.adminId` QUA `Order.leadId` (`commission-run.ts`), nên
// đơn không có `leadId` là hai tầng đó TREO — tiền thật không có người nhận.
//
// Luật D8: khoá nối = `canonicalPhone(order.customerPhone)` khớp `phoneKey(lead.phone)` của lead CÒN
// SỐNG. Đúng MỘT lead ⇒ nối; ≥2 lead khác nhau ⇒ NHIEU (người xem, KHÔNG tự nối); 0 ⇒ KHONG.
//
// ⚠️ SĐT không chuẩn hoá được (`canonicalPhone` = null, vd số cố định `02363…`, chuỗi rỗng) ⇒ KHONG,
// KHÔNG rơi về so chuỗi thô: `phoneKey` giữ nguyên chuỗi gốc của lead, nên lùi về so thô là cho đơn số
// cố định "khớp" lead số cố định — một lần nối sai người, và tiền hoa hồng đi theo.
//
// Hàm trong tệp này đều THUẦN (nhận dữ liệu, trả dữ liệu); tầng đọc/ghi DB ở `noi-don-db.ts`.
import type { HangThanhToanHoaHong } from "@/lib/crm/commission-run";
import { COMMISSION_TIERS } from "@/lib/crm/commission";
import { kyCuaButToan, type DongHoaHongKy } from "@/lib/crm/commission-thuc-thu";
import { canonicalPhone, phoneKey } from "@/lib/phone";

export type PhanLoaiNoiDon = "MOT" | "NHIEU" | "KHONG";

/** Lead ứng viên — đủ cột để vá `order.lead` trong bộ nhớ (khớp `SELECT_HOA_HONG.order.lead`). */
export type UngVienLead = {
  leadId: string;
  /** Giá trị THÔ trong DB (có thể `0…` hoặc `84…`). */
  phone: string;
  deletedAt: Date | null;
  convertedById: string | null;
  adminId: string | null;
  centerId: string | null;
};

export type DonThieuLead = {
  orderId: string;
  /** Mã đơn — thứ DUY NHẤT được in để người đọc tra. */
  code: string;
  customerPhone: string;
  centerId: string | null;
};

export type KeHoachNoiDon = {
  mot: { orderId: string; code: string; lead: UngVienLead; khacCoSo: boolean }[];
  nhieu: { orderId: string; code: string; leadIds: string[] }[];
  khong: { orderId: string; code: string; lyDo: "SDT_KHONG_CHUAN_HOA" | "KHONG_CO_LEAD" }[];
};

/**
 * Gom theo `leadId` TRƯỚC khi đếm: một lead lưu `0…` và được tra bằng cả hai biến thể SĐT chỉ là MỘT
 * ứng viên, không phải hai.
 */
export function phanLoaiNoiDon(ungVien: readonly { leadId: string }[]): PhanLoaiNoiDon {
  const soLead = new Set(ungVien.map((u) => u.leadId)).size;
  if (soLead === 0) return "KHONG";
  return soLead === 1 ? "MOT" : "NHIEU";
}

/**
 * Lập kế hoạch nối. Ứng viên = lead có `deletedAt === null` và `phoneKey(lead.phone) === khoá`.
 * `khacCoSo` = cơ sở của lead và của đơn cùng khác null và khác nhau — CHỈ để in, không chặn.
 */
export function lapKeHoachNoiDon(
  dons: readonly DonThieuLead[],
  leads: readonly UngVienLead[],
): KeHoachNoiDon {
  // Chỉ lead còn sống, gom theo khoá SĐT chuẩn hoá — một lượt, không quét lặp theo từng đơn.
  const theoKhoa = new Map<string, Map<string, UngVienLead>>();
  for (const l of leads) {
    if (l.deletedAt !== null) continue;
    const k = phoneKey(l.phone);
    const nhom = theoKhoa.get(k) ?? new Map<string, UngVienLead>();
    if (!nhom.has(l.leadId)) nhom.set(l.leadId, l);
    theoKhoa.set(k, nhom);
  }

  const kh: KeHoachNoiDon = { mot: [], nhieu: [], khong: [] };
  for (const d of dons) {
    const khoa = canonicalPhone(d.customerPhone);
    if (khoa === null) {
      kh.khong.push({ orderId: d.orderId, code: d.code, lyDo: "SDT_KHONG_CHUAN_HOA" });
      continue;
    }
    const ungVien = [...(theoKhoa.get(khoa)?.values() ?? [])];
    const loai = phanLoaiNoiDon(ungVien);
    if (loai === "KHONG") {
      kh.khong.push({ orderId: d.orderId, code: d.code, lyDo: "KHONG_CO_LEAD" });
    } else if (loai === "NHIEU") {
      kh.nhieu.push({ orderId: d.orderId, code: d.code, leadIds: ungVien.map((u) => u.leadId).sort() });
    } else {
      const lead = ungVien[0]!;
      kh.mot.push({
        orderId: d.orderId,
        code: d.code,
        lead,
        khacCoSo: d.centerId !== null && lead.centerId !== null && d.centerId !== lead.centerId,
      });
    }
  }
  return kh;
}

/**
 * Trả MẢNG MỚI; không đổi `rows` đầu vào. Chỉ vá dòng có `orderId ∈ va` VÀ `order.leadId === null`:
 * đặt `order.leadId = lead.leadId`, `order.lead = { convertedById, adminId, centerId }`.
 *
 * Vá thiếu `order.lead` là "sau" = "trước" mà không ai thấy — người nhận hoa hồng đọc từ
 * `order.lead`, không phải từ `order.leadId`.
 */
export function vaLeadTrongBoNho<T extends HangThanhToanHoaHong & { orderId: string }>(
  rows: readonly T[],
  va: ReadonlyMap<string, UngVienLead>,
): T[] {
  return rows.map((r) => {
    const lead = va.get(r.orderId);
    if (!lead || !r.order || r.order.leadId !== null) return r;
    return {
      ...r,
      order: {
        ...r.order,
        leadId: lead.leadId,
        lead: { convertedById: lead.convertedById, adminId: lead.adminId, centerId: lead.centerId },
      },
    };
  });
}

/**
 * Kỳ (giờ VN, `kyCuaButToan`) của mọi bút toán thuộc các đơn sẽ nối. Sắp tăng, không trùng.
 *
 * [PB-8] `rows` PHẢI là kết quả của `docButToanCuaDon` — MỌI bút toán thực thu của các đơn đó, ở MỌI
 * kỳ — KHÔNG phải bút toán đọc theo từng kỳ DRAFT/REOPENED: đọc theo kỳ thì kỳ APPROVED chứa tiền của
 * đơn sắp nối không bao giờ lọt vào phép kiểm, và cổng APPROVED câm đúng ca nó sinh ra để chặn.
 */
export function kyBiAnhHuong(
  rows: readonly { orderId: string; paidDate: Date }[],
  orderIds: ReadonlySet<string>,
): string[] {
  const ky = new Set<string>();
  for (const r of rows) if (orderIds.has(r.orderId)) ky.add(kyCuaButToan(r.paidDate));
  return [...ky].sort();
}

export type DongBaCot = {
  tier: string;
  recipientId: string;
  /** (a) `CommissionLine` đang lưu (KHÔNG gồm TRIAL_TEACHER). */
  dangLuu: number;
  /** (b) tính lại trên dữ liệu hôm nay. */
  truoc: number;
  /** (c) tính lại sau khi vá `leadId` trong bộ nhớ. */
  sau: number;
};

const TIER_TRIAL_TEACHER = "TRIAL_TEACHER";

/**
 * Gom theo (tier, recipientId), cộng `amount`. Dòng chỉ có ở một cột vẫn ra (cột kia = 0).
 *
 * `TRIAL_TEACHER` của (a) bị TÁCH RA (trả ở `trialTeacherDangLuu`): `tinhHoaHongTheoKy` không bao giờ
 * sinh tầng đó (nó ghi theo ghi danh lúc convert), nên gộp vào là báo "chênh" giả.
 */
export function soBaCot(
  dangLuu: readonly { tier: string; recipientId: string; amount: number }[],
  truoc: readonly DongHoaHongKy[],
  sau: readonly DongHoaHongKy[],
): { dong: DongBaCot[]; trialTeacherDangLuu: number } {
  const gom = new Map<string, DongBaCot>();
  const lay = (tier: string, recipientId: string): DongBaCot => {
    const khoa = `${tier}|${recipientId}`;
    let d = gom.get(khoa);
    if (!d) {
      d = { tier, recipientId, dangLuu: 0, truoc: 0, sau: 0 };
      gom.set(khoa, d);
    }
    return d;
  };

  let trialTeacherDangLuu = 0;
  for (const l of dangLuu) {
    if (l.tier === TIER_TRIAL_TEACHER) {
      trialTeacherDangLuu += l.amount;
      continue;
    }
    lay(l.tier, l.recipientId).dangLuu += l.amount;
  }
  for (const l of truoc) lay(l.tier, l.recipientId).truoc += l.amount;
  for (const l of sau) lay(l.tier, l.recipientId).sau += l.amount;

  const thuTu = (t: string) => {
    const i = (COMMISSION_TIERS as string[]).indexOf(t);
    return i < 0 ? COMMISSION_TIERS.length : i;
  };
  const dong = [...gom.values()].sort(
    (a, b) => thuTu(a.tier) - thuTu(b.tier) || a.tier.localeCompare(b.tier) || a.recipientId.localeCompare(b.recipientId),
  );
  return { dong, trialTeacherDangLuu };
}

export type TrangThaiKyGhi = { period: string; status: "DRAFT" | "APPROVED" | "REOPENED" };

/**
 * Số duyệt từ tham số dòng lệnh (`--expect=<N>`) — THUẦN, để test được mà không cần chạy script.
 *
 * `null` = không truyền; `NaN` = truyền nhưng KHÔNG phải chuỗi chữ số thập phân thuần. Đừng dùng `Number(chuỗi)`:
 * nó đọc `""` thành 0, `"0x2"` thành 2, `"1e1"` thành 10, `" 2"` thành 2 — tức một lỗi gõ biến thành một con số
 * "đã duyệt" nghe hợp lệ. Chỉ chữ số ASCII (`/^[0-9]+$/` — `\d` của JS vốn đã chỉ ASCII), và phải biểu diễn chính xác được.
 */
export function phanTichSoDuyet(argv: readonly string[]): number | null {
  const a = argv.find((x) => x.startsWith("--expect="));
  if (a === undefined) return null;
  const raw = a.slice("--expect=".length);
  if (!/^[0-9]+$/.test(raw)) return Number.NaN;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}

/**
 * Cổng ghi — gọi HAI lần: trước transaction (để báo sớm) và TRONG transaction (để chặn thật).
 * Lỗi đầu tiên theo đúng thứ tự dưới đây thắng.
 */
export function quyetDinhGhiNoiDon(input: {
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** = `mot.length` lúc chạy. */
  keHoach: number;
  /** `has_table_privilege(…"Order"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  trangThaiKy: readonly TrangThaiKyGhi[];
}): { ok: true } | { ok: false; loi: string } {
  const { soDuyet } = input;
  if (soDuyet === null || !Number.isInteger(soDuyet) || soDuyet < 0) {
    return { ok: false, loi: "`--ghi` phải đi kèm `--expect=<N>` (N = số \"SẼ NỐI\" của bản chạy thử đã duyệt)." };
  }
  if (soDuyet !== input.keHoach) {
    return {
      ok: false,
      loi:
        `Kế hoạch lúc này (${input.keHoach}) ≠ số đã duyệt (${soDuyet}). KHÔNG ghi gì — dữ liệu đã đổi ` +
        "so với bảng được duyệt; chạy lại bản chạy thử và duyệt bảng mới.",
    };
  }
  if (input.ghiDuoc === false) {
    return { ok: false, loi: "Có `--ghi` nhưng kết nối chỉ đọc — sai chuỗi kết nối. KHÔNG ghi gì." };
  }
  const daDuyet = input.trangThaiKy.filter((k) => k.status === "APPROVED").map((k) => k.period);
  if (daDuyet.length > 0) {
    return {
      ok: false,
      loi:
        `Kỳ ${daDuyet.join(", ")} đã duyệt — nối đơn là đổi người nhận của bảng kê đã duyệt. ` +
        "Quyết định của chủ dự án (mở lại kỳ hay chấp nhận) — MANUAL_REVIEW_REQUIRED.",
    };
  }
  return { ok: true };
}
