import "server-only";
/**
 * NẠP DỮ LIỆU CHO CÁC MÀN DISC — gom các truy vấn của `doc.ts` thành `DauVaoMan` (đầu vào thuần của `man-hinh*.ts`).
 * `userId` luôn từ PHIÊN. Không có sổ ⇒ null (màn «lập sổ»).
 */
import { NGAN_HANG } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { db } from "@/lib/db";

import { docCacBanNhap, docPhanTichMoiNhat, docSo, phanTichCuaKeHoachDangChay, type PhanTichDaLuu, type SoGiaDinh } from "./doc";
import type { DauVaoMan } from "./man-hinh";
import type { MaBoDe } from "./kieu";

export type NapMan = {
  readonly so: SoGiaDinh;
  readonly pt: PhanTichDaLuu | null;
  readonly dv: DauVaoMan;
  /** Có bản phân tích mới hơn bản mà một kế hoạch đang chạy dựa vào. */
  readonly capNhatKeHoach: boolean;
};

export async function napMan(userId: string, bayGio: Date): Promise<NapMan | null> {
  const so = await docSo(userId);
  if (!so) return null;
  const [pt, nhap, keHoach] = await Promise.all([docPhanTichMoiNhat(so.id), docCacBanNhap(so.id), phanTichCuaKeHoachDangChay(so.id)]);
  const dangNhap = new Map<string, { daLam: number; tong: number }>();
  for (const n of nhap) {
    const tl = n.traLoi && typeof n.traLoi === "object" && !Array.isArray(n.traLoi) ? Object.keys(n.traLoi as object).length : 0;
    const tong = NGAN_HANG[n.boDe as MaBoDe]?.cau.length ?? 0;
    const cu = dangNhap.get(n.thanhVienId);
    if (!cu || tl > cu.daLam) dangNhap.set(n.thanhVienId, { daLam: tl, tong });
  }
  return {
    so,
    pt,
    dv: {
      thanhVien: so.thanhVien,
      bai: so.bai,
      chup: pt?.chup ?? null,
      soBan: pt?.soBan ?? null,
      taoLucPhanTich: pt?.taoLuc ?? null,
      tenGiaDinh: so.ten,
      chuSoId: so.chuSoId,
      dangNhap,
      bayGio,
    },
    capNhatKeHoach: !!pt && keHoach.some((k) => k.phanTichId !== null && k.phanTichId !== pt.id),
  };
}

/** Học viên của tài khoản này CHƯA được nối với thành viên nào trong sổ (để chọn ở form thêm thành viên). */
export async function hocVienChuaNoi(userId: string, daNoi: readonly (string | null)[]): Promise<{ id: string; ten: string }[]> {
  const ids = daNoi.filter((x): x is string => !!x);
  const r = await db.student.findMany({
    where: { parentUserId: userId, deletedAt: null, ...(ids.length ? { id: { notIn: ids } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 12,
  });
  return r.map((s) => ({ id: s.id, ten: s.name }));
}

export async function soHocVienCua(userId: string): Promise<number> {
  return db.student.count({ where: { parentUserId: userId, deletedAt: null } });
}
