// lib/cham-cong/don-trong-ngay.ts — "NGỮ CẢNH ĐƠN" của một (người × ngày): mọi đơn đã duyệt còn hiệu
// lực, gom thành dữ liệu engine đọc (BA §10 AttendanceContext). THUẦN — phần đọc DB ở
// `don-trong-ngay-db.ts`, một câu truy vấn cho cả ngày.
//
// Vì sao đọc LÚC TÍNH LẠI chứ không đúc ra bản ghi lúc duyệt: đơn thường nộp TRƯỚC ngày (lúc duyệt
// chưa có lượt quét để so), và chính đơn đã duyệt là "lịch" của ngày đó (BA §3.1, §12). Tính lại bao
// nhiêu lần cũng ra cùng kết quả — không thể sinh bản ghi trùng; huỷ đơn = đổi trạng thái + tính lại.
//
// Mỗi đợt thêm một vế ở đây; engine nhận cả khối (BẮT BUỘC — luật 7).
import type { WorkRequestKindV } from "@/lib/work-request";
import { khoangTu, type Khoang } from "./khoang-gio";
import { gomMuonSomDaDuyet, KHONG_CO_DON_MUON_SOM, type MuonSomDaDuyet } from "./muon-som-da-duyet";
import type { NghiTrongNgay } from "./nghi-trong-ca";

/** Đúng những cột của đơn mà ngữ cảnh đọc — `don-trong-ngay-db.ts` select theo kiểu này. */
export type DonHieuLuc = {
  id: string;
  kind: WorkRequestKindV;
  detail: string | null;
  startTime: string | null;
  endTime: string | null;
  approvedStartTime: string | null;
  approvedEndTime: string | null;
  /** Nghỉ / nghỉ bù (đợt 7–8): NULL trên đơn cũ = cả ngày. */
  leaveDurationType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURLY" | null;
  /** `LeaveType.paidRatio` của đơn nghỉ — loader tra kèm. null = không phải đơn nghỉ / không rõ. */
  leavePaidRatio: number | null;
  /** Làm ngày nghỉ / lễ (đợt 9): loại ngày CHỤP LÚC DUYỆT (`appliedEffect.loai`). null = không phải loại đơn đó. */
  loaiNgayNghi: "LE" | "NGHI" | null;
  /**
   * Tỉ lệ quy đổi OT / làm ngày nghỉ → nghỉ bù CHỤP LÚC DUYỆT (`appliedEffect.quyDoi`). null = trả tiền — kể cả đơn
   * duyệt trước khi có ảnh chụp này (mặc định an toàn: không vừa trả tiền vừa cho nghỉ, BA 5.2).
   */
  tyLeNghiBu: number | null;
};

export type NguCanhDon = {
  /** Đợt 2 — khung đi muộn / về sớm đã duyệt. */
  muonSom: MuonSomDaDuyet;
  /** Đợt 4 — khung OT đã duyệt (khung QL duyệt, không có thì khung xin). */
  tangCa: Khoang[];
  /** Tập con của `tangCa` được quy đổi sang nghỉ bù, kèm tỉ lệ chụp lúc duyệt. */
  tangCaNghiBu: { khung: Khoang; tyLe: number }[];
  /** Đợt 9 — khung LÀM NGÀY NGHỈ / LỄ đã duyệt, loại ngày + tỉ lệ nghỉ bù chụp lúc duyệt. */
  lamNgayNghi: { khung: Khoang; loai: "LE" | "NGHI"; tyLe: number | null }[];
  /** Đợt 5 — khung LÀM TỪ XA đã duyệt; đơn không khai giờ ⇒ cả ngày [0, 1440). */
  lamTuXa: Khoang[];
  /** Đợt 6 — ngày nằm trong một đơn ĐI CÔNG TÁC đã duyệt. */
  congTac: boolean;
  /**
   * Đợt 7–8 — nghỉ MỘT PHẦN ca (nửa buổi / theo giờ) và nghỉ bù (cả ngày lẫn một phần). Nghỉ phép
   * CẢ NGÀY không ở đây — nó ghi ô P/X lên lưới như trước.
   */
  nghi: NghiTrongNgay[];
  /** id các đơn tạo nên ngữ cảnh — vào `ruleSnapshot` để truy ngược "vì sao ngày này ra số này". */
  donIds: string[];
};

export const KHONG_CO_DON: NguCanhDon = { muonSom: KHONG_CO_DON_MUON_SOM, tangCa: [], tangCaNghiBu: [], lamNgayNghi: [], lamTuXa: [], congTac: false, nghi: [], donIds: [] };

/** Đọc `appliedEffect.loai` của đơn làm ngày nghỉ / lễ. Lạ / thiếu ⇒ null. */
export function loaiNgayNghiTuHieuQua(appliedEffect: unknown): "LE" | "NGHI" | null {
  if (!appliedEffect || typeof appliedEffect !== "object") return null;
  const l = (appliedEffect as { loai?: unknown }).loai;
  return l === "LE" || l === "NGHI" ? l : null;
}

/** Đọc `appliedEffect.quyDoi` của đơn OT / làm ngày nghỉ. Hình dạng lạ / thiếu ⇒ null (= trả tiền). */
export function tyLeNghiBuTuHieuQua(appliedEffect: unknown): number | null {
  if (!appliedEffect || typeof appliedEffect !== "object") return null;
  const q = (appliedEffect as { quyDoi?: unknown }).quyDoi;
  if (!q || typeof q !== "object") return null;
  const { cheDo, tyLe } = q as { cheDo?: unknown; tyLe?: unknown };
  return cheDo === "NGHI_BU" && typeof tyLe === "number" && tyLe > 0 ? tyLe : null;
}

/** Đơn nghỉ / nghỉ bù ⇒ một vế nghỉ trong ca; null = không thuộc ngữ cảnh (nghỉ phép cả ngày đi qua ô ca). */
export function nghiCuaDon(d: DonHieuLuc): NghiTrongNgay | null {
  if (d.kind !== "LEAVE" && d.kind !== "COMP_LEAVE") return null;
  const nguon = d.kind;
  const coLuong = nguon === "COMP_LEAVE" || (d.leavePaidRatio ?? 0) > 0;
  switch (d.leaveDurationType) {
    case "HALF_DAY_AM":
      return { loai: "SANG", khung: null, coLuong, nguon };
    case "HALF_DAY_PM":
      return { loai: "CHIEU", khung: null, coLuong, nguon };
    case "HOURLY": {
      const k = khoangTu(d.startTime, d.endTime);
      return k ? { loai: "KHUNG", khung: k, coLuong, nguon } : null;
    }
    default:
      // Cả ngày: nghỉ phép đi qua ô P/X (không vào ngữ cảnh); nghỉ bù cả ngày thì vào ngữ cảnh.
      return nguon === "COMP_LEAVE" ? { loai: "CA_NGAY", khung: null, coLuong: true, nguon } : null;
  }
}

const CA_NGAY: Khoang = { start: 0, end: 24 * 60 };

export function dungNguCanhDon(dons: readonly DonHieuLuc[]): NguCanhDon {
  const tangCa: Khoang[] = [];
  const tangCaNghiBu: { khung: Khoang; tyLe: number }[] = [];
  const lamTuXa: Khoang[] = [];
  const lamNgayNghi: NguCanhDon["lamNgayNghi"] = [];
  for (const d of dons) {
    if (d.kind === "HOLIDAY_WORK") {
      const k = khoangTu(d.approvedStartTime ?? d.startTime, d.approvedEndTime ?? d.endTime);
      // Loại ngày thiếu (dữ liệu lạ) ⇒ không đoán, bỏ qua — đơn mới luôn có ảnh chụp.
      if (k && d.loaiNgayNghi) lamNgayNghi.push({ khung: k, loai: d.loaiNgayNghi, tyLe: d.tyLeNghiBu });
    }
    if (d.kind === "OT") {
      const k = khoangTu(d.approvedStartTime ?? d.startTime, d.approvedEndTime ?? d.endTime);
      if (k) tangCa.push(k);
      if (k && d.tyLeNghiBu !== null) tangCaNghiBu.push({ khung: k, tyLe: d.tyLeNghiBu });
    } else if (d.kind === "REMOTE") {
      lamTuXa.push(khoangTu(d.startTime, d.endTime) ?? CA_NGAY);
    }
  }
  return {
    muonSom: gomMuonSomDaDuyet(dons.filter((d) => d.kind === "LATE_EARLY")),
    tangCa,
    tangCaNghiBu,
    lamNgayNghi,
    lamTuXa,
    congTac: dons.some((d) => d.kind === "BUSINESS_TRIP"),
    nghi: dons.map(nghiCuaDon).filter((n): n is NghiTrongNgay => n !== null),
    donIds: dons.map((d) => d.id),
  };
}
