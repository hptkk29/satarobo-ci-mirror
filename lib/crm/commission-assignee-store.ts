// lib/crm/commission-assignee-store.ts — ĐƯỜNG GHI DUY NHẤT của sổ "ai phụ trách cơ sở".
//
// Luật thuần (ai hưởng, chia thế nào, treo khi nào) nằm ở `commission-assignee.ts`.
// File này chỉ lo phần chạm DB: mở dòng mới, đóng dòng cũ, và GIỮ `Center.managerUserId`
// khớp với sổ.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ HAI CHỖ LƯU NGƯỜI QUẢN LÝ — VÀ VÌ SAO CHÚNG KHÔNG ĐƯỢC LỆCH
//
// Chủ dự án chốt thêm `Center.managerUserId` (liên kết tài khoản, bắt buộc khi tạo cơ
// sở mới). Nhưng NGUỒN SỰ THẬT CỦA TIỀN phải là sổ có hiệu lực theo thời gian, không
// phải một cột "hiện tại" — nếu không, đổi quản lý hôm nay sẽ viết lại hoa hồng của
// tháng trước (xem đầu `commission-assignee.ts`).
//
// Hai thứ cùng tồn tại ⇒ nguy cơ lệch. Chặn bằng ba lớp:
//   1. CHỈ `datQuanLyCoSo()` được ghi `Center.managerUserId`. Form cơ sở gọi hàm này
//      chứ không tự `update` cột đó (`toData()` ở app/(admin)/admin/centers/_actions.ts
//      cố ý KHÔNG chứa `managerUserId`).
//   2. Cột và dòng sổ được ghi TRONG CÙNG MỘT transaction.
//   3. `docLechQuanLy()` soi lệch và màn quản trị HIỆN cảnh báo — lệch không im lặng.
//
// ⚠️ Vai QC KHÔNG có cột "hiện tại" tương ứng, và cố ý không có: một cơ sở được phép
// có nhiều QC (1% chia đều), mà cột đơn thì chỉ chứa được một người.
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import {
  dangHieuLuc,
  VAI_HOA_HONG_CO_SO,
  type PhanCongCoSo,
  type VaiHoaHongCoSo,
} from "@/lib/crm/commission-assignee";

export class PhanCongError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PhanCongError";
    this.code = code;
  }
}

/** Một dòng phân công kèm thông tin hiển thị (cho màn quản trị). */
export type DongPhanCong = PhanCongCoSo & {
  id: string;
  note: string | null;
  userName: string | null;
  userEmail: string | null;
  centerName: string;
};

export type CoSoPhanCong = {
  centerId: string;
  centerName: string;
  centerCode: string | null;
  /** Chuỗi tên cũ — CHỈ hiển thị, không dùng để suy người hưởng. */
  managerName: string | null;
  /** Con trỏ "hiện tại" trên bảng cơ sở. */
  managerUserId: string | null;
  managerUserName: string | null;
  /** Dòng sổ đang hiệu lực, tách theo vai. */
  dangHieuLuc: Record<VaiHoaHongCoSo, DongPhanCong[]>;
  /** Toàn bộ dòng (kể cả đã kết thúc) — mới nhất trước. */
  lichSu: DongPhanCong[];
  /**
   * Cột `managerUserId` KHÔNG khớp sổ QL_TT đang hiệu lực. Đây là thứ phải HIỆN LÊN
   * chứ không được tự sửa: tự sửa là đoán xem bên nào đúng, mà bên sai có thể là bên
   * đã chi tiền.
   */
  lechQuanLy: boolean;
};

const SELECT_DONG = {
  id: true,
  centerId: true,
  role: true,
  userId: true,
  effectiveFrom: true,
  effectiveTo: true,
  note: true,
  user: { select: { name: true, email: true } },
  center: { select: { name: true } },
} as const;

type RowDong = {
  id: string;
  centerId: string;
  role: VaiHoaHongCoSo;
  userId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  note: string | null;
  user: { name: string | null; email: string | null };
  center: { name: string };
};

function toDong(r: RowDong): DongPhanCong {
  return {
    id: r.id,
    centerId: r.centerId,
    role: r.role,
    userId: r.userId,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    note: r.note,
    userName: r.user.name,
    userEmail: r.user.email,
    centerName: r.center.name,
  };
}

/**
 * Toàn cảnh "cơ sở → người hưởng" cho màn quản trị.
 *
 * Liệt kê MỌI cơ sở đang hoạt động, kể cả cơ sở CHƯA khai — đó chính là danh sách
 * việc phải làm. Ẩn cơ sở chưa khai đi thì màn hình trông sạch còn tiền vẫn treo.
 */
export async function danhSachPhanCong(at: Date = new Date()): Promise<CoSoPhanCong[]> {
  const [centers, rows] = await Promise.all([
    db.center.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        managerName: true,
        managerUserId: true,
        managerUser: { select: { name: true, email: true } },
      },
    }),
    db.centerCommissionAssignee.findMany({
      orderBy: [{ effectiveFrom: "desc" }],
      select: SELECT_DONG,
    }),
  ]);

  const theoCoSo = new Map<string, DongPhanCong[]>();
  for (const r of rows as RowDong[]) {
    const arr = theoCoSo.get(r.centerId) ?? [];
    arr.push(toDong(r));
    theoCoSo.set(r.centerId, arr);
  }

  return centers.map((c) => {
    const lichSu = theoCoSo.get(c.id) ?? [];
    const hienTai = {
      QC: lichSu.filter((d) => d.role === "QC" && dangHieuLuc(d, at)),
      QL_TT: lichSu.filter((d) => d.role === "QL_TT" && dangHieuLuc(d, at)),
    } satisfies Record<VaiHoaHongCoSo, DongPhanCong[]>;
    const soQuanLy = hienTai.QL_TT.map((d) => d.userId);
    return {
      centerId: c.id,
      centerName: c.name,
      centerCode: c.code,
      managerName: c.managerName,
      managerUserId: c.managerUserId,
      managerUserName: c.managerUser?.name ?? c.managerUser?.email ?? null,
      dangHieuLuc: hienTai,
      lichSu,
      // Lệch = cột trỏ một người mà sổ nói người khác (hoặc sổ trống / có 2 người).
      lechQuanLy:
        c.managerUserId != null
          ? !(soQuanLy.length === 1 && soQuanLy[0] === c.managerUserId)
          : soQuanLy.length > 0,
    };
  });
}

type ThemInput = {
  centerId: string;
  role: VaiHoaHongCoSo;
  userId: string;
  effectiveFrom: Date;
  note?: string | null;
  reason?: string;
};

/**
 * Thêm một dòng phân công.
 *
 * QC — CHỈ THÊM, không đóng dòng nào: nhiều QC cùng phụ trách một cơ sở là hợp lệ và
 * 1% được chia đều (quyết định 27/08, xem `commission-assignee.ts`).
 *
 * QL_TT — ĐÓNG dòng đang mở rồi mới mở dòng mới, và cập nhật `Center.managerUserId`
 * trong CÙNG transaction. Ép một người vì cột trên bảng cơ sở là số ít; engine vẫn
 * chia đều nếu gặp nhiều (lưới an toàn chống chi vượt 2%).
 */
export async function themPhanCong(actor: AuditActor, input: ThemInput): Promise<void> {
  await kiemTraNguoiDung(input.userId);

  await db.$transaction(async (tx) => {
    if (input.role === "QL_TT") {
      // Đóng mọi dòng còn mở BẮT ĐẦU TRƯỚC mốc mới. Dòng bắt đầu SAU mốc mới không bị
      // đụng — sửa nó là viết lại một quyết định trong tương lai mà người dùng đã đặt.
      await tx.centerCommissionAssignee.updateMany({
        where: {
          centerId: input.centerId,
          role: "QL_TT",
          effectiveTo: null,
          effectiveFrom: { lte: input.effectiveFrom },
        },
        data: { effectiveTo: input.effectiveFrom },
      });
    }
    await tx.centerCommissionAssignee.create({
      data: {
        centerId: input.centerId,
        role: input.role,
        userId: input.userId,
        effectiveFrom: input.effectiveFrom,
        note: input.note ?? null,
        createdById: actor.id,
        createdByName: actor.name,
      },
    });
    if (input.role === "QL_TT") {
      await tx.center.update({
        where: { id: input.centerId },
        data: { managerUserId: input.userId },
      });
    }
    await writeAudit({
      actor,
      module: "commission",
      entityType: "CenterCommissionAssignee",
      entityId: input.centerId,
      action: "CREATE",
      newValues: {
        role: input.role,
        userId: input.userId,
        effectiveFrom: input.effectiveFrom.toISOString(),
      },
      reason: input.reason ?? `Khai người hưởng hoa hồng ${input.role} cho cơ sở`,
      orgUnitId: input.centerId,
      tx,
    });
  });
}

/**
 * Kết thúc một dòng phân công (người đó thôi phụ trách từ `effectiveTo`).
 *
 * KHÔNG XOÁ dòng: xoá là mất bằng chứng vì sao kỳ tháng trước chi cho người đó, và
 * chốt lại kỳ cũ sẽ ra số khác — đúng thứ mà cả thiết kế này sinh ra để chặn.
 */
export async function ketThucPhanCong(
  actor: AuditActor,
  input: { id: string; effectiveTo: Date; reason?: string },
): Promise<void> {
  const row = await db.centerCommissionAssignee.findUnique({
    where: { id: input.id },
    select: { id: true, centerId: true, role: true, userId: true, effectiveFrom: true, effectiveTo: true },
  });
  if (!row) throw new PhanCongError("NOT_FOUND", "Không tìm thấy dòng phân công.");
  if (row.effectiveTo != null) {
    throw new PhanCongError("ALREADY_ENDED", "Dòng này đã kết thúc rồi.");
  }
  if (input.effectiveTo <= row.effectiveFrom) {
    throw new PhanCongError(
      "INVALID_RANGE",
      "Ngày kết thúc phải SAU ngày bắt đầu — khoảng rỗng thì không ai từng phụ trách.",
    );
  }

  await db.$transaction(async (tx) => {
    await tx.centerCommissionAssignee.update({
      where: { id: row.id },
      data: { effectiveTo: input.effectiveTo },
    });
    if (row.role === "QL_TT") {
      // Gỡ con trỏ nếu nó đang trỏ đúng người vừa nghỉ — để cơ sở hiện "chưa khai"
      // thay vì trỏ tới một người mà sổ đã nói là thôi phụ trách.
      await tx.center.updateMany({
        where: { id: row.centerId, managerUserId: row.userId },
        data: { managerUserId: null },
      });
    }
    await writeAudit({
      actor,
      module: "commission",
      entityType: "CenterCommissionAssignee",
      entityId: row.id,
      action: "UPDATE",
      oldValues: { effectiveTo: null },
      newValues: { effectiveTo: input.effectiveTo.toISOString() },
      reason: input.reason ?? "Kết thúc phân công người hưởng hoa hồng",
      orgUnitId: row.centerId,
      tx,
    });
  });
}

/**
 * Đặt quản lý cơ sở — dùng CHUNG cho màn phân công và form tạo/sửa cơ sở.
 * Không đổi gì nếu đã đúng người (tránh đẻ dòng sổ rỗng mỗi lần bấm Lưu địa chỉ).
 */
export async function datQuanLyCoSo(
  actor: AuditActor,
  input: { centerId: string; userId: string; effectiveFrom?: Date; reason?: string },
): Promise<void> {
  const center = await db.center.findUnique({
    where: { id: input.centerId },
    select: { managerUserId: true },
  });
  if (!center) throw new PhanCongError("CENTER_NOT_FOUND", "Không tìm thấy cơ sở.");
  const dangMo = await db.centerCommissionAssignee.findFirst({
    where: { centerId: input.centerId, role: "QL_TT", effectiveTo: null },
    select: { userId: true },
  });
  if (center.managerUserId === input.userId && dangMo?.userId === input.userId) return;

  await themPhanCong(actor, {
    centerId: input.centerId,
    role: "QL_TT",
    userId: input.userId,
    effectiveFrom: input.effectiveFrom ?? new Date(),
    reason: input.reason ?? "Đặt quản lý cơ sở (đồng bộ cột managerUserId + sổ hoa hồng)",
  });
}

/** Tài khoản nhận hoa hồng phải CÓ THẬT và còn hoạt động. */
async function kiemTraNguoiDung(userId: string): Promise<void> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!u || u.deletedAt != null) {
    throw new PhanCongError("USER_NOT_FOUND", "Không tìm thấy tài khoản.");
  }
  if (!u.isActive) {
    throw new PhanCongError("USER_INACTIVE", "Tài khoản đang bị khoá — không gán hoa hồng được.");
  }
}

/**
 * Danh sách tài khoản để chọn (màn quản trị).
 *
 * LOẠI tài khoản PHỤ HUYNH: prod có hàng trăm tài khoản PARENT (114 đo ngày 10/08) và
 * con số đó chỉ tăng — thả cả vào dropdown "ai hưởng hoa hồng" thì danh sách vừa
 * không dùng được vừa mời gọi chọn nhầm một phụ huynh làm QC. Người kiêm cả hai
 * (`role` là nhân sự, `roles` có thêm PARENT) VẪN hiện.
 */
export async function nguoiCoTheGan(): Promise<
  { id: string; name: string; email: string | null; centerId: string | null }[]
> {
  const rows = await db.user.findMany({
    where: { isActive: true, deletedAt: null, role: { not: "PARENT" } },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, email: true, phone: true, centerId: true },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name ?? u.email ?? u.phone ?? u.id,
    email: u.email,
    centerId: u.centerId,
  }));
}

/** Hai vai, kèm nhãn tiếng Việt + tỉ lệ — cho dropdown và tiêu đề bảng. */
export const NHAN_VAI: Record<VaiHoaHongCoSo, string> = {
  QC: "Quảng cáo (QC) — 1%",
  QL_TT: "Quản lý trung tâm — 2%",
};

export { VAI_HOA_HONG_CO_SO };
export type { VaiHoaHongCoSo };
