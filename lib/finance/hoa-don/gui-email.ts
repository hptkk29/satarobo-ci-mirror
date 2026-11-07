import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { enqueueEmail } from "@/lib/email/queue";
import { writeAudit } from "@/lib/audit/audit-log";
import { notifyStaff } from "@/lib/notifications/notify";
import { on, type DomainEventLite } from "@/lib/events/registry";
// Người nhận phía sale — dời sang lib/notifications (dùng chung với tiền phiếu gộp, GĐ1 POS 06/10/2026).
import { nguoiNhanPhiaSale } from "@/lib/notifications/nguoi-nhan-phia-sale";
import { NGU_CANH_EMAIL_HOA_DON } from "./dinh-kem-email";
import { laHoaDonBat } from "./feature";
import { noiDungEmailHoaDon } from "./noi-dung-email";
import { COT_NGUOI_MUA } from "./ghi-hoa-don";
import { nguoiMuaChoDon } from "./nguoi-mua";
import { chuanEmail, luotDangChay } from "./trang-thai-email";
import { LoiGuiLai } from "./loi-gui-lai";

export { LoiGuiLai, thongDiepLoiGuiLai, type MaLoiGuiLai } from "./loi-gui-lai";
import { maskEmail } from "@/lib/utils";

// lib/finance/hoa-don/gui-email.ts — gửi hoá đơn điện tử cho khách (docs/ke-toan-hoa-don/PLAN.md §7).
//
//   chốt hoá đơn (tx) ─► HoaDonGuiEmail(CHO) + sự kiện `hoa-don.gui` {guiId}
//   dispatch-events   ─► giuLuotGuiHoaDon: MỘT transaction — giành CHO→DANG_GUI + xếp EmailQueue
//                        + lưu emailQueueId. Xếp hàng lỗi ⇒ NÉM ⇒ cả hai rollback ⇒ lượt thử lại
//                        của dispatcher vẫn gửi được, và không bao giờ có hai dòng EmailQueue.
//   email-queue       ─► dinh-kem-email.ts: đọc LẠI hoá đơn, ký URL tệp, gửi, ghi DA_GUI / LOI.
//   cron email-queue  ─► doiSoatGuiHoaDon: lượt còn CHO quá 10 phút (sự kiện chết) ⇒ giành lại.
//
// Khách KHÔNG có email (mà kế toán không bỏ tick) ⇒ sự kiện `hoa-don.khong-email` ⇒ báo SALE tải
// hoá đơn trên trang đơn để gửi Zalo. Người nhận: sale phụ trách lead → người lập đơn → mọi Quản lý
// cơ sở → không ai thì ghi nhật ký "không có người nhận" (không im lặng).
//
// GĐ 8 (quyết định (3) 27/09) — CỜ TẮT ⇒ DỪNG GỬI EMAIL HOÁ ĐƠN, không huỷ: handler không giành lượt
// (lượt nằm nguyên CHO), đối soát không quét, worker loại dòng hoá đơn ngay trong câu SQL. Bật lại ⇒
// đối soát (lượt CHO quá 10 phút) gửi tiếp, cũ trước. Tham số `hoaDonBat` BẮT BUỘC (luật 7): chỗ gọi
// nào quên hỏi cờ thì `tsc` liệt kê.
// ⚠️ Tắt bằng SQL thẳng vào `SystemSetting` mất tới 300 giây mới ăn (bộ đệm `getSetting`) — tắt ở màn
// Cấu hình vận hành (xoá bộ đệm theo tag). Cổng tiền §5, bước chốt và báo sale "khách không có email"
// KHÔNG hỏi cờ này.

/** Handler `hoa-don.gui` — idempotent: lượt không còn CHO thì thôi. */
export async function giuLuotGuiHoaDon(
  guiId: string,
  opts: { hoaDonBat: boolean },
): Promise<"da-xep" | "bo-qua" | "tat-co"> {
  // Trước MỌI phép đọc/ghi: tắt cờ mà vẫn giành CHO→DANG_GUI là đẩy lượt vào hàng đợi — thư vẫn đi.
  if (!opts.hoaDonBat) return "tat-co";
  return db.$transaction(async (tx) => {
    const g = await tx.hoaDonGuiEmail.findUnique({
      where: { id: guiId },
      select: {
        trangThai: true,
        toi: true,
        hoaDon: {
          select: {
            trangThai: true,
            nguoiMuaTen: true,
            nguoiMuaDonVi: true,
            phapNhanTen: true,
            kyHieu: true,
            soHoaDon: true,
            ngayPhatHanh: true,
            tongTien: true,
            tepXmlKey: true,
            order: { select: { code: true } },
          },
        },
      },
    });
    if (!g || g.trangThai !== "CHO") return "bo-qua";
    if (g.hoaDon.trangThai !== "DA_XAC_NHAN") {
      // Hoá đơn bị thay / gỡ trước khi kịp gửi ⇒ đóng lượt, KHÔNG gửi bản cũ.
      await tx.hoaDonGuiEmail.updateMany({
        where: { id: guiId, trangThai: "CHO" },
        data: { trangThai: "LOI", loi: "Hoá đơn không còn hiệu lực trước khi gửi" },
      });
      return "bo-qua";
    }

    const gianh = await tx.hoaDonGuiEmail.updateMany({ where: { id: guiId, trangThai: "CHO" }, data: { trangThai: "DANG_GUI" } });
    if (gianh.count === 0) return "bo-qua";

    const hd = g.hoaDon;
    const nd = noiDungEmailHoaDon({
      tenNguoiMua: hd.nguoiMuaDonVi || hd.nguoiMuaTen,
      phapNhanTen: hd.phapNhanTen,
      kyHieu: hd.kyHieu,
      soHoaDon: hd.soHoaDon,
      ngayPhatHanh: hd.ngayPhatHanh ? hd.ngayPhatHanh.toISOString().slice(0, 10) : null,
      tongTien: hd.tongTien,
      maDon: hd.order.code,
      coXml: Boolean(hd.tepXmlKey),
    });
    const q = await enqueueEmail({
      tx,
      to: g.toi,
      toName: hd.nguoiMuaTen,
      subject: nd.subject,
      bodyText: nd.bodyText,
      bodyHtml: nd.bodyHtml,
      context: { type: NGU_CANH_EMAIL_HOA_DON, id: guiId },
    });
    // Xếp hàng không được ⇒ NÉM để giành chỗ rollback cùng — lượt thử lại gửi được, không kẹt DANG_GUI.
    if (!q.ok || !q.id) throw new Error(`Không xếp được email hoá đơn (lượt ${guiId})`);
    await tx.hoaDonGuiEmail.update({ where: { id: guiId }, data: { emailQueueId: q.id } });
    return "da-xep";
  });
}

/** Handler `hoa-don.khong-email` — báo người gửi tay qua Zalo. Idempotent theo dedupeKey. */
export async function baoKhongEmail(hoaDonId: string): Promise<number> {
  const hd = await db.hoaDonDienTu.findUnique({
    where: { id: hoaDonId },
    select: {
      kyHieu: true,
      soHoaDon: true,
      orderId: true,
      centerId: true,
      order: { select: { code: true, customerName: true, createdById: true, lead: { select: { assignedToId: true } } } },
    },
  });
  if (!hd) return 0;

  const nguoiNhan = await nguoiNhanPhiaSale(hd);
  const so = [hd.kyHieu, hd.soHoaDon].filter(Boolean).join("-");
  if (nguoiNhan.length === 0) {
    await writeAudit({
      actor: { id: null, name: "Hệ thống" },
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: hoaDonId,
      action: "KHONG_CO_NGUOI_NHAN_BAO",
      newValues: { orderId: hd.orderId, loai: "hoa-don.khong-email" },
      orgUnitId: hd.centerId,
    });
    return 0;
  }
  return notifyStaff({
    userIds: nguoiNhan,
    dedupeKey: `hoa-don.khong-email:${hoaDonId}`,
    title: `Hoá đơn ${so} chưa gửi được cho khách`,
    body: `Khách ${hd.order.customerName ?? ""} (đơn ${hd.order.code}) không có email — tải hoá đơn trên trang đơn để gửi qua Zalo.`,
    // `#hoa-don` — neo của khối "Hoá đơn điện tử" trên trang đơn (GĐ 7): trên điện thoại cột phải
    // nằm dưới cùng trang, không neo thì sale phải cuộn đi tìm nút tải.
    href: `/orders/${hd.orderId}#hoa-don`,
    entityId: hoaDonId,
  });
}

/**
 * Handler `hoa-don.gui-loi` (GĐ 8) — email hoá đơn hỏng HẲN ⇒ báo phía sale (gửi Zalo / lấy email
 * đúng) + kế toán đã bấm gửi (gửi lại). Idempotent theo dedupeKey, mỗi phía một khoá.
 *
 * Chỉ báo khi lời báo còn ĐÚNG lúc handler chạy: lượt vẫn LOI · hoá đơn vẫn là bản ĐÃ XÁC NHẬN (bản
 * đã huỷ thì email của nó không còn là việc của ai) · chưa có lượt gửi MỚI hơn (đã gửi lại thì lượt
 * cũ hỏng không đòi ai làm gì). Không tiền, không số điện thoại trong nội dung; email đã che.
 */
export async function baoGuiLoi(guiId: string): Promise<number> {
  const g = await db.hoaDonGuiEmail.findUnique({
    where: { id: guiId },
    select: {
      trangThai: true,
      toi: true,
      lanGui: true,
      guiBoiId: true,
      hoaDon: {
        select: {
          id: true,
          trangThai: true,
          kyHieu: true,
          soHoaDon: true,
          orderId: true,
          centerId: true,
          order: { select: { code: true, createdById: true, lead: { select: { assignedToId: true } } } },
          guiEmail: { select: { lanGui: true }, orderBy: { lanGui: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!g || g.trangThai !== "LOI") return 0;
  const hd = g.hoaDon;
  if (hd.trangThai !== "DA_XAC_NHAN") return 0;
  if ((hd.guiEmail[0]?.lanGui ?? g.lanGui) > g.lanGui) return 0;

  const sale = await nguoiNhanPhiaSale(hd);
  // Kế toán đã bấm gửi — chỉ khi còn làm việc, và không báo hai lần cho người đã nằm trong phía sale.
  const keToan =
    g.guiBoiId && !sale.includes(g.guiBoiId)
      ? await db.user.findFirst({ where: { id: g.guiBoiId, isActive: true, deletedAt: null }, select: { id: true } })
      : null;

  if (sale.length === 0 && !keToan) {
    await writeAudit({
      actor: { id: null, name: "Hệ thống" },
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: hd.id,
      action: "KHONG_CO_NGUOI_NHAN_BAO",
      newValues: { orderId: hd.orderId, loai: "hoa-don.gui-loi", guiId },
      orgUnitId: hd.centerId,
    });
    return 0;
  }

  const so = [hd.kyHieu, hd.soHoaDon].filter(Boolean).join("-");
  const title = `Email hoá đơn ${so} chưa tới được khách`;
  const moDau = `Gửi tới ${maskEmail(g.toi)} không được (đơn ${hd.order.code}).`;
  let n = 0;
  if (sale.length > 0) {
    n += await notifyStaff({
      userIds: sale,
      dedupeKey: `hoa-don.gui-loi:${guiId}`,
      title,
      body: `${moDau} Tải hoá đơn trên trang đơn để gửi qua Zalo, hoặc lấy email đúng của khách rồi báo kế toán gửi lại.`,
      href: `/orders/${hd.orderId}#hoa-don`,
      entityId: hd.id,
    });
  }
  if (keToan) {
    n += await notifyStaff({
      userIds: [keToan.id],
      dedupeKey: `hoa-don.gui-loi:${guiId}:ke-toan`,
      title,
      body: `${moDau} Mở màn Hoá đơn điện tử để gửi lại.`,
      href: `/payments/hoa-don?hoaDon=${hd.id}`,
      entityId: hd.id,
    });
  }
  return n;
}

/**
 * GĐ 8 bước 11 (quyết định (3) 27/09) — "Gửi lại email": tạo lượt gửi MỚI (`lanGui + 1`, CHO) cho hoá
 * đơn ĐÃ XÁC NHẬN + sự kiện `hoa-don.gui` ⇒ handler xếp hàng như lượt đầu. Lượt mới ⇒ khoá chống gửi
 * đôi MỚI (`hoa-don:<guiId>`) — dùng lại khoá cũ thì nhà cung cấp coi là gửi trùng và bỏ.
 *
 * Một transaction, khoá ĐƠN TRƯỚC (cùng khoá với chốt / huỷ — huỷ song song không lọt), mọi cổng
 * đứng trước phép ghi đầu tiên, từ chối = `throw`:
 *   · hoá đơn phải còn ĐÃ XÁC NHẬN;
 *   · lượt mới nhất không còn đang chạy (cùng luật nhãn trạng thái — `luotDangChay`);
 *   · `HOA_DON` ⇒ `toi` phải đúng địa chỉ chụp lúc chốt; `DON_HIEN_TAI` ⇒ `toi` phải đúng email HIỆN
 *     TẠI của đơn (người bấm đã thấy địa chỉ nào thì gửi đúng địa chỉ đó).
 * `emailNhan` của hoá đơn KHÔNG bao giờ bị ghi đè — bản chụp lúc chốt là sự thật của lúc chốt.
 * Hai người bấm cùng lúc ⇒ khoá đơn xếp hàng; lọt nữa thì `@@unique([hoaDonId, lanGui])` chặn (P2002).
 */
export async function taoLuotGuiLai(input: {
  nguoiGui: { id: string; name: string };
  orderId: string;
  hoaDonId: string;
  toi: string;
  nguon: "HOA_DON" | "DON_HIEN_TAI";
}): Promise<{ guiId: string; lanGui: number }> {
  const toi = input.toi.trim();
  try {
    return await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, input.orderId);
      const hd = await tx.hoaDonDienTu.findFirst({
        where: { id: input.hoaDonId, orderId: input.orderId },
        select: {
          trangThai: true,
          emailNhan: true,
          centerId: true,
          kyHieu: true,
          soHoaDon: true,
          guiEmail: { orderBy: { lanGui: "desc" }, take: 1, select: { lanGui: true, trangThai: true, emailQueueId: true } },
        },
      });
      if (!hd || hd.trangThai !== "DA_XAC_NHAN") throw new LoiGuiLai("DA_DOI");
      const cuoi = hd.guiEmail[0] ?? null;
      if (cuoi) {
        const q = cuoi.emailQueueId
          ? await tx.emailQueue.findUnique({ where: { id: cuoi.emailQueueId }, select: { status: true } })
          : null;
        if (luotDangChay(cuoi, q)) throw new LoiGuiLai("DANG_GUI");
      }
      if (input.nguon === "HOA_DON") {
        if (!chuanEmail(toi) || chuanEmail(hd.emailNhan) !== chuanEmail(toi)) throw new LoiGuiLai("DA_DOI");
      } else {
        const don = await tx.order.findUnique({ where: { id: input.orderId }, select: COT_NGUOI_MUA });
        if (!don || !chuanEmail(toi) || chuanEmail(nguoiMuaChoDon(don).email) !== chuanEmail(toi)) {
          throw new LoiGuiLai("EMAIL_DA_DOI");
        }
      }

      const lanGui = (cuoi?.lanGui ?? 0) + 1;
      const g = await tx.hoaDonGuiEmail.create({
        data: { hoaDonId: input.hoaDonId, lanGui, toi, trangThai: "CHO", guiBoiId: input.nguoiGui.id },
        select: { id: true },
      });
      // Tên sự kiện viết LITERAL — lưới `lib/events/khop-phat-nghe.test.ts` chỉ đọc được chuỗi literal.
      await publishEvent("hoa-don.gui", { guiId: g.id }, { tx, dedupeKey: `hoa-don.gui:${g.id}` });
      await writeAudit({
        tx,
        actor: input.nguoiGui,
        module: "finance",
        entityType: "HoaDonDienTu",
        entityId: input.hoaDonId,
        action: "GUI_LAI_EMAIL_HOA_DON",
        oldValues: { lanGuiTruoc: cuoi?.lanGui ?? null, trangThaiLuotTruoc: cuoi?.trangThai ?? null },
        newValues: { orderId: input.orderId, guiId: g.id, lanGui, nguon: input.nguon, toi },
        reason:
          input.nguon === "DON_HIEN_TAI"
            ? "Gửi tới email HIỆN TẠI của đơn (khác địa chỉ chụp lúc xác nhận hoá đơn)"
            : undefined,
        orgUnitId: hd.centerId,
      });
      return { guiId: g.id, lanGui };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new LoiGuiLai("DA_CO_NGUOI_GUI");
    throw e;
  }
}

/**
 * Đối soát trong cron `email-queue`: lượt còn CHO quá `phut` phút (sự kiện chết / hết lượt thử của
 * dispatcher / cờ vừa bật lại) ⇒ giành lại bằng chính handler. Idempotent — lượt đã xếp thì bỏ qua.
 * Cũ trước: bật lại cờ sau một đợt tắt là có cả đống lượt tồn, khách chờ lâu nhất đi trước.
 */
export async function doiSoatGuiHoaDon(now: Date, opts: { hoaDonBat: boolean; phut?: number }): Promise<number> {
  if (!opts.hoaDonBat) return 0;
  const phut = opts.phut ?? 10;
  const ket = await db.hoaDonGuiEmail.findMany({
    where: { trangThai: "CHO", createdAt: { lt: new Date(now.getTime() - phut * 60_000) } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let n = 0;
  for (const g of ket) {
    try {
      if ((await giuLuotGuiHoaDon(g.id, { hoaDonBat: true })) === "da-xep") n++;
    } catch {
      // Lượt này lỗi lần nữa thì để lần đối soát sau — không làm chết cả vòng.
    }
  }
  return n;
}

export function registerHoaDonHandlers(): void {
  // Tên sự kiện viết LITERAL — lưới `lib/events/khop-phat-nghe.test.ts` chỉ đọc được chuỗi literal.
  on("hoa-don.gui", async (e: DomainEventLite) => {
    const guiId = (e.payload as { guiId?: unknown }).guiId;
    // Cờ TẮT ⇒ sự kiện xong (DONE) mà lượt vẫn CHO — bật lại thì đối soát gửi, không cần sự kiện.
    if (typeof guiId === "string" && guiId) await giuLuotGuiHoaDon(guiId, { hoaDonBat: await laHoaDonBat() });
  });
  on("hoa-don.khong-email", async (e: DomainEventLite) => {
    const hoaDonId = (e.payload as { hoaDonId?: unknown }).hoaDonId;
    if (typeof hoaDonId === "string" && hoaDonId) await baoKhongEmail(hoaDonId);
  });
  // GĐ 8 — báo người KHÔNG hỏi cờ hoá đơn: thư đã hỏng thì người phải biết, kể cả khi màn đang tắt.
  on("hoa-don.gui-loi", async (e: DomainEventLite) => {
    const guiId = (e.payload as { guiId?: unknown }).guiId;
    if (typeof guiId === "string" && guiId) await baoGuiLoi(guiId);
  });
}
