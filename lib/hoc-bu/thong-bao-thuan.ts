// lib/hoc-bu/thong-bao-thuan.ts — MA TRẬN THÔNG BÁO HỌC BÙ (T13, 08/10/2026). THUẦN, không chạm DB.
//
// Một nơi khai: sự kiện nào ⇒ ai nhận ⇒ khoá chống trùng ra sao ⇒ nói gì. Phần ghi (phát sự kiện trong giao dịch) ở `su-kien.ts`, phần nhận
// (tạo thông báo) ở `lib/_handlers/hoc-bu-case-notif.ts`, phần quét theo giờ ở `nhac-db.ts` — cả ba chỉ đọc bảng này.
//
// Ma trận (bản duyệt T13):
//   sự kiện                          phụ huynh   giáo viên   sale   quản lý
//   makeup.case.scheduled               ✔           ✔
//   makeup.case.changed                 ✔           ✔ (cả GV cũ nếu đổi người)
//   makeup.case.cancelled               ✔           ✔ (khi cả case bị huỷ)
//   makeup.case.reminder                ✔           ✔
//   makeup.completed (kèm đánh giá)     ✔
//   makeup.absent (bé vắng buổi bù)                          ✔
//   makeup.payment-required                                  ✔
//   makeup.teacher-unavailable                                         ✔
//   makeup.overdue                                  ✔                   ✔
//
// Luật cứng:
//   · Sự kiện nghiệp vụ phát TRONG giao dịch sinh ra nó (rollback ⇒ không có sự kiện) và chỉ mang ID — người nhận đọc dữ liệu LÚC XỬ LÝ.
//   · Khoá chống trùng gắn với MỘT sự việc cụ thể (bé + phiên bản, case + phiên bản…) chứ không gắn với thời điểm: outbox phát lại không
//     nhân đôi, nhưng một sự việc MỚI (sửa lịch lần hai, điểm danh sửa) vẫn được báo.
//   · Nội dung KHÔNG mang số điện thoại / email phụ huynh (luật 6 chat): tin chỉ nói tên bé, ngày giờ, bài, giáo viên.
import { vnDateAt } from "@/lib/time/vn";

export const SU_KIEN = {
  CASE_DA_XEP: "makeup.case.scheduled",
  CASE_DOI: "makeup.case.changed",
  CASE_HUY: "makeup.case.cancelled",
  CASE_NHAC: "makeup.case.reminder",
  HOAN_THANH: "makeup.completed",
  BE_VANG: "makeup.absent",
  CAN_THU_PHI: "makeup.payment-required",
  GV_KHONG_CON_CA: "makeup.teacher-unavailable",
  QUA_HAN: "makeup.overdue",
} as const;
export type LoaiSuKien = (typeof SU_KIEN)[keyof typeof SU_KIEN];

/** Tên sự kiện học bù CŨ (R7-17) còn chạy — giữ để không ai gỡ nhầm handler. */
export const SU_KIEN_CU = ["makeup.requested", "makeup.confirmed"] as const;

// ─── Khoá chống trùng ───────────────────────────────────────────────────────────────────────────────────────────────
export const khoaSuKien = {
  /** `mucId` = id mục (MakeupCaseStudent) ĐẦU TIÊN vừa thêm cho bé — mỗi lần xếp thêm bài là một mục mới nên là một sự việc mới. */
  caseDaXep: (participantId: string, mucId: string) => `${SU_KIEN.CASE_DA_XEP}:${participantId}:${mucId}`,
  caseDoi: (caseId: string, phienBanSau: number) => `${SU_KIEN.CASE_DOI}:${caseId}:${phienBanSau}`,
  caseHuyBe: (participantId: string, phienBan: number) => `${SU_KIEN.CASE_HUY}:${participantId}:${phienBan}`,
  /** Báo giáo viên khi cả case bị huỷ — một lần cho cả case, dù có nhiều bé bị gỡ. */
  caseHuyGv: (caseId: string) => `${SU_KIEN.CASE_HUY}:gv:${caseId}`,
  caseNhac: (caseId: string, ymd: string) => `${SU_KIEN.CASE_NHAC}:${caseId}:${ymd}`,
  hoanThanh: (participantId: string, phienBan: number) => `${SU_KIEN.HOAN_THANH}:${participantId}:${phienBan}`,
  beVang: (participantId: string, phienBan: number) => `${SU_KIEN.BE_VANG}:${participantId}:${phienBan}`,
  /** `moc` (tuỳ chọn) = khoản hoàn tiền làm phí thu thiếu: mỗi lần hoàn là một sự việc mới nên được báo lại; không có `moc` = lần hết lượt đầu tiên của dòng. */
  canThuPhi: (makeupNeedId: string, moc?: string | null) => (moc ? `${SU_KIEN.CAN_THU_PHI}:${makeupNeedId}:${moc}` : `${SU_KIEN.CAN_THU_PHI}:${makeupNeedId}`),
  gvKhongConCa: (caseId: string, teacherId: string, ymd: string) => `${SU_KIEN.GV_KHONG_CON_CA}:${caseId}:${teacherId}:${ymd}`,
  quaHan: (caseId: string) => `${SU_KIEN.QUA_HAN}:${caseId}`,
} as const;

// ─── Ngữ cảnh để soạn tin ─────────────────────────────────────────────────────────────────────────────────────────────
export type NguCanhCase = {
  tenBe: string;
  /** YYYY-MM-DD */
  ymd: string;
  gioBatDau: string;
  gioKetThuc: string;
  tenGv: string | null;
  tenPhong: string | null;
  /** Tên các bài của MỘT bé trong case (hoặc cả bộ bài khi tin gửi giáo viên). */
  tenBai: readonly string[];
};

export type KetQuaBaiTin = { tenBai: string; ketQua: "COMPLETED" | "NOT_COMPLETED"; danhGia: string | null };

export type TinNhan = { tieuDe: string; noiDung: string };

export const ngayDMY = (ymd: string): string => {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
};
const gio = (c: Pick<NguCanhCase, "gioBatDau" | "gioKetThuc">) => `${c.gioBatDau}–${c.gioKetThuc}`;
/** Tên bài đi nguyên văn từ giáo trình (VD "Bài 5", "Buổi 14 - HP2 - Tên bài") — không thêm chữ "bài" để khỏi ra "bài Bài 5". */
const dsBai = (b: readonly string[]) => (b.length === 0 ? "" : ` ${b.join(", ")}`);
const noiGv = (c: NguCanhCase) => (c.tenGv ? ` với giáo viên ${c.tenGv}` : "");
const noiPhong = (c: NguCanhCase) => (c.tenPhong ? `, phòng ${c.tenPhong}` : "");

// ─── Phụ huynh ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function tinPhuHuynhDaXep(c: NguCanhCase): TinNhan {
  return {
    tieuDe: "Đã xếp lịch học bù",
    noiDung: `${c.tenBe} được xếp học bù${dsBai(c.tenBai)} lúc ${gio(c)} ngày ${ngayDMY(c.ymd)}${noiGv(c)}${noiPhong(c)}.`,
  };
}

export function tinPhuHuynhDoiLich(c: NguCanhCase, doi: readonly string[]): TinNhan {
  return {
    tieuDe: "Lịch học bù đã thay đổi",
    noiDung:
      `Buổi học bù${dsBai(c.tenBai)} của ${c.tenBe} được cập nhật${doi.length ? ` (${doi.join("; ")})` : ""}. ` +
      `Lịch mới: ${gio(c)} ngày ${ngayDMY(c.ymd)}${noiGv(c)}${noiPhong(c)}.`,
  };
}

export function tinPhuHuynhHuy(c: Pick<NguCanhCase, "tenBe" | "ymd" | "tenBai">): TinNhan {
  return {
    tieuDe: "Buổi học bù đã huỷ",
    noiDung: `Buổi học bù${dsBai(c.tenBai)} ngày ${ngayDMY(c.ymd)} của ${c.tenBe} đã được huỷ. Trung tâm sẽ xếp lại lịch phù hợp và báo phụ huynh.`,
  };
}

export function tinPhuHuynhNhac(c: NguCanhCase): TinNhan {
  return {
    tieuDe: "Nhắc lịch học bù",
    noiDung: `${c.tenBe} có buổi học bù${dsBai(c.tenBai)} lúc ${gio(c)} ngày ${ngayDMY(c.ymd)}${noiGv(c)}${noiPhong(c)}. Phụ huynh nhớ đưa con đến đúng giờ.`,
  };
}

/** Kết quả buổi bù kèm đánh giá của giáo viên — chính là nội dung cổng phụ huynh đã bày (T08/T11), không thêm dữ liệu nhạy cảm nào. */
export function tinPhuHuynhKetQua(p: { tenBe: string; ymd: string; ketQua: readonly KetQuaBaiTin[]; nhanXetChung: string | null; sua: boolean }): TinNhan {
  const dong = p.ketQua.map((k) => {
    const dau = k.ketQua === "COMPLETED" ? "đã học xong" : "chưa hoàn thành, sẽ xếp bù lại";
    return `• ${k.tenBai}: ${dau}${k.danhGia ? ` — ${k.danhGia}` : ""}`;
  });
  const chung = p.nhanXetChung ? `\nNhận xét chung: ${p.nhanXetChung}` : "";
  return {
    tieuDe: p.sua ? "Kết quả buổi học bù đã được cập nhật" : "Kết quả buổi học bù",
    noiDung: `${p.tenBe} đã tham gia buổi học bù ngày ${ngayDMY(p.ymd)}.\n${dong.join("\n")}${chung}`,
  };
}

// ─── Giáo viên ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function tinGiaoVienDaXep(c: Omit<NguCanhCase, "tenBe" | "tenGv"> & { soBe: number }): TinNhan {
  return {
    tieuDe: "Có buổi dạy bù mới",
    noiDung: `Bạn được xếp dạy bù${dsBai(c.tenBai)} lúc ${gio(c)} ngày ${ngayDMY(c.ymd)}${noiPhong({ ...c, tenBe: "", tenGv: null })} cho ${c.soBe} học viên.`,
  };
}

export function tinGiaoVienDoiLich(c: Omit<NguCanhCase, "tenBe" | "tenGv">, doi: readonly string[]): TinNhan {
  return {
    tieuDe: "Buổi dạy bù đã đổi lịch",
    noiDung: `Buổi dạy bù${dsBai(c.tenBai)} được cập nhật${doi.length ? ` (${doi.join("; ")})` : ""}. Lịch mới: ${gio(c)} ngày ${ngayDMY(c.ymd)}${noiPhong({ ...c, tenBe: "", tenGv: null })}.`,
  };
}

export function tinGiaoVienDoiNguoi(c: Pick<NguCanhCase, "ymd" | "gioBatDau" | "gioKetThuc" | "tenBai">): TinNhan {
  return {
    tieuDe: "Buổi dạy bù chuyển cho giáo viên khác",
    noiDung: `Buổi dạy bù${dsBai(c.tenBai)} lúc ${gio(c)} ngày ${ngayDMY(c.ymd)} đã chuyển cho giáo viên khác — bạn không cần dạy buổi này nữa.`,
  };
}

export function tinGiaoVienHuy(c: Pick<NguCanhCase, "ymd" | "gioBatDau" | "gioKetThuc" | "tenBai">): TinNhan {
  return {
    tieuDe: "Buổi dạy bù đã huỷ",
    noiDung: `Buổi dạy bù${dsBai(c.tenBai)} lúc ${gio(c)} ngày ${ngayDMY(c.ymd)} đã bị huỷ.`,
  };
}

export function tinGiaoVienNhac(c: Omit<NguCanhCase, "tenBe" | "tenGv"> & { soBe: number }): TinNhan {
  return {
    tieuDe: "Nhắc buổi dạy bù",
    noiDung: `Bạn có buổi dạy bù${dsBai(c.tenBai)} lúc ${gio(c)} ngày ${ngayDMY(c.ymd)}${noiPhong({ ...c, tenBe: "", tenGv: null })} cho ${c.soBe} học viên.`,
  };
}

// ─── Sale ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function tinSaleBeVang(c: { tenBe: string; ymd: string }): TinNhan {
  return {
    tieuDe: "Học viên vắng buổi học bù",
    noiDung: `${c.tenBe} vắng buổi học bù ngày ${ngayDMY(c.ymd)}. Lượt bù không bị tiêu và buổi cần bù đã quay lại danh sách — hãy liên hệ phụ huynh để xếp lại.`,
  };
}

export function tinSaleCanThuPhi(c: { tenBe: string; tenBai: string | null; conThieu?: number | null }): TinNhan {
  const bai = c.tenBai ? ` (buổi vắng: ${c.tenBai})` : "";
  if (c.conThieu != null && c.conThieu > 0) {
    return {
      tieuDe: "Phí học bù thu thiếu — cần thu bổ sung",
      noiDung: `Phí học bù của ${c.tenBe}${bai} còn thiếu ${c.conThieu.toLocaleString("vi-VN")}đ sau khi hoàn tiền một phần. Bé đã được gỡ khỏi case chưa học — cần thu bổ sung rồi xếp lại.`,
    };
  }
  return {
    tieuDe: "Cần thu phí học bù",
    noiDung: `${c.tenBe} đã hết lượt học bù${bai}. Cần tạo phí học bù và thu trước khi xếp buổi bù.`,
  };
}

// ─── Quản lý ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export function tinQuanLyGvKhongConCa(c: { tenGv: string | null; ymd: string; gioBatDau: string; gioKetThuc: string; soBe: number }): TinNhan {
  return {
    tieuDe: "Giáo viên không còn ca cho buổi dạy bù",
    noiDung: `Giáo viên ${c.tenGv ?? "được xếp"} không còn ca làm phủ buổi dạy bù lúc ${gio(c)} ngày ${ngayDMY(c.ymd)} (${c.soBe} học viên). Cần đổi giáo viên hoặc dời lịch.`,
  };
}

export function tinQuaHan(c: { ymd: string; gioBatDau: string; gioKetThuc: string; soBeChoDiemDanh: number }): TinNhan {
  return {
    tieuDe: "Buổi dạy bù quá giờ chưa điểm danh",
    noiDung: `Buổi dạy bù lúc ${gio(c)} ngày ${ngayDMY(c.ymd)} đã quá giờ nhưng còn ${c.soBeChoDiemDanh} học viên chưa được điểm danh.`,
  };
}

// ─── Mô tả thay đổi lịch (cho tin đổi lịch) ─────────────────────────────────────────────────────────────────────────────
export type KhungCase = { ymd: string; startTime: string; endTime: string; teacherId: string; roomId: string | null };

/** So hai khung — trả danh sách việc đã đổi, ngắn gọn. Rỗng ⇒ không có gì đổi (không báo). Ghi chú / bộ bài không tính: không đổi giờ giấc. */
export function lietKeThayDoi(truoc: KhungCase, sau: KhungCase): string[] {
  const ra: string[] = [];
  if (truoc.ymd !== sau.ymd) ra.push(`ngày ${ngayDMY(truoc.ymd)} → ${ngayDMY(sau.ymd)}`);
  if (truoc.startTime !== sau.startTime || truoc.endTime !== sau.endTime) ra.push(`giờ ${truoc.startTime}–${truoc.endTime} → ${sau.startTime}–${sau.endTime}`);
  if (truoc.teacherId !== sau.teacherId) ra.push("đổi giáo viên");
  if (truoc.roomId !== sau.roomId) ra.push("đổi phòng");
  return ra;
}

// ─── Cửa sổ quét theo giờ ─────────────────────────────────────────────────────────────────────────────────────────────
export const NHAC_TRUOC_TU_GIO = 23;
export const NHAC_TRUOC_DEN_GIO = 25;
/** Quá giờ kết thúc bao lâu mà còn bé chưa điểm danh thì báo quản lý. Giáo viên được điểm danh hết 23:59 ngày dạy, nên 120 phút là sớm, không phải trễ. */
export const QUA_HAN_SAU_PHUT = 120;

export function gioCase(c: { ymd: string; startTime: string; endTime: string }): { batDau: Date; ketThuc: Date } {
  const [y, m, d] = c.ymd.split("-").map(Number);
  const [sh, sm] = c.startTime.split(":").map(Number);
  const [eh, em] = c.endTime.split(":").map(Number);
  return { batDau: vnDateAt(y!, m! - 1, d!, sh!, sm!), ketThuc: vnDateAt(y!, m! - 1, d!, eh!, em!) };
}

/** Còn trong khoảng [23h, 25h) trước giờ bắt đầu — đủ rộng để cron mỗi giờ luôn trúng đúng MỘT lượt, dedupe lo phần còn lại. */
export function trongCuaSoNhac(now: Date, batDau: Date): boolean {
  const gioConLai = (batDau.getTime() - now.getTime()) / 3_600_000;
  return gioConLai >= NHAC_TRUOC_TU_GIO && gioConLai < NHAC_TRUOC_DEN_GIO;
}

export function daQuaHan(now: Date, ketThuc: Date, graceMin: number = QUA_HAN_SAU_PHUT): boolean {
  return now.getTime() - ketThuc.getTime() >= graceMin * 60_000;
}

// ─── Giáo viên còn ca phủ buổi bù không ──────────────────────────────────────────────────────────────────────────────────
export type KetQuaPhuCaBu = "PHU_TRON" | "KHONG_PHU" | "NGHI" | "KHONG_GIO" | "KHONG_CO_CA" | "CHUA_VAO_LUOI" | "CHUA_CO_LUOI";

/**
 * Giáo viên của case có còn khả dụng không — CHỈ kết luận "không còn" khi lưới ca NÓI RÕ điều đó:
 *   · ngày nghỉ / nghỉ phép (`NGHI`), ca đổi sang khung không phủ buổi bù (`KHONG_PHU`), ca không nhận thêm buổi (`KHONG_GIO`);
 *   · ô ca phủ giờ nhưng gắn CƠ SỞ KHÁC (hôm đó giáo viên làm ở nơi khác).
 * "Không có ô ca / chưa sinh lưới" là DỮ LIỆU THIẾU chứ không phải "vắng" — báo theo đó là báo động giả (cùng bài học của cờ giáo viên vắng ở lớp trial).
 */
export function gvKhongConCaBu(p: { ketQuaPhu: KetQuaPhuCaBu; caCenterId: string | null | undefined; centerId: string }): boolean {
  if (p.ketQuaPhu === "NGHI" || p.ketQuaPhu === "KHONG_PHU" || p.ketQuaPhu === "KHONG_GIO") return true;
  return p.ketQuaPhu === "PHU_TRON" && p.caCenterId != null && p.caCenterId !== p.centerId;
}
