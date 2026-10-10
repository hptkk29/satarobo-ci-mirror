// lib/cham-cong/xung-dot-don.ts — BỘ KIỂM XUNG ĐỘT giữa các đơn của CÙNG một người (đợt 12 đơn từ,
// BA §11). THUẦN, theo KHOẢNG GIỜ — một chỗ cho cả lúc NỘP (so với đơn đang chờ + còn hiệu lực) lẫn lúc
// DUYỆT (chỉ so với đơn còn hiệu lực — đơn khác còn chờ không chặn ai).
//
// Mỗi đơn chiếm một "chỗ" trong từng ngày nó phủ:
//   CA_NGAY  — nghỉ cả ngày, nghỉ bù cả ngày, công tác, làm từ xa không khai giờ
//   BUOI     — nghỉ nửa buổi sáng / chiều (không biết giờ khi chưa có ca ⇒ chỉ so với buổi / cả ngày)
//   KHUNG    — tăng ca, làm ngày nghỉ, chấm ngoài địa điểm, làm từ xa có giờ, nghỉ theo giờ
//   KHONG    — đổi ca, chỉnh công, muộn/sớm, đơn lớp: không chiếm giờ, chỉ so theo luật riêng
//
// Luật (đọc từ trên xuống, luật đầu tiên khớp thắng):
//   1. Đơn LỚP chỉ trùng với đơn lớp CÙNG loại, CÙNG lớp, cùng ngày.
//   2. Ngày có đơn NGHỈ CẢ NGÀY (nghỉ phép / nghỉ bù) ⇒ mọi đơn ca/chấm công khác trong ngày đều trùng.
//   3. Cùng loại: chiếm chỗ chồng nhau ⇒ trùng (muộn/sớm: cùng hình thức; đổi ca / chỉnh công: cùng ngày).
//   4. NGHỈ một phần (nghỉ phép / nghỉ bù) chồng giờ với nghỉ khác, hoặc với giờ LÀM (OT, làm ngày nghỉ,
//      chấm ngoài, từ xa) ⇒ trùng — không thể vừa nghỉ vừa làm cùng lúc.
//   5. Công tác cùng ngày với làm từ xa / chấm ngoài địa điểm ⇒ trùng (hai nơi làm cho một ngày).
//   6. Tăng ca cùng ngày với làm ngày nghỉ / lễ ⇒ trùng (một ngày hoặc là ngày làm, hoặc không).
//   Còn lại: KHÔNG trùng — vd làm từ xa + tăng ca (BA cho phép), hai khung nghỉ theo giờ không chồng.
import type { WorkRequestKindV } from "@/lib/work-request";
import { WR_KIND_LABEL } from "@/lib/work-request";
import { giao, khoangTu, tong, type Khoang } from "./khoang-gio";

export type DonXet = {
  id: string;
  kind: WorkRequestKindV;
  status: string;
  fromDate: Date | null;
  toDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  approvedStartTime: string | null;
  approvedEndTime: string | null;
  leaveDurationType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURLY" | null;
  classId: string | null;
  detail: string | null;
};

type ChiemCho = { loai: "CA_NGAY" } | { loai: "BUOI"; buoi: "SANG" | "CHIEU" } | { loai: "KHUNG"; khung: Khoang } | { loai: "KHONG" };

const LOP = new Set<WorkRequestKindV>(["CLASS_CHANGE", "SUB_TEACH", "CLASS_OFF"]);
const NGHI = new Set<WorkRequestKindV>(["LEAVE", "COMP_LEAVE"]);
const LAM = new Set<WorkRequestKindV>(["OT", "HOLIDAY_WORK", "OUTSIDE_ATTENDANCE", "REMOTE"]);

function khungCua(d: DonXet): Khoang | null {
  return khoangTu(d.approvedStartTime ?? d.startTime, d.approvedEndTime ?? d.endTime);
}

export function chiemCho(d: DonXet): ChiemCho {
  switch (d.kind) {
    case "LEAVE":
    case "COMP_LEAVE":
      if (d.leaveDurationType === "HALF_DAY_AM") return { loai: "BUOI", buoi: "SANG" };
      if (d.leaveDurationType === "HALF_DAY_PM") return { loai: "BUOI", buoi: "CHIEU" };
      if (d.leaveDurationType === "HOURLY") {
        const k = khungCua(d);
        return k ? { loai: "KHUNG", khung: k } : { loai: "KHONG" };
      }
      return { loai: "CA_NGAY" };
    case "BUSINESS_TRIP":
      return { loai: "CA_NGAY" };
    case "REMOTE": {
      const k = khungCua(d);
      return k ? { loai: "KHUNG", khung: k } : { loai: "CA_NGAY" };
    }
    case "OT":
    case "HOLIDAY_WORK":
    case "OUTSIDE_ATTENDANCE": {
      const k = khungCua(d);
      return k ? { loai: "KHUNG", khung: k } : { loai: "KHONG" };
    }
    default:
      return { loai: "KHONG" };
  }
}

/** Hai chỗ có chồng nhau không. BUOI với KHUNG: không biết giờ buổi khi chưa có ca ⇒ KHÔNG đoán là chồng. */
function chong(a: ChiemCho, b: ChiemCho): boolean {
  if (a.loai === "KHONG" || b.loai === "KHONG") return false;
  if (a.loai === "CA_NGAY" || b.loai === "CA_NGAY") return true;
  if (a.loai === "BUOI" && b.loai === "BUOI") return a.buoi === b.buoi;
  if (a.loai === "KHUNG" && b.loai === "KHUNG") return tong(giao([a.khung], [b.khung])) > 0;
  return false;
}

function ngayTrung(a: DonXet, b: DonXet): boolean {
  if (!a.fromDate || !b.fromDate) return false;
  const aDen = (a.toDate ?? a.fromDate).getTime();
  const bDen = (b.toDate ?? b.fromDate).getTime();
  return a.fromDate.getTime() <= bDen && b.fromDate.getTime() <= aDen;
}

const nghiCaNgay = (d: DonXet) => NGHI.has(d.kind) && chiemCho(d).loai === "CA_NGAY";

/** Lý do hai đơn trùng, hoặc null. Đối xứng: `lyDoTrung(a, b)` khác null ⇔ `lyDoTrung(b, a)` khác null. */
export function lyDoTrung(a: DonXet, b: DonXet): string | null {
  if (!ngayTrung(a, b)) return null;
  // 1. Đơn lớp.
  if (LOP.has(a.kind) || LOP.has(b.kind)) {
    return a.kind === b.kind && a.classId && a.classId === b.classId ? "cùng một buổi lớp" : null;
  }
  // 2. Nghỉ cả ngày chặn mọi đơn ca / chấm công khác trong ngày.
  if (nghiCaNgay(a) || nghiCaNgay(b)) return "ngày này đã có đơn nghỉ cả ngày";
  const ca = chiemCho(a);
  const cb = chiemCho(b);
  // 3. Cùng loại.
  if (a.kind === b.kind) {
    if (a.kind === "LATE_EARLY") return (a.detail ?? "") === (b.detail ?? "") ? "cùng hình thức đi muộn / về sớm" : null;
    if (a.kind === "SHIFT_SWAP" || a.kind === "TIMESHEET_FIX") return "cùng ngày";
    return chong(ca, cb) ? "trùng khung giờ" : null;
  }
  // 4. Nghỉ một phần × nghỉ khác / giờ làm.
  if ((NGHI.has(a.kind) && (NGHI.has(b.kind) || LAM.has(b.kind))) || (NGHI.has(b.kind) && LAM.has(a.kind))) {
    return chong(ca, cb) ? "không thể vừa nghỉ vừa làm (hoặc nghỉ hai lần) cùng khung giờ" : null;
  }
  // 5. Công tác × làm từ xa / chấm ngoài.
  const cap = new Set([a.kind, b.kind]);
  if (cap.has("BUSINESS_TRIP") && (cap.has("REMOTE") || cap.has("OUTSIDE_ATTENDANCE"))) return "ngày công tác đã là nơi làm việc của ngày đó";
  // 6. Tăng ca × làm ngày nghỉ.
  if (cap.has("OT") && cap.has("HOLIDAY_WORK")) return "một ngày hoặc có ca (tăng ca) hoặc không (làm ngày nghỉ / lễ)";
  return null;
}

export type XungDot = { don: DonXet; lyDo: string };

export function timXungDot(moi: DonXet, khac: readonly DonXet[]): XungDot | null {
  for (const d of khac) {
    if (d.id === moi.id) continue;
    const lyDo = lyDoTrung(moi, d);
    if (lyDo) return { don: d, lyDo };
  }
  return null;
}

/** Câu báo cho người dùng — nói ĐƠN NÀO trùng và VÌ SAO. */
export function cauXungDot(x: XungDot, nhanTrangThai: string, ngay: string): string {
  return `Trùng với đơn ${WR_KIND_LABEL[x.don.kind] ?? x.don.kind}${ngay ? ` ngày ${ngay}` : ""} (${nhanTrangThai.toLowerCase()}): ${x.lyDo}`;
}
