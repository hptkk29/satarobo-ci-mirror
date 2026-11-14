import "server-only";
/**
 * GHI SỔ GIA ĐÌNH DISC — mọi phép ghi của cổng phụ huynh.
 *
 * LUẬT (doc 18, mục 8–9):
 *  · `userId` LẤY TỪ PHIÊN (action truyền vào), không bao giờ từ input. Mọi hàm bắt đầu bằng `laySoCuaChu(userId)`:
 *    không có sổ / sổ của người khác ≡ cùng kết quả KHONG_CO_SO (chống IDOR).
 *  · Mọi id con (thành viên, việc, kế hoạch) được tìm KÈM `giaDinhId` của sổ ấy — id lạ ≡ KHONG_TIM_THAY.
 *  · Cổng đứng TRƯỚC phép ghi đầu tiên; từ chối trong giao dịch = `throw`, không `return` sau khi đã ghi.
 *  · Ghi bài + nối lịch sử «đã thấy» + xoá bản nháp trong MỘT giao dịch (ghi bài mà quên lịch sử ⇒ lần sau gặp lại đúng câu cũ).
 *  · Audit KHÔNG chứa tên / năm sinh / điểm — chỉ id và số lượng.
 *  · Không `scopedDb`: bảng DISC không theo cơ sở; không centerId.
 */
import { createHash, randomUUID } from "node:crypto";

import { coHoiLop, laTreEm } from "@/lib/disc/engine-goc/config/disc-gia-dinh";
import { chonBaiPhaiXoa } from "@/lib/disc/engine-goc/modules/core/gia-dinh/han-muc";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { bacHocTuNamSinh } from "@/lib/disc/ho-so";
import { layKhoaDisc } from "@/lib/disc/phone-key";

import { CAU_LOI_NOP, dePhatRaTuVe, nganHangDangBat, nopBaiChoThanhVien, phatDeChoThanhVien } from "./bai-lam";
import { nhanTuKieu, tangBaoCaoMo } from "./chi-so";
import { boDeChoBai, CAU_LY_DO_CHAN, tuoiTuNamSinh, type LyDoChanBai } from "./dinh-tuyen-bai";
import { baiTuHang, chiSoCuaVai, docBanNhap, docHoatDongDaKiem, docPhanTichMoiNhat, docSo, laySoCuaChu, thanhVienTuHang, vaiTuChiSo, type SoGiaDinh } from "./doc";
import { hoSoCaNha } from "./ho-so-dang-dung";
import {
  choPhepTick,
  CAU_KHONG_TICK,
  dieuChinhTuanSau,
  nguoiNhanChinh,
  sinhKeHoach,
  SO_NGAY_KY,
  tuanCuaNgay,
  type KetQuaTuan,
  type KyKeHoach,
} from "./ke-hoach";
import { congNgay, ngayVN, soNgayGiua, type CachLam } from "./kieu";
import { dungBanChup, type BanChup, type NguoiChup } from "./phan-tich";
import { bamPin, dangKhoaPin, kiemPin, sauLanSai } from "./pin";
import {
  SO_THANH_VIEN_TOI_DA_SO,
  checkinSchema,
  luuNhapSchema,
  nopBaiSchema,
  phatDeSchema,
  pinSchema,
  taoKeHoachSchema,
  taoSoSchema,
  thanhVienSchema,
  viecSchema,
  xoaThanhVienSchema,
} from "./validators";

/* ── Kết quả chung ────────────────────────────────────────────────────────── */

export type MaLoi =
  | "KHONG_CO_SO"
  | "DA_CO_SO"
  | "KHONG_TIM_THAY"
  | "DU_LIEU_KHONG_HOP_LE"
  | "DAY_THANH_VIEN"
  | "KHONG_XOA_DUOC_CHU_SO"
  | "HOC_VIEN_KHONG_THUOC_TAI_KHOAN"
  | "HOC_VIEN_DA_NOI"
  | "KHONG_CO_BO_DE"
  | "QUA_NHIEU_BAI"
  | "NHAP_KHONG_KHOP"
  | "CHUA_DU_NGUOI"
  | "KE_HOACH_CHUA_MO"
  | "NGAY_KHONG_HOP_LE"
  | "KHONG_TICK_DUOC"
  | "CHUA_DAT_PIN"
  | "PIN_SAI"
  | "PIN_BI_KHOA"
  | "NOP_BAI_LOI";

export type Loi = { readonly ok: false; readonly loi: MaLoi; readonly thongBao: string };
/** «Không có gì thêm» — KHÔNG dùng `Record<string, never>` (giao với `{ok:true}` sẽ thành `never`). */
export type Rong = Record<never, never>;
export type Ok<T> = { readonly ok: true } & T;
export type KetQua<T> = Ok<T> | Loi;

const loi = (ma: MaLoi, thongBao: string): Loi => ({ ok: false, loi: ma, thongBao });
const KHONG_SO = loi("KHONG_CO_SO", "Chưa có sổ gia đình.");
const SAI_DAU_VAO = (m = "Thông tin chưa hợp lệ.") => loi("DU_LIEU_KHONG_HOP_LE", m);
const TEN_AUDIT = "Phụ huynh (sổ DISC)";

const namVN = (d: Date) => Number(ngayVN(d).slice(0, 4));
export const TRAN_BAI_MOI_NGUOI_MOI_NAM = 24;

function audit(userId: string, entityType: string, entityId: string, action: string, newValues: Record<string, unknown>, tx?: Prisma.TransactionClient) {
  return writeAudit({ actor: { id: userId, name: TEN_AUDIT }, module: "disc", entityType, entityId, action, newValues, tx });
}

/* ── 1. Tạo sổ ────────────────────────────────────────────────────────────── */

export function lopTuNamSinh(namSinh: number | null, bayGio: Date): string | null {
  if (namSinh === null) return null;
  const b = bacHocTuNamSinh(namSinh, bayGio);
  return b === null ? null : b === "MN" ? "mam-non" : b;
}

export async function taoSo(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<{ giaDinhId: string; soGoiY: number }>> {
  const p = taoSoSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO(p.error.issues[0]?.message);
  if (await laySoCuaChu(userId)) return loi("DA_CO_SO", "Tài khoản này đã có sổ gia đình.");
  const d = p.data;

  const hocVien = d.goiYHocVien === false ? [] : await db.student.findMany({
    where: { parentUserId: userId, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, dateOfBirth: true, currentGrade: true },
    take: SO_THANH_VIEN_TOI_DA_SO - 1,
  });

  try {
    const so = await db.$transaction(async (tx) => {
      const g = await tx.discGiaDinh.create({
        data: { ownerUserId: userId, ten: d.tenGiaDinh?.trim() || "Gia đình" },
        select: { id: true },
      });
      await tx.discThanhVien.create({
        data: { giaDinhId: g.id, ten: d.tenChuSo, vaiTro: chiSoCuaVai(d.vaiTroChuSo), namSinh: d.namSinhChuSo ?? null, thuTu: 0, laChuSo: true },
      });
      let thuTu = 1;
      for (const h of hocVien) {
        const ns = h.dateOfBirth ? namVN(h.dateOfBirth) : null;
        const lop = lopTuNamSinh(ns, bayGio) ?? (h.currentGrade !== null && h.currentGrade >= 1 && h.currentGrade <= 12 ? String(h.currentGrade) : null);
        await tx.discThanhVien.create({
          data: { giaDinhId: g.id, ten: h.name.trim().slice(0, 30) || "Con", vaiTro: chiSoCuaVai("con"), lop, namSinh: ns, thuTu, studentId: h.id },
        });
        thuTu += 1;
      }
      await audit(userId, "DiscGiaDinh", g.id, "disc.so.tao", { soThanhVien: 1 + hocVien.length }, tx);
      return g.id;
    });
    return { ok: true, giaDinhId: so, soGoiY: hocVien.length };
  } catch (e) {
    // Hai lần bấm gần nhau: ràng buộc UNIQUE(ownerUserId) giữ đúng một sổ.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") return loi("DA_CO_SO", "Tài khoản này đã có sổ gia đình.");
    throw e;
  }
}

/* ── 2. Thành viên ────────────────────────────────────────────────────────── */

export async function luuThanhVien(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<{ id: string; moi: boolean }>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = thanhVienSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO(p.error.issues[0]?.message);
  const d = p.data;

  const hienCo = await db.discThanhVien.findMany({
    where: { giaDinhId: so.id, deletedAt: null },
    select: { id: true, laChuSo: true, studentId: true, thuTu: true },
  });
  const dangSua = d.id ? hienCo.find((t) => t.id === d.id) : undefined;
  if (d.id && !dangSua) return loi("KHONG_TIM_THAY", "Không tìm thấy thành viên.");
  if (!d.id && hienCo.length >= SO_THANH_VIEN_TOI_DA_SO) return loi("DAY_THANH_VIEN", `Sổ gia đình có tối đa ${SO_THANH_VIEN_TOI_DA_SO} thành viên.`);

  // Chủ sổ là người lớn đăng nhập: không đổi thành «con» / «anh chị em».
  if (dangSua?.laChuSo && coHoiLop(d.vaiTro)) return SAI_DAU_VAO("Chủ sổ là người lớn đang đăng nhập nên không đặt vai «con».");

  // Chỉ vai còn đi học mới có lớp; chưa khai lớp mà có năm sinh thì suy lớp theo năm học (KHÔNG suy tuổi từ lớp).
  const lop = coHoiLop(d.vaiTro) ? (d.lop ?? lopTuNamSinh(d.namSinh ?? null, bayGio)) : null;

  let studentId: string | null = null;
  if (d.studentId) {
    const hs = await db.student.findFirst({ where: { id: d.studentId, parentUserId: userId, deletedAt: null }, select: { id: true } });
    if (!hs) return loi("HOC_VIEN_KHONG_THUOC_TAI_KHOAN", "Không tìm thấy học viên này trong tài khoản của bạn.");
    if (hienCo.some((t) => t.studentId === hs.id && t.id !== d.id)) return loi("HOC_VIEN_DA_NOI", "Học viên này đã là một thành viên của sổ.");
    studentId = hs.id;
  }

  if (dangSua) {
    await db.discThanhVien.update({
      where: { id: dangSua.id },
      data: { ten: d.ten, vaiTro: chiSoCuaVai(d.vaiTro), lop, namSinh: d.namSinh ?? null, ghiChu: d.ghiChu ?? null, studentId },
    });
    await audit(userId, "DiscThanhVien", dangSua.id, "disc.thanhvien.sua", {});
    return { ok: true, id: dangSua.id, moi: false };
  }
  const thuTu = hienCo.reduce((m, t) => Math.max(m, t.thuTu), 0) + 1;
  const moi = await db.discThanhVien.create({
    data: { giaDinhId: so.id, ten: d.ten, vaiTro: chiSoCuaVai(d.vaiTro), lop, namSinh: d.namSinh ?? null, ghiChu: d.ghiChu ?? null, studentId, thuTu },
    select: { id: true },
  });
  await audit(userId, "DiscThanhVien", moi.id, "disc.thanhvien.them", {});
  return { ok: true, id: moi.id, moi: true };
}

export async function xoaThanhVien(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<{ daXoaBai: number; daGiuBai: number }>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = xoaThanhVienSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO("Hãy chọn giữ hay xoá các lần làm bài của thành viên này.");
  const tv = await db.discThanhVien.findFirst({ where: { id: p.data.id, giaDinhId: so.id, deletedAt: null }, select: { id: true, laChuSo: true } });
  if (!tv) return loi("KHONG_TIM_THAY", "Không tìm thấy thành viên.");
  if (tv.laChuSo) return loi("KHONG_XOA_DUOC_CHU_SO", "Không xoá được chính chủ sổ.");

  const ket = await db.$transaction(async (tx) => {
    const soBai = await tx.discBaiLam.count({ where: { giaDinhId: so.id, thanhVienId: tv.id } });
    if (p.data.cheDo === "xoa-bai") {
      await tx.discBaiLam.deleteMany({ where: { giaDinhId: so.id, thanhVienId: tv.id } });
      // Bản phân tích đã chụp có điểm của người này ⇒ xoá cùng (rút dữ liệu thì rút cả bản chụp).
      const bans = await tx.discPhanTich.findMany({ where: { giaDinhId: so.id }, select: { id: true, noiDung: true } });
      const chua = bans.filter((b) => JSON.stringify(b.noiDung).includes(`"id":"${tv.id}"`)).map((b) => b.id);
      if (chua.length > 0) await tx.discPhanTich.deleteMany({ where: { id: { in: chua }, giaDinhId: so.id } });
    }
    // Hàng của thành viên (lịch sử «đã thấy», bản nháp, việc, check-in) xoá theo ON DELETE CASCADE; bài giữ lại thì thanhVienId → NULL.
    await tx.discThanhVien.delete({ where: { id: tv.id } });
    await audit(userId, "DiscThanhVien", tv.id, "disc.thanhvien.xoa", { cheDo: p.data.cheDo, soBai }, tx);
    return soBai;
  });

  // Báo cáo cả nhà tính lại với những người còn lại (không để bản cũ còn tên người đã rời đi là bản mới nhất).
  await chayPhanTich(userId, bayGio);
  return { ok: true, daXoaBai: p.data.cheDo === "xoa-bai" ? ket : 0, daGiuBai: p.data.cheDo === "giu-bai" ? ket : 0 };
}

/* ── 3. Làm bài ───────────────────────────────────────────────────────────── */

async function layThanhVienCuaSo(giaDinhId: string, id: string) {
  const h = await db.discThanhVien.findFirst({
    where: { id, giaDinhId, deletedAt: null },
    select: { id: true, ten: true, vaiTro: true, lop: true, namSinh: true, thuTu: true, ghiChu: true, studentId: true, laChuSo: true },
  });
  return h ? { hang: h, tv: thanhVienTuHang(h) } : null;
}

function layBo(tv: ReturnType<typeof thanhVienTuHang>, cach: CachLam, bayGio: Date) {
  return boDeChoBai({ vaiTro: tv.vaiTro, lop: tv.lop, tuoi: tuoiTuNamSinh(tv.namSinh, namVN(bayGio)) }, cach);
}

export type DeDangLam = {
  readonly boDe: string;
  readonly cauDan: string;
  readonly cauMoiMan: number;
  readonly thang: readonly { readonly gia: number; readonly nhan: string; readonly mat?: string }[];
  readonly cau: readonly { readonly viTri: number; readonly noiDung: string }[];
  readonly ve: string;
  readonly traLoi: Readonly<Record<string, number>>;
  readonly tiepTuc: boolean;
};

export async function phatDeCho(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<{ de: DeDangLam }>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = phatDeSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO();
  const t = await layThanhVienCuaSo(so.id, p.data.thanhVienId);
  if (!t) return loi("KHONG_TIM_THAY", "Không tìm thấy thành viên.");
  const bo = layBo(t.tv, p.data.cachLam, bayGio);
  if (!bo.duoc) return loi("KHONG_CO_BO_DE", CAU_LY_DO_CHAN[bo.lyDo]);
  const khoa = layKhoaDisc();

  // Còn bản nháp với vé còn hạn, cùng bộ đề ⇒ làm TIẾP đúng đề đã phát.
  const nhap = await docBanNhap(so.id, t.tv.id, p.data.cachLam);
  if (nhap && nhap.boDe === bo.boDe) {
    const lai = dePhatRaTuVe({ ve: nhap.ve, thanhVienId: t.tv.id, khoa, bayGio });
    if (lai.ok) {
      const tl = nhap.traLoi && typeof nhap.traLoi === "object" && !Array.isArray(nhap.traLoi) ? (nhap.traLoi as Record<string, number>) : {};
      return { ok: true, de: { ...lai.de, traLoi: tl, tiepTuc: true } };
    }
  }

  const daThay = await db.discCauDaThay.findMany({ where: { thanhVienId: t.tv.id }, orderBy: [{ lanDau: "asc" }, { maCau: "asc" }], select: { maCau: true } });
  const de = phatDeChoThanhVien({
    boDe: bo.boDe,
    thanhVienId: t.tv.id,
    daThay: daThay.map((x) => x.maCau),
    hat: randomUUID(),
    khoa,
    bayGio,
    dungNganHang: nganHangDangBat(),
  });
  await db.discBanNhap.upsert({
    where: { thanhVienId_cachLam: { thanhVienId: t.tv.id, cachLam: p.data.cachLam } },
    create: { giaDinhId: so.id, thanhVienId: t.tv.id, cachLam: p.data.cachLam, boDe: bo.boDe, ve: de.ve, traLoi: {} },
    update: { boDe: bo.boDe, ve: de.ve, traLoi: {} },
  });
  return { ok: true, de: { ...de, traLoi: {}, tiepTuc: false } };
}

export async function luuNhap(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<{ daLam: number }>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = luuNhapSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO();
  const t = await layThanhVienCuaSo(so.id, p.data.thanhVienId);
  if (!t) return loi("KHONG_TIM_THAY", "Không tìm thấy thành viên.");
  const nhap = await docBanNhap(so.id, t.tv.id, p.data.cachLam);
  if (!nhap || nhap.ve !== p.data.ve) return loi("NHAP_KHONG_KHOP", "Bản nháp không khớp phiên làm bài. Hãy mở lại bài.");
  const lai = dePhatRaTuVe({ ve: p.data.ve, thanhVienId: t.tv.id, khoa: layKhoaDisc(), bayGio });
  if (!lai.ok) return loi("NHAP_KHONG_KHOP", "Phiên làm bài đã hết hạn. Hãy mở lại bài.");
  const toiDa = lai.de.thang.reduce((m, x) => Math.max(m, x.gia), 0);
  const sach: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.data.traLoi)) {
    if (Number(k) >= lai.de.cau.length || v < 1 || v > toiDa) return SAI_DAU_VAO("Câu trả lời không hợp lệ.");
    sach[k] = v;
  }
  await db.discBanNhap.update({ where: { id: nhap.id }, data: { traLoi: sach } });
  return { ok: true, daLam: Object.keys(sach).length };
}

export type KetQuaNopBaiSo = {
  readonly baiId: string;
  readonly thanhVienId: string;
  readonly ten: string;
  readonly cachLam: CachLam;
  readonly boDe: string;
  readonly nhan: string;
  readonly diem: Readonly<Record<"D" | "I" | "S" | "C", number>>;
  /** Điểm lần trước CÙNG bộ đề + CÙNG phiên bản (so trực tiếp được); null nếu lần đầu hoặc khác phiên bản. */
  readonly truoc: Readonly<Record<"D" | "I" | "S" | "C", number>> | null;
  readonly daCoPhanTich: boolean;
};

export async function nopBaiSo(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<KetQuaNopBaiSo>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = nopBaiSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO();
  const t = await layThanhVienCuaSo(so.id, p.data.thanhVienId);
  if (!t) return loi("KHONG_TIM_THAY", "Không tìm thấy thành viên.");
  const bo = layBo(t.tv, p.data.cachLam, bayGio);
  if (!bo.duoc) return loi("KHONG_CO_BO_DE", CAU_LY_DO_CHAN[bo.lyDo]);

  const kq = nopBaiChoThanhVien({ ve: p.data.ve, theoViTri: p.data.traLoi, thanhVienId: t.tv.id, boDeMongDoi: bo.boDe, khoa: layKhoaDisc(), bayGio });
  if (!kq.ok) return loi("NOP_BAI_LOI", CAU_LOI_NOP[kq.lyDo]);

  // Trần chống lạm dụng: 24 bài/người/năm. Vượt thì HỎI xoá bớt — không tự xoá.
  const mocNam = new Date(bayGio.getTime() - 365 * 86_400_000);
  const baiTrongNam = await db.discBaiLam.findMany({ where: { giaDinhId: so.id, thanhVienId: t.tv.id, createdAt: { gte: mocNam } }, select: { id: true, createdAt: true } });
  if (baiTrongNam.length >= TRAN_BAI_MOI_NGUOI_MOI_NAM) {
    const deXuat = chonBaiPhaiXoa(baiTrongNam.map((b) => ({ id: b.id, ketThuc: b.createdAt.toISOString() })), TRAN_BAI_MOI_NGUOI_MOI_NAM, 1);
    return loi("QUA_NHIEU_BAI", `Đã đủ ${TRAN_BAI_MOI_NGUOI_MOI_NAM} lần làm trong 12 tháng. Hãy xoá bớt lần làm cũ nhất (${deXuat.length} lần) rồi làm tiếp.`);
  }

  const maDe = createHash("sha256").update(kq.maCau.join("|")).digest("hex");
  const baiId = await db.$transaction(async (tx) => {
    const b = await tx.discBaiLam.create({
      data: {
        giaDinhId: so.id,
        thanhVienId: t.tv.id,
        tenLuc: t.tv.ten,
        boDe: kq.boDe,
        phienBanBoDe: kq.phienBanBoDe,
        cachLam: p.data.cachLam,
        nguoiTraLoiId: userId,
        diem: kq.ketQua.diem,
        kieu: kq.ketQua.kieu as unknown as Prisma.InputJsonValue,
        canhBao: [...kq.ketQua.canhBao],
        maDe,
      },
      select: { id: true },
    });
    // Nối mã câu vào lịch sử «đã thấy» (KHÔNG phải câu trả lời) — CÙNG giao dịch với việc ghi bài.
    await tx.discCauDaThay.createMany({ data: kq.maCau.map((m) => ({ thanhVienId: t.tv.id, maCau: m, lanDau: bayGio })), skipDuplicates: true });
    await tx.discBanNhap.deleteMany({ where: { thanhVienId: t.tv.id, cachLam: p.data.cachLam } });
    await audit(userId, "DiscBaiLam", b.id, "disc.bai.nop", { cachLam: p.data.cachLam, boDe: kq.boDe }, tx);
    return b.id;
  });

  // Mỗi lần có người làm xong, bản phân tích cả nhà được tính lại (snapshot mới; bản cũ vẫn giữ để so).
  const pt = await chayPhanTich(userId, bayGio);
  const truocRaw = await db.discBaiLam.findFirst({
    where: { giaDinhId: so.id, thanhVienId: t.tv.id, boDe: kq.boDe, phienBanBoDe: kq.phienBanBoDe, id: { not: baiId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { diem: true },
  });
  const truoc = truocRaw ? baiTuHang({ id: "", thanhVienId: null, tenLuc: "", boDe: kq.boDe, phienBanBoDe: kq.phienBanBoDe, cachLam: p.data.cachLam, diem: truocRaw.diem, kieu: { loai: "deu" }, canhBao: [], createdAt: bayGio })?.diem ?? null : null;
  return {
    ok: true,
    baiId,
    thanhVienId: t.tv.id,
    ten: t.tv.ten,
    cachLam: p.data.cachLam,
    boDe: kq.boDe,
    nhan: nhanTuKieu(kq.ketQua.kieu),
    diem: kq.ketQua.diem,
    truoc,
    daCoPhanTich: pt.ok && pt.soBan !== null,
  };
}

export async function xoaBaiLam(userId: string, baiId: unknown, bayGio: Date): Promise<KetQua<Rong>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  if (typeof baiId !== "string" || baiId.length === 0 || baiId.length > 64) return SAI_DAU_VAO();
  const b = await db.discBaiLam.findFirst({ where: { id: baiId, giaDinhId: so.id }, select: { id: true } });
  if (!b) return loi("KHONG_TIM_THAY", "Không tìm thấy lần làm này.");
  await db.$transaction(async (tx) => {
    await tx.discBaiLam.delete({ where: { id: b.id } });
    // Bản phân tích đã dùng bài này không còn đúng nữa ⇒ xoá cùng.
    await tx.discPhanTich.deleteMany({ where: { giaDinhId: so.id, maBai: { has: b.id } } });
    await audit(userId, "DiscBaiLam", b.id, "disc.bai.xoa", {}, tx);
  });
  await chayPhanTich(userId, bayGio);
  return { ok: true };
}

/* ── 4. Phân tích cả nhà ──────────────────────────────────────────────────── */

export function nguoiChupTu(so: Pick<SoGiaDinh, "thanhVien" | "bai">): NguoiChup[] {
  const hs = hoSoCaNha(so.thanhVien, so.bai);
  const kq: NguoiChup[] = [];
  for (const tv of so.thanhVien) {
    const b = hs.get(tv.id);
    if (!b) continue;
    kq.push({
      id: tv.id,
      ten: tv.ten,
      vaiTro: tv.vaiTro,
      laTre: laTreEm(tv.vaiTro, tv.lop ?? undefined),
      lop: tv.lop,
      diem: b.diem,
      kieu: b.kieu,
      qua: b.cachLam,
      baiId: b.id,
      phienBanBoDe: b.phienBanBoDe,
    });
  }
  return kq;
}

const GIU_BAN_PHAN_TICH = 5;

export async function chayPhanTich(userId: string, _bayGio: Date): Promise<KetQua<{ soBan: number | null; moi: boolean }>> {
  const so = await docSo(userId);
  if (!so) return KHONG_SO;
  const nguoi = nguoiChupTu(so).slice(0, 6);
  const r = dungBanChup(nguoi);
  if (!r.ok) return { ok: true, soBan: null, moi: false };

  const moiNhat = await docPhanTichMoiNhat(so.id);
  const dau = (n: readonly NguoiChup[]) => JSON.stringify(n.map((x) => [x.id, x.baiId, x.ten, x.vaiTro, x.lop, x.laTre]));
  if (moiNhat && dau(moiNhat.chup.nguoi) === dau(nguoi)) return { ok: true, soBan: moiNhat.soBan, moi: false };

  const soBan = await db.$transaction(async (tx) => {
    const cuoi = await tx.discPhanTich.findFirst({ where: { giaDinhId: so.id }, orderBy: { soBan: "desc" }, select: { soBan: true } });
    const sb = (cuoi?.soBan ?? 0) + 1;
    const moi = await tx.discPhanTich.create({
      data: { giaDinhId: so.id, soBan: sb, maBai: nguoi.map((n) => n.baiId), noiDung: r.chup as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
    const dsCu = await tx.discPhanTich.findMany({ where: { giaDinhId: so.id }, orderBy: { soBan: "desc" }, select: { id: true } });
    const bo = dsCu.slice(GIU_BAN_PHAN_TICH).map((x) => x.id);
    if (bo.length > 0) await tx.discPhanTich.deleteMany({ where: { id: { in: bo }, giaDinhId: so.id } });
    await audit(userId, "DiscPhanTich", moi.id, "disc.phantich.chay", { soBan: sb, soNguoi: nguoi.length }, tx);
    return sb;
  });
  return { ok: true, soBan, moi: true };
}

/* ── 5. Kế hoạch ──────────────────────────────────────────────────────────── */

function paceVoiSo(so: SoGiaDinh): { soTuLam: number; soCoHoSo: number } {
  const hs = hoSoCaNha(so.thanhVien, so.bai);
  let tuLam = 0;
  let co = 0;
  for (const b of hs.values()) {
    if (!b) continue;
    co += 1;
    if (b.cachLam === "TU_LAM") tuLam += 1;
  }
  return { soTuLam: tuLam, soCoHoSo: co };
}

export async function taoKeHoach(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<{ keHoachId: string; soViec: number }>> {
  const p = taoKeHoachSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO();
  const so = await docSo(userId);
  if (!so) return KHONG_SO;
  const homNay = ngayVN(bayGio);
  const cach = soNgayGiua(homNay, p.data.batDau);
  if (Number.isNaN(cach) || cach < 0 || cach > 31) return loi("NGAY_KHONG_HOP_LE", "Ngày bắt đầu phải từ hôm nay tới 31 ngày sau.");

  const { soTuLam, soCoHoSo } = paceVoiSo(so);
  const tang = tangBaoCaoMo(soTuLam, soCoHoSo, so.thanhVien.length);
  const mo = p.data.ky === "NGAY_7" ? tang.ke7 : p.data.ky === "THANG_1" ? tang.ke30 : tang.ke365;
  if (!mo) return loi("KE_HOACH_CHUA_MO", "Kế hoạch này chưa mở — cần thêm người làm bài.");

  // Dùng bản phân tích mới nhất; chưa có thì tính ngay.
  await chayPhanTich(userId, bayGio);
  const pt = await docPhanTichMoiNhat(so.id);
  if (!pt) return loi("CHUA_DU_NGUOI", "Cần ít nhất hai người đã có kết quả.");

  const hoatDong = await docHoatDongDaKiem(bayGio);
  const viec = sinhKeHoach({ chup: pt.chup, ky: p.data.ky, batDau: p.data.batDau, doKho: 1, soViecTuan: 7, hoatDong });

  const id = await db.$transaction(async (tx) => {
    await tx.discKeHoach.updateMany({ where: { giaDinhId: so.id, ky: p.data.ky, trangThai: "DANG_CHAY" }, data: { trangThai: "HUY" } });
    const kh = await tx.discKeHoach.create({
      data: { giaDinhId: so.id, phanTichId: pt.id, ky: p.data.ky, batDau: new Date(`${p.data.batDau}T00:00:00.000Z`) },
      select: { id: true },
    });
    if (viec.length > 0) {
      await tx.discViec.createMany({
        data: viec.map((v) => ({
          keHoachId: kh.id,
          nguoiLamId: v.nguoiLamId,
          nguoiNhanId: v.nguoiNhanId,
          ngay: new Date(`${v.ngay}T00:00:00.000Z`),
          nguon: v.nguon,
          noiDung: v.noiDung,
          phut: v.phut,
          hoatDongId: v.hoatDongId,
        })),
      });
    }
    await audit(userId, "DiscKeHoach", kh.id, "disc.kehoach.tao", { ky: p.data.ky, soViec: viec.length }, tx);
    return kh.id;
  });
  return { ok: true, keHoachId: id, soViec: viec.length };
}

async function layViecCuaSo(giaDinhId: string, viecId: string) {
  return db.discViec.findFirst({
    where: { id: viecId, keHoach: { giaDinhId, trangThai: "DANG_CHAY" } },
    select: { id: true, ngay: true, xongLuc: true, camOnLuc: true, nguoiNhanId: true, keHoachId: true },
  });
}

export async function tickViec(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<Rong>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = viecSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO();
  const v = await layViecCuaSo(so.id, p.data.viecId);
  if (!v) return loi("KHONG_TIM_THAY", "Không tìm thấy việc này.");
  const c = choPhepTick(v.ngay.toISOString().slice(0, 10), ngayVN(bayGio), v.xongLuc !== null);
  if (!c.duoc) return loi("KHONG_TICK_DUOC", CAU_KHONG_TICK[c.lyDo]);
  // Cập nhật CÓ ĐIỀU KIỆN (xongLuc còn null): hai lần bấm đồng thời chỉ ghi một lần.
  const r = await db.discViec.updateMany({ where: { id: v.id, xongLuc: null }, data: { xongLuc: bayGio, nguoiTick: userId } });
  if (r.count === 0) return loi("KHONG_TICK_DUOC", CAU_KHONG_TICK.DA_TICK);
  return { ok: true };
}

export async function camOnViec(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<Rong>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = viecSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO();
  const v = await layViecCuaSo(so.id, p.data.viecId);
  if (!v) return loi("KHONG_TIM_THAY", "Không tìm thấy việc này.");
  if (v.xongLuc === null || v.nguoiNhanId === null) return loi("KHONG_TICK_DUOC", "Chỉ cảm ơn được việc đã làm và có người nhận.");
  const r = await db.discViec.updateMany({ where: { id: v.id, camOnLuc: null }, data: { camOnLuc: bayGio } });
  if (r.count === 0) return loi("KHONG_TICK_DUOC", "Đã cảm ơn việc này rồi.");
  return { ok: true };
}

/** Kết quả từng tuần của một kế hoạch (để tự điều chỉnh). */
export function ketQuaCacTuan(
  kh: { batDau: string; ky: KyKeHoach; viec: readonly { ngay: string; nguoiLamId: string | null; xongLuc: Date | null }[]; checkin: readonly { thanhVienId: string; tuan: number; diem: number }[] },
): KetQuaTuan[] {
  const soNgay = SO_NGAY_KY[kh.ky];
  const tuans = [...new Set(kh.checkin.map((c) => c.tuan))].sort((a, b) => a - b);
  return tuans.map((t) => {
    const viecTuan = kh.viec.filter((v) => v.nguoiLamId !== null && tuanCuaNgay(kh.batDau, v.ngay, soNgay) === t);
    const xong = viecTuan.filter((v) => v.xongLuc !== null).length;
    const ds = kh.checkin.filter((c) => c.tuan === t);
    const theoNguoi: Record<string, number> = {};
    for (const c of ds) theoNguoi[c.thanhVienId] = c.diem;
    return {
      tuan: t,
      tyLeHoanThanh: viecTuan.length === 0 ? null : xong / viecTuan.length,
      diemTrungBinh: ds.length === 0 ? null : ds.reduce((s, c) => s + c.diem, 0) / ds.length,
      diemTheoNguoi: theoNguoi,
    };
  });
}

export async function luuCheckin(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<{ lyDo: readonly string[]; soViecTuan: number; doKho: number; them1_1: number }>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = checkinSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO();
  const kh = await db.discKeHoach.findFirst({
    where: { id: p.data.keHoachId, giaDinhId: so.id, trangThai: "DANG_CHAY" },
    select: { id: true, ky: true, batDau: true, doKho: true, soViecTuan: true, phanTichId: true },
  });
  if (!kh) return loi("KHONG_TIM_THAY", "Không tìm thấy kế hoạch.");
  const batDau = kh.batDau.toISOString().slice(0, 10);
  const homNay = ngayVN(bayGio);
  const tuanHienTai = Math.floor(soNgayGiua(batDau, homNay) / 7) + 1;
  if (soNgayGiua(batDau, homNay) < 0 || p.data.tuan > tuanHienTai) return loi("NGAY_KHONG_HOP_LE", "Chưa tới tuần này.");

  const tv = await db.discThanhVien.findMany({ where: { giaDinhId: so.id, deletedAt: null }, select: { id: true } });
  const hop = new Set(tv.map((t) => t.id));
  if (!p.data.diem.every((d) => hop.has(d.thanhVienId))) return loi("KHONG_TIM_THAY", "Có thành viên không thuộc sổ.");
  if (new Set(p.data.diem.map((d) => d.thanhVienId)).size !== p.data.diem.length) return SAI_DAU_VAO();
  let cap: string | null = null;
  if (p.data.capDeChiu) {
    const [a, b] = p.data.capDeChiu;
    if (a === b || !hop.has(a) || !hop.has(b)) return loi("KHONG_TIM_THAY", "Cặp được chọn không thuộc sổ.");
    cap = a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  const ketQua = await db.$transaction(async (tx) => {
    for (const d of p.data.diem) {
      await tx.discCheckin.upsert({
        where: { keHoachId_thanhVienId_tuan: { keHoachId: kh.id, thanhVienId: d.thanhVienId, tuan: p.data.tuan } },
        create: { keHoachId: kh.id, thanhVienId: d.thanhVienId, tuan: p.data.tuan, diem: d.diem, capDeChiu: cap },
        update: { diem: d.diem, capDeChiu: cap },
      });
    }
    const [viec, checkin] = await Promise.all([
      tx.discViec.findMany({ where: { keHoachId: kh.id }, select: { ngay: true, nguoiLamId: true, xongLuc: true } }),
      tx.discCheckin.findMany({ where: { keHoachId: kh.id }, select: { thanhVienId: true, tuan: true, diem: true } }),
    ]);
    const tuans = ketQuaCacTuan({ batDau, ky: kh.ky as KyKeHoach, viec: viec.map((v) => ({ ...v, ngay: v.ngay.toISOString().slice(0, 10) })), checkin });
    // Người nhận chính cần bản chụp phân tích; thiếu ⇒ không đổi cặp nào.
    const pt = kh.phanTichId ? await tx.discPhanTich.findUnique({ where: { id: kh.phanTichId }, select: { noiDung: true } }) : null;
    const chup = pt ? (pt.noiDung as unknown as BanChup) : null;
    const nhan = (id: string) => (chup ? nguoiNhanChinh(chup, id) : null);
    const qd = dieuChinhTuanSau({ soViecTuan: kh.soViecTuan, doKho: kh.doKho }, tuans, nhan);
    await tx.discKeHoach.update({ where: { id: kh.id }, data: { soViecTuan: qd.soViecTuan, doKho: qd.doKho } });

    // Cặp bị chấm thấp hai tuần liền: thêm MỘT buổi 1-1 vào ngày kế tiếp (nếu chưa có).
    let them = 0;
    for (const k of qd.capCanThem1_1) {
      const [a, b] = k.split("|") as [string, string];
      const ngay = congNgay(homNay, 1);
      const co = await tx.discViec.findFirst({ where: { keHoachId: kh.id, nguon: `MOT_MOT_30P:${k}`, ngay: new Date(`${ngay}T00:00:00.000Z`) }, select: { id: true } });
      if (co) continue;
      await tx.discViec.create({
        data: { keHoachId: kh.id, nguoiLamId: a, nguoiNhanId: b, ngay: new Date(`${ngay}T00:00:00.000Z`), nguon: `MOT_MOT_30P:${k}`, noiDung: "Một buổi 1-1, 30 phút, chỉ hai người — không bàn bài vở hay việc nhà.", phut: 30 },
      });
      them += 1;
    }
    await audit(userId, "DiscKeHoach", kh.id, "disc.kehoach.checkin", { tuan: p.data.tuan, soNguoi: p.data.diem.length }, tx);
    return { qd, them };
  });
  return { ok: true, lyDo: ketQua.qd.lyDo, soViecTuan: ketQua.qd.soViecTuan, doKho: ketQua.qd.doKho, them1_1: ketQua.them };
}

/* ── 6. PIN chế độ trẻ em ─────────────────────────────────────────────────── */

export async function datPin(userId: string, raw: unknown): Promise<KetQua<Rong>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = pinSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO(p.error.issues[0]?.message);
  await db.discGiaDinh.update({ where: { id: so.id }, data: { pinHash: bamPin(p.data.pin), pinSai: 0, pinKhoaDen: null } });
  await audit(userId, "DiscGiaDinh", so.id, "disc.pin.dat", {});
  return { ok: true };
}

export async function xacNhanPin(userId: string, raw: unknown, bayGio: Date): Promise<KetQua<Rong>> {
  const so = await laySoCuaChu(userId);
  if (!so) return KHONG_SO;
  const p = pinSchema.safeParse(raw);
  if (!p.success) return SAI_DAU_VAO(p.error.issues[0]?.message);
  const g = await db.discGiaDinh.findUnique({ where: { id: so.id }, select: { pinHash: true, pinSai: true, pinKhoaDen: true } });
  if (!g?.pinHash) return loi("CHUA_DAT_PIN", "Chưa đặt mã PIN.");
  if (dangKhoaPin({ pinSai: g.pinSai, khoaDen: g.pinKhoaDen }, bayGio)) return loi("PIN_BI_KHOA", "Nhập sai nhiều lần. Thử lại sau 15 phút.");
  if (kiemPin(p.data.pin, g.pinHash)) {
    if (g.pinSai !== 0 || g.pinKhoaDen) await db.discGiaDinh.update({ where: { id: so.id }, data: { pinSai: 0, pinKhoaDen: null } });
    return { ok: true };
  }
  const t = sauLanSai({ pinSai: g.pinSai, khoaDen: g.pinKhoaDen }, bayGio);
  await db.discGiaDinh.update({ where: { id: so.id }, data: { pinSai: t.pinSai, pinKhoaDen: t.khoaDen } });
  return loi("PIN_SAI", t.khoaDen ? "Nhập sai nhiều lần. Thử lại sau 15 phút." : "Mã PIN chưa đúng.");
}

export { baiTuHang, vaiTuChiSo, type LyDoChanBai };
