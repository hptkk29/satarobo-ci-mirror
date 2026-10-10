import "server-only";
import { scopedDb } from "@/lib/db-scope";
import { maskPhone } from "@/lib/utils";
import type { Actor } from "@/lib/auth/actor";
import { WHERE_CHO_DUYET } from "@/lib/orders/cho-duyet";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { banDoTenConLead, tenConTrenDong } from "@/lib/orders/ten-con-tren-dong";
import { docHinhThucLop, khoaCuaDong } from "@/lib/orders/hinh-thuc-lop";
import type { PendingOrderCardData } from "@/app/(admin)/admin/orders/duyet/_components/order-approval-card";

/**
 * NẠP DỮ LIỆU CHO THẺ DUYỆT — một chỗ, hai màn dùng.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TÁCH RA [25/09/2026]
 *
 * Chủ dự án: *"làm riêng 1 màn duyệt riêng trên điện thoại cho qly, khi qly thấy thông
 * báo chỉ cần bấm vào xem đơn hàng cần duyệt đó và duyệt luôn"*.
 *
 * Từ nay hai màn cùng cần đúng bộ dữ liệu này: HÀNG CHỜ trên `/orders?duyet=1` (ngồi máy)
 * và MÀN MỘT ĐƠN `/orders/<id>/duyet` (cầm điện thoại). Trước đó nó nằm gọn trong
 * `khoi-cho-duyet.tsx`.
 *
 * ⚠️ Chép sang màn thứ hai là chép cả BA thứ dễ sai, và cả ba đều hỏng CÂM:
 *   · phép suy TÊN BÉ (`tenConTrenDong` + gom `LeadChild` theo lô) — chép hụt là màn
 *     điện thoại in tên KHOÁ thay tên bé, đúng con bug vừa vá sáng nay;
 *   · phép CHE SỐ ĐIỆN THOẠI theo `orders:view-pii` — chép hụt là rò PII;
 *   · danh sách `select` — thiếu một cột là thẻ trống một khối mà không ai báo lỗi.
 *
 * ⚠️ `scopedDb(actor)` là thứ giữ cách ly cơ sở. Quản lý cơ sở 1 mở link của đơn cơ sở 2
 * (ai đó gửi nhầm, hoặc gõ tay id) thì nhận mảng RỖNG — và màn gọi phải đọc đó thành
 * `notFound()`, không phải "đơn đã duyệt".
 */
export async function docTheDuyet(
  actor: Actor,
  opts: {
    /** Người xem có `orders:view-pii` không — quyết định SĐT hiện hay bị che. */
    canViewPii: boolean;
    /** Chỉ lấy ĐÚNG một đơn. Bỏ trống = lấy cả hàng chờ. */
    orderId?: string;
  },
): Promise<PendingOrderCardData[]> {
  const orders = await scopedDb(actor).order.findMany({
    where: {
      deletedAt: null,
      ...(opts.orderId ? { id: opts.orderId } : {}),
      ...WHERE_CHO_DUYET,
    },
    // Đơn CŨ NHẤT lên trước — đơn chờ lâu là đơn đang chặn sale chốt học phí.
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      code: true,
      createdAt: true,
      customerName: true,
      customerPhone: true,
      subtotal: true,
      discountAmount: true,
      discountPercent: true,
      discountReason: true,
      shippingFee: true,
      totalAmount: true,
      customerNote: true,
      internalNote: true,
      discountApprovalStatus: true,
      installmentApprovalStatus: true,
      soBuoiApprovalStatus: true,
      center: { select: { name: true } },
      paymentMethod: { select: { name: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          // ⚠️ `type` là NGUỒN DUY NHẤT trả lời "dòng này có phải khoá học không".
          // Suy từ `metadata.courseId` là sai: đo 26/09 — 523/523 dòng là
          // COURSE_ENROLLMENT nhưng chỉ 5 dòng có `courseId` trong metadata, nên phép suy
          // ấy coi 518 dòng là hàng hoá và nuốt mất nhãn số buổi của chúng.
          type: true,
          itemName: true,
          quantity: true,
          totalPrice: true,
          // `metadata` đã có ở dưới (nó chở `soBuoi`) — thẻ duyệt in ra số buổi để quản lý
          // thấy NGAY vì sao đơn vướng mốc học phần, khỏi phải mở trang đơn.
          discountAmount: true,
          discounts: true,
          student: { select: { name: true } },
          metadata: true,
          // `courseId` của ghi danh — đường tra khoá của 493/523 dòng (đo 26/09). Ba đường
          // tạo đơn ngoài form không ghi `metadata.courseId` bao giờ.
          enrollment: { select: { courseId: true, student: { select: { name: true } } } },
        },
      },
      installments: {
        orderBy: { soDot: "asc" },
        select: {
          id: true,
          soDot: true,
          amount: true,
          status: true,
          dueDate: true,
          paidAt: true,
        },
      },
    },
  });
  if (orders.length === 0) return [];

  // ⚠️ Gom ID của TOÀN BỘ tập rồi tra MỘT lượt. Tra theo từng đơn là N+1 — đúng lớp lỗi
  // đã giết `backfill-orderitem-dry.ts` bằng `P2028` ngay lượt chạy prod đầu tiên.
  const idConLead = [
    ...new Set(
      orders
        .flatMap((o) => o.items)
        .map((it) => docConLeadTuMetadata(it.metadata))
        .filter((x): x is string => x !== null),
    ),
  ];
  // ⚠️ Gom theo LÔ, y như trên. Hai câu tra này KHÔNG cần nhau nên chạy song song —
  // trang duyệt trên điện thoại là nơi mỗi lượt đi-về DB đều đếm được bằng mắt
  // (bài học "độ sâu tuần tự", `[DST-01]`).
  const idKhoa = [
    ...new Set(
      orders
        .flatMap((o) => o.items)
        .map((it) =>
          khoaCuaDong({ metadata: it.metadata, courseIdGhiDanh: it.enrollment?.courseId ?? null }),
        )
        .filter((x): x is string => x !== null),
    ),
  ];
  const [dsConLead, dsKhoa] = await Promise.all([
    idConLead.length > 0
      ? scopedDb(actor).leadChild.findMany({
          where: { id: { in: idConLead } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
    // `totalSessions` — vế PHẠM VI của luật mốc học phần. Thiếu nó thì thẻ duyệt không
    // phân biệt được "khoá 48 buổi bán lệch" với "khoá 11 buổi bán đủ", và khối giải
    // thích rơi về nhánh "không dòng nào lệch" cho MỌI đơn.
    idKhoa.length > 0
      ? scopedDb(actor).course.findMany({
          where: { id: { in: idKhoa } },
          select: { id: true, totalSessions: true },
        })
      : Promise.resolve([]),
  ]);
  const tenConLead = banDoTenConLead(dsConLead);
  const soBuoiKhoa = new Map(dsKhoa.map((c) => [c.id, c.totalSessions] as const));

  return orders.map((o) => ({
    id: o.id,
    code: o.code,
    createdAt: o.createdAt,
    customerName: o.customerName,
    // Che số điện thoại y như trang chi tiết đơn: người duyệt cần biết đơn của ai, không
    // nhất thiết phải cầm được số để gọi.
    customerPhone: opts.canViewPii ? o.customerPhone : maskPhone(o.customerPhone),
    centerName: o.center?.name ?? null,
    paymentMethodName: o.paymentMethod?.name ?? null,
    subtotal: o.subtotal,
    discountAmount: o.discountAmount,
    discountPercent: o.discountPercent,
    discountReason: o.discountReason,
    shippingFee: o.shippingFee,
    totalAmount: o.totalAmount,
    customerNote: o.customerNote,
    internalNote: o.internalNote,
    discountApprovalStatus: o.discountApprovalStatus,
    installmentApprovalStatus: o.installmentApprovalStatus,
    soBuoiApprovalStatus: o.soBuoiApprovalStatus,
    // Nhãn bé dựng Ở ĐÂY, không ở thẻ: thẻ là component hiển thị, còn phép suy "dòng này
    // của bé nào" phải nằm ở MỘT chỗ dùng chung (`ten-con-tren-dong.ts`, bộ ca `[TCD-*]`).
    items: o.items.map((it) => {
      const ht = docHinhThucLop(it.metadata);
      const idKhoaDong = khoaCuaDong({
        metadata: it.metadata,
        courseIdGhiDanh: it.enrollment?.courseId ?? null,
      });
      return {
        ...it,
        tenCon:
          tenConTrenDong(
            {
              tenHocVien: it.student?.name ?? it.enrollment?.student?.name ?? null,
              leadChildId: docConLeadTuMetadata(it.metadata),
            },
            tenConLead,
          )?.ten ?? null,
        // Đọc `metadata` bằng `docHinhThucLop` — cùng bộ đọc phòng thủ với đường tạo đơn,
        // không tự bóc khoá JSON ở đây (`metadata` có BỐN đường ghi, chỉ một qua zod).
        soBuoi: ht.soBuoi,
        tongSoBuoiKhoa: idKhoaDong ? (soBuoiKhoa.get(idKhoaDong) ?? null) : null,
        // ⚠️ Đọc từ CỘT `type`, KHÔNG suy từ `metadata.courseId` [sửa 26/09/2026].
        // Dòng sản phẩm (hộp LEGO, phí thi) không có "số buổi" nên không in nhãn; nhưng
        // suy bằng `courseId` thì 518/523 dòng KHOÁ HỌC cũng bị xếp nhầm vào đó và nhãn
        // biến mất — đúng con bug chủ dự án gặp: *"không hiển thị bao nhiêu buổi thì sao
        // biết mà duyệt"*.
        laKhoaHoc: it.type === "COURSE_ENROLLMENT",
      };
    }),
    installments: o.installments,
  }));
}

/**
 * Đơn chờ duyệt KẾ TIẾP sau một đơn — để màn điện thoại nối việc, không bắt quay ra rồi
 * tìm lại.
 *
 * ⚠️ Trả `null` khi hết. Màn gọi phải nói thẳng "hết việc rồi" chứ đừng đưa một cái nút
 * dẫn về màn rỗng (luật 12).
 */
export async function donChoDuyetKeTiep(
  actor: Actor,
  boQuaOrderId: string,
): Promise<{ id: string; code: string } | null> {
  const row = await scopedDb(actor).order.findFirst({
    where: { deletedAt: null, id: { not: boQuaOrderId }, ...WHERE_CHO_DUYET },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true },
  });
  return row ?? null;
}
