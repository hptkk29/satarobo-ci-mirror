/**
 * lib/affiliate/tai-khoan-truy-cap.ts — ĐỌC quan hệ User ↔ AffiliateParty (AFF-L3a). MỘT điểm vào cho mọi câu hỏi «tài khoản này vào được đối tác nào / đối tác này có những tài khoản nào».
 *
 * ── ĐIỂM VÀO DUY NHẤT của cổng `/portal/gioi-thieu` ──────────────────────────────────────────────────────────
 * `partyIdsVaoDuoc(userId)` — menu (`coGioiThieuChoNguoiDung`), trang (`docGioiThieuCuaToi`) và mọi nơi sau này cùng hỏi hàm này. Hai nơi hỏi bằng hai câu là có ngày menu hiện mục mà trang trả 404.
 *
 * ── Giai đoạn chuyển: bảng nối + cột LEGACY `Affiliate.userId` ──────────────────────────────────────────────
 *  · Nguồn thật = dòng `AffiliatePartyUser` ACTIVE.
 *  · Cột cũ chỉ được tính khi CHƯA CÓ dòng nối nào cho đúng cặp (đối tác, tài khoản) — tức dữ liệu gắn bằng SQL sau migration mà chưa qua màn mới. CÓ dòng nối (kể cả SUSPENDED/REVOKED) ⇒ cột cũ bị
 *    BỎ QUA. Nếu không, tạm ngừng / gỡ liên kết sẽ bị chính cột cũ hoàn tác (người bị gỡ vẫn vào được qua lối cũ). Hàm ghi còn đồng bộ cột cũ = người đại diện chưa gỡ (`userIdLegacy`).
 *
 * ── PII ───────────────────────────────────────────────────────────────────────────────────────────────────────
 * Danh sách tài khoản của một đối tác dành cho người quản trị: SĐT/email chỉ nguyên văn khi `coTheXemLienHe` (BẮT BUỘC, không mặc định — luật 7); không thì che Ở ĐÂY, trước khi thành props RSC.
 * Ô tìm tài khoản: tối thiểu 3 ký tự, trần 8 kết quả, che SĐT/email, loại tài khoản không liên kết được (nhân viên · bị khoá) bằng CHÍNH `kiemUserLienKetDuoc`.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { maskEmail, maskPhone } from "@/lib/lead/pii";
import { thoatLike } from "@/lib/nguon/tim-nguoi-gioi-thieu";
import { phoneVariants } from "@/lib/phone";
import {
  DO_DAI_TIM_USER_TOI_DA,
  DO_DAI_TIM_USER_TOI_THIEU,
  SO_KET_QUA_TIM_USER,
  kiemUserLienKetDuoc,
  thaoTacKhaDung,
  type ThaoTacTruyCap,
  type TrangThaiTruyCap,
  type VaiTruyCap,
} from "./tai-khoan-truy-cap-dau-vao";

type Khach = PrismaClient | Prisma.TransactionClient;

// ── Cổng đối tác ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Các đối tác mà tài khoản này VÀO ĐƯỢC cổng: dòng nối ACTIVE ∪ cột legacy (chỉ khi chưa có dòng nối cho cặp đó). Sắp theo ngày tạo đối tác rồi id (ổn định).
 * Không phụ thuộc cờ — nơi gọi tự hỏi cờ trước.
 */
export async function partyIdsVaoDuoc(userId: string, client: Khach = db): Promise<string[]> {
  // HAI truy vấn song song (một vòng đi-về): menu của cổng chạy hàm này ở MỌI lượt render layout.
  const [daNoi, cu] = await Promise.all([
    client.affiliatePartyUser.findMany({ where: { userId, status: "ACTIVE" }, select: { partyId: true, party: { select: { createdAt: true } } } }),
    client.affiliate.findMany({ where: { userId, accessUsers: { none: { userId } } }, select: { id: true, createdAt: true } }),
  ]);
  const theoId = new Map<string, Date>();
  for (const r of daNoi) theoId.set(r.partyId, r.party.createdAt);
  for (const r of cu) theoId.set(r.id, r.createdAt);
  // Sắp theo ngày tạo đối tác rồi id — cùng thứ tự với truy vấn cũ, ổn định giữa hai lần render.
  return [...theoId.entries()].sort((a, b) => a[1].getTime() - b[1].getTime() || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id]) => id);
}

/**
 * MỌI tài khoản đang gắn với đối tác (ACTIVE ∪ SUSPENDED ∪ legacy chưa có dòng nối) — để so TỰ GIỚI THIỆU: người bị tạm ngừng cổng vẫn là «người của đối tác», tự giới thiệu mình vẫn bị chặn.
 * REVOKED không tính (đã gỡ ⇒ không còn liên quan).
 */
export async function userIdsGanVoiDoiTac(partyId: string, client: Khach = db): Promise<string[]> {
  const [daNoi, cu] = await Promise.all([
    client.affiliatePartyUser.findMany({ where: { partyId, status: { in: ["ACTIVE", "SUSPENDED"] } }, select: { userId: true } }),
    client.affiliate.findUnique({ where: { id: partyId }, select: { userId: true, accessUsers: { select: { userId: true } } } }),
  ]);
  const ids = new Set<string>(daNoi.map((r) => r.userId));
  if (cu?.userId && !cu.accessUsers.some((a) => a.userId === cu.userId)) ids.add(cu.userId);
  return [...ids];
}

// ── Danh sách tài khoản của một đối tác (màn quản trị) ───────────────────────────────────────────────────────

export type DongTruyCap = {
  id: string;
  userId: string;
  ten: string;
  /** Đã che nếu người xem không có `affiliates:manage`. */
  email: string | null;
  dienThoai: string | null;
  vai: VaiTruyCap;
  trangThai: TrangThaiTruyCap;
  lyDo: string | null;
  lienKetLuc: string;
  /** Số học viên đã liên kết với tài khoản (cổng phụ huynh chỉ mở khi ≥ 1). */
  soHocVien: number;
  /** Tài khoản này thật sự vào được trang cổng không — nói THẬT, không suy từ trạng thái một mình. */
  vaoDuocCong: boolean;
  lyDoKhongVao: string | null;
  /** ISO của `updatedAt` — mốc khoá lạc quan. */
  capNhatLuc: string;
  thaoTac: { thaoTac: ThaoTacTruyCap; lyDoChan: string | null }[];
};

export async function docTruyCapCuaDoiTac(p: { partyId: string; doiTacKetThuc: boolean; coTheXemLienHe: boolean }, client: Khach = db): Promise<DongTruyCap[]> {
  const hang = await client.affiliatePartyUser.findMany({
    where: { partyId: p.partyId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      statusReason: true,
      grantedAt: true,
      updatedAt: true,
      user: { select: { name: true, email: true, phone: true } },
    },
  });
  if (hang.length === 0) return [];
  const con = await client.student.groupBy({ by: ["parentUserId"], where: { parentUserId: { in: hang.map((h) => h.userId) }, deletedAt: null }, _count: { _all: true }, orderBy: { parentUserId: "asc" } });
  const demCon = new Map(con.map((g) => [g.parentUserId, g._count._all]));
  return hang.map((h) => {
    const soHocVien = demCon.get(h.userId) ?? 0;
    const lyDoKhongVao =
      h.status === "REVOKED" ? "Đã gỡ liên kết." : h.status === "SUSPENDED" ? "Cổng đang tạm ngừng." : soHocVien === 0 ? "Chưa liên kết học viên nào — cổng phụ huynh chưa mở cho tài khoản này." : null;
    return {
      id: h.id,
      userId: h.userId,
      ten: h.user.name?.trim() || "(chưa có tên)",
      email: h.user.email === null ? null : p.coTheXemLienHe ? h.user.email : maskEmail(h.user.email),
      dienThoai: h.user.phone === null ? null : p.coTheXemLienHe ? h.user.phone : maskPhone(h.user.phone),
      vai: h.role,
      trangThai: h.status,
      lyDo: h.statusReason,
      lienKetLuc: h.grantedAt.toISOString(),
      soHocVien,
      vaoDuocCong: lyDoKhongVao === null,
      lyDoKhongVao,
      capNhatLuc: h.updatedAt.toISOString(),
      thaoTac: thaoTacKhaDung({ role: h.role, status: h.status, doiTacKetThuc: p.doiTacKetThuc }),
    };
  });
}

// ── Ô tìm tài khoản để liên kết ──────────────────────────────────────────────────────────────────────────────

export type UserUngVien = { userId: string; ten: string; email: string | null; dienThoai: string | null; soHocVien: number; vaoDuocCong: boolean; lyDoKhongVao: string | null };

/**
 * Tìm tài khoản phụ huynh liên kết được. KHÔNG phải danh bạ: tối thiểu 3 ký tự, tối đa 8 kết quả, che SĐT/email, bỏ tài khoản đã gắn với CHÍNH đối tác này (chưa gỡ).
 * `kiemUserLienKetDuoc` lọc lần cuối ở JS — một định nghĩa «liên kết được» cho cả ô tìm lẫn cổng ghi.
 */
export async function timUserDeLienKet(p: { partyId: string; q: string }, client: Khach = db): Promise<UserUngVien[]> {
  const q = p.q.trim().slice(0, DO_DAI_TIM_USER_TOI_DA);
  if (q.length < DO_DAI_TIM_USER_TOI_THIEU) return [];
  const like = thoatLike(q);
  const chuSo = q.replace(/\D/g, "");
  const theoSdt = chuSo.length >= 6 ? phoneVariants(chuSo) : [];
  const daGan = await client.affiliatePartyUser.findMany({ where: { partyId: p.partyId, status: { not: "REVOKED" } }, select: { userId: true } });
  const rows = await client.user.findMany({
    where: {
      role: "PARENT",
      isActive: true,
      deletedAt: null,
      accountStatus: { not: "DISABLED" },
      id: { notIn: daGan.map((d) => d.userId) },
      OR: [{ name: { contains: like, mode: "insensitive" } }, { email: { contains: like, mode: "insensitive" } }, ...(theoSdt.length > 0 ? [{ phone: { in: theoSdt } }] : [])],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    // Lấy dư rồi lọc bằng luật thuần: trần cuối vẫn là SO_KET_QUA_TIM_USER.
    take: SO_KET_QUA_TIM_USER * 3,
    select: { id: true, name: true, email: true, phone: true, role: true, roles: true, isActive: true, deletedAt: true, accountStatus: true },
  });
  const hopLe = rows.filter((u) => kiemUserLienKetDuoc(u).ok).slice(0, SO_KET_QUA_TIM_USER);
  if (hopLe.length === 0) return [];
  const con = await client.student.groupBy({ by: ["parentUserId"], where: { parentUserId: { in: hopLe.map((u) => u.id) }, deletedAt: null }, _count: { _all: true }, orderBy: { parentUserId: "asc" } });
  const demCon = new Map(con.map((g) => [g.parentUserId, g._count._all]));
  return hopLe.map((u) => {
    const soHocVien = demCon.get(u.id) ?? 0;
    return {
      userId: u.id,
      ten: u.name?.trim() || "(chưa có tên)",
      email: u.email === null ? null : maskEmail(u.email),
      dienThoai: u.phone === null ? null : maskPhone(u.phone),
      soHocVien,
      vaoDuocCong: soHocVien > 0,
      lyDoKhongVao: soHocVien > 0 ? null : "Chưa liên kết học viên nào — liên kết xong vẫn chưa vào được cổng phụ huynh.",
    };
  });
}
