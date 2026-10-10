// lib/enrollments/ghi-danh-cu-trong-lop.ts — "học viên đã có ghi danh ở lớp này chưa, và có
// được xếp LẠI vào lớp này không" hỏi ở MỘT chỗ.
//
// Sự cố 09/10/2026 (prod, học viên CS2-26-57AWRE): em được ghi danh vào lớp P302 rồi bị "Xoá
// khỏi lớp" (ghi danh PENDING ⇒ CANCELLED). Lúc xếp em LẠI vào chính lớp đó thì mọi cửa đều
// từ chối, vì:
//   · câu tra `existing` ({ studentId, classId }) KHÔNG lọc trạng thái ⇒ dòng "Đã huỷ" vẫn tính
//     là "đã có trong lớp" — `enrollStudent` trả "Học viên đã có trong lớp này (trạng thái:
//     CANCELLED)";
//   · và kể cả bỏ câu tra đó, chỉ mục duy nhất từng phần `Enrollment_studentId_classId_active_key`
//     (`… WHERE "deletedAt" IS NULL`, migration 20260617020000) vẫn nổ P2002, vì "Xoá khỏi lớp"
//     KHÔNG đặt `deletedAt` (cố ý: dòng đã kết thúc là lịch sử, xem `ket-thuc-ghi-danh.ts`).
// Người vận hành chỉ còn đường xoá tay dòng cũ ở /enrollments — và phải tự đoán ra đường đó.
//
// LUẬT (một chỗ, mọi cửa ghi danh cùng hỏi):
//   · không có dòng nào                              ⇒ xếp bình thường;
//   · dòng CÒN SỐNG / đã HOÀN THÀNH / đã CHUYỂN LỚP  ⇒ chặn, như cũ;
//   · dòng đã HUỶ hoặc đã RÚT mà KHÔNG mang dữ liệu nghiệp vụ nào (khoản thu, dòng đơn, biên
//     lai, bảo lưu, hoàn tiền) ⇒ xoá mềm dòng đó TRONG CÙNG transaction rồi tạo dòng mới.
//     Đây đúng là phép `deleteEnrollmentAction` vẫn cho người vận hành bấm tay, cùng các vế
//     chặn (thêm vế hoàn tiền cho chặt) — chỉ là cửa ghi danh tự làm thay;
//   · dòng đã huỷ/rút mà CÓ dữ liệu nghiệp vụ ⇒ chặn bằng câu nói rõ lý do, KHÔNG để P2002 thô.
//
// ⚠️ Vì sao KHÔNG nới chỉ mục duy nhất (loại trạng thái kết thúc khỏi điều kiện): đó là DDL
// trên bảng có dữ liệu prod (luật cứng #4), và nhiều chỗ đọc vẫn giả định "mỗi học viên × lớp
// có tối đa MỘT dòng chưa xoá mềm".
// ⚠️ Vì sao KHÔNG thêm CANCELLED/WITHDREW → PENDING vào `ENROLLMENT_TRANSITIONS`: các cổng khác
// (bảo lưu, gỡ lớp) đọc map đó; mở chiều quay lại là mở cho MỌI đường đổi trạng thái.
// ⚠️ TRANSFERRED không được tự gỡ: dòng đó là nguồn của chuỗi `transferredToId`.
import type { EnrollmentStatus, Prisma } from "@prisma/client";

/** Trạng thái kết thúc mà cửa ghi danh được phép tự gỡ (khi dòng sạch). */
export const TRANG_THAI_GO_DUOC = ["CANCELLED", "WITHDREW"] as const satisfies readonly EnrollmentStatus[];

export type DemNghiepVu = {
  payments: number;
  orderItems: number;
  receipts: number;
  reserves: number;
  refundRequests: number;
};

export type GhiDanhCu = { id: string; status: EnrollmentStatus; _count: DemNghiepVu };

export type XetGhiDanhCu =
  | { loai: "TRONG" }
  | { loai: "DANG_CHIEM"; status: EnrollmentStatus }
  | { loai: "GO_DUOC"; id: string; status: EnrollmentStatus }
  | { loai: "CO_DU_LIEU"; status: EnrollmentStatus };

const NHAN: Partial<Record<EnrollmentStatus, string>> = {
  PENDING: "Chờ xếp lớp",
  CONFIRMED: "Đã xếp lớp",
  STUDYING: "Đang học",
  ACTIVE: "Đang học",
  PAUSED: "Bảo lưu",
  COMPLETED: "Hoàn thành",
  WITHDREW: "Đã rút",
  TRANSFERRED: "Đã chuyển lớp",
  CANCELLED: "Đã huỷ",
};

export function nhanTrangThaiGhiDanh(s: EnrollmentStatus): string {
  return NHAN[s] ?? s;
}

/** THUẦN — phân loại dòng ghi danh (chưa xoá mềm) của học viên ở lớp đích. */
export function xetGhiDanhCu(cu: GhiDanhCu | null): XetGhiDanhCu {
  if (!cu) return { loai: "TRONG" };
  if (!(TRANG_THAI_GO_DUOC as readonly string[]).includes(cu.status)) {
    return { loai: "DANG_CHIEM", status: cu.status };
  }
  const c = cu._count;
  const tong = c.payments + c.orderItems + c.receipts + c.reserves + c.refundRequests;
  return tong > 0 ? { loai: "CO_DU_LIEU", status: cu.status } : { loai: "GO_DUOC", id: cu.id, status: cu.status };
}

/** THUẦN — câu chặn cho người dùng; `null` ⇒ được xếp (có thể kèm gỡ dòng cũ). */
export function cauChanGhiDanhCu(x: XetGhiDanhCu): string | null {
  switch (x.loai) {
    case "TRONG":
    case "GO_DUOC":
      return null;
    case "DANG_CHIEM":
      return `Học viên đã có trong lớp này (trạng thái: ${nhanTrangThaiGhiDanh(x.status)}).`;
    case "CO_DU_LIEU":
      return (
        `Học viên từng ghi danh lớp này (trạng thái: ${nhanTrangThaiGhiDanh(x.status)}) và ghi danh đó ` +
        `đã có khoản thu / biên lai / bảo lưu / hoàn tiền gắn vào, nên không tự xếp lại được. ` +
        `Liên hệ kế toán gỡ phần tiền khỏi ghi danh cũ, hoặc xếp học viên vào lớp khác.`
      );
  }
}

/**
 * Câu tra dòng cũ — mọi cửa dùng ĐÚNG hai hằng này rồi đưa kết quả cho `xetGhiDanhCu`. Không bọc
 * thành hàm nhận `db`: client của `scopedDb` không gán được vào `Prisma.TransactionClient`.
 * `deletedAt: null` ghi tường minh (hook xoá mềm cũng lọc, nhưng đường `tx` thô thì không).
 */
export function whereGhiDanhCu(studentId: string, classId: string) {
  return { studentId, classId, deletedAt: null } as const;
}

export const SELECT_GHI_DANH_CU = {
  id: true,
  status: true,
  _count: { select: { payments: true, orderItems: true, receipts: true, reserves: true, refundRequests: true } },
} as const;

export class GhiDanhCuDaDoiError extends Error {
  constructor() {
    super("Ghi danh cũ của học viên ở lớp này vừa thay đổi — tải lại trang rồi thử lại.");
    this.name = "GhiDanhCuDaDoiError";
  }
}

/**
 * GHI — xoá mềm dòng cũ đã được `xetGhiDanhCu` xếp loại `GO_DUOC`. Gọi TRONG transaction, TRƯỚC
 * `enrollment.create`. Phép ghi có ĐIỀU KIỆN (trạng thái vẫn kết thúc, vẫn chưa xoá, vẫn không có
 * dữ liệu nghiệp vụ): ai đó vừa gắn tiền vào giữa lúc đọc và lúc ghi ⇒ 0 dòng ⇒ `throw` ⇒ rollback.
 */
export async function goGhiDanhCuDaKetThuc(
  tx: Prisma.TransactionClient,
  id: string,
  moc: Date,
): Promise<void> {
  const r = await tx.enrollment.updateMany({
    where: {
      id,
      deletedAt: null,
      status: { in: [...TRANG_THAI_GO_DUOC] },
      payments: { none: {} },
      orderItems: { none: {} },
      receipts: { none: {} },
      reserves: { none: {} },
      refundRequests: { none: {} },
    },
    data: { deletedAt: moc },
  });
  if (r.count !== 1) throw new GhiDanhCuDaDoiError();
}
