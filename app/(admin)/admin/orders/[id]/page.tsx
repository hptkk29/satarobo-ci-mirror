import Link from "next/link";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { congNoDon } from "@/lib/finance/cong-no-don";
import { DON_SACH, donNhiemTheoDon } from "@/lib/orders/don-nhiem";
import { laDonChoDuyet, lyDoChuaDuyetQr } from "@/lib/orders/cho-duyet";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { laKhoanDaXacNhan, tongDaXacNhan } from "@/lib/finance/debt";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { OrderDetailClient } from "../_components/order-detail-client";
import { NutChuyenDoi } from "../_components/nut-chuyen-doi";
import { NutXoaDonHuy } from "../_components/nut-xoa-don-huy";
import {
  duocChuyenDoi,
  lyDoChuaChuyenDoiDuoc,
  tienWebhookCuaDon,
} from "@/lib/payments/tien-webhook-vao-don";
import { SendEmailModal } from "../_components/send-email-modal";
import {
  resolveOrderPaymentConfig,
  transferContentForOrder,
  transferPhonePart,
  buildVietQrImageUrl,
  VIETQR_ADDINFO_MAX,
} from "@/lib/payments/vietqr";
import { computeDueNow } from "@/lib/payments/due-now";
import { getOrderPaymentRequests } from "@/lib/payments/payment-request";
import { loadActiveQrSessions } from "../_qr-core";
import { maskPhone, maskEmail } from "@/lib/utils";
import { laThuTienLinhHoatBat } from "@/lib/finance/feature";
import { noTheoCon } from "@/lib/finance/debt";
import { laDonPhiHocBu } from "@/lib/hoc-bu/don-phi";
import { docTrangThaiDungHoc } from "@/lib/finance/dung-hoc-con";
import { docBaoLuuCuaDon } from "@/lib/finance/bao-luu-tien";
import { NutThemCon } from "../_components/them-con-dialog";
import type { LopChon } from "../_components/doi-khoa-dialog";
import { CongNoTheoCon, type PhieuGopView } from "../_components/cong-no-theo-con";
import { docPhieuGopDangMo } from "@/lib/finance/phieu-gop";
import { docChinhSachUuDai } from "@/lib/finance/uu-dai-setting";
import { memoPhatHanh } from "@/lib/payments/memo-phat-hanh";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { banDoTenConLead } from "@/lib/orders/ten-con-tren-dong";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { napKhoiHoaDonDon } from "@/lib/finance/hoa-don/nap-khoi-hoa-don-don";
import { khoiNguoiMuaHoaDon } from "@/lib/finance/hoa-don/khoi-nguoi-mua";
import { docPhieuPosTho } from "@/lib/payments/pos/phieu-pos";
import { khaiMayChoDon } from "@/lib/payments/pos/may-o-co-so";
import { nhapPosDuocMoiCoSo } from "@/lib/payments/pos/pham-vi-nhap";
import { dungPhieuPosChoDon } from "@/lib/payments/pos/phieu-pos-luat";
import { docTheDangMoCuaDon } from "@/lib/payments/pos/the-dang-mo";

export const metadata = { title: "Chi tiết đơn hàng | Admin" };
export const dynamic = "force-dynamic";

/**
 * Che phần SĐT trong nội dung CK — CHỈ cho thứ in ra màn hình.
 *
 * VÌ SAO: nội dung CK nay là `HoTenCon_84987654321_TenKhoa`, tức SĐT phụ huynh nằm
 * NGUYÊN trong đó và được in đậm ở 3 chỗ trên trang. Vai có `orders:view` mà không
 * có `orders:view-pii` đọc lại được đủ số ⇒ việc che ô "SĐT" phía trên thành vô
 * nghĩa (và số còn nằm trong RSC payload).
 *
 * Vì sao CHE mà không ẨN HẲN khối: che xong chuỗi vẫn còn tên con + tên khoá, đủ
 * để người không có quyền PII đối chiếu đơn/sao kê bằng mắt, mà không cầm được số
 * để gọi. Ẩn hẳn thì khối "Nội dung CK" trống trơn, không giúp ai thêm điều gì.
 *
 * ⚠️ TUYỆT ĐỐI không dùng cho chuỗi nhúng vào ảnh QR: che ở đó là mã hỏng, tiền
 * không về được.
 *
 * Dùng lại `maskPhone` (hàm che DUY NHẤT của repo) + `transferPhonePart` để biết
 * chính xác đoạn nào là số — không dò regex lần hai. Đoạn SĐT luôn còn nguyên vẹn
 * trong chuỗi vì `buildTransferContent` cắt bớt TÊN CON chứ không cắt phần đuôi,
 * nên phép thay thế này không trượt.
 */
function maskPhoneInTransferContent(
  content: string,
  rawPhone: string | null | undefined,
): string {
  const phonePart = transferPhonePart(rawPhone);
  if (!phonePart || !content.includes(phonePart)) return content;
  return content.replace(phonePart, maskPhone(phonePart));
}

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * ── ĐỘ SÂU TUẦN TỰ — ĐỌC TRƯỚC KHI THÊM MỘT `await` [24/09/2026] ─────────────
 *
 * Chủ dự án: *"khi sale thao tác tạo đơn xong thì đến trang chi tiết đơn hàng thì phải
 * đợi một chút mới có nút xuất QR."*
 *
 * Không phải nút hỏng, cũng không phải phiếu thu về muộn (`ensureFullOrderRequest` chạy
 * TRONG chính transaction tạo đơn). Đo được, và nó là hai thứ cộng lại:
 *
 *  1. `app/(admin)/admin/loading.tsx` vẽ khung chờ **ngay lập tức** — sidebar + topbar
 *     giữ nguyên, nên người dùng thấy mình ĐÃ TỚI trang;
 *  2. trang này `force-dynamic` và **không có `Suspense` nào**, nên KHÔNG có gì thật hiện
 *     ra cho tới khi câu tra CUỐI CÙNG trả về. Nút "Xuất QR" nằm ở khối gần cuối ⇒ nó là
 *     thứ người bán ngồi chờ.
 *
 * Trước bản này: **21 lượt đi-về DB/quyền NỐI ĐUÔI NHAU**. Đo trên Postgres LOCAL (RTT
 * dưới 1 ms) thì chỉ riêng 10 trong số đó đã là 15 lượt đi-về / 72 ms; trên Supabase mỗi
 * lượt đắt hơn hàng chục lần và chúng CỘNG DỒN vì không lượt nào chạy song song.
 *
 * Sau bản này: **9**. Không câu tra nào bị bỏ, không câu nào đổi điều kiện — chỉ những
 * câu KHÔNG cần kết quả của nhau được gom vào cùng một `Promise.all`.
 *
 * ⚠️ **THÊM MỘT `await` MỚI THÌ GOM VÀO MỘT LÔ CÓ SẴN**, đừng nối thêm vào chuỗi. Lưới
 * `[DST-01]` (`do-sau-tuan-tu.test.ts`) đếm và sẽ đỏ — nó cố ý phiền, vì một lượt đi-về
 * thêm vào đây thì KHÔNG ai thấy trong diff, chỉ người bán thấy.
 *
 * ⚠️ Thứ tự các lô là THỨ TỰ PHỤ THUỘC, không phải thứ tự tuỳ ý: quyền → (sau khi có
 * `order`) → (sau khi biết công tắc `batThuTheoCon`). Đảo lô là đọc biến chưa gán.
 */
export default async function OrderDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate trước khi fetch order → chưa có centerId, không truyền target được (xem báo cáo).
  if (!(await checkPermission("orders:view"))) {
    redirect("/dashboard?error=unauthorized");
  }
  // ⚠️ Kiểm theo VAI, cố ý KHÔNG đẻ quyền mới cho nút "Xoá đơn" [02/10/2026]: quyền mới
  // chỉ sống sau khi bấm `seed-prod-roles.yml` (RBAC v2 đọc quyền từ DB), và quãng giữa là
  // không ai xoá được — triệu chứng sẽ là "không có quyền" chứ không phải "chưa seed".
  // Cùng lý lẽ đã dùng cho luật duyệt số buổi học phần (CLAUDE.md).
  const laQuanTriToiCao =
    (session.user as { role?: string }).role === "SUPER_ADMIN" ||
    ((session.user as { roles?: string[] }).roles ?? []).includes("SUPER_ADMIN");

  const { id } = await params;
  // Cách ly cơ sở: Order ∈ SCOPED_MODELS — findUnique qua scopedDb chống IDOR
  // (đơn cơ sở ngoài tầm nhìn → null → notFound).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const order = await sdb.order.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          product: { select: { id: true, sku: true } },
          // Học viên CỦA TỪNG DÒNG. Một đơn nay chở được nhiều con của cùng một phụ
          // huynh (mỗi con một khoá), nên `order.student` — vốn chỉ có giá trị khi
          // đơn quy về đúng MỘT em — không còn trả lời được "khoản này là của ai".
          student: { select: { id: true, name: true } },
        },
      },
      paymentMethod: true,
      student: { select: { id: true, name: true } },
      lead: { select: { id: true, parentName: true } },
      center: { select: { id: true, name: true } },
      history: { orderBy: { createdAt: "desc" } },
      // OD1 — kế hoạch 2 đợt kèm reminderDays (số ngày nhắc trước hạn đợt 2) để pre-fill.
      installments: {
        orderBy: { soDot: "asc" },
        select: {
          id: true,
          soDot: true,
          amount: true,
          status: true,
          dueDate: true,
          paidAt: true,
          reminderDays: true,
        },
      },
      // (b) PA-A 22/07 — trạng thái sổ kế toán (Payment.accountantStatus) hiển thị
      // read-only cạnh kế hoạch đợt: installment PAID = "Sale đã thu", tiền chỉ
      // "xong" khi kế toán CONFIRMED bên /payments.
      // ⚠️ 07/09/2026 — PHẢI có `deletedAt: null`. Trước đó include này KHÔNG có
      // `where` nào cả, mà bộ lọc duy nhất ở dưới (dòng ~355) chỉ soi
      // `accountantStatus === "CONFIRMED"` ⇒ khoản đã XOÁ MỀM vẫn được cộng vào ô
      // "Đã xác nhận" của màn chi tiết đơn. Tiền đã huỷ sổ vẫn hiện là tiền đã thu.
      // (Đo 07/09: 0 dòng `deletedAt != null` ở local và dev/test ⇒ đang sai 0 đ,
      // nhưng `softDeletePayment` là đường ghi có thật.)
      payments: {
        where: { deletedAt: null },
        select: { amount: true, accountantStatus: true },
      },
    },
  });
  if (!order) notFound();

  // ── LÔ QUYỀN — hỏi MỘT LƯỢT [24/09/2026] ────────────────────────────────────
  //
  // Bốn câu hỏi này không câu nào cần câu trước, nhưng trước bản này chúng là bốn lượt
  // đi-về **nối đuôi nhau**. Xem khối "ĐỘ SÂU TUẦN TỰ" ở đầu hàm: đó là lý do trang đơn
  // hiện khung chờ rồi mới có nội dung.
  //
  // ⚠️ Giữ nguyên `checkPermission` cho TỪNG quyền, đừng gộp thành một lời gọi "hỏi cả
  // bó": mỗi quyền có `target`/scope riêng, và một hàm gộp sẽ phải đoán scope chung —
  // đúng kiểu nới quyền không ai thấy.
  const [canManage, canRecordPayments, canManagePayments, canViewPii, laKeToan, hoaDonBat, duocThuThePos, coQuyenImportPos] = await Promise.all([
    // orders:manage chỉ HO_ACCOUNTANT (GLOBAL) — không cần target.
    checkPermission("orders:manage"),
    // ĐƯỜNG B — quyền RIÊNG, không dùng lại `orders:manage`. Chủ dự án chốt 18/09/2026:
    // `payments:record` để gắn khoản đã thu cho một bé, `payments:manage` để bỏ gắn.
    //
    // ⚠️ Hai cờ này chỉ quyết định VẼ NÚT hay không. Cổng thật nằm trong action
    // (`congDuongB`), và nó hỏi lại cả ba vế: quyền · phạm vi cơ sở · công tắc của ĐƠN.
    // Ẩn nút không phải là kiểm quyền.
    checkPermission("payments:record"),
    checkPermission("payments:manage"),
    // Che liên hệ khách trên PHẦN HIỂN THỊ nếu thiếu quyền. QR (nội dung CK) + gửi email
    // vẫn dùng `order` GỐC ở server (chức năng), chỉ bản `displayOrder` xuống client bị che
    // → không leak qua RSC payload.
    checkPermission("orders:view-pii"),
    // GĐ 7 hoá đơn — nhánh "kế toán cơ sở" của route tải hoá đơn (nút tải phải CÙNG luật route).
    checkPermission("payments:confirm"),
    // Cờ `billing.hoaDonEnabled` — TẮT thì không nạp, không vẽ khối "Hoá đơn điện tử".
    laHoaDonBat(),
    // GĐ1 POS (06/10/2026) — "Thu bằng thẻ POS": quyền RIÊNG (D6). Chỉ quyết VẼ nút / nạp phiếu;
    // cổng thật ở `taoPhieuPosAction` (quyền · phạm vi · cờ) và `kiemTraPhieuPosAction`.
    checkPermission("payments:pos-check"),
    // Việc 2 (09/10/2026) — quyền KHAI máy POS, chỉ để quyết ô "Chưa khai máy POS" có thành link tới màn Cơ sở không (xem
    // `khaiMay` bên dưới). Cổng thật nằm ở ba action khai máy; hỏi trong CÙNG lô quyền, không thêm lượt đi-về (`[DST-01]`).
    checkPermission("payments:import-pos"),
  ]);

  // ⚠️ CỔNG DUYỆT — CỬA THỨ HAI. Xem chú thích tại `_qr-core.ts:guardIssuable`.
  // Trang này dựng URL ảnh VietQR THẲNG (không qua `_qr-core`, không ghi `QrSession`), nên
  // gác một cửa là thủng: mở trang đơn là thấy mã QR dùng được.
  //
  // ⚠️ ĐIỀU KIỆN GỌI TỪ `lib/orders/cho-duyet.ts` [gom 25/09/2026], KHÔNG chép tay nữa.
  // Bản cũ là một chuỗi ba ngôi hai tầng, và nó có hai khuyết tật: (a) NUỐT lý do thứ hai
  // khi đơn vướng cả hai phần, (b) thêm cờ thứ ba (mốc học phần) thì phải nhớ sửa ở CẢ
  // HAI cửa — quên một cửa là QR phát ra cho đơn chưa ai ký, không lỗi nào báo.
  const lyDoChuaDuyet: string | null = lyDoChuaDuyetQr(laDonChoDuyet(order));
  // OD1b — duyệt kế hoạch trả góp 2 đợt tách khỏi orders:manage (ACCOUNTANT không có quyền duyệt).
  // order đã fetch có centerId → truyền target để scope-aware (CENTER nếu có role seed sau này).
  // BGĐ 31/07 — duyệt giảm giá nhập tay (Quản lý cơ sở).

  // Commit 4 — thanh toán 2 đợt + QR.
  // BGĐ 31/07 — QR lấy tài khoản NHẬN TIỀN theo đơn. 31/08/2026: nguồn đổi từ "theo cơ
  // sở" sang "theo PHƯƠNG THỨC đã chọn trên đơn" (lùi dần về phương thức chuyển khoản
  // của cơ sở → dùng chung → kho VietQR cũ). Xem resolveOrderPaymentConfig.
  //
  // 20/08 — nội dung CK là `HoTenCon_SdtPH_TenKhoa` (không còn mã đơn). Tính MỘT LẦN
  // ở đây rồi truyền xuống cả khối QR mức đơn lẫn bảng phiếu thu theo đợt: ba chỗ in
  // ra phải là cùng một chuỗi, lệch nhau là sale đọc một đằng QR mã một nẻo.
  // ── LÔ "SAU KHI CÓ ĐƠN" — năm câu tra, MỘT LƯỢT [24/09/2026] ────────────────
  //
  // Cả năm chỉ cần `order` (đã có ở trên); không câu nào cần kết quả của câu khác. Trước
  // bản này chúng là năm lượt đi-về **nối đuôi nhau** — xem khối "ĐỘ SÂU TUẦN TỰ" ở đầu
  // hàm.
  //
  // ⚠️ `paymentRequests` kéo lên đây chứ không nằm ở chỗ dùng: nó là nguồn của bảng
  // "Phiếu thu & QR theo đợt", tức của chính NÚT "Xuất QR" — thứ người bán chờ. Nằm cuối
  // chuỗi thì nó là lượt đi-về THỨ 21 của trang.
  const [payCfg, paidSoFar, nhiemMap, batThuTheoCon, paymentRequests, khoiHoaDon, phieuPosTho, mayPosTho] = await Promise.all([
    // BGĐ 31/07 — QR lấy tài khoản NHẬN TIỀN theo đơn. 31/08/2026: nguồn đổi từ "theo cơ
    // sở" sang "theo PHƯƠNG THỨC đã chọn trên đơn" (lùi dần về phương thức chuyển khoản
    // của cơ sở → dùng chung → kho VietQR cũ). Xem resolveOrderPaymentConfig.
    resolveOrderPaymentConfig({
      centerId: order.centerId,
      paymentMethodId: order.paymentMethodId,
    }),
    // Trục B — tổng đã ghi nhận, dùng cho SỐ IN TRÊN QR và cho khối "Công nợ đơn hàng".
    sdb.payment.aggregate({
      where: { orderId: order.id, ...KHOAN_DA_GHI_NHAN },
      _sum: { amount: true },
    }),
    // ⚠️ `bypass: true` — cổng AN TOÀN, không phải cổng hiển thị. Xem khối A3 bên dưới.
    donNhiemTheoDon(scopedDb(actor, { bypass: true }), [order.id]),
    // PHIÊN A — công tắc "thu theo con" của cơ sở giữ đơn.
    // Đơn PHÍ HỌC BÙ luôn đi đường cũ (chốt 30/09): mỗi đơn đúng MỘT bé, thu MỘT lần, QR ngay —
    // không có công nợ theo con / đợt theo con / phiếu gộp. PH hai con thì tạo hai đơn.
    laDonPhiHocBu(order.items) ? false : laThuTienLinhHoatBat(order.orgUnitId),
    // 03/08 — SỔ PHIẾU THU theo đợt (PaymentRequest).
    getOrderPaymentRequests(order.id),
    // GĐ 7 hoá đơn — khối "Hoá đơn điện tử" cho sale. Nằm TRONG lô (không `await` riêng — `[DST-01]`);
    // loader tự có nhịp 2 bên trong nhưng chạy song song với bốn câu còn lại của lô.
    hoaDonBat
      ? napKhoiHoaDonDon(actor, { orderId: order.id, xemPii: canViewPii, keToan: laKeToan })
      : null,
    // GĐ1 POS — phiếu thu thẻ của đơn + máy POS đang bật của cơ sở giữ đơn. Gác bằng QUYỀN, KHÔNG
    // bằng `batThuTheoCon` (T8: cờ tắt giữa chừng thì sale vẫn phải xem được khoản đã quẹt).
    // Nằm TRONG lô (`[DST-01]`); dựng view ở dưới là phép THUẦN, không thêm lượt đi-về.
    duocThuThePos ? docPhieuPosTho(order.id) : null,
    duocThuThePos && order.centerId
      ? sdb.posTerminal.findMany({
          where: { centerId: order.centerId, active: true },
          select: { id: true, maThietBi: true, maQuay: true, ten: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);
  // Bản ĐẦY ĐỦ — thứ duy nhất được nhúng vào ảnh QR.
  //
  // ⚠️ Trần ký tự lấy TỪ `VIETQR_ADDINFO_MAX` (lib/payments/vietqr.ts), KHÔNG khai
  // lại số 25 ở đây. Chuỗi này và chuỗi mà `_qr-core.ts#addInfoFor` nhúng vào QR
  // theo từng phiếu thu PHẢI là một; hai chỗ giữ hai hằng riêng thì chỉ cần một
  // người sửa lệch là sale đọc một đằng, QR mã một nẻo — mà không có test nào bắt
  // được vì mỗi bên tự nhất quán với chính nó.
  const transferContent = transferContentForOrder(
    {
      studentName: order.student?.name,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      courseName: order.items[0]?.itemName,
    },
    VIETQR_ADDINFO_MAX,
  );
  // QR in SỐ PHẢI THU NGAY, không phải tổng đơn: khách chọn 2 đợt thì quét đóng
  // đợt 1. Dùng chung `computeDueNow` với webhook SePay — hai bên phải cùng một
  // con số, lệch là QR in một đằng máy đối khớp một nẻo (khách trả đúng vẫn bị
  // xếp vào "trả thiếu → xử lý tay").
  const dueNow = computeDueNow({
    totalAmount: order.totalAmount,
    paidAmount: paidSoFar._sum.amount ?? 0,
    installments: order.installments,
    installmentApprovalStatus: order.installmentApprovalStatus,
  });
  // Bộ số in ra khối "Công nợ đơn hàng" — TÁI DÙNG `paidSoFar` (trục B) đã tính ở
  // trên cho mã QR, nên số trên màn và số trong QR không thể lệch nhau. Trục A lấy
  // Trục A ở đây CỐ Ý dùng bộ lọc GỘP (`laKhoanDaXacNhan`), KHÁC cổng phụ huynh —
  // xem ghi chú dài ở khối `accounting` bên dưới.
  //
  // Trước bản này `paidSoFar` chỉ dùng cho QR rồi bị bỏ: trang tính được "còn thiếu"
  // mà không in ra đâu cả.
  /**
   * ── BƯỚC A3 [16/09/2026]: ĐƠN CÓ DỮ LIỆU HỎNG THÌ NÓI RA NGAY ĐẦU TRANG ─────
   *
   * Chủ dự án: *"màn đơn hiện banner 'Đang chờ sửa dữ liệu'"*. Người mở đơn phải biết
   * TRƯỚC KHI thao tác, chứ không phải bấm "Xuất QR" rồi mới ăn một câu từ chối.
   *
   * ⚠️ `bypass: true` — đây là cổng AN TOÀN, không phải cổng hiển thị. Đơn này người dùng
   * đã qua scope ở trên rồi; nếu phép phán xét lại bị lọc theo tầm nhìn thì một đơn nhiễm
   * nằm ngoài tầm nhìn sẽ hiện ra là SẠCH.
   */
  const donNhiem = nhiemMap.get(order.id) ?? DON_SACH;

  // PHIÊN A — công nợ theo từng con. Chỉ tính khi CÔNG TẮC BẬT cho cơ sở giữ đơn: tắt thì
  // trang giữ nguyên y như cũ, không thêm một truy vấn nào.
  //
  // ⚠️ `noTheoCon` cố ý đọc bằng `db` TRẦN (không `scopedDb`) — chốt của chủ dự án: *"cùng một
  // đơn, ai mở cũng ra cùng con số"*. Cách ly cơ sở đã ép ở cửa vào: tới được dòng này nghĩa là
  // `scopedDb` đã cho phép đọc chính cái đơn này.
  // ── LÔ "THU THEO CON" — sáu câu tra, MỘT LƯỢT [24/09/2026] ──────────────────
  //
  // Cả sáu chỉ phụ thuộc vào `batThuTheoCon` + `order.id`, không câu nào cần câu trước.
  // Trước bản này chúng nối đuôi nhau — sáu lượt đi-về **chỉ có ở đơn đã bật công tắc**,
  // tức đúng những đơn của luồng mới.
  //
  // ⚠️ Công tắc TẮT thì cả sáu vẫn KHÔNG chạy câu nào (`Promise.resolve` của nhánh else),
  // đúng như lời hứa "tắt thì không thêm một truy vấn nào" trong các chú thích dưới.
  // GĐ1 POS (rà đối kháng 06/10/2026, T8): đơn còn phiếu thu thẻ thì VẪN đọc phiếu gộp đang mở dù cờ
  // vừa tắt — mã vẫn nhận tiền (`thuTheoPhieuGop` không hỏi cờ), hộp POS phải in đúng số còn phải thu
  // thay vì "Phiếu gộp không còn khoản phải thu". QR / bảng phiếu gộp vẫn theo cờ (`phieuMo` dưới).
  const coPhieuPos = (phieuPosTho?.length ?? 0) > 0;
  const [soTheoCon, trangThaiDungHoc, lopThoRaw, khoaChonDuoc, baoLuuRaw, phieuMoTho, theDangMo, hapThu, conLead] =
    await Promise.all([
      batThuTheoCon ? noTheoCon(order.id) : Promise.resolve(null),
      // PHIÊN D — trạng thái dừng học của từng dòng.
      batThuTheoCon ? docTrangThaiDungHoc(order.id) : Promise.resolve(undefined),
      // F4 — lớp chọn được khi đổi khoá. Chỉ lớp CÒN NHẬN học sinh và khoá ĐÃ CÓ GIÁ: lớp đã
      // huỷ/kết thúc thì `chuyenLopTrongTx` từ chối, khoá chưa khai giá thì cổng soát giá từ
      // chối — mời chọn chúng là lời hứa suông (luật 12).
      batThuTheoCon
        ? sdb.class.findMany({
            where: {
              deletedAt: null,
              status: { notIn: ["CANCELLED", "COMPLETED"] },
              course: { isActive: true, price: { gt: 0 } },
            },
            select: {
              id: true,
              name: true,
              course: { select: { name: true, price: true } },
            },
            orderBy: { name: "asc" },
            take: 200,
          })
        : Promise.resolve([]),
      // F3 — khoá học chọn được khi thêm con. Chỉ khoá ĐANG BÁN và ĐÃ CÓ GIÁ: khoá chưa khai
      // giá thì cổng soát giá ở máy chủ từ chối, nên mời chọn nó là một lời hứa suông (luật 12).
      batThuTheoCon
        ? sdb.course.findMany({
            where: { isActive: true, price: { gt: 0 } },
            select: { id: true, name: true, price: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      // F2 — con nào đang bảo lưu + hạn đợt đã dời bao nhiêu ngày. Hỏi RIÊNG ở trang, cố ý
      // KHÔNG nhồi vào `noTheoCon`: hàm đó chạy trong transaction của mọi phép ghi tiền nên mỗi
      // câu tra thêm ở đó là thêm thời gian nằm dưới khoá đơn cho một thông tin chỉ để hiển thị.
      batThuTheoCon ? docBaoLuuCuaDon(order.id) : Promise.resolve(null),
      // ── PHIÊN C · phiếu gộp đang mở [20/09/2026] ──
      batThuTheoCon || coPhieuPos ? docPhieuGopDangMo(order.id) : Promise.resolve(null),
      // ── THẺ POS ĐANG MỞ của phiếu gộp [hai nút QR / Thẻ POS, 09/10/2026] ──
      //
      // ⚠️ Gác theo CỜ như phiếu gộp, KHÔNG gác theo quyền `payments:pos-check` (khác `docPhieuPosTho` ở lô trên):
      // người chỉ có `payments:record` (CENTER_ACCOUNTANT) vẫn thấy nút QR và nút Huỷ phiếu, mà `phieuPos` luôn
      // `null` với họ — lấy "có thẻ đang mở" từ `phieuPos` là để họ thấy panel QR bung sẵn lúc khách đang quẹt, và
      // một nút Huỷ mà máy chủ chắc chắn từ chối (luật 12). Cờ tắt thì `phieuGop` cũng null ⇒ không cần hỏi.
      // Nằm TRONG lô (`[DST-01]`): hàm tự có nhịp 2 bên trong nhưng chạy song song với các câu còn lại.
      batThuTheoCon ? docTheDangMoCuaDon(order.id, new Date()) : Promise.resolve(null),
      // Rà vòng 4 (luật 12) — chính sách "giảm muộn trừ vào đợt nào": form miễn giảm cần nó để
      // NÓI TRƯỚC đợt nào sẽ bị huỷ (mã phiếu gộp của cả nhà). CÙNG hàm `mienGiamNoAction` đọc.
      batThuTheoCon
        ? docChinhSachUuDai(order.orgUnitId).then((cs) => cs.hapThu)
        : Promise.resolve(null),
      // ── TÊN CON CỦA LEAD [25/09/2026] ──
      //
      // Chủ dự án: *"2 con học cùng khoá thì sao biết là đang giảm đơn cho con nào?"*
      // `noTheoCon` trả về `leadChildId` của từng dòng nhưng KHÔNG tra tên — cố ý, vì nó
      // chạy trong transaction của mọi phép ghi tiền. Tra ở đây, MỘT lượt theo lô, đúng
      // khuôn `lib/reports/revenue-by-child.ts`.
      //
      // ⚠️ Không tốn lượt đi-về nào khi đơn không có dòng nào gắn con lead (`in: []` thì
      // bỏ qua hẳn câu tra). `LeadChild` không nằm trong `SCOPED_MODELS` nên `sdb` không
      // lọc mất dòng nào.
      (() => {
        const ids = [
          ...new Set(
            order.items
              .map((it) => docConLeadTuMetadata(it.metadata))
              .filter((x): x is string => x !== null),
          ),
        ];
        return ids.length > 0
          ? sdb.leadChild.findMany({
              where: { id: { in: ids } },
              select: { id: true, fullName: true },
            })
          : Promise.resolve([] as { id: string; fullName: string }[]);
      })(),
    ]);

  // Bản đồ tra tên con lead. Dựng MỘT lần ở đây rồi truyền xuống: mỗi nơi tự dựng là mỗi
  // nơi có thể dựng khác nhau, và nhãn tiền thì không được có hai phiên bản.
  const tenConLead = banDoTenConLead(conLead);
  const phieuMo = batThuTheoCon ? phieuMoTho : null;

  const lopChonDuoc: LopChon[] = lopThoRaw.map((l) => ({
    id: l.id,
    name: l.name,
    courseName: l.course?.name ?? "",
    coursePrice: l.course?.price ?? null,
  }));
  const baoLuuTheoCon = baoLuuRaw ? Object.fromEntries(baoLuuRaw) : undefined;
  let phieuGop: PhieuGopView | null = null;
  if (phieuMo) {
    // Nội dung CK lấy từ `memoPhatHanh` — CHỖ DUY NHẤT quyết định khuôn mới hay cũ. Dựng
    // chuỗi tại đây bằng tay là đẻ ra một khuôn thứ hai, và khuôn thứ hai thì có ngày lệch.
    const memo = await memoPhatHanh({
      orgUnitId: order.orgUnitId,
      hoTen: order.student?.name ?? order.customerName,
      sdt: order.customerPhone,
      maMoi: phieuMo.ma,
      tran: VIETQR_ADDINFO_MAX,
    });
    phieuGop = {
      ...phieuMo,
      // ⚠️ QR nhận bản ĐẦY ĐỦ, phần HIỂN THỊ mới che — y hệt khối QR mức đơn ở dưới. Nhúng
      // bản che vào ảnh QR là mã hỏng, tiền không về được.
      qrUrl:
        canViewPii && !lyDoChuaDuyet
          ? buildVietQrImageUrl(payCfg, phieuMo.tongTien, memo.noiDung)
          : null,
      noiDungCk: canViewPii
        ? memo.noiDung
        : maskPhoneInTransferContent(memo.noiDung, order.customerPhone),
      theDangMo,
    };
  }

  // GĐ1 POS — MỘT phiếu thu thẻ lên màn (mới nhất của phiếu gộp đang mở, không có thì mới nhất còn
  // ý nghĩa). Thuần: `phieuMo` đã có ở lô trên. Số GÕ VÀO MÁY là còn phải thu HIỆN TẠI của phiếu gộp.
  const phieuPos = phieuPosTho
    ? dungPhieuPosChoDon({ ds: phieuPosTho, phieuMo: phieuMoTho, now: new Date() })
    : null;
  const mayPos = mayPosTho.map((m) => ({ id: m.id, nhan: m.maQuay ?? m.ten ?? m.maThietBi }));
  // Ô "Chưa khai máy POS" (T10): `title` chỉ đường tới mục "Máy POS quẹt thẻ" của CƠ SỞ GIỮ ĐƠN, và là LINK chỉ khi người xem GHI
  // được máy — cùng hàm `duocKhaiMayPos` với chính mục đó (quyền `import-pos` ∧ tầm nhìn mọi cơ sở). Thuần: tên cơ sở lấy từ
  // `order.center` đã include, không câu tra mới.
  const khaiMay = khaiMayChoDon({
    don: order,
    coQuyenGhi: coQuyenImportPos,
    phamViGhiMoiCoSo: nhapPosDuocMoiCoSo(actor),
  });

  const congNo = congNoDon({
    totalAmount: order.totalAmount,
    daGhiNhan: paidSoFar._sum.amount ?? 0,
    daXacNhan: tongDaXacNhan(order.payments.filter(laKhoanDaXacNhan)),
  });
  // ⚠️ QR nhận bản ĐẦY ĐỦ (`transferContent`), KHÔNG phải bản che: mã phải mang đúng
  // nội dung phụ huynh sẽ chuyển, che ở đây là tiền không về được.
  //
  // ⚠️ VÌ THẾ, thiếu `orders:view-pii` thì KHÔNG dựng URL ảnh QR luôn. URL có dạng
  // `img.vietqr.io/...?addInfo=NguyenVanA_84987654321_Sata4` — nó đi thẳng vào
  // `<img src>` trong DOM và vào RSC payload, tức SĐT ĐẦY ĐỦ vẫn lọt xuống client dù
  // chuỗi in ra màn hình đã che (đo được ở vòng soi 3 — khối comment cũ ở đây khẳng
  // định ngược lại là SAI).
  //
  // Vì sao ẨN QR chứ không proxy ảnh qua route của mình: proxy là hạ tầng mới (route
  // ảnh + gác quyền + chống IDOR theo orderId) cho một vai mà HÔM NAY KHÔNG AI GIỮ —
  // mọi vai có `orders:view` trong seed-roles đều có kèm `orders:view-pii`. Ẩn là
  // hành vi trung thực và đúng bản chất: không được xem SĐT thì cũng không được cầm
  // mã QR, vì mã QR CHÍNH LÀ SĐT đó ở dạng khác.
  const qrUrl =
    canViewPii && !lyDoChuaDuyet
      ? buildVietQrImageUrl(payCfg, dueNow.amount, transferContent)
      : null;
  // Bản HIỂN THỊ — mọi chỗ in nội dung CK ra màn hình (khối QR mức đơn, bảng phiếu
  // thu theo đợt, hộp phóng to QR) đều nhận chuỗi này. Che số nhưng GIỮ tên con +
  // tên khoá để người không có quyền PII vẫn đối chiếu đơn/sao kê bằng mắt được.
  const transferContentShown = canViewPii
    ? transferContent
    : maskPhoneInTransferContent(transferContent, order.customerPhone);

  // Phiên QR ACTIVE còn hạn của từng phiếu (`paymentRequests` đã tra ở LÔ trên). Đây là
  // nguồn của bảng "Phiếu thu & QR theo đợt"; `OrderQrSection` (QR mức ĐƠN, hành vi cũ)
  // chỉ còn là lối lùi cho đơn CHƯA có phiếu thu nào — đơn cũ tạo trước khi có sổ này.
  // Xoá hẳn sẽ làm những đơn đó mất luôn QR.
  const qrSessions = await loadActiveQrSessions(
    actor,
    paymentRequests.map((r) => ({ id: r.id, matchKey: r.matchKey })),
    // Đây là PHẦN NGƯỜI ĐỌC (`TenCon_84SĐT_MaKhoa`), KHÔNG phải chuỗi in ra: khoá đối
    // khớp do `noiDungCkChoPhieu` ghép thêm theo TỪNG PHIẾU ở trong core, vì mỗi đợt một
    // khoá. Truyền bản che được vì thiếu `orders:view-pii` thì core trả RỖNG (không phiên
    // nào xuống client), nên chuỗi tới đây luôn là bản đầy đủ.
    transferContentShown,
    // Cùng một câu trả lời quyền cho cả trang: thiếu `orders:view-pii` → core trả
    // RỖNG, không phiên QR nào xuống client (ảnh QR của từng đợt cũng mang SĐT đầy
    // đủ trong `imageSrc`). Truyền tường minh thay vì để core tự suy, để cờ này và
    // `qrUrl` ở trên chắc chắn đi cùng một nguồn `checkPermission`.
    { canViewPii },
  );

  // ── LÔ "CHỈ KHI CÓ QUYỀN SỬA" — hai câu tra, MỘT LƯỢT [24/09/2026] ──────────
  const [emailTemplates, paymentMethods, tienWebhook] = await Promise.all([
    canManage
      ? sdb.emailTemplate.findMany({
          where: {
            isActive: true,
            trigger: { in: ["ORDER_CONFIRMATION", "PAYMENT_RECEIPT", "MANUAL"] },
          },
          select: { id: true, name: true, trigger: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    // G4 (3c) — danh sách phương thức để đổi PTTT (chỉ cần khi có quyền sửa).
    // 30/08/2026 — lọc theo CƠ SỞ CỦA ĐƠN ngay tại nguồn: ở đây đã có `order.centerId`
    // nên không cần đẩy cả danh mục xuống client rồi lọc lại. Phương thức dùng chung
    // (centerId null) luôn nằm trong danh sách — bỏ chúng đi là đơn nào cũng mất tiền mặt.
    canManage
      ? sdb.paymentMethod.findMany({
          where: {
            isActive: true,
            OR: [{ centerId: null }, { centerId: order.centerId }],
          },
          orderBy: { displayOrder: "asc" },
          select: {
            id: true,
            name: true,
            centerId: true,
            canBuyCourse: true,
            canBuyPackage: true,
            canBuyExam: true,
            canBuyProduct: true,
          },
        })
      : Promise.resolve([]),
    // Tiền webhook đã đối khớp vào đơn — điều kiện mở nút Chuyển đổi [29/09/2026].
    // Gom vào LÔ SẴN CÓ chứ không thêm một `await` nối đuôi: màn này đã có 21 lượt
    // đi-về tuần tự trước bản vá 24/09, và `[DST-01]` đếm đúng con số ấy.
    tienWebhookCuaDon(order.id),
  ]);

  return (
    /* Trần bề ngang 104rem (1664px) thay cho `max-w-5xl` (1024px) cũ.
       `max-w-5xl` là lý do màn 1531px bỏ trống hơn nửa bề ngang trong khi khối QR —
       công cụ thu tiền — bị đẩy xuống dưới cả ghi chú và lịch sử. Vẫn phải CÓ trần:
       ở 4k/8k một trang trải hết bề ngang thì mắt phải quét cả mét để đọc một cặp
       nhãn/giá trị. */
    <div className="mx-auto w-full max-w-[104rem]">
      <Link
        href="/orders"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Quay lại danh sách
      </Link>


      <OrderDetailClient
        order={
          canViewPii
            ? order
            : {
                ...order,
                customerPhone: order.customerPhone ? maskPhone(order.customerPhone) : order.customerPhone,
                customerEmail: order.customerEmail ? maskEmail(order.customerEmail) : order.customerEmail,
                customerCccd: null,
                customerAddress: null,
                // 29/09 — MST cũng là PII (PLAN GĐ 7 mục 12): không đi xuống client đầy đủ.
                invoiceTaxCode: order.invoiceTaxCode ? maskPhone(order.invoiceTaxCode) : order.invoiceTaxCode,
                // Email nhận hoá đơn cũng là PII — che cùng cửa với `customerEmail`,
                // nếu không thì khối "Người mua trên hoá đơn" thành đường vòng đọc email.
                invoiceEmail: order.invoiceEmail
                  ? maskEmail(order.invoiceEmail)
                  : order.invoiceEmail,
              }
        }
        canManage={canManage}
        // Cùng con số mà trang dùng để giấu ảnh VietQR — bảng phiếu thu phải biết,
        // kẻo nút "Xuất QR" sáng trong khi `guardIssuable` luôn từ chối.
        lyDoChuaDuyet={lyDoChuaDuyet}
        // ⚠️ Khối "Công nợ theo con" dựng CUỐI CỘT TRÁI qua slot `khoiCuoi`, KHÔNG đặt
        // sau `<OrderDetailClient>`. Đặt sau là nằm ngoài lưới hai cột, mà `<aside>` cột
        // phải có `lg:self-start` nên nó không kéo cột trái cao theo — cột trái hụt bao
        // nhiêu thì màn hình trống bấy nhiêu (đo thật: ~200px trắng dưới nút "Sửa kế
        // hoạch thanh toán"). Lý do đầy đủ ở chính prop `khoiCuoi`.
        khoiCuoi={
          // Cột trái đã có `space-y-5`, nên KHÔNG bọc thêm `<div className="mt-4">`:
          // bọc là cộng hai lớp khoảng cách và khối này thụt xuống lệch với anh em.
          //
          // `&& hapThu` (rà vòng 4): chính sách hấp thụ đọc CÙNG công tắc với `soTheoCon`
          // (nhánh else `Promise.resolve(null)`), nên vế này chỉ thu hẹp kiểu cho prop BẮT
          // BUỘC — tắt công tắc thì khối vẫn KHÔNG dựng, như cũ.
          soTheoCon && hapThu && (
            <CongNoTheoCon
              orderId={order.id}
              so={soTheoCon}
              tenConLead={Object.fromEntries(tenConLead)}
              duocSua={canManage}
              duocGan={canRecordPayments}
              duocBoGan={canManagePayments}
              dungHoc={trangThaiDungHoc}
              baoLuu={baoLuuTheoCon}
              themCon={
                khoaChonDuoc.length > 0 ? (
                  <NutThemCon orderId={order.id} khoa={khoaChonDuoc} phieu={phieuGop} />
                ) : null
              }
              lopDoiKhoa={lopChonDuoc}
              phieu={phieuGop}
              hapThu={hapThu}
              // PHIÊN J — đợt CẤP ĐƠN đang sống, nguồn của bảng "chia đợt theo con".
              //
              // ⚠️ Lọc `orderItemId === null`: bảng chia học phí các con vào các đợt CỦA ĐƠN,
              // nên đợt theo con (nếu đơn có) KHÔNG được lẫn vào — lẫn vào là đếm hai lần.
              // `status !== "VOID"` vì đợt đã huỷ không còn là lịch thu; `installmentNo > 0`
              // loại phiếu "thu toàn đơn" (số 0), vốn không phải một đợt.
              //
              // Dùng lại `paymentRequests` đã tra ở lô trên — KHÔNG thêm lượt đi-về nào.
              dotDon={paymentRequests
                .filter((r) => r.orderItemId === null && r.installmentNo > 0 && r.status !== "VOID")
                .map((r) => ({
                  installmentNo: r.installmentNo,
                  amountDue: r.amountDue,
                  dueDate: r.dueDate,
                }))}
              // Q-L — form miễn giảm nói trước bằng CHÍNH `keHoachMienGiam` đường ghi dùng: MỌI phiếu thu
              // (số đã rót = tiền THẬT, không cộng phần tha) + kế hoạch đợt. Dùng lại hai tập đã tra ở trên.
              phieuThu={paymentRequests.map((r) => ({
                id: r.id,
                orderItemId: r.orderItemId,
                installmentNo: r.installmentNo,
                amountDue: r.amountDue,
                dueDate: r.dueDate,
                status: r.status,
                daRot: r.allocated,
              }))}
              keHoachDon={order.installments.map((i) => ({ soDot: i.soDot, amount: i.amount, status: i.status }))}
              // Rà vòng 6 — phiếu toàn đơn dựng lại = tổng đơn sau miễn (đúng số đường ghi dùng).
              tongDon={order.totalAmount}
            />
          )
        }
        hanhDongPhu={
          <>
            {/* ── NÚT CHUYỂN ĐỔI [29/09/2026] ────────────────────────────────────
                Chủ dự án: *"thêm nút chuyển đổi, để sang màn chuyển đổi ở trang chi
                tiết đơn hàng (khi xác nhận có số tiền đã thu do hệ thống xác nhận) để
                add học viên vào lớp"*, và nói rõ điều kiện: *"chỉ cần webhook xác nhận
                có tiền vào tài khoản với đúng nội dung CK của đơn hàng là được"*.

                ⚠️ ĐIỀU KIỆN KHÔNG PHẢI ô "ĐÃ THU" trên màn này. Ô đó là Trục B (sale
                bấm đã thu) — người khai, không phải ngân hàng báo. Điều kiện thật là
                `BankTransaction → PaymentAllocation → PaymentRequest → Order`; xem
                `lib/payments/tien-webhook-vao-don.ts`.

                ⚠️ LUÔN HIỆN, kể cả khi chưa đủ điều kiện — nút mờ kèm lý do. Ẩn nút là
                để sale tự đoán vì sao không chuyển đổi được (luật 12). */}
            <NutChuyenDoi
              orderId={order.id}
              duocChuyenDoi={duocChuyenDoi(tienWebhook)}
              lyDoKhoa={lyDoChuaChuyenDoiDuoc(tienWebhook)}
              soTienWebhook={tienWebhook.soTien}
            />
            {/* Xoá đơn ĐÃ HUỶ — component tự ẩn khi đơn chưa huỷ hoặc người xem không
                phải Quản trị tối cao. Server kiểm lại CẢ HAI vế trong
                `xoaDonDaHuyAction`: ẩn nút KHÔNG phải là kiểm quyền. */}
            <NutXoaDonHuy
              orderId={order.id}
              maDon={order.code}
              trangThai={order.status}
              duocXoa={laQuanTriToiCao}
            />
            {canManage ? (
              <SendEmailModal
                orderId={order.id}
                defaultEmail={order.customerEmail}
                defaultName={order.customerName}
                templates={emailTemplates}
              />
            ) : null}
          </>
        }
        qrUrl={qrUrl}
        dueNow={dueNow}
        transferContent={transferContentShown}
        paymentRequests={paymentRequests.map((r) => ({
          id: r.id,
          orderItemId: r.orderItemId,
          installmentNo: r.installmentNo,
          amountDue: r.amountDue,
          allocated: r.allocated,
          dueDate: r.dueDate ? r.dueDate.toISOString() : null,
          status: r.status,
          matchKey: r.matchKey,
        }))}
        qrSessions={qrSessions}
        // ── 24/09/2026 · QR theo đợt dùng mã 5 ký tự ──
        // `batThuTheoCon` truyền RIÊNG chứ không suy từ `phieuGop != null`: "cờ tắt" và
        // "cờ bật, chưa phát phiếu" là hai tình trạng khác nhau và cần hai cái nút khác
        // nhau. Xem `lib/payments/qr-theo-dot.ts`.
        duocPhatPhieu={canRecordPayments}
        duocDongPhieu={canManagePayments}
        batThuTheoCon={batThuTheoCon}
        phieuGop={phieuGop}
        // GĐ1 POS — ba prop BẮT BUỘC ở phía nhận (luật 11), lưới `[POS1-UI-W2]` ghim đủ hai bậc.
        duocThuThePos={duocThuThePos}
        phieuPos={phieuPos}
        mayPos={mayPos}
        // Việc 2 — BẮT BUỘC ở phía nhận (luật 11), lưới `[HN2-MP-W07]` ghim đủ hai bậc.
        khaiMay={khaiMay}
        paymentMethods={paymentMethods}
        congNo={congNo}
        donNhiem={donNhiem}
        khoiHoaDon={khoiHoaDon}
        // Dựng từ đơn THẬT rồi mới che theo quyền — xem `khoi-nguoi-mua.ts`.
        khoiNguoiMua={khoiNguoiMuaHoaDon(order, canViewPii)}
        accounting={{
          // TRỤC A (GỘP) — KHÔNG phải con số "phụ huynh đã đóng" của cổng PH.
          //
          // ⚠️ 17/09/2026 — đã thử đổi sang bộ lọc RÒNG (`laKhoanDaDong`, trừ bút toán
          // hoàn) rồi TRẢ LẠI: `congNoDon` tính `choXacNhan = trục B − trục A`, mà trục B
          // (`KHOAN_DA_GHI_NHAN`, phân bổ PaymentRequest) KHÔNG trừ hoàn. Để A ròng còn B
          // gộp thì sau mỗi lần hoàn, màn báo "chờ xác nhận" một khoản KHÔNG TỒN TẠI —
          // biến tín hiệu đối soát webhook thành báo động giả. Trang này hỏi "hai trục
          // lệch nhau bao nhiêu", KHÔNG hỏi "phụ huynh đã đóng bao nhiêu"; câu sau là
          // việc của `lib/portal/billing.ts`. Hai câu hỏi — xem `lib/finance/debt.ts`.
          //
          // Hệ quả còn lại, ghi ra để không ai tưởng đã xong: khối này KHÔNG hiện bút
          // toán hoàn. Muốn hiện thì thêm MỘT DÒNG RIÊNG, đừng đổi trục A.
          confirmed: tongDaXacNhan(order.payments.filter(laKhoanDaXacNhan)),
          pending: order.payments
            .filter((p) => p.accountantStatus === "PENDING")
            .reduce((s, p) => s + p.amount, 0),
        }}
        installments={order.installments.map((i) => ({
          id: i.id,
          soDot: i.soDot,
          amount: i.amount,
          status: i.status,
          dueDate: i.dueDate ? i.dueDate.toISOString() : null,
          paidAt: i.paidAt ? i.paidAt.toISOString() : null,
          reminderDays: i.reminderDays,
        }))}
      />
    </div>
  );
}
