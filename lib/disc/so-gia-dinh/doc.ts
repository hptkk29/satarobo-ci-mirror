import "server-only";
/**
 * ĐỌC SỔ GIA ĐÌNH DISC — mọi truy vấn đều bắt đầu từ `ownerUserId = userId` (userId LẤY TỪ PHIÊN, không bao giờ từ URL/form).
 * Id lạ ≡ id của người khác ≡ không tồn tại ⇒ cùng kết quả `null` (chống IDOR, không oracle).
 *
 * Bảng DISC không theo cơ sở nên không qua `scopedDb`; mọi truy vấn nằm Ở ĐÂY và ở `ghi.ts` (cổng portal không import `@/lib/db`).
 * ⚠️ Dữ liệu cá nhân của TRẺ: không log, không `select *` ra ngoài tầng này.
 */
import { z } from "zod";

import { VAI_GIA_DINH } from "@/lib/disc/engine-goc/config/disc-gia-dinh";
import { MA_BO_DE } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { db } from "@/lib/db";

import type { HoatDongDaKiem } from "./ke-hoach";
import type { BaiLam, CachLam, ThanhVien } from "./kieu";
import { ngayVN, soNgayGiua } from "./kieu";
import { laBanChupHopLe, type BanChup } from "./phan-tich";

const diemSchema = z.object({ D: z.number(), I: z.number(), S: z.number(), C: z.number() });
const kieuSchema = z.union([
  z.object({ loai: z.literal("don"), truc: z.enum(["D", "I", "S", "C"]) }),
  z.object({ loai: z.literal("pha"), cap: z.tuple([z.enum(["D", "I", "S", "C"]), z.enum(["D", "I", "S", "C"])]) }),
  z.object({ loai: z.literal("deu") }),
]);

export function vaiTuChiSo(i: number): ThanhVien["vaiTro"] {
  return VAI_GIA_DINH[i] ?? "khac";
}
export function chiSoCuaVai(v: ThanhVien["vaiTro"]): number {
  return VAI_GIA_DINH.indexOf(v);
}

type HangThanhVien = {
  id: string;
  ten: string;
  vaiTro: number;
  lop: string | null;
  namSinh: number | null;
  thuTu: number;
  ghiChu: string | null;
  studentId: string | null;
  laChuSo: boolean;
};

export function thanhVienTuHang(h: HangThanhVien): ThanhVien {
  return { id: h.id, ten: h.ten, vaiTro: vaiTuChiSo(h.vaiTro), lop: h.lop, namSinh: h.namSinh, thuTu: h.thuTu, ghiChu: h.ghiChu, studentId: h.studentId };
}

type HangBai = {
  id: string;
  thanhVienId: string | null;
  tenLuc: string;
  boDe: string;
  phienBanBoDe: string;
  cachLam: string;
  diem: unknown;
  kieu: unknown;
  canhBao: string[];
  createdAt: Date;
};

/** Bài có JSON hỏng ⇒ bỏ qua (null), không ném: một dòng hỏng không được làm sập cả màn. */
export function baiTuHang(h: HangBai): BaiLam | null {
  const d = diemSchema.safeParse(h.diem);
  const k = kieuSchema.safeParse(h.kieu);
  if (!d.success || !k.success) return null;
  if (!(MA_BO_DE as readonly string[]).includes(h.boDe)) return null;
  if (h.cachLam !== "TU_LAM" && h.cachLam !== "GOC_NHIN") return null;
  return {
    id: h.id,
    thanhVienId: h.thanhVienId,
    tenLuc: h.tenLuc,
    boDe: h.boDe as BaiLam["boDe"],
    phienBanBoDe: h.phienBanBoDe,
    cachLam: h.cachLam as CachLam,
    diem: d.data,
    kieu: k.data,
    canhBao: h.canhBao,
    createdAt: h.createdAt,
  };
}

const CHON_THANH_VIEN = { id: true, ten: true, vaiTro: true, lop: true, namSinh: true, thuTu: true, ghiChu: true, studentId: true, laChuSo: true } as const;
const CHON_BAI = { id: true, thanhVienId: true, tenLuc: true, boDe: true, phienBanBoDe: true, cachLam: true, diem: true, kieu: true, canhBao: true, createdAt: true } as const;
/** Trần số bài đọc một lần — đủ cho 8 người × 24 bài/năm × 2 năm. */
const TRAN_DOC_BAI = 400;

export type SoGiaDinh = {
  readonly id: string;
  readonly ten: string;
  readonly coPin: boolean;
  readonly thanhVien: readonly ThanhVien[];
  readonly chuSoId: string | null;
  /** Mới nhất trước. Gồm cả bài «chưa xếp». */
  readonly bai: readonly BaiLam[];
};

/** Sổ của CHÍNH userId (một tài khoản — một sổ). null nếu chưa tạo. */
export async function docSo(userId: string): Promise<SoGiaDinh | null> {
  const so = await db.discGiaDinh.findUnique({
    where: { ownerUserId: userId },
    select: {
      id: true,
      ten: true,
      pinHash: true,
      thanhVien: { where: { deletedAt: null }, orderBy: [{ thuTu: "asc" }, { createdAt: "asc" }], select: CHON_THANH_VIEN },
      baiLam: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: TRAN_DOC_BAI, select: CHON_BAI },
    },
  });
  if (!so) return null;
  const bai = so.baiLam.map(baiTuHang).filter((b): b is BaiLam => b !== null);
  return {
    id: so.id,
    ten: so.ten,
    coPin: so.pinHash !== null,
    thanhVien: so.thanhVien.map(thanhVienTuHang),
    chuSoId: so.thanhVien.find((t) => t.laChuSo)?.id ?? null,
    bai,
  };
}

/** Chỉ cần id sổ + chủ — dùng ở đầu mọi Server Action ghi. */
export async function laySoCuaChu(userId: string): Promise<{ id: string; ownerUserId: string } | null> {
  return db.discGiaDinh.findUnique({ where: { ownerUserId: userId }, select: { id: true, ownerUserId: true } });
}

export type PhanTichDaLuu = {
  readonly id: string;
  readonly soBan: number;
  readonly taoLuc: Date;
  readonly maBai: readonly string[];
  readonly chup: BanChup;
};

export async function docPhanTichMoiNhat(giaDinhId: string): Promise<PhanTichDaLuu | null> {
  const r = await db.discPhanTich.findFirst({
    where: { giaDinhId },
    orderBy: { soBan: "desc" },
    select: { id: true, soBan: true, createdAt: true, maBai: true, noiDung: true },
  });
  if (!r || !laBanChupHopLe(r.noiDung)) return null;
  return { id: r.id, soBan: r.soBan, taoLuc: r.createdAt, maBai: r.maBai, chup: r.noiDung };
}

export type ViecDaLuu = {
  readonly id: string;
  readonly nguoiLamId: string | null;
  readonly nguoiNhanId: string | null;
  readonly ngay: string;
  readonly nguon: string;
  readonly noiDung: string;
  readonly phut: number;
  readonly hoatDongId: string | null;
  readonly xongLuc: Date | null;
  readonly camOnLuc: Date | null;
};

export type KeHoachDaLuu = {
  readonly id: string;
  readonly ky: "NGAY_7" | "THANG_1" | "NAM_1";
  readonly batDau: string;
  readonly doKho: number;
  readonly soViecTuan: number;
  readonly phanTichId: string | null;
  readonly viec: readonly ViecDaLuu[];
  readonly checkin: readonly { readonly thanhVienId: string; readonly tuan: number; readonly diem: number; readonly capDeChiu: string | null }[];
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10); // cột @db.Date đọc về 00:00 UTC của đúng ngày
}

export async function docKeHoachDangChay(giaDinhId: string, ky: KeHoachDaLuu["ky"]): Promise<KeHoachDaLuu | null> {
  const r = await db.discKeHoach.findFirst({
    where: { giaDinhId, ky, trangThai: "DANG_CHAY" },
    select: {
      id: true,
      ky: true,
      batDau: true,
      doKho: true,
      soViecTuan: true,
      phanTichId: true,
      viec: {
        orderBy: [{ ngay: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, nguoiLamId: true, nguoiNhanId: true, ngay: true, nguon: true, noiDung: true, phut: true, hoatDongId: true, xongLuc: true, camOnLuc: true },
      },
      checkin: { select: { thanhVienId: true, tuan: true, diem: true, capDeChiu: true } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    ky: r.ky as KeHoachDaLuu["ky"],
    batDau: ymd(r.batDau),
    doKho: r.doKho,
    soViecTuan: r.soViecTuan,
    phanTichId: r.phanTichId,
    viec: r.viec.map((v) => ({ ...v, ngay: ymd(v.ngay) })),
    checkin: r.checkin,
  };
}

/** Kế hoạch đang chạy của cả ba kỳ — để biết tab nào đã có. */
export async function kyDangChay(giaDinhId: string): Promise<readonly KeHoachDaLuu["ky"][]> {
  const r = await db.discKeHoach.findMany({ where: { giaDinhId, trangThai: "DANG_CHAY" }, select: { ky: true } });
  return r.map((x) => x.ky as KeHoachDaLuu["ky"]);
}

const NGAY_TOI_DA_DIA_DIEM = 180;

const diaDiemSchema = z.object({ ten: z.string(), diaChi: z.string(), nguon: z.string().optional(), ngayKiem: z.string().optional() });

/** Thư viện hoạt động: CHỈ dòng `DA_KIEM`. Địa điểm chỉ hiện khi đã kiểm trong 180 ngày gần nhất; quá hạn ⇒ vẫn dùng hoạt động nhưng KHÔNG kèm địa điểm. */
export async function docHoatDongDaKiem(homNay: Date): Promise<readonly HoatDongDaKiem[]> {
  const ds = await db.discHoatDong.findMany({
    where: { trangThai: "DA_KIEM" },
    orderBy: { createdAt: "asc" },
    select: { id: true, loai: true, moTa: true, phut: true, chiPhi: true, diaDiem: true },
    take: 50,
  });
  const hom = ngayVN(homNay);
  return ds.map((h): HoatDongDaKiem => {
    const p = diaDiemSchema.safeParse(h.diaDiem);
    const conHan = p.success && !!p.data.ngayKiem && soNgayGiua(p.data.ngayKiem.slice(0, 10), hom) <= NGAY_TOI_DA_DIA_DIEM && soNgayGiua(p.data.ngayKiem.slice(0, 10), hom) >= 0;
    return { id: h.id, loai: h.loai, moTa: h.moTa, phut: h.phut, chiPhi: h.chiPhi, diaDiem: p.success && conHan ? { ten: p.data.ten, diaChi: p.data.diaChi } : null };
  });
}

export async function docBanNhap(giaDinhId: string, thanhVienId: string, cachLam: CachLam) {
  return db.discBanNhap.findFirst({
    where: { giaDinhId, thanhVienId, cachLam },
    select: { id: true, ve: true, traLoi: true, boDe: true, updatedAt: true },
  });
}

/** Các bản nháp đang dở của cả nhà (để hiện «Còn bản nháp» ở thẻ thành viên). */
export async function docCacBanNhap(giaDinhId: string) {
  return db.discBanNhap.findMany({ where: { giaDinhId }, select: { thanhVienId: true, cachLam: true, traLoi: true, boDe: true, updatedAt: true } });
}


/** Với mỗi kế hoạch đang chạy: nó dựa trên bản phân tích nào (để biết có «kết quả mới hơn» không). */
export async function phanTichCuaKeHoachDangChay(giaDinhId: string): Promise<readonly { readonly ky: KeHoachDaLuu["ky"]; readonly phanTichId: string | null }[]> {
  const r = await db.discKeHoach.findMany({ where: { giaDinhId, trangThai: "DANG_CHAY" }, select: { ky: true, phanTichId: true } });
  return r.map((x) => ({ ky: x.ky as KeHoachDaLuu["ky"], phanTichId: x.phanTichId }));
}
