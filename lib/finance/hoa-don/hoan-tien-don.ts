// lib/finance/hoa-don/hoan-tien-don.ts — YÊU CẦU HOÀN TIỀN (`RefundRequest`) của một đơn, nhìn từ màn
// hoá đơn điện tử. THUẦN (chỉ `import type`) — màn, loader và bước chốt cùng gọi.
//
// Vì sao cần (chủ dự án chốt 29/09, Q1): tiền hoàn học phí đi qua `RefundRequest` (/hoan-tien —
// nghỉ học, huỷ lớp, dừng học, đổi khoá, đề xuất tay); CHỜ / ĐÃ DUYỆT thì KHÔNG nằm trong sổ `Payment` ⇒
// `canDieuChinh` đo trên sổ Payment không thấy nó. (Từ 29/09 bước ĐÃ CHI — `chiHoanTien` — ghi dòng
// âm trỏ `adjustmentOfId` vào sổ, nên yêu cầu ĐÃ CHI còn bật thêm vế "hoàn / điều chỉnh trên khoản".) Hai việc, cả hai CHỈ BẬT CỜ — không sửa sổ tiền, không gọi
// `refundPayment`:
//   (a) hoá đơn đã xuất mà sau đó hoàn được DUYỆT ⇒ "Cần điều chỉnh" (`lyDoHoanSauMoc`);
//   (b) bản NHÁP của đơn đang có yêu cầu hoàn CHỜ / ĐÃ DUYỆT / ĐÃ CHI ⇒ nút Xác nhận tắt VÀ bước chốt từ chối —
//       CÙNG một hàm (`lyDoHoanChanXacNhan`), để màn và cổng không bao giờ lệch nhau.
// Cả (a) lẫn (b) chỉ tính yêu cầu hoàn CHẠM khoản của hoá đơn / lần thu đó (`yeuCauHoanCuaKhoan`, 29/09):
// đơn 2 bé, hoàn cho bé A không cờ / không chặn hoá đơn chỉ chứa khoản của bé B. Mơ hồ ⇒ theo cả đơn.
//
// ── Nối yêu cầu hoàn với ĐƠN ─────────────────────────────────────────────────────────────────────
// `RefundRequest` không có `orderId`. Hai đầu mối (CHECK `RefundRequest_co_nguon_check` đòi ít nhất một):
//   1. `orderItemId` → `OrderItem.orderId` — CHẮC CHẮN, một đơn. Có thì chỉ dùng nó.
//   2. `orderItemId` NULL ⇒ qua `enrollmentId`: đơn có DÒNG ĐƠN trỏ ghi danh đó (`OrderItem.enrollmentId`)
//      hoặc có KHOẢN THU gắn ghi danh đó (`Payment.enrollmentId`). ⚠️ MƠ HỒ khi một ghi danh được trả
//      bởi nhiều đơn (mua thêm / gia hạn): yêu cầu được tính cho MỌI đơn đó. Chủ ý nghiêng về phía
//      BẬT CỜ — bỏ sót một lần hoàn là hoá đơn sai nằm im; bật thừa thì kế toán nhìn là thấy.

import type { Prisma } from "@prisma/client";

/** Trạng thái nạp — bỏ REJECTED (bị từ chối thì không có tiền nào đi ra). */
export const TRANG_THAI_HOAN_CAN_NAP = ["PENDING", "APPROVED", "PAID"] as const;
/**
 * (b) — còn chờ duyệt, đã duyệt, hoặc ĐÃ CHI: số trên hoá đơn sắp xuất chưa chắc đúng. ĐÃ CHI thêm 29/09 (chủ
 * dự án chốt, 0b) — trước đó bị tha, nên bản nháp làm từ số TRƯỚC hoàn vẫn xuất được sau khi tiền đã ra khỏi quỹ.
 */
export const TRANG_THAI_HOAN_CHAN_XAC_NHAN = ["PENDING", "APPROVED", "PAID"] as const;
/** (a) — đã duyệt (kể cả đã chi): tiền khách trả thực tế đã giảm. */
export const TRANG_THAI_HOAN_DA_DUYET = ["APPROVED", "PAID"] as const;

/** Câu nút Xác nhận TẮT và câu lỗi của bước chốt — MỘT chuỗi. */
export const CAU_HOAN_CHAN_XAC_NHAN = "Đơn có yêu cầu hoàn tiền — kiểm lại số trước khi xuất";

export type YeuCauHoanVao = {
  id: string;
  status: string;
  /** `approvedAmount ?? proposedAmount`. */
  soTien: number;
  /** `approvedAt` — mốc "duyệt"; `null` ⇒ dùng `createdAt`. */
  lucDuyet: Date | null;
  createdAt: Date;
  /** Tên bé (ghi danh) hoặc tên dòng đơn — `null` khi không suy được. */
  ten: string | null;
  /**
   * 29/09 — yêu cầu này thuộc DÒNG ĐƠN / GHI DANH nào (`hoanAnhHuongKhoan`). Cả hai rỗng ⇒ MƠ HỒ ⇒ tính
   * cho cả đơn. BẮT BUỘC (luật 7): thiếu nó là mọi hoá đơn của đơn lại bị cờ / chặn theo ĐƠN.
   */
  phamVi: PhamViHoan;
};

/** Dòng đơn + ghi danh mà MỘT yêu cầu hoàn trỏ tới (đã nới qua quan hệ dòng đơn ↔ ghi danh). */
export type PhamViHoan = { orderItemIds: readonly string[]; enrollmentIds: readonly string[] };
/** Hai móc của MỘT khoản thu (`Payment.orderItemId` / `Payment.enrollmentId`). */
export type PhamViKhoan = { orderItemId: string | null; enrollmentId: string | null };

/** Điều kiện câu tra `RefundRequest` thuộc các đơn cho trước (xem đầu tệp — hai đầu mối). */
export function dieuKienHoanCuaDon(
  orderIds: readonly string[],
  trangThai: readonly (typeof TRANG_THAI_HOAN_CAN_NAP)[number][],
): Prisma.RefundRequestWhereInput {
  const ids = { in: [...orderIds] };
  return {
    status: { in: [...trangThai] },
    OR: [
      { orderItem: { orderId: ids } },
      {
        orderItemId: null,
        enrollment: {
          OR: [{ orderItems: { some: { orderId: ids } } }, { payments: { some: { orderId: ids, deletedAt: null } } }],
        },
      },
    ],
  };
}

/** Cột nạp — đủ để `hoanTheoDon` biết yêu cầu thuộc đơn nào (nhánh ghi danh lọc theo CHÍNH tập đơn). */
export function chonHoanCuaDon(orderIds: readonly string[]) {
  const ids = { in: [...orderIds] };
  return {
    id: true,
    status: true,
    proposedAmount: true,
    approvedAmount: true,
    approvedAt: true,
    createdAt: true,
    orderItemId: true,
    enrollmentId: true,
    orderItem: { select: { orderId: true, itemName: true, enrollmentId: true } },
    enrollment: {
      select: {
        student: { select: { name: true } },
        orderItems: { where: { orderId: ids }, select: { orderId: true, id: true } },
        payments: { where: { orderId: ids, deletedAt: null }, select: { orderId: true } },
      },
    },
  } satisfies Prisma.RefundRequestSelect;
}

/** Điều kiện ĐƠN "có yêu cầu hoàn ở các trạng thái này" — nhánh câu tra của màn (`loc-hang-cho.ts`). */
export function dieuKienDonCoHoan(trangThai: readonly (typeof TRANG_THAI_HOAN_CAN_NAP)[number][]): Prisma.OrderWhereInput {
  const rr = { status: { in: [...trangThai] } };
  const rrQuaGhiDanh = { ...rr, orderItemId: null };
  return {
    OR: [
      { items: { some: { refundRequests: { some: rr } } } },
      { items: { some: { enrollment: { refundRequests: { some: rrQuaGhiDanh } } } } },
      { payments: { some: { deletedAt: null, enrollment: { refundRequests: { some: rrQuaGhiDanh } } } } },
    ],
  };
}

export type HangHoan = {
  id: string;
  status: string;
  proposedAmount: number;
  approvedAmount: number | null;
  approvedAt: Date | null;
  createdAt: Date;
  orderItemId: string | null;
  enrollmentId: string | null;
  orderItem: { orderId: string; itemName: string; enrollmentId: string | null } | null;
  enrollment: {
    student: { name: string } | null;
    orderItems: readonly { orderId: string; id: string }[];
    payments: readonly { orderId: string }[];
  } | null;
};

/** Gom yêu cầu hoàn theo ĐƠN (một yêu cầu có thể thuộc nhiều đơn ở nhánh ghi danh — xem đầu tệp). */
export function hoanTheoDon(rows: readonly HangHoan[]): Map<string, YeuCauHoanVao[]> {
  const kq = new Map<string, YeuCauHoanVao[]>();
  for (const r of rows) {
    const donIds = r.orderItem
      ? [r.orderItem.orderId]
      : [...new Set([...(r.enrollment?.orderItems ?? []), ...(r.enrollment?.payments ?? [])].map((x) => x.orderId))];
    const vao: YeuCauHoanVao = {
      id: r.id,
      status: r.status,
      soTien: r.approvedAmount ?? r.proposedAmount,
      lucDuyet: r.approvedAt,
      createdAt: r.createdAt,
      ten: r.enrollment?.student?.name ?? r.orderItem?.itemName ?? null,
      phamVi: phamViCuaHoan(r),
    };
    for (const id of donIds) {
      const ds = kq.get(id) ?? [];
      ds.push(vao);
      kq.set(id, ds);
    }
  }
  return kq;
}

/** Dòng đơn + ghi danh của một yêu cầu: móc trực tiếp, nới qua `OrderItem.enrollmentId` và dòng đơn của ghi danh. */
function phamViCuaHoan(r: HangHoan): PhamViHoan {
  const oi = new Set<string>();
  const en = new Set<string>();
  if (r.orderItemId) oi.add(r.orderItemId);
  if (r.enrollmentId) en.add(r.enrollmentId);
  if (r.orderItem?.enrollmentId) en.add(r.orderItem.enrollmentId);
  // Dòng đơn của ghi danh chỉ nới khi yêu cầu KHÔNG móc dòng đơn: móc dòng đơn là đã chỉ đích danh một con.
  if (!r.orderItemId) for (const x of r.enrollment?.orderItems ?? []) oi.add(x.id);
  return { orderItemIds: [...oi], enrollmentIds: [...en] };
}

/**
 * 29/09 — CỜ HOÀN THEO KHOẢN, KHÔNG THEO CẢ ĐƠN. Yêu cầu hoàn có chạm tập khoản `khoan` (một lần thu / một
 * hoá đơn) không. Đơn 2 bé, hoàn cho bé A thì hoá đơn chỉ chứa khoản của bé B KHÔNG bị cờ / chặn.
 *
 * So trên từng CHIỀU mà cả hai phía cùng có (dòng đơn, ghi danh): trùng một chiều ⇒ chạm. Nghiêng về phía
 * BẬT (thà báo thừa — bỏ sót là hoá đơn sai nằm im) ở mọi chỗ không phân định được:
 *   · yêu cầu MƠ HỒ (không móc được dòng đơn / ghi danh nào) ⇒ chạm mọi khoản (hành vi cũ theo đơn);
 *   · khoản KHÔNG có chiều chung nào để so (khoản chưa gắn con; yêu cầu chỉ móc dòng đơn còn khoản chỉ
 *     móc ghi danh…) ⇒ chạm;
 *   · tập khoản rỗng ⇒ chạm (không biết hoá đơn chứa gì).
 * Chỉ KHÔNG chạm khi mọi khoản đều có chiều chung với yêu cầu và không chiều nào trùng.
 */
export function hoanAnhHuongKhoan(r: { phamVi: PhamViHoan }, khoan: readonly PhamViKhoan[]): boolean {
  const { orderItemIds: ois, enrollmentIds: ens } = r.phamVi;
  if (khoan.length === 0 || (ois.length === 0 && ens.length === 0)) return true;
  return khoan.some((k) => {
    let coChieuChung = false;
    if (k.orderItemId && ois.length > 0) {
      coChieuChung = true;
      if (ois.includes(k.orderItemId)) return true;
    }
    if (k.enrollmentId && ens.length > 0) {
      coChieuChung = true;
      if (ens.includes(k.enrollmentId)) return true;
    }
    return !coChieuChung;
  });
}

/** MỘT hàm lọc cho cả cờ "Cần điều chỉnh" lẫn chặn Xác nhận — yêu cầu hoàn của đơn chạm tập khoản này. */
export function yeuCauHoanCuaKhoan<T extends { phamVi: PhamViHoan }>(ds: readonly T[], khoan: readonly PhamViKhoan[]): T[] {
  return ds.filter((r) => hoanAnhHuongKhoan(r, khoan));
}

/**
 * (b) — màn (nút Xác nhận) và bước chốt (trong transaction) cùng hỏi ĐÚNG hàm này. `khoan` = khoản của lần
 * thu / hoá đơn đang xét — BẮT BUỘC (luật 7): chặn theo cả đơn là chặn oan hoá đơn của bé khác.
 */
export function lyDoHoanChanXacNhan(
  ds: readonly Pick<YeuCauHoanVao, "status" | "phamVi">[],
  khoan: readonly PhamViKhoan[],
): string | null {
  return yeuCauHoanCuaKhoan(ds, khoan).some((r) => (TRANG_THAI_HOAN_CHAN_XAC_NHAN as readonly string[]).includes(r.status))
    ? CAU_HOAN_CHAN_XAC_NHAN
    : null;
}

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
/** dd/mm theo giờ Việt Nam (+07) tường minh — không đọc múi giờ máy chủ. */
const ddmmVN = (d: Date) => {
  const iso = new Date(d.getTime() + 7 * 3600_000).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};

/**
 * (a) — yêu cầu hoàn ĐÃ DUYỆT có mốc duyệt (không có thì mốc tạo) SAU `moc` ⇒ mỗi yêu cầu một câu.
 * Cùng mốc KHÔNG tính (cùng luật biên `[CDC-01]` của bút toán Payment). `viecTiep` = việc kế toán phải
 * làm tiếp — khác nhau giữa bản đã xác nhận (huỷ) và bản "đã xuất ngoài hệ thống" (gỡ dấu).
 */
export function lyDoHoanSauMoc(ds: readonly YeuCauHoanVao[], moc: number, viecTiep: string): string[] {
  return ds
    .filter(
      (r) =>
        (TRANG_THAI_HOAN_DA_DUYET as readonly string[]).includes(r.status) && (r.lucDuyet ?? r.createdAt).getTime() > moc,
    )
    .map(
      (r) =>
        `Đã duyệt hoàn ${tien(r.soTien)} cho ${r.ten ?? "khoản trên đơn"} ngày ${ddmmVN(r.lucDuyet ?? r.createdAt)} — ${viecTiep}`,
    );
}
