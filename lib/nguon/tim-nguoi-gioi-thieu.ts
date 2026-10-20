/**
 * lib/nguon/tim-nguoi-gioi-thieu.ts — TÌM người giới thiệu cho ReferrerPicker (06 §5.1, 03 §2.8). ĐỌC, không ghi.
 *
 * ── Ba loại, ba cách tra, ba mức cách ly ────────────────────────────────────────────────────────────────────
 *  · NHAN_SU   `db` KHÔNG scope. Người giới thiệu có thể thuộc Hội sở/cơ sở khác (máy chủ cũng nhận họ — `kiemNguoiTonTai`
 *              ở doi-nguon-lead.ts tra không scope). Chỉ trả tên + mã + cơ sở + VAI; KHÔNG SĐT, KHÔNG email, KHÔNG lương.
 *              Chỉ ACTIVE/ON_LEAVE: nhân viên đã nghỉ không được claim MỚI (D13).
 *  · PHU_HUYNH `scopedDb(actor).student` — phụ huynh là dữ liệu của học viên, nên cách ly theo cơ sở của học viên: Sale CS1
 *              không dò được phụ huynh của CS2. Tìm theo SĐT chỉ khi người hỏi được xem PII (`coTheTimTheoSdt`); không thì
 *              gõ số vào ô tìm là một cách dò "SĐT này có phải phụ huynh của Sata không". Tên phụ huynh che theo `canViewPii`.
 *  · DOI_TAC   `db` không scope, `isActive`. (Chưa có cột loại cá nhân/tổ chức — PR11; hôm nay `Affiliate` 0 dòng.)
 *
 * Tham số nguy hiểm KHÔNG có mặc định (luật 7): `coTheTimTheoSdt`, `canViewPii`, `now`, `gioiHan`.
 * Kết quả luôn bị chặn ở `gioiHan` (≤ 20): ô tìm không phải đường tải danh bạ.
 */
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { maskPersonName } from "@/lib/lead/pii";
import { phoneVariants } from "@/lib/phone";
import { DO_DAI_TIM_TOI_DA, DO_DAI_TIM_TOI_THIEU, type LoaiNguoi, type NguoiDaChon } from "./chon-nguon";
import { VAI_SANG_NGUON_MAC_DINH, suyVaiNguon } from "./danh-muc-goc";
import { vaiTaiThoiDiem } from "./thu-thap-tin-hieu";

export const GIOI_HAN_KET_QUA_TOI_DA = 20;

/**
 * Thoát ký tự đại diện của LIKE (`\`, `%`, `_`) trước khi đưa vào `contains`. Prisma KHÔNG tự thoát: ô tìm gõ "%%" hay "__"
 * khớp MỌI dòng — qua mặt luật "gõ tối thiểu 2 ký tự" và biến ô tìm thành đường liệt kê danh bạ. (Đo trên Postgres thật,
 * `[NHH-UI-TN-08]`.) Postgres mặc định dùng `\` làm ký tự thoát của LIKE/ILIKE.
 */
export function thoatLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type DauVaoTimNguoi = {
  loai: LoaiNguoi;
  q: string;
  /** 1..20. */
  gioiHan: number;
  /** Có được tìm phụ huynh theo SĐT không (`leads:view-pii`). */
  coTheTimTheoSdt: boolean;
  /** Có được thấy tên phụ huynh nguyên văn không (`leads:view-pii`). */
  canViewPii: boolean;
  /** Đồng hồ — vai của nhân sự tính TẠI thời điểm này. */
  now: Date;
};

export async function timNguoiGioiThieu(actor: Actor, p: DauVaoTimNguoi): Promise<NguoiDaChon[]> {
  const q = p.q.trim().slice(0, DO_DAI_TIM_TOI_DA);
  if (q.length < DO_DAI_TIM_TOI_THIEU) return [];
  const like = thoatLike(q);
  const gioiHan = Math.min(Math.max(Math.trunc(p.gioiHan) || 1, 1), GIOI_HAN_KET_QUA_TOI_DA);
  switch (p.loai) {
    case "NHAN_SU":
      return timNhanSu(like, gioiHan, p.now);
    case "PHU_HUYNH":
      return timPhuHuynh(actor, q, like, gioiHan, p.coTheTimTheoSdt, p.canViewPii);
    case "DOI_TAC":
      return timDoiTac(like, gioiHan);
  }
}

async function timNhanSu(q: string, gioiHan: number, now: Date): Promise<NguoiDaChon[]> {
  const rows = await db.employee.findMany({
    where: {
      status: { in: ["ACTIVE", "ON_LEAVE"] },
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { employeeCode: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take: gioiHan,
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      center: { select: { code: true } },
      userAccount: { select: { id: true } },
    },
  });
  const userIds = rows.map((r) => r.userAccount?.id).filter((v): v is string => !!v);
  // MỘT câu cho cả trang kết quả — không N+1.
  const vaiRows =
    userIds.length > 0
      ? await db.userOrgRole.findMany({
          where: { userId: { in: userIds }, status: "ACTIVE" },
          select: { userId: true, effectiveFrom: true, effectiveTo: true, role: { select: { code: true } } },
        })
      : [];
  return rows.map((r) => {
    const vaiCuaNguoi = vaiRows.filter((v) => v.userId === r.userAccount?.id);
    // CÙNG hàm với resolver (`thu-thap-tin-hieu`) ⇒ vai hiển thị ở ô chọn = vai máy chủ sẽ ghi làm ảnh chụp (KHÔNG chọn nhóm).
    const vai = suyVaiNguon(vaiTaiThoiDiem(vaiCuaNguoi, now), VAI_SANG_NGUON_MAC_DINH);
    return {
      loai: "NHAN_SU" as const,
      employeeId: r.id,
      ten: r.fullName,
      ma: [r.employeeCode, r.center?.code].filter(Boolean).join(" · ") || null,
      vai,
    };
  });
}

async function timPhuHuynh(
  actor: Actor,
  q: string,
  like: string,
  gioiHan: number,
  coTheTimTheoSdt: boolean,
  canViewPii: boolean,
): Promise<NguoiDaChon[]> {
  const dayChuSo = q.replace(/\D/g, "");
  const theoSdt = coTheTimTheoSdt && dayChuSo.length >= 6 ? phoneVariants(dayChuSo) : [];
  const rows = await scopedDb(actor).student.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: like, mode: "insensitive" } },
        { studentCode: { contains: like, mode: "insensitive" } },
        { parentName: { contains: like, mode: "insensitive" } },
        ...(theoSdt.length > 0 ? [{ parentPhone: { in: theoSdt } }] : []),
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: gioiHan,
    select: {
      id: true,
      name: true,
      studentCode: true,
      parentName: true,
      parentUserId: true,
      center: { select: { code: true } },
    },
  });
  return rows.map((r) => {
    const tenPh = r.parentName?.trim() ? (canViewPii ? r.parentName.trim() : maskPersonName(r.parentName)) : null;
    return {
      loai: "PHU_HUYNH" as const,
      studentId: r.id,
      parentUserId: r.parentUserId,
      ten: tenPh ?? `Phụ huynh của bé ${r.name}`,
      ma: r.studentCode,
      moTa: `phụ huynh của bé ${r.name}${r.center?.code ? ` · ${r.center.code}` : ""}`,
    };
  });
}

async function timDoiTac(q: string, gioiHan: number): Promise<NguoiDaChon[]> {
  const rows = await db.affiliate.findMany({
    where: {
      isActive: true,
      OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: gioiHan,
    select: { id: true, name: true, code: true },
  });
  return rows.map((r) => ({ loai: "DOI_TAC" as const, affiliateId: r.id, ten: r.name, ma: r.code }));
}
