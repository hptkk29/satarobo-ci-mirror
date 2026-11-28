import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/audit-log";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { coQuyenToanHeThong } from "@/lib/auth/quyen-tai-co-so";

import { donOnlineDaThuDu } from "./cap-quyen-sau-thanh-toan";
import { hoanTatHangSauThanhToan } from "./hang-sau-thanh-toan";

/**
 * V8.44 — VẬN HÀNH GIAO HÀNG TỪNG DÒNG (Commerce v2 · P0-3): nhân viên kho chuyển `OrderItemFulfillment` qua PACKING → SHIPPED → DELIVERED / FAILED.
 *   · MỖI DÒNG đi một mình (giao từng phần): đơn có 3 món thì món A DELIVERED, món B SHIPPED, món C PACKING đều hợp lệ. Không có "trạng thái đơn" lưu thứ hai — chỉ tính ra (`tongQuanGiao`).
 *   · Quyền CHUYÊN BIỆT, tách đôi (Owner M8 28/11/2026): ĐỌC danh sách + PII người nhận = `online_fulfillment:view-pii`; ĐỔI trạng thái / thử lại = `online_fulfillment:update`. Không vai nào được cấp sẵn — xem `nguoiVanHanhKho`.
 *   · Chặn chuyển sai: bảng `CHUYEN_HOP_LE` + đơn phải còn hiệu lực mới được đóng gói / giao; «thử lại» chỉ khi đơn còn đủ điều kiện nhận hàng. Mọi lần từ chối chuyển trạng thái trên dòng có thật đều ghi nhật ký.
 *   · Đồng thời/retry: chuyển có ĐIỀU KIỆN `where { id, status: tu }` ⇒ hai nhân viên bấm cùng lúc chỉ MỘT thắng (người kia nhận 409 TRANG_THAI_DA_DOI kèm trạng thái hiện tại);
 *     chuyển lại đúng đích đã đạt (bấm đúp / mạng rớt) ⇒ ok `daCo` (idempotent), KHÔNG ghi audit/thông báo lần hai.
 *   · Dấu thời gian khớp CHECK ở DB (`paidAt/shippedAt/deliveredAt`); mọi chuyển có AuditLog trước/sau CÙNG giao dịch + thông báo cho phụ huynh (dedupeKey theo dòng+trạng thái).
 *   · KHÔNG hoàn tiền / KHÔNG nhập kho lại ở đây: huỷ dòng ĐÃ THU tiền đi theo luồng hoàn tiền (P0-4). Chỉ `NEEDS_STAFF → CANCELLED` (chưa trừ kho) được huỷ ở đây — tiền vẫn do hoàn tiền xử lý.
 */
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type TrangThaiGiao = "AWAITING_PAYMENT" | "PAID" | "PACKING" | "SHIPPED" | "DELIVERED" | "FAILED" | "CANCELLED" | "RETURNED" | "NEEDS_STAFF";

/** Bảng chuyển hợp lệ: từ → các đích. Một chỗ duy nhất; mọi thứ khác bị từ chối. */
export const CHUYEN_HOP_LE: Readonly<Record<string, readonly TrangThaiGiao[]>> = {
  PAID: ["PACKING"],
  PACKING: ["SHIPPED"],
  SHIPPED: ["DELIVERED", "FAILED"],
  FAILED: ["SHIPPED"],
  NEEDS_STAFF: ["CANCELLED"],
};

export type NguoiVanHanh = { id: string; ten: string };

/** Quyền chuyên biệt của nhân viên kho — đọc PII người nhận và đổi trạng thái là HAI quyền, giữ cái này không kéo theo cái kia. */
export const QUYEN_XEM_NGUOI_NHAN = "online_fulfillment:view-pii";
export const QUYEN_CAP_NHAT_GIAO = "online_fulfillment:update";

/**
 * CỔNG DUY NHẤT của `/api/admin/online-fulfillment*`. Đơn Online không thuộc cơ sở nào và danh sách mang họ tên · SĐT · địa chỉ người nhận, nên đòi đủ BA vế trên MỘT khoá (đọc hoặc ghi):
 *   1. `checkPermission` — đi đúng cửa quyền (v1/v2 + PermissionGrant);
 *   2. cấp Hội sở (`actor.isHoLevel`, dựng từ `UserOrgRole`) hoặc Quản trị tối cao;
 *   3. CHÍNH khoá đó được giữ ở tầm toàn hệ (`coQuyenToanHeThong`) — khoá giữ ở cơ sở + một vai Hội sở khác KHÔNG ghép lại thành quyền.
 * Không so vai tại chỗ, không mượn quyền kho cũ (`inventory:*`). SUPER_ADMIN chỉ ghi ở `User.role` mà không có `UserOrgRole` ⇒ 403 (fail-closed).
 * `ghi` = false cho danh sách (mang PII), true cho đổi trạng thái / thử lại (thân phản hồi không mang PII).
 */
export async function nguoiVanHanhKho(ghi: boolean): Promise<{ ok: true; nguoi: NguoiVanHanh } | { ok: false; status: 401 | 403; ma: "UNAUTHENTICATED" | "FORBIDDEN" }> {
  const s = await auth();
  const u = s?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  if (!u?.id) return { ok: false, status: 401, ma: "UNAUTHENTICATED" };
  const khoa = ghi ? QUYEN_CAP_NHAT_GIAO : QUYEN_XEM_NGUOI_NHAN;
  if (!(await checkPermission(khoa))) return { ok: false, status: 403, ma: "FORBIDDEN" };
  const actor = await resolveActor(u.id);
  const toanHe = actor.isSuperAdmin || (actor.isHoLevel && coQuyenToanHeThong(actor, khoa));
  if (!toanHe) return { ok: false, status: 403, ma: "FORBIDDEN" };
  return { ok: true, nguoi: { id: u.id, ten: u.name ?? u.email ?? u.id } };
}

const ghiChu = z.string().trim().min(1).max(300);
export const chuyenTienDoSchema = z
  .object({
    tu: z.enum(["PAID", "PACKING", "SHIPPED", "FAILED", "NEEDS_STAFF"]),
    den: z.enum(["PACKING", "SHIPPED", "DELIVERED", "FAILED", "CANCELLED"]),
    carrier: z.string().trim().min(1).max(60).optional(),
    trackingCode: z.string().trim().min(1).max(80).optional(),
    expectedDeliveryOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ghiChu: ghiChu.optional(),
  })
  .strict();
export const thuLaiSchema = z.object({}).strict();

export type MaLoiVanHanh = "KHONG_TIM_THAY" | "CHUYEN_KHONG_HOP_LE" | "TRANG_THAI_DA_DOI" | "THIEU_GHI_CHU" | "DON_KHONG_DU_DIEU_KIEN";
export type LoiVanHanh = { ok: false; ma: MaLoiVanHanh; thongBao: string; hienTai?: TrangThaiGiao };
export const HTTP_LOI_VAN_HANH: Record<MaLoiVanHanh, number> = { KHONG_TIM_THAY: 404, CHUYEN_KHONG_HOP_LE: 422, TRANG_THAI_DA_DOI: 409, THIEU_GHI_CHU: 422, DON_KHONG_DU_DIEU_KIEN: 409 };
const loi = (ma: MaLoiVanHanh, thongBao: string, hienTai?: TrangThaiGiao): LoiVanHanh => ({ ok: false, ma, thongBao, ...(hienTai ? { hienTai } : {}) });

/** THUẦN. Ghi chú bắt buộc khi giao thất bại / huỷ (để người sau biết vì sao). */
export const canGhiChu = (den: TrangThaiGiao): boolean => den === "FAILED" || den === "CANCELLED";

/** THUẦN. Tổng quan giao của MỘT đơn từ trạng thái các dòng (không tính dòng đã huỷ). */
export function tongQuanGiao(trangThai: readonly TrangThaiGiao[]): "KHONG_CO_HANG" | "CHUA_GIAO" | "GIAO_MOT_PHAN" | "DA_GIAO_HET" | "CAN_XU_LY" {
  const con = trangThai.filter((t) => t !== "CANCELLED" && t !== "RETURNED");
  if (con.length === 0) return "KHONG_CO_HANG";
  if (con.some((t) => t === "NEEDS_STAFF" || t === "FAILED")) return "CAN_XU_LY";
  const daGiao = con.filter((t) => t === "DELIVERED").length;
  if (daGiao === con.length) return "DA_GIAO_HET";
  if (daGiao > 0 || con.some((t) => t === "SHIPPED")) return "GIAO_MOT_PHAN";
  return "CHUA_GIAO";
}

const NOI_DUNG_THONG_BAO: Partial<Record<TrangThaiGiao, { title: string; body: string }>> = {
  PACKING: { title: "Đơn hàng đang được chuẩn bị", body: "Sata Robo đang chuẩn bị sản phẩm trong đơn hàng của ba mẹ." },
  SHIPPED: { title: "Đơn hàng đang được giao", body: "Sản phẩm trong đơn hàng của ba mẹ đã được giao cho đơn vị vận chuyển." },
  DELIVERED: { title: "Đơn hàng đã được giao", body: "Sản phẩm trong đơn hàng của ba mẹ đã được giao thành công." },
  FAILED: { title: "Giao hàng chưa thành công", body: "Việc giao sản phẩm chưa thành công. Sata Robo sẽ liên hệ ba mẹ để sắp xếp lại." },
};

export type DongCanXuLy = {
  fulfillmentId: string;
  orderId: string;
  orderCode: string;
  orderItemId: string;
  tenSanPham: string | null;
  soLuong: number;
  trangThai: TrangThaiGiao;
  carrier: string | null;
  trackingCode: string | null;
  ghiChu: string | null;
  nguoiNhan: { hoTen: string | null; soDienThoai: string | null; diaChi: string | null } | null;
  capNhatLuc: string;
};

/** Danh sách dòng cần kho xử lý (mặc định PAID/PACKING/SHIPPED/FAILED/NEEDS_STAFF), cũ nhất trước; con trỏ theo (updatedAt,id). `take` ≤ 100. */
export async function danhSachDongGiao(db: Db, input: { trangThai?: TrangThaiGiao[]; take?: number; sau?: string }): Promise<{ dong: DongCanXuLy[]; tiep: string | null }> {
  const take = Math.min(Math.max(input.take ?? 50, 1), 100);
  const trangThai = input.trangThai && input.trangThai.length > 0 ? input.trangThai : (["PAID", "PACKING", "SHIPPED", "FAILED", "NEEDS_STAFF"] as TrangThaiGiao[]);
  const rows = await db.orderItemFulfillment.findMany({
    where: { status: { in: trangThai }, ...(input.sau ? { id: { gt: input.sau } } : {}) },
    orderBy: { id: "asc" },
    take: take + 1,
    select: { id: true, status: true, carrier: true, trackingCode: true, note: true, updatedAt: true, orderItem: { select: { id: true, quantity: true, product: { select: { name: true } }, order: { select: { id: true, code: true, shippingAddress: true } } } } },
  });
  const trang = rows.slice(0, take);
  return {
    dong: trang.map((r) => {
      const a = r.orderItem.order.shippingAddress as { hoTen?: string; soDienThoai?: string; soNhaDuong?: string; phuongXa?: string; tinhThanh?: string } | null;
      return {
        fulfillmentId: r.id,
        orderId: r.orderItem.order.id,
        orderCode: r.orderItem.order.code,
        orderItemId: r.orderItem.id,
        tenSanPham: r.orderItem.product?.name ?? null,
        soLuong: r.orderItem.quantity,
        trangThai: r.status as TrangThaiGiao,
        carrier: r.carrier,
        trackingCode: r.trackingCode,
        ghiChu: r.note,
        nguoiNhan: a ? { hoTen: a.hoTen ?? null, soDienThoai: a.soDienThoai ?? null, diaChi: [a.soNhaDuong, a.phuongXa, a.tinhThanh].filter(Boolean).join(", ") || null } : null,
        capNhatLuc: r.updatedAt.toISOString(),
      };
    }),
    tiep: rows.length > take ? trang[trang.length - 1]!.id : null,
  };
}

async function baoPhuHuynh(tx: Tx, fulfillmentId: string, den: TrangThaiGiao, orderItemId: string): Promise<void> {
  const nd = NOI_DUNG_THONG_BAO[den];
  if (!nd) return;
  const it = await tx.orderItem.findUnique({ where: { id: orderItemId }, select: { order: { select: { createdById: true } } } });
  const ph = it?.order.createdById;
  if (!ph) return;
  const con = await tx.student.findFirst({ where: { parentUserId: ph }, orderBy: { id: "asc" }, select: { id: true } });
  if (!con) return;
  await tx.notification.createMany({ data: [{ title: nd.title, body: nd.body, audience: "STUDENT" as const, studentId: con.id, centerId: null, isPublished: true, dedupeKey: `giao:${fulfillmentId}:${den}` }], skipDuplicates: true });
}

export type KetQuaChuyen = { ok: true; daCo: boolean; trangThai: TrangThaiGiao } | LoiVanHanh;

/** Đích làm hàng RỜI KHO ⇒ đơn phải còn hiệu lực. DELIVERED/FAILED (ghi lại hàng đã đi tới đâu) và CANCELLED (đóng dòng thiếu hàng) không đòi. */
const DICH_CAN_DON_CON_HIEU_LUC: ReadonlySet<TrangThaiGiao> = new Set(["PACKING", "SHIPPED"]);
/** Danh sách TRẮNG (fail-closed: trạng thái đơn mới mặc định bị chặn) — cùng tập với `donOnlineDaThuDu`. */
const DON_CON_HIEU_LUC: Prisma.OrderWhereInput = { deletedAt: null, status: { in: ["PENDING_PAYMENT", "CONFIRMED", "COMPLETED"] } };

/** Từ chối đáng ghi nhật ký: mọi lần cố đưa một dòng CÓ THẬT sang trạng thái không được phép. Thiếu ghi chú / id lạ không phải một lần chuyển trạng thái. */
const MA_TU_CHOI_GHI_NHAT_KY: ReadonlySet<MaLoiVanHanh> = new Set(["CHUYEN_KHONG_HOP_LE", "TRANG_THAI_DA_DOI", "DON_KHONG_DU_DIEU_KIEN"]);

/** Ghi NGOÀI giao dịch chuyển (giao dịch đó không ghi gì khi từ chối). Không chép ghi chú / PII của yêu cầu. */
async function ghiNhatKyTuChoi(db: Db, nguoi: NguoiVanHanh, fulfillmentId: string, yeuCau: Record<string, string>, tuChoi: LoiVanHanh): Promise<void> {
  if (!MA_TU_CHOI_GHI_NHAT_KY.has(tuChoi.ma)) return;
  const cu = await db.orderItemFulfillment.findUnique({ where: { id: fulfillmentId }, select: { status: true } });
  if (!cu) return;
  await writeAudit({ actor: { id: nguoi.id, name: nguoi.ten }, module: "online-fulfillment", entityType: "OrderItemFulfillment", entityId: fulfillmentId, action: "FULFILLMENT_TU_CHOI", oldValues: { status: cu.status }, newValues: { ...yeuCau, ma: tuChoi.ma }, changedFields: [] });
}

/** Chuyển tiến độ MỘT dòng. `tu` do client gửi = trạng thái họ ĐANG THẤY (khoá lạc quan). */
export async function chuyenTienDoGiao(db: Db, nguoi: NguoiVanHanh, fulfillmentId: string, raw: unknown, now: Date): Promise<KetQuaChuyen> {
  const d = chuyenTienDoSchema.parse(raw);
  const kq = await chuyenTienDoLoi(db, nguoi, fulfillmentId, d, now);
  if (!kq.ok) await ghiNhatKyTuChoi(db, nguoi, fulfillmentId, { tu: d.tu, den: d.den }, kq);
  return kq;
}

async function chuyenTienDoLoi(db: Db, nguoi: NguoiVanHanh, fulfillmentId: string, d: z.infer<typeof chuyenTienDoSchema>, now: Date): Promise<KetQuaChuyen> {
  const cho = CHUYEN_HOP_LE[d.tu];
  if (!cho || !cho.includes(d.den)) return loi("CHUYEN_KHONG_HOP_LE", `Không chuyển từ ${d.tu} sang ${d.den}`);
  if (canGhiChu(d.den) && !d.ghiChu) return loi("THIEU_GHI_CHU", "Cần ghi chú lý do khi giao thất bại hoặc huỷ dòng");
  const canDonHieuLuc = DICH_CAN_DON_CON_HIEU_LUC.has(d.den);
  const donKhongConHieuLuc = () => loi("DON_KHONG_DU_DIEU_KIEN", "Đơn không còn hiệu lực (đã huỷ, đã hoàn tiền hoặc đã xoá) — không đóng gói hay giao hàng");
  return db.$transaction(async (tx) => {
    const cu = await tx.orderItemFulfillment.findUnique({ where: { id: fulfillmentId }, select: { id: true, status: true, orderItemId: true, carrier: true, trackingCode: true, note: true } });
    if (!cu) return loi("KHONG_TIM_THAY", "Không tìm thấy dòng giao hàng");
    if (cu.status === d.den) return { ok: true as const, daCo: true, trangThai: cu.status as TrangThaiGiao }; // bấm đúp/retry: đã ở đích
    if (cu.status !== d.tu) return loi("TRANG_THAI_DA_DOI", `Dòng đã được chuyển sang ${cu.status} bởi người khác — tải lại`, cu.status as TrangThaiGiao);
    if (canDonHieuLuc && !(await tx.orderItem.findFirst({ where: { id: cu.orderItemId, order: DON_CON_HIEU_LUC }, select: { id: true } }))) return donKhongConHieuLuc();
    const data: Prisma.OrderItemFulfillmentUpdateManyMutationInput = { status: d.den };
    if (d.den === "PACKING") data.packedAt = now;
    if (d.den === "SHIPPED") {
      data.shippedAt = now;
      if (d.carrier !== undefined) data.carrier = d.carrier;
      if (d.trackingCode !== undefined) data.trackingCode = d.trackingCode;
      if (d.expectedDeliveryOn) data.expectedDeliveryOn = new Date(`${d.expectedDeliveryOn}T00:00:00.000Z`);
    }
    if (d.den === "DELIVERED") data.deliveredAt = now;
    if (d.den === "FAILED") data.failedAt = now;
    if (d.ghiChu !== undefined) data.note = d.ghiChu;
    // ĐIỀU KIỆN theo trạng thái cũ (+ đơn còn hiệu lực, cùng một câu ghi — đơn bị huỷ chen giữa hai câu vẫn không lọt): hai người cùng bấm ⇒ chỉ một cập nhật được 1 dòng.
    const r = await tx.orderItemFulfillment.updateMany({ where: { id: fulfillmentId, status: cu.status, ...(canDonHieuLuc ? { orderItem: { order: DON_CON_HIEU_LUC } } : {}) }, data });
    if (r.count === 0) {
      const nay = await tx.orderItemFulfillment.findUniqueOrThrow({ where: { id: fulfillmentId }, select: { status: true } });
      if (nay.status === d.den) return { ok: true as const, daCo: true, trangThai: nay.status as TrangThaiGiao };
      if (canDonHieuLuc && nay.status === cu.status) return donKhongConHieuLuc();
      return loi("TRANG_THAI_DA_DOI", `Dòng đã được chuyển sang ${nay.status} bởi người khác — tải lại`, nay.status as TrangThaiGiao);
    }
    await writeAudit({
      tx,
      actor: { id: nguoi.id, name: nguoi.ten },
      module: "online-fulfillment",
      entityType: "OrderItemFulfillment",
      entityId: fulfillmentId,
      action: `FULFILLMENT_${d.den}`,
      oldValues: { status: cu.status, carrier: cu.carrier, trackingCode: cu.trackingCode, note: cu.note },
      newValues: { status: d.den, ...(d.carrier ? { carrier: d.carrier } : {}), ...(d.trackingCode ? { trackingCode: d.trackingCode } : {}), ...(d.ghiChu ? { ghiChu: d.ghiChu } : {}), orderItemId: cu.orderItemId },
    });
    await baoPhuHuynh(tx, fulfillmentId, d.den, cu.orderItemId);
    return { ok: true as const, daCo: false, trangThai: d.den };
  });
}

/**
 * «THỬ LẠI» một dòng NEEDS_STAFF sau khi kho đã bổ sung hàng: đưa về AWAITING_PAYMENT rồi chạy lại cầu nối (tiêu thụ giữ kho). Kết quả hoặc PAID (đủ hàng) hoặc NEEDS_STAFF lại (vẫn thiếu).
 * Đồng thời: chuyển CÓ ĐIỀU KIỆN `status = NEEDS_STAFF`; người thứ hai nhận TRANG_THAI_DA_DOI.
 */
export async function thuLaiDongCanXuLy(db: Db, nguoi: NguoiVanHanh, fulfillmentId: string, now: Date): Promise<{ ok: true; trangThai: TrangThaiGiao } | LoiVanHanh> {
  const cu = await db.orderItemFulfillment.findUnique({ where: { id: fulfillmentId }, select: { status: true, orderItem: { select: { orderId: true } } } });
  if (!cu) return loi("KHONG_TIM_THAY", "Không tìm thấy dòng giao hàng");
  const tuChoi = async (l: LoiVanHanh) => {
    await ghiNhatKyTuChoi(db, nguoi, fulfillmentId, { thaoTac: "THU_LAI" }, l);
    return l;
  };
  if (cu.status !== "NEEDS_STAFF") return tuChoi(loi("TRANG_THAI_DA_DOI", `Dòng đang ở ${cu.status}, không phải cần xử lý`, cu.status as TrangThaiGiao));
  // Cầu nối chỉ xử lý đơn còn hiệu lực VÀ đã thu đủ. Không hỏi trước thì dòng rời NEEDS_STAFF (mất ghi chú) rồi kẹt ở AWAITING_PAYMENT, ngoài hàng đợi mặc định của kho.
  if (!(await donOnlineDaThuDu(db, cu.orderItem.orderId))) return tuChoi(loi("DON_KHONG_DU_DIEU_KIEN", "Đơn không còn hiệu lực hoặc chưa thu đủ tiền — không thử lại được", "NEEDS_STAFF"));
  const dau = await db.$transaction(async (tx) => {
    const r = await tx.orderItemFulfillment.updateMany({ where: { id: fulfillmentId, status: "NEEDS_STAFF" }, data: { status: "AWAITING_PAYMENT", note: null } });
    if (r.count === 0) return false;
    await writeAudit({ tx, actor: { id: nguoi.id, name: nguoi.ten }, module: "online-fulfillment", entityType: "OrderItemFulfillment", entityId: fulfillmentId, action: "FULFILLMENT_RETRY", oldValues: { status: "NEEDS_STAFF" }, newValues: { status: "AWAITING_PAYMENT" } });
    return true;
  });
  if (!dau) {
    const nay = await db.orderItemFulfillment.findUniqueOrThrow({ where: { id: fulfillmentId }, select: { status: true } });
    return tuChoi(loi("TRANG_THAI_DA_DOI", `Dòng đã được chuyển sang ${nay.status} bởi người khác — tải lại`, nay.status as TrangThaiGiao));
  }
  await hoanTatHangSauThanhToan(db, cu.orderItem.orderId, now);
  const sau = await db.orderItemFulfillment.findUniqueOrThrow({ where: { id: fulfillmentId }, select: { status: true } });
  // Kết quả CUỐI của lượt thử lại gắn với người bấm (cầu nối ghi dưới tên «Hệ thống» và không ghi gì khi ra PAID).
  await writeAudit({ actor: { id: nguoi.id, name: nguoi.ten }, module: "online-fulfillment", entityType: "OrderItemFulfillment", entityId: fulfillmentId, action: "FULFILLMENT_RETRY_KET_QUA", oldValues: { status: "AWAITING_PAYMENT" }, newValues: { status: sau.status } });
  return { ok: true, trangThai: sau.status as TrangThaiGiao };
}
