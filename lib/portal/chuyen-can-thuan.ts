import type { SessionAttendance } from "@/lib/portal/student-sessions";
import { bacTuTrungBinh, type NangLucBac } from "@/lib/portal/tong-quan-thuan";
import { EVAL_CRITERIA_BY_ID } from "@/lib/lms/session-eval-rubric";
import { so1 } from "@/lib/portal/nhan-xet-thuan";

// Cổng phụ huynh — phần THUẦN của màn "Chuyên cần & kết quả" (artifact Chuyen-can.dc.html).
// Quy tắc đếm (một chỗ): buổi huỷ không tính; buổi NGOÀI phạm vi đăng ký không tính; buổi chưa chấm điểm danh KHÔNG phải vắng.

export type KieuO = "co" | "bu" | "cho" | "xep" | "vang" | "chua-cham" | "ke" | "sap" | "huy" | "ngoai";

export const NHAN_KIEU: Record<KieuO, string> = {
  co: "Có mặt",
  bu: "Học bù xong",
  cho: "Vắng · chờ bù",
  xep: "Đã xếp lịch bù",
  vang: "Vắng · không bù",
  "chua-cham": "Chưa chấm điểm danh",
  ke: "Buổi kế tiếp",
  sap: "Sắp tới",
  huy: "Trung tâm huỷ",
  // Nhãn thật do server tính (`nhanPhamVi`, luật 12b) — đây chỉ là chữ dự phòng khi chưa có.
  ngoai: "Không tính vào gói",
};

export function kieuO(i: {
  attendance: SessionAttendance;
  past: boolean;
  laKeTiep: boolean;
  ngoaiPhamVi: boolean;
  /** Trạng thái đơn bù của buổi vắng này (nếu có). */
  bu: "PENDING" | "SCHEDULED" | null;
}): KieuO {
  if (i.attendance === "CANCELLED") return "huy";
  if (i.ngoaiPhamVi) return "ngoai";
  if (i.attendance === "PRESENT") return "co";
  if (i.attendance === "MAKEUP") return "bu";
  if (i.attendance === "EXCUSED" || i.attendance === "ABSENT") {
    if (i.bu === "SCHEDULED") return "xep";
    if (i.bu === "PENDING") return "cho";
    return "vang";
  }
  if (i.attendance === "UNMARKED") return "chua-cham";
  return i.laKeTiep ? "ke" : i.past ? "chua-cham" : "sap";
}

export type SoBuoi = {
  lopDaHoc: number;
  conDaHoc: number;
  coMat: number;
  bu: number;
  choBu: number;
  vangKhongBu: number;
  chuaCham: number;
  conLai: number;
  /** Tổng các nhóm — đem so với số buổi đăng ký. */
  tongNhom: number;
  /** Tỉ lệ có mặt: mẫu số = buổi đã diễn ra TRỪ buổi chưa chấm. null khi mẫu số 0. */
  tiLe: { phanTram: number; coMat: number; mauSo: number } | null;
};

export function demSoBuoi(kieu: KieuO[]): SoBuoi {
  const dem = (...k: KieuO[]) => kieu.filter((x) => k.includes(x)).length;
  const coMat = dem("co");
  const bu = dem("bu");
  const choBu = dem("cho", "xep");
  const vangKhongBu = dem("vang");
  const chuaCham = dem("chua-cham");
  const conLai = dem("ke", "sap");
  const lopDaHoc = coMat + bu + choBu + vangKhongBu + chuaCham;
  const mauSo = coMat + bu + choBu + vangKhongBu;
  return {
    lopDaHoc,
    conDaHoc: coMat + bu,
    coMat,
    bu,
    choBu,
    vangKhongBu,
    chuaCham,
    conLai,
    tongNhom: lopDaHoc + conLai,
    tiLe: mauSo > 0 ? { phanTram: Math.round(((coMat + bu) / mauSo) * 100), coMat: coMat + bu, mauSo } : null,
  };
}

export type PhepCong = { ve: string; khop: boolean; lech: number; nhan: string };

/** "Đã học 6 + Chờ bù 1 + Còn lại 41 = 48 buổi đã đăng ký" — chỉ in nhóm khác 0; lệch thì nói thẳng, không gượng ép cho khớp. */
export function phepCong(s: SoBuoi, dangKy: number): PhepCong {
  const phan: [string, number][] = [
    ["Đã học", s.conDaHoc],
    ["Chờ bù", s.choBu],
    ["Vắng không bù", s.vangKhongBu],
    ["Chưa chấm", s.chuaCham],
    ["Còn lại", s.conLai],
  ];
  const ve = phan.filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(" + ") || "Chưa có buổi nào";
  const lech = dangKy - s.tongNhom;
  return {
    ve: `${ve} = ${s.tongNhom} buổi · đăng ký ${dangKy} buổi`,
    khop: lech === 0,
    lech,
    nhan: lech === 0 ? "Khớp — không mất buổi nào" : `Lệch ${Math.abs(lech)} buổi so với số đã đăng ký — nhờ trung tâm kiểm tra`,
  };
}

export type KetLuan = {
  tieuDe: string;
  giaiThich: string;
  viec: string;
  nut: { nhan: string; href: string };
  /** `canh-bao` = nền tối; còn lại nền tím. */
  sac: "tot" | "canh-bao";
};

export function ketLuan(i: { ten: string; s: SoBuoi; soBuoiChoBu: number[] }): KetLuan {
  const { s } = i;
  const dau = `Lớp đã học ${s.lopDaHoc} buổi. ${i.ten || "Con"} đã học ${s.conDaHoc}`;
  if (s.vangKhongBu > 0 && s.choBu === 0)
    return {
      tieuDe: `Có ${s.vangKhongBu} buổi vắng chưa có lịch bù`,
      giaiThich: `${dau}, còn ${s.vangKhongBu} buổi vắng chưa có đơn bù. Ba mẹ gửi đơn học bù để con không hụt bài.`,
      viec: "Gửi đơn học bù cho buổi đã vắng",
      nut: { nhan: "Xin học bù", href: "/portal/yeu-cau" },
      sac: "canh-bao",
    };
  if (s.choBu > 0)
    return {
      tieuDe: `Đủ buổi — ${s.choBu} buổi đang chờ học bù`,
      giaiThich: `${dau}, ${s.choBu} buổi vắng đang chờ bù. Chưa mất buổi nào nếu con học bù.`,
      viec: i.soBuoiChoBu.length ? `Chọn giờ học bù buổi ${i.soBuoiChoBu.join(", ")}` : "Chọn giờ học bù",
      nut: { nhan: "Chọn giờ học bù", href: "/portal/yeu-cau" },
      sac: "tot",
    };
  if (s.chuaCham > 0)
    return {
      tieuDe: `${s.chuaCham} buổi giáo viên chưa chấm điểm danh`,
      giaiThich: `${dau}. Còn ${s.chuaCham} buổi đã diễn ra nhưng chưa chấm, nên chưa tính là có mặt hay vắng.`,
      viec: "Chờ giáo viên chấm điểm danh",
      nut: { nhan: "Xem lịch", href: "/portal/lich" },
      sac: "tot",
    };
  return {
    tieuDe: s.lopDaHoc === 0 ? "Chưa có buổi nào đã học" : "Con học đủ buổi",
    giaiThich: s.lopDaHoc === 0 ? "Số liệu hiện ra sau buổi học đầu tiên." : `${dau}, không có buổi nào đang thiếu.`,
    viec: "Chưa có việc cần làm",
    nut: { nhan: "Xem lịch", href: "/portal/lich" },
    sac: "tot",
  };
}

// ── Chất lượng học ─────────────────────────────────────────────────────────────

export const NHAN_BAC_NGAN: Record<NangLucBac, string> = { 1: "K", 2: "T", 3: "TC" };
export const NHAN_BAC: Record<NangLucBac, string> = { 1: "Khá", 2: "Tốt", 3: "Tích cực" };

/** Bậc của MỘT phiếu = bậc của trung bình mọi tiêu chí đã chấm; không chấm tiêu chí nào ⇒ null (không bịa). */
export function bacCuaPhieu(rubric: Record<string, number> | null): NangLucBac | null {
  const xs = Object.values(rubric ?? {}).filter((v) => v >= 1 && v <= 5);
  if (xs.length === 0) return null;
  return bacTuTrungBinh(xs.reduce((a, b) => a + b, 0) / xs.length);
}

export type XepLoai = { n: number; bac: NangLucBac };

export function canhBao(xl: XepLoai[], chuaNop: number): { loai: "tot" | "luu-y"; tieuDe: string; noi: string } | null {
  const gan = xl.slice(-3);
  if (gan.length === 0) return null;
  const kha = gan.filter((x) => x.bac === 1).length;
  const tichCuc = gan.filter((x) => x.bac === 3).length;
  const nop = chuaNop > 0 ? ` Còn ${chuaNop} bài về nhà chưa nộp.` : "";
  if (kha >= 2)
    return {
      loai: "luu-y",
      tieuDe: `${kha} trong ${gan.length} buổi gần nhất xếp loại Khá`,
      noi: `Ba mẹ có thể nhắn thầy cô để cùng tìm cách giúp con.${nop}`,
    };
  return {
    loai: "tot",
    tieuDe: "Con đang học tốt",
    noi: `${tichCuc} trên ${gan.length} buổi gần nhất xếp loại Tích cực${kha === 0 ? ", chưa buổi nào xếp loại Khá" : ""}.${nop}`,
  };
}

/** Điểm trung bình theo NHÓM tiêu chí, đổi sang thang 5 vạch (6 − mức). */
export function diemTheoNhom(rubrics: (Record<string, number> | null)[]): { ten: string; diem: number; chu: string }[] {
  const tong = new Map<string, { s: number; n: number }>();
  for (const r of rubrics) {
    for (const [id, v] of Object.entries(r ?? {})) {
      const nhom = EVAL_CRITERIA_BY_ID[id]?.group;
      if (!nhom || !(v >= 1 && v <= 5)) continue;
      const c = tong.get(nhom) ?? { s: 0, n: 0 };
      c.s += v;
      c.n += 1;
      tong.set(nhom, c);
    }
  }
  return [...tong].map(([ten, { s, n }]) => {
    const diem = 6 - s / n;
    return { ten, diem, chu: so1(diem) };
  });
}

// ── Lượt học bù ────────────────────────────────────────────────────────────────

export type LuotBu = { tong: number; dung: number; giu: number; con: number };
export const luotBu = (granted: number, held: number, consumed: number): LuotBu => ({
  tong: granted,
  dung: consumed,
  giu: held,
  con: Math.max(0, granted - held - consumed),
});
