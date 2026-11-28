/**
 * DỮ LIỆU GIẢ CHO TEST của sổ gia đình DISC — KHÔNG import từ mã chạy thật.
 * Hình dạng gần dữ liệu thật: điểm lẻ (không tròn trịa), hai phiên bản bộ đề, một hồ sơ ước lượng.
 */
import type { BaiLam, CachLam, DiemDisc, Kieu, ThanhVien, VaiGiaDinh } from "./kieu";
import type { DauVaoMan } from "./man-hinh";
import { type NguoiChup, dungBanChup, type BanChup } from "./phan-tich";

export const GOC_GIO = new Date("2026-11-02T03:00:00.000Z");

export function tv(id: string, ten: string, vaiTro: VaiGiaDinh, lop: string | null = null, thuTu = 0): ThanhVien {
  return { id, ten, vaiTro, lop, namSinh: null, thuTu, ghiChu: null, studentId: null };
}

export function bai(
  id: string,
  thanhVienId: string | null,
  cachLam: CachLam,
  diem: DiemDisc,
  ngay: string,
  boDe: BaiLam["boDe"] = "PH",
  phienBanBoDe = "1.1",
  kieu: Kieu = { loai: "don", truc: "D" },
): BaiLam {
  return { id, thanhVienId, tenLuc: id, boDe, phienBanBoDe, cachLam, diem, kieu, canhBao: [], createdAt: new Date(`${ngay}T03:00:00.000Z`) };
}

export const DIEM = {
  boD: { D: 87.5, I: 40.2, S: 19.8, C: 45.1 } as DiemDisc,
  meC: { D: 33.6, I: 24.4, S: 62.1, C: 74.3 } as DiemDisc,
  conI: { D: 58.3, I: 74.1, S: 46.2, C: 21.9 } as DiemDisc,
  beS: { D: 20.4, I: 47.7, S: 74.2, C: 39.8 } as DiemDisc,
};

export function nguoiChup(
  id: string,
  ten: string,
  vaiTro: VaiGiaDinh,
  laTre: boolean,
  lop: string | null,
  diem: DiemDisc,
  kieu: Kieu,
  qua: CachLam = "TU_LAM",
  phienBanBoDe = "1.1",
): NguoiChup {
  return { id, ten, vaiTro, laTre, lop, diem, kieu, qua, baiId: `bai-${id}`, phienBanBoDe };
}

/** Nhà 4 người: bố (D), mẹ (C), con lớp 5 (I), bé mầm non (S, ước lượng). */
export function nhaBonNguoi(): NguoiChup[] {
  return [
    nguoiChup("bo", "Người lớn 1", "bo", false, null, DIEM.boD, { loai: "don", truc: "D" }),
    nguoiChup("me", "Người lớn 2", "me", false, null, DIEM.meC, { loai: "pha", cap: ["C", "S"] }),
    nguoiChup("con", "Bé lớn", "con", true, "5", DIEM.conI, { loai: "don", truc: "I" }, "TU_LAM", "nh:nh1"),
    nguoiChup("be", "Bé nhỏ", "con", true, "mam-non", DIEM.beS, { loai: "don", truc: "S" }, "GOC_NHIN", "nh:nh1"),
  ];
}

export function chupBonNguoi(): BanChup {
  const r = dungBanChup(nhaBonNguoi());
  if (!r.ok) throw new Error("fixture hỏng");
  return r.chup;
}

/** Kịch bản số người đã làm bài (bảng 4.6 của spec): mỗi kịch bản dựng đủ `DauVaoMan` (thành viên + bài + bản chụp). */
export type KichBan = "mot-tu-lam" | "hai-tu-lam" | "ba-ho-so-mot-uoc" | "du-ca-nha";

export function dauVaoNha(kb: KichBan, homNay: Date = GOC_GIO): DauVaoMan {
  const thanhVien = [tv("me", "Người lớn 2", "me", null, 0), tv("bo", "Người lớn 1", "bo", null, 1), tv("con", "Bé lớn", "con", "5", 2), tv("be", "Bé nhỏ", "con", "mam-non", 3)];
  const tl = (id: string, bo: BaiLam["boDe"], diem: DiemDisc, ngay: string, cach: CachLam = "TU_LAM", pb = "1.1") => bai(`bai-${id}`, id, cach, diem, ngay, bo, pb);
  const bais: Record<KichBan, BaiLam[]> = {
    "mot-tu-lam": [tl("me", "PH", DIEM.meC, "2026-10-28")],
    "hai-tu-lam": [tl("me", "PH", DIEM.meC, "2026-10-28"), tl("bo", "PH", DIEM.boD, "2026-10-27")],
    "ba-ho-so-mot-uoc": [tl("me", "PH", DIEM.meC, "2026-10-28"), tl("bo", "PH", DIEM.boD, "2026-10-27"), tl("be", "MN", DIEM.beS, "2026-10-30", "GOC_NHIN", "nh:nh1")],
    "du-ca-nha": [tl("me", "PH", DIEM.meC, "2026-10-28"), tl("bo", "PH", DIEM.boD, "2026-10-27"), tl("con", "TH", DIEM.conI, "2026-10-28", "TU_LAM", "nh:nh1"), tl("be", "MN", DIEM.beS, "2026-10-30", "TU_LAM", "nh:nh1")],
  };
  const co = bais[kb];
  const kieuCua: Record<string, Kieu> = { me: { loai: "don", truc: "C" }, bo: { loai: "don", truc: "D" }, con: { loai: "don", truc: "I" }, be: { loai: "don", truc: "S" } };
  const dsBai = co.map((b) => ({ ...b, kieu: kieuCua[b.thanhVienId!]! }));
  const nguoi = thanhVien
    .filter((t) => dsBai.some((b) => b.thanhVienId === t.id))
    .map((t) => {
      const b = dsBai.find((x) => x.thanhVienId === t.id)!;
      return nguoiChup(t.id, t.ten, t.vaiTro, t.vaiTro === "con", t.lop, b.diem, b.kieu, b.cachLam, b.phienBanBoDe);
    });
  const r = nguoi.length >= 2 ? dungBanChup(nguoi) : null;
  return {
    thanhVien,
    bai: dsBai,
    chup: r && r.ok ? r.chup : null,
    soBan: r && r.ok ? 3 : null,
    taoLucPhanTich: r && r.ok ? homNay : null,
    tenGiaDinh: "Nhà thử",
    chuSoId: "me",
    dangNhap: new Map(),
    bayGio: homNay,
  };
}
