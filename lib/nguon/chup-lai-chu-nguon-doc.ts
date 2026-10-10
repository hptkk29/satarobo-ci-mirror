/**
 * lib/nguon/chup-lai-chu-nguon-doc.ts — ĐỌC «chụp lại chủ nguồn»: có bao nhiêu lead cần chụp lại, chia theo lý do. MỘT định nghĩa cho cả nút trên trang chi tiết nguồn LẪN lô ghi.
 *
 * Đếm bằng MỘT câu `GROUP BY` theo chủ đã chụp (không tải từng dòng) rồi phân loại theo `phanLoaiChuChup` — số ở nút và số lô ghi đi qua CÙNG hàm `docNhomCanChup`, nên không có
 * hai định nghĩa «cần chụp lại». Không scope theo cơ sở: nguồn là danh mục CHUNG và người bấm phải có `sources:manage` ∧ `commission_policies:activate` (cả hai chỉ vai toàn hệ thống giữ).
 * Nơi gọi PHẢI là code của module nguồn (trang chi tiết · Server Action) — đừng import từ nơi khác.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { BAN_CHUP_HOP_LE, CHU_DA_CHUP, DA_CHI_CHU_NGUON } from "./chup-lai-chu-nguon-sql";
import { kiemChuHienTai, phanLoaiChuChup, type LyDoChupLai } from "./chup-lai-chu-nguon-luat";

type Khach = PrismaClient | Prisma.TransactionClient;

export type ChuHienTaiNguon = { employeeId: string; ten: string; maNv: string | null; status: string; coTaiKhoan: boolean };

export type NhomCanChup = { chu: string | null; soLead: number; lyDo: LyDoChupLai };

/** Người phụ trách hiện tại của nguồn (hoặc `null` nếu nguồn không tồn tại / chưa khai). */
export async function docChuHienTai(client: Khach, nguonId: string): Promise<{ tonTai: boolean; ten: string; chu: ChuHienTaiNguon | null }> {
  const g = await client.leadSourceGroup.findUnique({
    where: { id: nguonId },
    select: { name: true, ownerEmployee: { select: { id: true, fullName: true, employeeCode: true, status: true, userAccount: { select: { id: true } } } } },
  });
  if (!g) return { tonTai: false, ten: "", chu: null };
  const e = g.ownerEmployee;
  return { tonTai: true, ten: g.name, chu: e ? { employeeId: e.id, ten: e.fullName, maNv: e.employeeCode, status: e.status, coTaiKhoan: e.userAccount !== null } : null };
}

/**
 * Các nhóm chủ-đã-chụp sang `chuHienTai` mà luật chụp lại nhận ra, TÁCH THEO «đã chi cho chủ cũ hay chưa» (`DA_CHI_CHU_NGUON`): `canChup` sẽ được chụp lại; `giuChuCu` thuộc diện nếu xét riêng chủ đã chụp
 * (nghỉ việc · không còn hồ sơ) nhưng đã có khoản chi còn hiệu lực cho chủ cũ nên GIỮ chủ cũ. `sauId` = con trỏ (chỉ xét dòng có `id > sauId`; `null` = từ đầu). Không có gì ⇒ hai mảng rỗng, KHÔNG bao giờ «mọi nhóm».
 */
export async function docNhomChupLai(client: Khach, p: { nguonId: string; chuHienTai: string; sauId: string | null }): Promise<{ canChup: NhomCanChup[]; giuChuCu: NhomCanChup[] }> {
  const sau = p.sauId === null ? Prisma.sql`true` : Prisma.sql`"id" > ${p.sauId}`;
  const dong = await client.$queryRaw<{ chu: string | null; daChi: boolean; n: number }[]>(Prisma.sql`
    SELECT ${CHU_DA_CHUP} AS chu, ${DA_CHI_CHU_NGUON} AS "daChi", count(*)::int AS n
    FROM "LeadAttribution"
    WHERE "groupId" = ${p.nguonId} AND ${sau} AND ${BAN_CHUP_HOP_LE} AND ${CHU_DA_CHUP} IS DISTINCT FROM ${p.chuHienTai}
    GROUP BY 1, 2`);
  const ra = { canChup: [] as NhomCanChup[], giuChuCu: [] as NhomCanChup[] };
  if (dong.length === 0) return ra;
  const idChu = dong.flatMap((d) => (d.chu === null ? [] : [d.chu]));
  const nhanSu = idChu.length > 0 ? await client.employee.findMany({ where: { id: { in: idChu } }, select: { id: true, status: true } }) : [];
  const trangThai = new Map(nhanSu.map((e) => [e.id, e.status as string]));
  for (const d of dong) {
    const lyDo = phanLoaiChuChup({ chuChup: d.chu, chuHienTai: p.chuHienTai, trangThaiNhanSu: trangThai });
    if (lyDo !== null) (d.daChi ? ra.giuChuCu : ra.canChup).push({ chu: d.chu, soLead: d.n, lyDo });
  }
  return ra;
}

/** Các nhóm sẽ được chụp lại (đã loại lead đã chi cho chủ cũ). Cùng nguồn với `docNhomChupLai` — không có hai định nghĩa «cần chụp lại». */
export async function docNhomCanChup(client: Khach, p: { nguonId: string; chuHienTai: string; sauId: string | null }): Promise<NhomCanChup[]> {
  return (await docNhomChupLai(client, p)).canChup;
}

export type TinhTrangChupLai = {
  /** Nguồn được hỏi. */
  nguon: { id: string; name: string };
  /** Người phụ trách hiện tại (nguồn không có ⇒ `null`). */
  chu: ChuHienTaiNguon | null;
  /** Vì sao KHÔNG chụp lại được lúc này (chủ trống / nghỉ / chưa tài khoản); `null` = chụp được. */
  khongChupDuoc: string | null;
  /** Số lead SẼ được chụp lại (đã loại lead đã chi cho chủ cũ). */
  tong: number;
  theoLyDo: Record<LyDoChupLai, number>;
  /** Số lead mà chủ đã chụp nghỉ việc / không còn hồ sơ NHƯNG đã có khoản chi còn hiệu lực cho họ ⇒ GIỮ chủ cũ, không chụp lại (hồi tố tiền đã chi). Không đếm khi `khongChupDuoc`. */
  giuChuCu: number;
};

const KHONG_CO: Record<LyDoChupLai, number> = { THIEU_CHU: 0, CHU_NGHI_VIEC: 0, CHU_KHONG_CON_HO_SO: 0 };

/** Dữ liệu cho nút «Chụp lại chủ nguồn». `null` ⇒ nguồn không tồn tại. Chủ hiện tại không hợp lệ ⇒ `tong = 0` + `khongChupDuoc` (không đếm thứ không làm được). */
export async function docCanChupLai(client: Khach, nguonId: string): Promise<TinhTrangChupLai | null> {
  const { tonTai, ten, chu } = await docChuHienTai(client, nguonId);
  if (!tonTai) return null;
  const nguon = { id: nguonId, name: ten };
  const loi = kiemChuHienTai(chu ? { status: chu.status, coTaiKhoan: chu.coTaiKhoan } : null);
  if (!chu || loi) return { nguon, chu, khongChupDuoc: loi, tong: 0, theoLyDo: { ...KHONG_CO }, giuChuCu: 0 };
  const { canChup, giuChuCu } = await docNhomChupLai(client, { nguonId, chuHienTai: chu.employeeId, sauId: null });
  const theoLyDo = { ...KHONG_CO };
  for (const n of canChup) theoLyDo[n.lyDo] += n.soLead;
  return {
    nguon,
    chu,
    khongChupDuoc: null,
    tong: theoLyDo.THIEU_CHU + theoLyDo.CHU_NGHI_VIEC + theoLyDo.CHU_KHONG_CON_HO_SO,
    theoLyDo,
    giuChuCu: giuChuCu.reduce((n, g) => n + g.soLead, 0),
  };
}

/**
 * `docCanChupLai` theo MÃ nguồn, gắn sẵn `db` cho trang dưới `app/(admin)/**` (cổng ESLint cấm import `@/lib/db` trần ở đó). Theo MÃ (không theo id) để trang gọi ĐƯỢC trong cùng lượt `Promise.all` với
 * hàm đọc trang — không thêm một `await` nối đuôi (`[CTN-W6]`: độ sâu tuần tự của trang bị chặn). Cùng một hàm đọc — không có đường thứ hai.
 */
export async function docCanChupLaiCuaToi(code: string): Promise<TinhTrangChupLai | null> {
  const g = await db.leadSourceGroup.findUnique({ where: { code }, select: { id: true } });
  return g ? docCanChupLai(db, g.id) : null;
}
