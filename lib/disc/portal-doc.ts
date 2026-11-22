import "server-only";
import { db } from "@/lib/db";
import { ketQuaNguoiSchema } from "./luu";
import { dungBaoCaoHtml, type BaoCao } from "./tai-bao-cao";

/**
 * NƠI DUY NHẤT cổng phụ huynh (`app/(portal)/portal/disc/**`) đọc bảng `Disc*`.
 * `app/(portal)` cấm import `@/lib/db` trần (ESLint error) — mọi truy vấn đi qua đây.
 *
 * Quyền đọc = `claimedUserId === userId` (id người đăng nhập, lấy từ PHIÊN) ∧ `claimStatus = CLAIMED` ∧ chưa xoá.
 * KHÔNG BAO GIỜ theo SĐT / `phoneKey`: ai cũng gõ được SĐT người khác ở màn Lưu (xem 03-data-model §4).
 * Id lạ, id của user khác, bài chưa nhận, bài đã xoá ⇒ cùng một kết quả `null` (không oracle).
 *
 * `select` liệt kê TỪNG cột được đọc — không có `phoneKey`, `claimCodeHash`, `claimAttempts`, `downloadTokenHash`,
 * `emailTo`, `emailVerifyTokenHash`, `leadId`, `reportSnapshot`. Kiểu trả về cũng không có chỗ cho chúng.
 * ⚠️ Chứa dữ liệu cá nhân của trẻ: không log nội dung.
 */

export const MOI_TRANG_MAC_DINH = 10;
export const TOI_DA_LUOT_LICH_SU = 100;

export type NguoiTrongLuot = {
  vaiTro: "PHU_HUYNH" | "HOC_SINH";
  hoTen: string;
  namSinh: number;
  bacHoc: string | null;
  nguoiLonQuanSat: boolean;
  /** `null` nếu `result` của người này không đọc được (hỏng/đã tẩy) — giao diện nói thật, không bịa số 0. */
  diem: { D: number; I: number; S: number; C: number } | null;
  maBoDe: string | null;
  phienBanBoDe: string | null;
};

export type LuotDisc = {
  id: string;
  taoLuc: Date;
  engineVersion: string;
  nguoi: NguoiTrongLuot[];
};

export type TrangLuot = { luot: LuotDisc[]; tong: number; trang: number; tongTrang: number; moiTrang: number };

const SELECT_LUOT = {
  id: true,
  createdAt: true,
  engineVersion: true,
  subjects: {
    select: { role: true, fullName: true, birthYear: true, grade: true, observedByAdult: true, result: true },
    orderBy: { role: "asc" },
  },
} as const;

type DongLuot = {
  id: string;
  createdAt: Date;
  engineVersion: string;
  subjects: Array<{ role: string; fullName: string; birthYear: number; grade: string | null; observedByAdult: boolean; result: unknown }>;
};

/** Điều kiện quyền đọc — MỘT chỗ. Mọi truy vấn của tệp này bắt đầu từ đây. */
function dieuKienCuaToi(userId: string) {
  return { claimedUserId: userId, claimStatus: "CLAIMED" as const, deletedAt: null };
}

export function dungLuot(r: DongLuot): LuotDisc {
  const nguoi = r.subjects
    .filter((s) => s.role === "PARENT" || s.role === "STUDENT")
    .map((s): NguoiTrongLuot => {
      const kq = ketQuaNguoiSchema.safeParse(s.result);
      return {
        vaiTro: s.role === "PARENT" ? "PHU_HUYNH" : "HOC_SINH",
        hoTen: s.fullName,
        namSinh: s.birthYear,
        bacHoc: s.grade,
        nguoiLonQuanSat: s.observedByAdult,
        diem: kq.success ? kq.data.diem : null,
        maBoDe: kq.success ? kq.data.maBoDe : null,
        phienBanBoDe: kq.success ? kq.data.phienBanBoDe : null,
      };
    });
  return { id: r.id, taoLuc: r.createdAt, engineVersion: r.engineVersion, nguoi };
}

function soNguyenDuong(v: unknown, macDinh: number, tran: number): number {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isInteger(n) || n < 1) return macDinh;
  return Math.min(n, tran);
}

/** Danh sách lượt đã nhận của người đăng nhập, mới nhất trước, phân trang. */
export async function docDanhSachLuot(userId: string, p: { trang?: unknown; moiTrang?: number } = {}): Promise<TrangLuot> {
  const moiTrang = soNguyenDuong(p.moiTrang, MOI_TRANG_MAC_DINH, 50);
  const where = dieuKienCuaToi(userId);
  const tong = await db.discSubmission.count({ where });
  const tongTrang = Math.max(1, Math.ceil(tong / moiTrang));
  const trang = Math.min(soNguyenDuong(p.trang, 1, 10_000), tongTrang);
  const rows = (await db.discSubmission.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (trang - 1) * moiTrang,
    take: moiTrang,
    select: SELECT_LUOT,
  })) as unknown as DongLuot[];
  return { luot: rows.map(dungLuot), tong, trang, tongTrang, moiTrang };
}

/** Chi tiết MỘT lượt — chỉ nếu thuộc `userId`. Mọi lý do không đọc được ⇒ `null`. */
export async function docChiTietLuot(userId: string, id: unknown): Promise<LuotDisc | null> {
  if (typeof id !== "string" || id.length < 1 || id.length > 64) return null;
  const r = (await db.discSubmission.findFirst({
    where: { ...dieuKienCuaToi(userId), id },
    select: SELECT_LUOT,
  })) as unknown as DongLuot | null;
  return r ? dungLuot(r) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lịch sử theo từng thành viên (THUẦN)
// ─────────────────────────────────────────────────────────────────────────────

export type DiemDisc = { D: number; I: number; S: number; C: number };

export type MocLichSu = {
  luotId: string;
  taoLuc: Date;
  diem: DiemDisc;
  maBoDe: string;
  phienBanBoDe: string;
  bacHoc: string | null;
  /** Chênh lệch so với mốc ngay trước — CHỈ khi cùng bộ đề + cùng phiên bản. Ngược lại `null` và `lyDoKhongSoSanh` nói vì sao. */
  chenhLech: DiemDisc | null;
  lyDoKhongSoSanh: "MOC_DAU" | "KHAC_BO_DE" | "KHAC_PHIEN_BAN" | null;
};

export type LichSuNguoi = {
  khoa: string;
  vaiTro: "PHU_HUYNH" | "HOC_SINH";
  hoTen: string;
  /** Cũ → mới. */
  moc: MocLichSu[];
};

export function chuanHoaTen(t: string): string {
  return t.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
}

/**
 * Gom các lượt (mọi thứ tự) thành chuỗi theo thành viên (vai + tên). So sánh hai mốc liên tiếp CHỈ khi
 * `maBoDe` và `phienBanBoDe` giống nhau; KHÔNG bao giờ tính lại điểm cũ theo phiên bản mới.
 */
export function dungLichSu(luot: readonly LuotDisc[]): LichSuNguoi[] {
  const nhom = new Map<string, { vaiTro: LichSuNguoi["vaiTro"]; hoTen: string; ds: Array<{ l: LuotDisc; n: NguoiTrongLuot }> }>();
  for (const l of luot) {
    for (const n of l.nguoi) {
      if (!n.diem || !n.maBoDe || !n.phienBanBoDe) continue;
      const khoa = `${n.vaiTro}|${chuanHoaTen(n.hoTen)}`;
      const g = nhom.get(khoa) ?? { vaiTro: n.vaiTro, hoTen: n.hoTen, ds: [] };
      g.ds.push({ l, n });
      nhom.set(khoa, g);
    }
  }
  const ra: LichSuNguoi[] = [];
  for (const [khoa, g] of nhom) {
    const ds = [...g.ds].sort((a, b) => a.l.taoLuc.getTime() - b.l.taoLuc.getTime() || a.l.id.localeCompare(b.l.id));
    const moc = ds.map(({ l, n }, i): MocLichSu => {
      const truoc = i > 0 ? ds[i - 1]!.n : null;
      let chenhLech: DiemDisc | null = null;
      let ly: MocLichSu["lyDoKhongSoSanh"] = null;
      if (!truoc) ly = "MOC_DAU";
      else if (truoc.maBoDe !== n.maBoDe) ly = "KHAC_BO_DE";
      else if (truoc.phienBanBoDe !== n.phienBanBoDe) ly = "KHAC_PHIEN_BAN";
      else {
        const a = truoc.diem!;
        const b = n.diem!;
        chenhLech = { D: b.D - a.D, I: b.I - a.I, S: b.S - a.S, C: b.C - a.C };
      }
      return {
        luotId: l.id,
        taoLuc: l.taoLuc,
        diem: n.diem!,
        maBoDe: n.maBoDe!,
        phienBanBoDe: n.phienBanBoDe!,
        bacHoc: n.bacHoc,
        chenhLech,
        lyDoKhongSoSanh: ly,
      };
    });
    // Tên hiển thị = cách viết ở lượt MỚI nhất.
    ra.push({ khoa, vaiTro: g.vaiTro, hoTen: ds[ds.length - 1]!.n.hoTen, moc });
  }
  // Phụ huynh trước, rồi học sinh; cùng vai theo tên.
  return ra.sort((a, b) => (a.vaiTro === b.vaiTro ? a.hoTen.localeCompare(b.hoTen, "vi") : a.vaiTro === "PHU_HUYNH" ? -1 : 1));
}

/** Lịch sử các lượt gần nhất (trần `TOI_DA_LUOT_LICH_SU`) của người đăng nhập. */
export async function docLichSuGiaDinh(userId: string): Promise<LichSuNguoi[]> {
  const rows = (await db.discSubmission.findMany({
    where: dieuKienCuaToi(userId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TOI_DA_LUOT_LICH_SU,
    select: SELECT_LUOT,
  })) as unknown as DongLuot[];
  return dungLichSu(rows.map(dungLuot));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tải lại báo cáo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HTML in được dựng LẠI từ điểm đã lưu (không tính lại): dùng đúng `dungBaoCaoHtml` của `tai-bao-cao.ts` nên
 * báo cáo tải lại cùng khuôn với báo cáo lần đầu. Thiếu người nào đọc được điểm thì bỏ người đó; không còn ai ⇒ `null`.
 */
export function baoCaoChoLuot(l: LuotDisc): BaoCao | null {
  const nguoi: BaoCao["nguoi"] = l.nguoi.flatMap((n) =>
    n.diem && n.maBoDe && n.phienBanBoDe
      ? [{ vaiTro: n.vaiTro, hoTen: n.hoTen, namSinh: n.namSinh, bacHoc: n.bacHoc, nguoiLonQuanSat: n.nguoiLonQuanSat, diem: n.diem, maBoDe: n.maBoDe, phienBanBoDe: n.phienBanBoDe }]
      : [],
  );
  if (nguoi.length === 0) return null;
  return { taoLuc: l.taoLuc.toISOString(), engineVersion: l.engineVersion, nguoi };
}

export function dungBaoCaoHtmlChoLuot(l: LuotDisc): string | null {
  const bc = baoCaoChoLuot(l);
  return bc ? dungBaoCaoHtml(bc) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tải dữ liệu của tôi (S-01)
// ─────────────────────────────────────────────────────────────────────────────

export type DuLieuCuaToi = {
  xuatLuc: string;
  ghiChu: string;
  luot: Array<{
    id: string;
    taoLuc: string;
    nhanLuc: string | null;
    engineVersion: string;
    phienBanDongY: string;
    dongYTiepThi: boolean;
    emailDaKhai: string | null;
    nguoi: Array<{
      vaiTro: "PHU_HUYNH" | "HOC_SINH";
      hoTen: string;
      namSinh: number;
      bacHoc: string | null;
      nguoiLonQuanSat: boolean;
      diem: { D: number; I: number; S: number; C: number } | null;
      maBoDe: string | null;
      phienBanBoDe: string | null;
    }>;
  }>;
};

/**
 * Bản xuất dữ liệu của CHÍNH người đăng nhập (quyền = `claimedUserId` từ PHIÊN, bài CLAIMED chưa xoá).
 * Gồm các trường người dùng đã nhập + điểm. KHÔNG có `phoneKey`, hash mã/token, `leadId`, `ipKey`, `payloadHash`.
 * `select` liệt kê từng cột — thêm cột nội bộ vào bảng không tự lọt ra file này.
 */
export async function docDuLieuCuaToi(userId: string, now: Date): Promise<DuLieuCuaToi> {
  const rows = await db.discSubmission.findMany({
    where: dieuKienCuaToi(userId),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 1000,
    select: { ...SELECT_LUOT, claimedAt: true, consentVersion: true, consentMarketing: true, emailTo: true },
  });
  const luot = (rows as unknown as Array<DongLuot & { claimedAt: Date | null; consentVersion: string; consentMarketing: boolean; emailTo: string | null }>).map((r) => {
    const l = dungLuot(r);
    return {
      id: l.id,
      taoLuc: l.taoLuc.toISOString(),
      nhanLuc: r.claimedAt ? r.claimedAt.toISOString() : null,
      engineVersion: l.engineVersion,
      phienBanDongY: r.consentVersion,
      dongYTiepThi: r.consentMarketing,
      emailDaKhai: r.emailTo,
      nguoi: l.nguoi,
    };
  });
  return {
    xuatLuc: now.toISOString(),
    ghiChu: "Dữ liệu DISC bạn đã nhập và điểm tính được. Không gồm mã/khoá nội bộ của hệ thống.",
    luot,
  };
}
