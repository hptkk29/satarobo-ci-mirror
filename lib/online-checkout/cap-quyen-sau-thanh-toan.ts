import type { PrismaClient } from "@prisma/client";
import { capQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { sumRecorded } from "@/lib/finance/ghi-nhan";
import { docTienChoDoiSoatCuaDonOnlineDaHuy } from "./tien-ve-don-het-nhan";

/**
 * WORKSTREAM A — CẦU NỐI "ĐƠN ONLINE ĐÃ THU ĐỦ TIỀN → QUYỀN HỌC". MỘT lối cấp (không có engine thứ hai):
 * mọi quyền học Online sinh ra từ `capQuyenHoc` (E-learning sở hữu); file này chỉ quyết ĐỊNH KHI NÀO gọi và GHI SỔ kết quả.
 *
 * Luật (mỗi cái có ca `[OCQ-*]`):
 *  1. Khoá idempotency = `onl-order:<orderItemId>` — theo DÒNG ĐƠN, không theo giao dịch ngân hàng: webhook nhận trùng, cron đối soát,
 *     nút "thử lại" đều ra CÙNG một khoá ⇒ không cấp đôi, không gia hạn đôi.
 *  2. Chỉ cấp khi đơn đã THU ĐỦ (`sumRecorded ≥ totalAmount`) và chưa huỷ/hoàn. Thu một phần ⇒ KHÔNG cấp (đơn online không có kế hoạch trả góp).
 *  3. Học được NGAY sau cấp thành công — không chờ hoá đơn, không chờ kế toán xác nhận.
 *  4. Lỗi HẠ TẦNG (ném) ⇒ thử lại với backoff, tối đa `TOI_DA_LAN_THU`, rồi `NEEDS_REVIEW`. Lỗi LUẬT (`ok:false`) ⇒ `REJECTED`, KHÔNG thử lại —
 *     tiền đã vào mà quyền không cấp được: con người xử lý (cấp tay/hoàn), có chỗ để thấy (`docHangDoiCapQuyenOnline`).
 *  5. KHÔNG BAO GIỜ ném ra đường thanh toán: caller (`lib/entitlements/hich.ts`) còn bọc try, nhưng hàm này cũng không ném khi cấp lỗi.
 *  6. Hoàn/huỷ SAU khi đã cấp: KHÔNG tự thu hồi (chính sách hoàn tiền ↔ thu hồi quyền chưa được chủ dự án chốt) — chỉ HIỆN ở hàng đợi
 *     (`hoanNhungConQuyen`) để người có quyền `onl:student:revoke` quyết.
 */

type Db = PrismaClient;

export const TOI_DA_LAN_THU = 8;
const NEN_BACKOFF_PHUT = 5;
const TRAN_BACKOFF_PHUT = 6 * 60;

export const khoaIdempotencyCapOnline = (orderItemId: string) => `onl-order:${orderItemId}`;

/** Hạn thử lại tiếp theo (THUẦN): 5, 10, 20, … phút, trần 6 giờ. `lanDaThu` đã gồm lần vừa hỏng. */
export function hanThuLai(now: Date, lanDaThu: number): Date {
  const phut = Math.min(TRAN_BACKOFF_PHUT, NEN_BACKOFF_PHUT * 2 ** Math.max(0, lanDaThu - 1));
  return new Date(now.getTime() + phut * 60_000);
}

export type KetQuaCapDong = {
  orderItemId: string;
  ketQua: "DA_CAP" | "DA_CAP_TRUOC_DO" | "TU_CHOI_LUAT" | "LOI_HA_TANG" | "CHO_THANH_TOAN";
  ma?: string;
};
export type KetQuaCapOnline = { coDongOnline: boolean; daThuDu: boolean; dong: KetQuaCapDong[] };

/** Đơn đã thu đủ chưa. Một chỗ — màn/cron/hàng đợi cùng hỏi hàm này (không chép điều kiện). */
export async function donOnlineDaThuDu(db: Db, orderId: string): Promise<boolean> {
  const don = await db.order.findFirst({ where: { id: orderId, deletedAt: null, type: "ONLINE", status: { in: ["PENDING_PAYMENT", "CONFIRMED", "COMPLETED"] } }, select: { totalAmount: true } });
  if (!don || don.totalAmount <= 0) return false;
  return (await sumRecorded(orderId)) >= don.totalAmount;
}

/**
 * Xét MỘT đơn: nếu là đơn online đã thu đủ thì cấp quyền cho từng dòng đang chờ. Gọi lại bao nhiêu lần cũng được.
 * `now` BẮT BUỘC (luật 7 + 19).
 */
export async function capQuyenOnlineChoDon(db: Db, orderId: string, now: Date): Promise<KetQuaCapOnline> {
  const cho = await db.orderOnlineGrant.findMany({
    where: { orderId, status: "PENDING" },
    select: { id: true, orderItemId: true, studentId: true, courseId: true, attempts: true },
    orderBy: { createdAt: "asc" },
  });
  if (cho.length === 0) return { coDongOnline: false, daThuDu: false, dong: [] };

  if (!(await donOnlineDaThuDu(db, orderId))) {
    return { coDongOnline: true, daThuDu: false, dong: cho.map((g) => ({ orderItemId: g.orderItemId, ketQua: "CHO_THANH_TOAN" as const })) };
  }

  // CR-01 (hợp đồng E v0.3): đơn Online CHỈ được tạo khi khoá đang bán (cổng kiểm lúc ĐẶT ĐƠN ở `taoDonOnline`), nên cổng "đang bán" lúc THU TIỀN được miễn:
  // khách đã đặt khi khoá còn bán rồi chuyển khoản sau khi trung tâm tạm dừng bán vẫn được cấp quyền (không để tiền đã thu mà quyền không cấp vì đổi trạng thái bán).
  // KHÔNG miễn: khoá không tồn tại / đã xoá, học viên không tồn tại, luật cấp (trọn đời, gia hạn…). Thiếu `Order.createdAt` ⇒ không khai (giữ hành vi cũ, đóng).
  const donGoc = await db.order.findUnique({ where: { id: orderId }, select: { createdAt: true } });
  const dong: KetQuaCapDong[] = [];
  for (const g of cho) {
    try {
      const kq = await capQuyenHoc(db, {
        studentId: g.studentId,
        courseId: g.courseId,
        loai: "MUA",
        idempotencyKey: khoaIdempotencyCapOnline(g.orderItemId),
        now,
        orderId,
        orderItemId: g.orderItemId,
        daKiemCongBanLucDatDon: donGoc?.createdAt ?? null,
      });
      // ⚠️ MỌI ghi chuyển trạng thái đều CÓ ĐIỀU KIỆN `status: "PENDING"` (updateMany): hai lượt chạy chồng (webhook + cron) không được
      // ghi đè kết quả của nhau — bản đầu `update` trần để lượt THUA đua đè `GRANTED` thành `REJECTED` (ca `[OCQ-DB-02]` bắt được).
      const daCap = async (entitlementId: string) =>
        db.orderOnlineGrant.updateMany({
          where: { id: g.id, status: "PENDING" },
          data: { status: "GRANTED", entitlementId, grantedAt: now, lastErrorCode: null, lastError: null, nextRetryAt: null, attempts: { increment: 1 } },
        });
      if (kq.ok) {
        await daCap(kq.entitlementId);
        dong.push({ orderItemId: g.orderItemId, ketQua: kq.daXuLyTruocDo ? "DA_CAP_TRUOC_DO" : "DA_CAP" });
      } else {
        // CR-02 (hợp đồng): `capQuyenHoc` kiểm khoá idempotency TRƯỚC khi khoá dòng quyền, nên lượt THUA đua cùng khoá có thể thấy quyền do lượt
        // THẮNG vừa tạo và trả lỗi luật (`KHOA_KHONG_CHO_GIA_HAN`…) dù sự kiện cấp của CHÍNH khoá này đã được ghi. Trước khi coi là lỗi luật: hỏi sổ.
        const daGhi = await db.onlEntitlementEvent.findUnique({ where: { idempotencyKey: khoaIdempotencyCapOnline(g.orderItemId) }, select: { entitlementId: true } });
        if (daGhi) {
          await daCap(daGhi.entitlementId);
          dong.push({ orderItemId: g.orderItemId, ketQua: "DA_CAP_TRUOC_DO" });
        } else {
          // Lỗi LUẬT: không thử lại. Tiền đã vào — hàng đợi cho con người thấy.
          await db.orderOnlineGrant.updateMany({
            where: { id: g.id, status: "PENDING" },
            data: { status: "REJECTED", lastErrorCode: kq.ma, lastError: kq.thongBao, nextRetryAt: null, attempts: { increment: 1 } },
          });
          dong.push({ orderItemId: g.orderItemId, ketQua: "TU_CHOI_LUAT", ma: kq.ma });
        }
      }
    } catch (e) {
      const lan = g.attempts + 1;
      const hetLan = lan >= TOI_DA_LAN_THU;
      const moTa = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 500) : "lỗi không rõ";
      try {
        await db.orderOnlineGrant.updateMany({
          where: { id: g.id, status: "PENDING" },
          data: { status: hetLan ? "NEEDS_REVIEW" : "PENDING", attempts: lan, lastErrorCode: "LOI_HA_TANG", lastError: moTa, nextRetryAt: hetLan ? null : hanThuLai(now, lan) },
        });
      } catch (e2) {
        console.error(`[online-cap-quyen] đơn ${orderId} dòng ${g.orderItemId}: không ghi được lỗi thử lại`, e2);
      }
      console.error(`[online-cap-quyen] đơn ${orderId} dòng ${g.orderItemId}: lỗi hạ tầng (lần ${lan}/${TOI_DA_LAN_THU})`, e);
      dong.push({ orderItemId: g.orderItemId, ketQua: "LOI_HA_TANG", ma: "LOI_HA_TANG" });
    }
  }
  return { coDongOnline: true, daThuDu: true, dong };
}

/**
 * ĐỐI SOÁT: mọi dòng đang chờ mà đã tới hạn thử lại (hoặc chưa từng thử) — cho cron. Gom theo đơn.
 * Bắt: (a) hạ tầng lỗi lúc webhook, (b) sổ `Payment` ghi chậm hơn lúc hích, (c) hích bị mất (tiến trình chết giữa chừng).
 */
export async function doiSoatCapQuyenOnline(db: Db, now: Date, opts: { gioiHan: number }): Promise<{ soDon: number; daCap: number; tuChoiLuat: number; loiHaTang: number; choThanhToan: number }> {
  const dongCho = await db.orderOnlineGrant.findMany({
    // Đơn đã HUỶ/HOÀN rơi khỏi hàng đợi (đơn huỷ có tiền — đã ghi sổ hoặc đang chờ đối soát — hiện ở `daHuyNhungCoTien`, không bị cron nhặt mãi).
    where: { status: "PENDING", OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }], orderItem: { order: { status: { in: ["PENDING_PAYMENT", "CONFIRMED", "COMPLETED"] } } } },
    select: { orderId: true },
    distinct: ["orderId"],
    orderBy: { createdAt: "asc" },
    take: opts.gioiHan,
  });
  const kq = { soDon: dongCho.length, daCap: 0, tuChoiLuat: 0, loiHaTang: 0, choThanhToan: 0 };
  for (const d of dongCho) {
    const r = await capQuyenOnlineChoDon(db, d.orderId, now);
    for (const x of r.dong) {
      if (x.ketQua === "DA_CAP" || x.ketQua === "DA_CAP_TRUOC_DO") kq.daCap++;
      else if (x.ketQua === "TU_CHOI_LUAT") kq.tuChoiLuat++;
      else if (x.ketQua === "LOI_HA_TANG") kq.loiHaTang++;
      else kq.choThanhToan++;
    }
  }
  return kq;
}

export type HangDoiCapQuyenOnline = {
  /** Đã thu đủ tiền nhưng quyền KHÔNG được cấp vì lỗi luật (cần người xử lý: cấp tay hoặc hoàn tiền). */
  biTuChoi: { orderId: string; orderItemId: string; studentId: string; courseId: string; ma: string | null; thongBao: string | null }[];
  /** Hạ tầng lỗi quá số lần thử. */
  canXemTay: { orderId: string; orderItemId: string; studentId: string; courseId: string; lanThu: number; loi: string | null }[];
  /**
   * Đơn đã HUỶ nhưng CÓ TIỀN: dòng vẫn chờ cấp, không ai nhặt — cần người quyết (mở lại đơn / cấp tay / hoàn). Hai số TÁCH RIÊNG, đều theo CẢ ĐƠN (đơn nhiều dòng thì lặp ở mỗi dòng):
   * `daThu` = tiền đã ghi sổ vào đơn; `choDoiSoat` = tiền về mang mã đơn mà còn nằm ở hàng chờ `UNMATCHED` của `/admin/bien-dong-so-du` (khách chuyển khoản đúng lúc / sau khi huỷ).
   */
  daHuyNhungCoTien: { orderId: string; orderItemId: string; studentId: string; courseId: string; daThu: number; choDoiSoat: number }[];
  /** Đơn đã HOÀN/HUỶ nhưng quyền học còn hiệu lực — hệ thống KHÔNG tự thu hồi (chính sách chưa chốt). */
  hoanNhungConQuyen: { orderId: string; orderItemId: string; studentId: string; courseId: string; trangThaiDon: string }[];
};

export async function docHangDoiCapQuyenOnline(db: Db, opts: { gioiHan: number }): Promise<HangDoiCapQuyenOnline> {
  const [biTuChoi, canXemTay, hoan, choDonHuy] = await Promise.all([
    db.orderOnlineGrant.findMany({ where: { status: "REJECTED" }, take: opts.gioiHan, orderBy: { updatedAt: "desc" }, select: { orderId: true, orderItemId: true, studentId: true, courseId: true, lastErrorCode: true, lastError: true } }),
    db.orderOnlineGrant.findMany({ where: { status: "NEEDS_REVIEW" }, take: opts.gioiHan, orderBy: { updatedAt: "desc" }, select: { orderId: true, orderItemId: true, studentId: true, courseId: true, attempts: true, lastError: true } }),
    db.orderOnlineGrant.findMany({
      where: { status: "GRANTED", orderItem: { order: { status: { in: ["CANCELLED", "REFUNDED"] } } } },
      take: opts.gioiHan,
      orderBy: { updatedAt: "desc" },
      select: { orderId: true, orderItemId: true, studentId: true, courseId: true, orderItem: { select: { order: { select: { status: true } } } } },
    }),
    db.orderOnlineGrant.findMany({
      where: { status: "PENDING", orderItem: { order: { status: "CANCELLED" } } },
      take: opts.gioiHan,
      orderBy: { updatedAt: "desc" },
      select: { orderId: true, orderItemId: true, studentId: true, courseId: true },
    }),
  ]);
  // Đơn có tiền ĐANG CHỜ đối soát đi từ phía TIỀN: đơn huỷ không đồng nào chiếm phần lớn cửa sổ `gioiHan` ở trên, tra một chiều từ đơn là lọt đơn có tiền.
  const choDoiSoatTheoDon = await docTienChoDoiSoatCuaDonOnlineDaHuy(db, { gioiHan: opts.gioiHan });
  const themTuPhiaTien =
    choDoiSoatTheoDon.size === 0
      ? []
      : await db.orderOnlineGrant.findMany({
          where: { orderId: { in: [...choDoiSoatTheoDon.keys()] }, status: "PENDING", orderItem: { order: { status: "CANCELLED" } } },
          orderBy: { createdAt: "asc" },
          select: { orderId: true, orderItemId: true, studentId: true, courseId: true },
        });
  const daHuyNhungCoTien: HangDoiCapQuyenOnline["daHuyNhungCoTien"] = [];
  for (const g of [...themTuPhiaTien, ...choDonHuy.filter((x) => !themTuPhiaTien.some((y) => y.orderItemId === x.orderItemId))]) {
    const daThu = await sumRecorded(g.orderId);
    const choDoiSoat = choDoiSoatTheoDon.get(g.orderId) ?? 0;
    if (daThu > 0 || choDoiSoat > 0) daHuyNhungCoTien.push({ ...g, daThu, choDoiSoat });
  }
  return {
    daHuyNhungCoTien,
    biTuChoi: biTuChoi.map((g) => ({ orderId: g.orderId, orderItemId: g.orderItemId, studentId: g.studentId, courseId: g.courseId, ma: g.lastErrorCode, thongBao: g.lastError })),
    canXemTay: canXemTay.map((g) => ({ orderId: g.orderId, orderItemId: g.orderItemId, studentId: g.studentId, courseId: g.courseId, lanThu: g.attempts, loi: g.lastError })),
    hoanNhungConQuyen: hoan.map((g) => ({ orderId: g.orderId, orderItemId: g.orderItemId, studentId: g.studentId, courseId: g.courseId, trangThaiDon: g.orderItem.order.status })),
  };
}
