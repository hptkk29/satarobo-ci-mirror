/**
 * TRẦN LƯỢT DÙNG MÃ THEO CON — luật THUẦN [14/11/2026].
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TỆP NÀY TỒN TẠI
 *
 * `Voucher.usageLimitPerUser` (mặc định 1) trước đây đếm theo SĐT phụ huynh. Phụ huynh có HAI con cùng
 * đăng ký 12 buổi, mỗi con ăn mã «12BUOI giảm 5%» MỘT lần là đúng ý chương trình — nhưng con thứ hai bị chặn
 * «đã dùng 1/1 lượt», vì lượt của con thứ nhất cùng SĐT. Đo prod 14/11/2026: lượt duy nhất của 12BUOI trên
 * SĐT đó là của bé Hiếu (đơn 1 dòng); dòng bị chặn là bé Nghĩa. Chủ dự án chốt: «sửa theo con».
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * LUẬT (fail-closed — không nhận ra bé thì giữ nguyên luật cũ theo SĐT)
 *
 * «MỘT NGƯỜI» = MỘT CON, trong phạm vi MỘT SĐT (đã có từ trước; chỉ THU HẸP theo con, không đối khớp
 * chéo SĐT). Danh tính con của một dòng = `studentId` của dòng, và/hoặc `leadChildId` (metadata dòng; hoặc
 * `Order.leadChildId` khi đơn CHỈ có một dòng — đúng thứ tự `gan-danh-tinh-dong-don.ts`).
 *
 *   · dòng mới KHÔNG nhận ra bé nào  ⇒ đếm TOÀN BỘ lượt của SĐT (luật cũ, y nguyên);
 *   · dòng mới nhận ra bé            ⇒ đếm lượt cũ CỦA BÉ ĐÓ + lượt cũ KHÔNG ghi rõ bé nào (không loại trừ
 *                                     được thì tính, nếu không thì bỏ trống ô học viên là lách trần);
 *                                     lượt cũ của bé KHÁC không tính;
 *   · bé có thể hiện ra bằng HAI khoá (đơn đầu mang `leadChildId`, đơn gia hạn mang `studentId` của chính
 *     bé đó sau khi chốt) — cầu nối là `Enrollment.leadChildId` ↔ `Enrollment.studentId`; thiếu cầu nối này
 *     thì gia hạn lọt qua đúng trần đang chặn nó hôm nay;
 *   · cùng ĐƠN: hai dòng của CÙNG MỘT bé cùng mã ⇒ lượt thứ hai tính. Dòng không nhận ra bé không bị tính
 *     trong đơn (giữ hành vi cũ — hai dòng không phân biệt được thì không có cơ sở để nói là cùng bé).
 *
 * THUẦN — không Prisma, không DB. Đọc DB là việc của `createOrderManualAction`.
 */

export type DanhTinhCon = {
  studentId: string | null;
  leadChildId: string | null;
};

/** Tập khoá nhận diện MỘT con (đã mở rộng qua `Enrollment`). */
export type TapDanhTinhCon = {
  studentIds: ReadonlySet<string>;
  leadChildIds: ReadonlySet<string>;
};

const sach = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

/**
 * Danh tính con của MỘT DÒNG. `null` = không nhận ra bé nào.
 * `leadChildCuaDon` chỉ được truyền khi đơn có ĐÚNG MỘT dòng (đơn nhiều dòng mà dòng không khai bé thì
 * KHÔNG suy từ cấp đơn — không biết dòng nào của bé nào).
 */
export function danhTinhConCuaDong(d: {
  studentId?: string | null;
  leadChildId?: string | null;
  leadChildCuaDon?: string | null;
}): DanhTinhCon | null {
  const studentId = sach(d.studentId);
  const leadChildId = sach(d.leadChildId) ?? sach(d.leadChildCuaDon);
  if (!studentId && !leadChildId) return null;
  return { studentId, leadChildId };
}

/** Như trên, cho một DÒNG của đơn đang tạo (cùng hình với dữ liệu form). */
export function danhTinhConCuaDongMoi(
  dong: { studentId?: string | null; leadChildId?: string | null },
  leadChildCuaDon: string | null,
): DanhTinhCon | null {
  return danhTinhConCuaDong({
    studentId: dong.studentId,
    leadChildId: dong.leadChildId,
    leadChildCuaDon,
  });
}

/** Đọc `leadChildId` từ `OrderItem.metadata` (Json bất kỳ). */
export function leadChildTuMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return sach((metadata as Record<string, unknown>).leadChildId);
}

/** Dựng tập khoá của một con: chính nó + các khoá bắc cầu qua ghi danh. */
export function tapDanhTinhCon(
  con: DanhTinhCon,
  ghiDanh: readonly { studentId: string | null; leadChildId: string | null }[],
): TapDanhTinhCon {
  const studentIds = new Set<string>();
  const leadChildIds = new Set<string>();
  if (con.studentId) studentIds.add(con.studentId);
  if (con.leadChildId) leadChildIds.add(con.leadChildId);
  for (const g of ghiDanh) {
    // Chỉ nối khi ghi danh khớp ÍT NHẤT MỘT khoá của con — đừng kéo cả họ hàng của một ghi danh lạ vào.
    const khop =
      (g.studentId != null && studentIds.has(g.studentId)) ||
      (g.leadChildId != null && leadChildIds.has(g.leadChildId));
    if (!khop) continue;
    if (g.studentId) studentIds.add(g.studentId);
    if (g.leadChildId) leadChildIds.add(g.leadChildId);
  }
  return { studentIds, leadChildIds };
}

/** Khoá của lượt/dòng có thuộc con này không (khớp ÍT NHẤT một khoá). */
export function thuocCon(d: DanhTinhCon, con: TapDanhTinhCon): boolean {
  return (
    (d.studentId != null && con.studentIds.has(d.studentId)) ||
    (d.leadChildId != null && con.leadChildIds.has(d.leadChildId))
  );
}

export type KetQuaDemLuot = {
  /** Tổng lượt tính vào trần. */
  tong: number;
  /** Trong đó: lượt cũ không ghi rõ bé nào nhưng không loại trừ được (để thông báo nói thật). */
  khongRoCon: number;
  /** Trong đó: dòng trước đó CỦA CHÍNH ĐƠN NÀY cùng bé cùng mã. */
  trongDonNay: number;
  /** Đếm theo con (true) hay theo SĐT (false — dòng không nhận ra bé). */
  theoCon: boolean;
};

/**
 * Số lượt đã dùng của MỘT dòng mới, để so với `usageLimitPerUser`.
 *
 * @param luotCu      mọi lượt ĐÃ LƯU của (mã, SĐT) — mỗi lượt kèm danh tính con của dòng nó gắn vào
 *                    (`null` = lượt cũ không ghi rõ bé).
 * @param con         tập khoá của con ở dòng mới; `null` = dòng mới không nhận ra bé (luật cũ).
 * @param dongTruocCungMa danh tính của các dòng ĐỨNG TRƯỚC trong cùng đơn đang dùng cùng mã
 *                    (`null` = dòng ấy không nhận ra bé ⇒ không tính).
 */
export function demLuotDaDung(
  luotCu: readonly (DanhTinhCon | null)[],
  con: TapDanhTinhCon | null,
  dongTruocCungMa: readonly (DanhTinhCon | null)[],
): KetQuaDemLuot {
  if (!con) {
    return { tong: luotCu.length, khongRoCon: 0, trongDonNay: 0, theoCon: false };
  }
  let tong = 0;
  let khongRoCon = 0;
  for (const l of luotCu) {
    if (l === null) {
      tong += 1;
      khongRoCon += 1;
    } else if (thuocCon(l, con)) {
      tong += 1;
    }
  }
  let trongDonNay = 0;
  for (const d of dongTruocCungMa) {
    if (d !== null && thuocCon(d, con)) trongDonNay += 1;
  }
  return { tong: tong + trongDonNay, khongRoCon, trongDonNay, theoCon: true };
}
