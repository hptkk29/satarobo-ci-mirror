import "server-only";
// lib/pricing/de-xuat-doi-chuong-trinh-db.ts — DỊCH VỤ ĐỀ XUẤT / DUYỆT ĐỔI CHƯƠNG TRÌNH GIẢM (D5). DB, GHI. CHƯA NỐI vào form / tạo đơn / cổng QR (`[DXC-PIN]`).
//
// Khuôn y hệt hàng đợi quyền học (`lib/entitlements/hang-doi/hanh-dong.ts`), từng bước có lưới canh:
//   1. NGOÀI transaction: tìm qua `scopedDb(actor)` (người cấp cơ sở KHÔNG thấy cơ sở khác ⇒ "không tìm thấy") + `passesScope` (scopedDb KHÔNG che write);
//      kiểm quyền bằng `can()` v2 với TARGET cơ sở thật; kiểm cờ `billing.scopePurchaseEnabled` của cơ sở (TẮT ⇒ từ chối, không ghi gì).
//   2. TRONG transaction: `khoaDonTrongTx` TRƯỚC mọi thứ → đọc lại dòng dưới khoá → mọi cổng (trạng thái, dấu vân tay, đơn còn sửa được) → CHỈ KHI qua hết mới ghi.
//      Từ chối = `throw` (luật rollback: `return` không rollback). Phép ghi quyết định là `updateMany … where status = PENDING` (đến sau ⇒ 0 dòng ⇒ "không có gì đổi").
//   3. Nhật ký `AuditLog` ghi lên chính ĐƠN (entityType "Order") để hiện ở trang đơn dưới cổng `orders:view`: ai đề xuất · ai duyệt · lý do · kết quả · có tự duyệt không.
//
// 🔴 TẬP MÃ cuối cùng và TIỀN không được ghi ở đây: duyệt chỉ chuyển trạng thái đề xuất. Áp vào dòng đơn là bước nối riêng, chờ D3 (trần/Tổng Giám đốc) và D8.
// 🔴 Ai là "QLCS" (`QUYEN_DUYET_DE_XUAT`) là MỘT dòng ở đây. Đang dùng đúng danh sách duyệt đơn có sẵn ("ai duyệt được đơn là duyệt được", chủ dự án 25/09/2026),
//    nên Kế toán Hội sở cũng duyệt được. Muốn chỉ Quản lý cơ sở: đổi dòng này sang `laQuanLyCoSo` (lib/settings/quyen-co-so.ts) — câu hỏi mở §12.4.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { passesScope, scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { LOI_PHAM_VI_TAT, laThuHocPhiTheoPhamViBat } from "@/lib/entitlements/feature";
import { QUYEN_DUYET_DON } from "@/lib/orders/cho-duyet";
import type { CanCuThuTu } from "./gia-dinh-thu-tu";
import type { KetQuaGoiY, NguCanhGoiY } from "./goi-y-chuong-trinh";
import {
  dauVanGoiY,
  kiemDeXuat,
  xetQuyetDinh,
  type HanhDongDeXuat,
  type MaLoiDeXuat,
  type MaLoiQuyetDinh,
  type TrangThaiDeXuat,
} from "./de-xuat-doi-chuong-trinh";

/** Quyền duyệt đề xuất. MỘT chỗ — xem đầu tệp. */
export const QUYEN_DUYET_DE_XUAT = QUYEN_DUYET_DON;
/** Quyền đề xuất: người tạo được đơn tại cơ sở đó. */
export const QUYEN_DE_XUAT = "orders:create" as const;

/** Đơn còn sửa được giá khi ở các trạng thái này (đã xác nhận tiền / huỷ / hoàn thì giá đã đóng). */
const TRANG_THAI_DON_SUA_DUOC: readonly string[] = ["DRAFT", "PENDING_PAYMENT"];

export type MaLoiDichVu =
  | MaLoiDeXuat
  | MaLoiQuyetDinh
  | "KHONG_TIM_THAY"
  | "KHONG_QUYEN"
  | "PHAM_VI_TAT"
  | "DON_KHONG_CON_SUA_DUOC"
  | "DON_DA_PHAT_MA"
  | "DA_CO_DE_XUAT_CHO"
  | "LOI";

export class LoiDichVu extends Error {
  constructor(readonly ma: MaLoiDichVu, message: string) {
    super(message);
    this.name = "LoiDichVu";
  }
}

export type KetQuaDichVu =
  | { readonly ok: true; readonly daLam: boolean; readonly thongBao: string; readonly deXuatId: string; readonly trangThai: TrangThaiDeXuat }
  | { readonly ok: false; readonly ma: MaLoiDichVu; readonly error: string };

/** Gợi ý + căn cứ do MÁY CHỦ tính (không tin client). Truyền dưới dạng hàm để dịch vụ gọi lại DƯỚI KHOÁ ĐƠN — bản tính trước khoá có thể đã cũ. */
export interface GoiYDaTinh {
  readonly goiY: KetQuaGoiY;
  readonly ctx: NguCanhGoiY;
  /** Mã dùng được cho cơ sở/ngày này mà không nằm trong gợi ý. */
  readonly choPhepThem: ReadonlySet<string>;
  readonly canCu: CanCuThuTu | null;
}
/**
 * `orderItemId` do DỊCH VỤ truyền (lấy từ DB), KHÔNG do closure tự nhớ: một closure bắt nhầm dòng sẽ lưu gợi ý + dấu vân tay của dòng KHÁC mà không lỗi nào báo
 * (rà soát độc lập 19/10/2026). Người cài `TinhGoiY` chỉ được tính cho đúng dòng này.
 */
export type TinhGoiY = (tx: Prisma.TransactionClient, orderItemId: string) => Promise<GoiYDaTinh>;

const TX_OPTS = { maxWait: 15_000, timeout: 30_000 } as const;

const MO_TA_LOI_QUYET_DINH: Record<MaLoiQuyetDinh, string> = {
  LY_DO_NGAN: "Lý do từ chối phải từ 10 ký tự.",
  GOI_Y_DA_DOI: "Gợi ý của hệ thống đã thay đổi từ lúc Sale đề xuất (chính sách hoặc thứ hạng gia đình). Không duyệt bản cũ — hãy từ chối để Sale đề xuất lại.",
  CHI_NGUOI_DE_XUAT_MOI_HUY_DUOC: "Chỉ người đã đề xuất mới huỷ được đề xuất này.",
};

const loi = (ma: MaLoiDichVu, error: string): KetQuaDichVu => ({ ok: false, ma, error });

function dichLoi(e: unknown): KetQuaDichVu {
  if (e instanceof LoiDichVu) return loi(e.ma, e.message);
  // `PENDING` thứ hai cho cùng một dòng đơn va chỉ mục duy nhất từng phần.
  if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002") {
    return loi("DA_CO_DE_XUAT_CHO", "Dòng đơn này đã có một đề xuất đang chờ duyệt.");
  }
  console.error("[de-xuat-doi-chuong-trinh]", e);
  return loi("LOI", "Có lỗi khi xử lý — thử lại sau ít phút.");
}

const MO_TA_LOI_DE_XUAT: Record<MaLoiDeXuat, string> = {
  LY_DO_NGAN: "Lý do phải từ 10 ký tự.",
  DE_XUAT_RONG: "Đề xuất không thêm hay bỏ chương trình nào.",
  MA_LAP: "Một chương trình bị chọn lặp.",
  VUA_THEM_VUA_BO: "Một chương trình không thể vừa thêm vừa bỏ.",
  BO_MA_KHONG_CO_TRONG_GOI_Y: "Chỉ bỏ được chương trình mà hệ thống đang gợi ý.",
  THEM_MA_DA_CO_TRONG_GOI_Y: "Chương trình này hệ thống đã gợi ý sẵn.",
  THEM_MA_KHONG_DUNG_DUOC: "Chương trình không dùng được cho cơ sở / ngày của dòng này.",
};

interface DonTim {
  readonly id: string;
  readonly centerId: string;
  readonly status: string;
}

/** Tìm đơn của dòng qua `scopedDb` + `passesScope`; trả `null` nếu ngoài tầm nhìn của actor. */
async function timDonTrongTamNhin(actor: Actor, orderId: string): Promise<DonTim | null> {
  const don = await scopedDb(actor).order.findUnique({ where: { id: orderId }, select: { id: true, centerId: true, status: true } });
  if (!don || !don.centerId || !passesScope("Order", don, actor)) return null;
  return { id: don.id, centerId: don.centerId, status: don.status };
}

const coQuyenDuyet = (actor: Actor, centerId: string, orgUnitId: string | undefined): boolean =>
  QUYEN_DUYET_DE_XUAT.some((q) => can(actor, q, { centerId, orgUnitId }));

/**
 * Bất biến "đang có đề xuất chờ ⇒ không có mã nào đang thu tiền theo giá cũ": đơn đã có phiếu gộp MỞ, QR còn hạn hoặc tiền đã ghi nhận thì giá không còn
 * là thứ duyệt được. Kiểm ở CẢ HAI đầu — lúc ĐỀ XUẤT và lúc DUYỆT (giữa hai lúc, ghi tay tiền mặt `recordPayment` không đi qua cổng QR nên tiền vẫn vào đơn được).
 * Gọi DƯỚI khoá đơn, TRƯỚC phép ghi đầu tiên.
 *
 * ⚠️ `QrSession.expiresAt` chỉ là hạn trong ứng dụng; mã cũ còn in/gửi vẫn có thể trả được tiền vào đúng phiếu, nhưng nó KHÔNG được tính là "đang sống" ở đây
 * (quyết định cũ của `regenerateQr`). Nếu chủ dự án muốn chặt hơn thì đó là một câu hỏi mở, không phải thứ sửa im lặng.
 */
async function kiemDonChuaPhatMa(tx: Prisma.TransactionClient, orderId: string, now: Date): Promise<void> {
  const [phieuMo, qrSong, tienGhiNhan] = await Promise.all([
    tx.paymentBill.count({ where: { orderId, status: "OPEN" } }),
    tx.qrSession.count({ where: { status: "ACTIVE", expiresAt: { gt: now }, paymentRequest: { orderId } } }),
    tx.payment.count({ where: { orderId, ...KHOAN_DA_GHI_NHAN } }),
  ]);
  if (phieuMo + qrSong + tienGhiNhan > 0) {
    throw new LoiDichVu(
      "DON_DA_PHAT_MA",
      "Đơn đã có phiếu gộp đang mở, mã QR còn hạn hoặc khoản tiền đã ghi nhận — huỷ mã / xử lý khoản đó trước rồi mới đề xuất hoặc duyệt đổi chương trình giảm.",
    );
  }
}

// ═══ SALE ĐỀ XUẤT ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export interface VaoDeXuat {
  readonly actor: Actor;
  readonly nguoi: AuditActor;
  readonly orderItemId: string;
  readonly themVao: readonly string[];
  readonly boBot: readonly string[];
  readonly lyDo: string;
  readonly tinhGoiY: TinhGoiY;
  /** Đồng hồ của lượt gọi — BẮT BUỘC (luật 7 + 19). */
  readonly now: Date;
}

export async function guiDeXuat(vao: VaoDeXuat): Promise<KetQuaDichVu> {
  try {
    // 1) Ngoài giao dịch: dòng → đơn → cơ sở → quyền → cờ.
    const item = await db.orderItem.findUnique({ where: { id: vao.orderItemId }, select: { id: true, orderId: true } });
    const don = item ? await timDonTrongTamNhin(vao.actor, item.orderId) : null;
    if (!item || !don) throw new LoiDichVu("KHONG_TIM_THAY", "Không tìm thấy dòng đơn.");
    const orgUnitId = (await orgUnitIdForCenter(don.centerId)) ?? undefined;
    if (!can(vao.actor, QUYEN_DE_XUAT, { centerId: don.centerId, orgUnitId })) {
      throw new LoiDichVu("KHONG_QUYEN", "Bạn không có quyền đề xuất thay đổi chương trình giảm cho đơn của cơ sở này.");
    }
    if (!orgUnitId || !(await laThuHocPhiTheoPhamViBat(orgUnitId))) throw new LoiDichVu("PHAM_VI_TAT", LOI_PHAM_VI_TAT);

    return await db.$transaction(async (tx): Promise<KetQuaDichVu> => {
      await khoaDonTrongTx(tx, don.id);
      // 2) Dưới khoá: đọc lại đơn + tính lại gợi ý (bản trước khoá có thể đã cũ) → kiểm → mới ghi.
      const hien = await tx.order.findUnique({ where: { id: don.id }, select: { status: true, centerId: true } });
      if (!hien || hien.centerId !== don.centerId) throw new LoiDichVu("KHONG_TIM_THAY", "Không tìm thấy đơn.");
      if (!TRANG_THAI_DON_SUA_DUOC.includes(hien.status)) throw new LoiDichVu("DON_KHONG_CON_SUA_DUOC", "Đơn đã chốt — không đề xuất đổi chương trình giảm được nữa.");
      // Đã phát mã / đã có tiền ⇒ phải huỷ mã (hoặc xử lý khoản) trước rồi mới đề xuất. Không tự huỷ hộ: huỷ phiếu là đường tiền có luật riêng.
      await kiemDonChuaPhatMa(tx, don.id, vao.now);
      const g = await vao.tinhGoiY(tx, item.id);
      const kiem = kiemDeXuat({ goiY: g.goiY, themVao: vao.themVao, boBot: vao.boBot, lyDo: vao.lyDo, choPhepThem: g.choPhepThem });
      if (!kiem.ok) throw new LoiDichVu(kiem.ma, MO_TA_LOI_DE_XUAT[kiem.ma]);

      const dong = await tx.discountProgramChangeRequest.create({
        data: {
          orderId: don.id,
          orderItemId: item.id,
          centerId: don.centerId,
          orgUnitId,
          addVoucherIds: [...kiem.deXuat.themVao],
          removeVoucherIds: [...kiem.deXuat.boBot],
          reason: kiem.deXuat.lyDo,
          suggestionFingerprint: dauVanGoiY(g.goiY, g.ctx),
          suggestionSnapshot: { goiY: g.goiY, ctx: g.ctx } as unknown as Prisma.InputJsonValue,
          familyBasis: g.canCu === null ? undefined : (g.canCu as unknown as Prisma.InputJsonValue),
          proposedById: vao.actor.userId,
          proposedAt: vao.now,
        },
        select: { id: true },
      });
      await writeAudit({
        actor: vao.nguoi,
        module: "finance",
        entityType: "Order",
        entityId: don.id,
        action: "DISCOUNT_PROGRAM_CHANGE_PROPOSED",
        newValues: { deXuatId: dong.id, orderItemId: item.id, themVao: kiem.deXuat.themVao, boBot: kiem.deXuat.boBot },
        reason: kiem.deXuat.lyDo,
        orgUnitId: don.centerId,
        tx,
      });
      return { ok: true, daLam: true, thongBao: "Đã gửi đề xuất — chờ quản lý cơ sở duyệt.", deXuatId: dong.id, trangThai: "PENDING" };
    }, TX_OPTS);
  } catch (e) {
    return dichLoi(e);
  }
}

// ═══ QLCS DUYỆT / TỪ CHỐI · NGƯỜI ĐỀ XUẤT HUỶ ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface VaoQuyetDinh {
  readonly actor: Actor;
  readonly nguoi: AuditActor;
  readonly deXuatId: string;
  readonly hanhDong: HanhDongDeXuat;
  /** Bắt buộc ≥ 10 ký tự khi từ chối; tuỳ chọn khi duyệt / huỷ. */
  readonly lyDo?: string | null;
  /** Bắt buộc khi `DUYET`: tính lại gợi ý DƯỚI KHOÁ để so dấu vân tay. */
  readonly tinhGoiY?: TinhGoiY;
  readonly now: Date;
}

const TEN_HANH_DONG_NHAT_KY: Record<HanhDongDeXuat, string> = {
  DUYET: "DISCOUNT_PROGRAM_CHANGE_APPROVED",
  TU_CHOI: "DISCOUNT_PROGRAM_CHANGE_REJECTED",
  HUY: "DISCOUNT_PROGRAM_CHANGE_CANCELLED",
};

const THONG_BAO: Record<HanhDongDeXuat, string> = {
  DUYET: "Đã duyệt đề xuất.",
  TU_CHOI: "Đã từ chối đề xuất.",
  HUY: "Đã huỷ đề xuất.",
};

export async function quyetDinhDeXuat(vao: VaoQuyetDinh): Promise<KetQuaDichVu> {
  try {
    // 1) Ngoài giao dịch.
    const dong = await scopedDb(vao.actor).discountProgramChangeRequest.findUnique({ where: { id: vao.deXuatId } });
    if (!dong || !passesScope("DiscountProgramChangeRequest", dong, vao.actor)) throw new LoiDichVu("KHONG_TIM_THAY", "Không tìm thấy đề xuất.");
    const orgUnitId = dong.orgUnitId ?? (await orgUnitIdForCenter(dong.centerId)) ?? undefined;
    if (vao.hanhDong === "HUY") {
      // Người huỷ phải là người đề xuất; tầm nhìn cơ sở đã được kiểm ở trên.
      if (dong.proposedById !== vao.actor.userId) throw new LoiDichVu("CHI_NGUOI_DE_XUAT_MOI_HUY_DUOC", MO_TA_LOI_QUYET_DINH.CHI_NGUOI_DE_XUAT_MOI_HUY_DUOC);
    } else if (!coQuyenDuyet(vao.actor, dong.centerId, orgUnitId)) {
      throw new LoiDichVu("KHONG_QUYEN", "Bạn không có quyền duyệt đề xuất này tại cơ sở của đơn.");
    }
    // Cờ chỉ gác việc TẠO ra thay đổi (duyệt). TỪ CHỐI và HUỶ luôn chạy được: tắt cờ khi còn đề xuất PENDING mà khoá cả hai thì đề xuất kẹt vĩnh viễn và
    // cổng QR vẫn chặn đơn (rà soát độc lập 19/10/2026) — lối thoát duy nhất sẽ là sửa DB bằng tay.
    if (vao.hanhDong === "DUYET" && (!orgUnitId || !(await laThuHocPhiTheoPhamViBat(orgUnitId)))) throw new LoiDichVu("PHAM_VI_TAT", LOI_PHAM_VI_TAT);
    if (vao.hanhDong === "DUYET" && !vao.tinhGoiY) throw new LoiDichVu("LOI", "Thiếu bộ tính gợi ý để so dấu vân tay.");

    return await db.$transaction(async (tx): Promise<KetQuaDichVu> => {
      await khoaDonTrongTx(tx, dong.orderId);
      // 2) Dưới khoá: đọc lại đề xuất + (khi duyệt) gợi ý hiện tại → mọi cổng → mới ghi.
      const hien = await tx.discountProgramChangeRequest.findUnique({ where: { id: dong.id } });
      if (!hien) throw new LoiDichVu("KHONG_TIM_THAY", "Không tìm thấy đề xuất.");
      let dauVanHienTai = "";
      if (vao.hanhDong === "DUYET" && hien.status === "PENDING") {
        const g = await vao.tinhGoiY!(tx, hien.orderItemId);
        dauVanHienTai = dauVanGoiY(g.goiY, g.ctx);
        const don = await tx.order.findUnique({ where: { id: hien.orderId }, select: { status: true } });
        if (!don || !TRANG_THAI_DON_SUA_DUOC.includes(don.status)) throw new LoiDichVu("DON_KHONG_CON_SUA_DUOC", "Đơn đã chốt — không duyệt được nữa.");
        // Giữa lúc đề xuất và lúc duyệt có thể phát sinh mã / tiền (ghi tay tiền mặt không đi qua cổng QR) — kiểm LẠI.
        await kiemDonChuaPhatMa(tx, hien.orderId, vao.now);
        // Dấu vân tay chỉ băm gợi ý, KHÔNG băm các mã được THÊM: mã đó có thể đã bị thu hồi / hết hạn / hết suất / đổi cơ sở kể từ lúc đề xuất.
        const khongDung = hien.addVoucherIds.filter((id) => !g.choPhepThem.has(id));
        if (khongDung.length > 0) throw new LoiDichVu("THEM_MA_KHONG_DUNG_DUOC", MO_TA_LOI_DE_XUAT.THEM_MA_KHONG_DUNG_DUOC);
      }
      const kq = xetQuyetDinh({
        trangThai: hien.status,
        hanhDong: vao.hanhDong,
        dauVanLuc: hien.suggestionFingerprint,
        dauVanHienTai,
        nguoiDeXuat: hien.proposedById,
        nguoiQuyet: vao.actor.userId,
        lyDo: vao.lyDo ?? null,
      });
      if (kq.ok === "KHONG_DOI") {
        return { ok: true, daLam: false, thongBao: "Đề xuất đã được xử lý — không có gì thay đổi.", deXuatId: hien.id, trangThai: kq.trangThai };
      }
      if (kq.ok === false) throw new LoiDichVu(kq.ma, MO_TA_LOI_QUYET_DINH[kq.ma]);

      const lyDo = vao.lyDo?.trim() || null;
      const upd = await tx.discountProgramChangeRequest.updateMany({
        where: { id: hien.id, status: "PENDING" },
        data: { status: kq.trangThaiMoi, decidedById: vao.actor.userId, decidedAt: vao.now, decisionReason: lyDo },
      });
      // Đến sau trong cuộc đua: dòng đã bị bên kia chốt ⇒ không đổi gì, không ghi nhật ký.
      if (upd.count === 0) {
        return { ok: true, daLam: false, thongBao: "Đề xuất đã được xử lý — không có gì thay đổi.", deXuatId: hien.id, trangThai: hien.status };
      }
      await writeAudit({
        actor: vao.nguoi,
        module: "finance",
        entityType: "Order",
        entityId: hien.orderId,
        action: TEN_HANH_DONG_NHAT_KY[vao.hanhDong],
        oldValues: { trangThai: "PENDING" },
        newValues: {
          deXuatId: hien.id,
          orderItemId: hien.orderItemId,
          trangThai: kq.trangThaiMoi,
          nguoiDeXuat: hien.proposedById,
          nguoiQuyet: vao.actor.userId,
          tuQuyet: kq.tuQuyet,
          themVao: hien.addVoucherIds,
          boBot: hien.removeVoucherIds,
          lyDoDeXuat: hien.reason,
        },
        reason: lyDo ?? undefined,
        orgUnitId: hien.centerId,
        tx,
      });
      return { ok: true, daLam: true, thongBao: THONG_BAO[vao.hanhDong], deXuatId: hien.id, trangThai: kq.trangThaiMoi };
    }, TX_OPTS);
  } catch (e) {
    return dichLoi(e);
  }
}
