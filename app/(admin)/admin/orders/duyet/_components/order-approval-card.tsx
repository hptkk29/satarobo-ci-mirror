import Link from "next/link";
import type {
  DiscountApprovalStatus,
  InstallmentApprovalStatus,
  SoBuoiApprovalStatus,
} from "@prisma/client";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { formatVndPlain } from "@/lib/format/money";
import { OrderApprovalButtons } from "./order-approval-buttons";
import { khoanGiamCuaDon } from "@/lib/orders/khoan-giam-da-ap";
import { laDonChoDuyet } from "@/lib/orders/cho-duyet";
import { cn } from "@/lib/utils";
import { TriangleAlert } from "lucide-react";
import { moTaMocHopLe, nhanSoBuoiDong, xetSoBuoiDong } from "@/lib/orders/so-buoi-hoc-phan";

/**
 * Một tờ đơn chờ duyệt — đủ mọi mục quản lý cơ sở cần để quyết định TẠI CHỖ,
 * không phải mở sang trang chi tiết rồi quay lại (chốt 20/08/2026).
 *
 * Server Component: chỉ cặp nút bấm là client.
 */

export type PendingOrderCardData = {
  id: string;
  code: string;
  createdAt: Date;
  /** Đã che theo quyền orders:view-pii ở tầng trang — component này chỉ in ra. */
  customerName: string;
  customerPhone: string;
  centerName: string | null;
  paymentMethodName: string | null;
  subtotal: number;
  discountAmount: number;
  /** Có giá trị = nhân viên nhập theo %, null = nhập thẳng số tiền. */
  discountPercent: number | null;
  discountReason: string | null;
  shippingFee: number;
  totalAmount: number;
  customerNote: string | null;
  internalNote: string | null;
  discountApprovalStatus: DiscountApprovalStatus | null;
  installmentApprovalStatus: InstallmentApprovalStatus | null;
  soBuoiApprovalStatus: SoBuoiApprovalStatus | null;
  items: {
    id: string;
    itemName: string;
    quantity: number;
    totalPrice: number;
    discountAmount: number;
    /** Cột JSON `OrderItem.discounts` — đọc phòng thủ, xem `docKhoanGiam`. */
    discounts: unknown;
    /**
     * Tên bé của dòng, `null` khi chưa gắn được [25/09/2026].
     *
     * ⚠️ BẮT BUỘC, không cho `?` (luật 7): tuỳ chọn ở đây là lỗi CÂM — chỗ gọi quên
     * truyền thì cả thẻ duyệt lặng lẽ quay về đúng trạng thái vừa vá, không lỗi biên
     * dịch, không ca nào đỏ. Phép suy nằm ở `lib/orders/ten-con-tren-dong.ts`.
     */
    tenCon: string | null;
    /**
     * Số buổi bán ra của dòng (`OrderItem.metadata.soBuoi`), `null` = không khai.
     *
     * ⚠️ BẮT BUỘC (luật 7): quản lý được hỏi "gật hay không" về đúng con số này, nên
     * chỗ gọi quên truyền thì thẻ im lặng bỏ mất thứ đang cần duyệt.
     */
    soBuoi: number | null;
    /** `Course.totalSessions` của khoá trên dòng — vế PHẠM VI của luật mốc học phần. */
    tongSoBuoiKhoa: number | null;
    /** Dòng KHOÁ HỌC hay dòng sản phẩm — dòng sản phẩm không in nhãn số buổi. */
    laKhoaHoc: boolean;
  }[];
  installments: {
    id: string;
    soDot: number;
    amount: number;
    status: string;
    dueDate: Date | null;
    paidAt: Date | null;
  }[];
};

/**
 * Ngày giờ theo múi giờ Việt Nam, khai TƯỜNG MINH.
 *
 * Vercel chạy UTC còn máy làm việc +07: để mặc định thì hạn đóng đợt 2 in ra trên
 * production lệch một ngày so với lúc thử ở máy, mà không có gì báo.
 */
function formatVnDate(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(d);
}

const INSTALLMENT_STATUS_LABEL: Record<string, string> = {
  PAID: "đã thu",
  PENDING: "chưa thu",
  OVERDUE: "quá hạn",
  CANCELLED: "đã huỷ",
};

/** Dòng số tiền: nhãn trái, số phải, canh cột đều nhau giữa các đơn. */
/**
 * MỘT KHỐI NỘI DUNG trong thẻ duyệt.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 Chủ dự án 26/09/2026: *"phần nào cần duyệt thì thiết kế chữ nổi bật lên cho QLCS
 * dễ nhận thấy"*.
 *
 * `dangCho` là khác biệt DUY NHẤT người duyệt cần thấy từ xa: khối này là THỨ PHẢI GẬT,
 * hay chỉ là bối cảnh để gật cho đúng. Trước hôm nay cả ba khối đều `bg-muted` + tiêu đề
 * `text-foreground` — giống hệt nhau, nên muốn biết mình đang duyệt cái gì thì phải đọc
 * hết. Tệ nhất là ca đơn chỉ vướng SỐ BUỔI: khối "Giải trình giảm giá" vẫn hiện (vì đơn
 * có giảm giá) và trông y như khối phải duyệt.
 *
 * ⚠️ Độ nổi tới từ BỀ MẶT + CHỮ, không từ trang trí: nền cảnh báo, viền 1px, tiêu đề đổi
 * màu và có biểu tượng. KHÔNG viền trái dày, KHÔNG thẻ lồng thẻ, KHÔNG đổ bóng — nền
 * thiết kế của repo cấm cả ba, và chúng cũng không làm người ta đọc nhanh hơn.
 */
function KhoiXetDuyet({
  dangCho,
  tieuDe,
  chiDan,
  children,
}: {
  /** Khối này có đang chờ duyệt không. */
  dangCho: boolean;
  /** Gọi ĐÚNG tên phần đang chờ, cùng cụm chữ với nhãn trên dòng bảng đơn. */
  tieuDe: string;
  /** `<HelpHint>` đi kèm tiêu đề, nếu có. */
  chiDan?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    /* `data-khoi` là móc CHỈ để test ĐỊNH VỊ khối. Ca `[DTD-05]` so MÀU NỀN THẬT của
       hai khối chứ không đọc móc này — đọc móc là tự khẳng định lại thứ mình vừa viết. */
    <div
      data-khoi={tieuDe}
      className={cn(
        "space-y-1.5 rounded-lg p-3",
        dangCho ? "border border-state-warning-ink/30 bg-state-warning-soft" : "bg-muted",
      )}
    >
      <p
        className={cn(
          "flex flex-wrap items-center gap-1.5",
          dangCho ? "font-bold text-state-warning-ink" : "font-semibold text-foreground",
        )}
      >
        {dangCho && <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />}
        {tieuDe}
        {chiDan}
      </p>
      {children}
    </div>
  );
}

function MoneyRow({
  label,
  value,
  hint,
  strong,
  negative,
}: {
  label: string;
  value: number;
  hint?: React.ReactNode;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      // ⚠️ `flex-wrap` + `min-w-0` thêm 25/09/2026 cho màn ĐIỆN THOẠI. Bản cũ không có
      // cả hai: nhãn dài nhất ("Giảm giá (theo %: 15%)") cộng số 9 chữ số
      // ("-12.500.000 đ") là một token liền — `toLocaleString("vi-VN")` dùng dấu CHẤM
      // nên trình duyệt không có chỗ nào để ngắt — và ở bề rộng khả dụng ~300px của màn
      // 375px thì nó đẩy tràn ngang cả trang.
      className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1 ${strong ? "border-t border-border pt-2 font-bold text-foreground" : "text-muted-foreground"}`}
    >
      <span className="flex min-w-0 items-center gap-1">
        {label}
        {hint && <HelpHint>{hint}</HelpHint>}
      </span>
      {/* SỐ TIỀN không bao giờ được cắt hay xuống dòng giữa chừng: `shrink-0` +
          `whitespace-nowrap`. Nhãn co được, con số thì không — cắt một chữ số là đổi
          nghĩa cả dòng. */}
      <span
        className={`shrink-0 whitespace-nowrap tabular-nums ${negative ? "text-state-danger-ink" : strong ? "" : "text-foreground"}`}
      >
        {negative ? "-" : ""}
        {formatVndPlain(value)}
      </span>
    </div>
  );
}

export function OrderApprovalCard({
  order,
  anNut = false,
}: {
  order: PendingOrderCardData;
  /**
   * Giấu cặp nút Duyệt/Từ chối ở CUỐI thẻ [25/09/2026].
   *
   * ⚠️ Chỉ dùng cho màn MỘT ĐƠN trên điện thoại, nơi cặp nút được dựng lại ở THANH DÍNH
   * ĐÁY để ngón cái với tới. Hai bộ nút cùng lúc trên một màn là hai lời hứa cho một hành
   * động — người ta sẽ hỏi chúng có khác nhau không.
   */
  anNut?: boolean;
}) {
  // Mọi khoản giảm của đơn, KÈM tên dòng — nguồn của khối giải trình. Cùng một bộ đọc
  // với màn chi tiết đơn, không chép bản thứ hai (`lib/orders/khoan-giam-da-ap.ts`).
  const khoanGiam = khoanGiamCuaDon(order.items);
  // ⚠️ Đi qua `laDonChoDuyet`, KHÔNG so chuỗi tại chỗ: thẻ này và dòng bảng phải trả lời
  // giống hệt nhau về cùng một đơn (`[CDT-06]` ghim).
  const cho = laDonChoDuyet(order);
  const choDuyetGiamGia = cho.giamGia;
  const choDuyetKeHoach = cho.traGop;
  const choDuyetSoBuoi = cho.soBuoi;
  // Những dòng THỰC SỰ lệch mốc — quản lý cần thấy ĐÚNG dòng nào, không phải cả đơn.
  // Xét lại bằng chính hàm mà đường tạo đơn dùng, không suy từ cờ: cờ chỉ nói "đơn này
  // có dòng lệch", còn người gật cần biết LÀ DÒNG NÀO.
  const dongLechMoc = order.items.filter(
    (it) => xetSoBuoiDong({ tongSoBuoiKhoa: it.tongSoBuoiKhoa, soBuoiMua: it.soBuoi }).canDuyet,
  );
  // Đơn chỉ có kế hoạch trả góp thì KHÔNG in khối giảm giá rỗng, và ngược lại —
  // "gộp một khối" không có nghĩa là bịa ra nội dung đơn không có.
  //
  // ⚠️ Đơn ĐANG CHỜ DUYỆT KẾ HOẠCH thì LUÔN in khối này, kể cả khi bảng đợt rỗng
  // hoặc mới có 1 dòng: trước đây điều kiện chỉ là `length > 1`, nên card in badge
  // "Chờ duyệt kế hoạch thanh toán" mà bên dưới không có kế hoạch nào — quản lý cơ
  // sở bấm "Duyệt đơn" trong khi không nhìn thấy thứ mình đang duyệt. Dữ liệu thiếu
  // phải NÓI RA, không được ẩn đi.
  const coKeHoach = choDuyetKeHoach || order.installments.length > 1;
  const keHoachDuDong = order.installments.length > 1;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
        <div>
          <Link
            href={`/orders/${order.id}`}
            className="font-mono text-base font-bold text-foreground hover:text-primary hover:underline"
          >
            {order.code}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tạo {formatVnDate(order.createdAt)}
            {order.centerName ? ` · ${order.centerName}` : ""}
          </p>
        </div>
        {/* Bên phải header CỐ Ý TRỐNG [26/09/2026].

            Ở đây từng có ba badge "Chờ duyệt …", rồi đổi thành một dải "CẦN BẠN DUYỆT"
            rộng hết bề ngang — chủ dự án bỏ cả hai. Việc "cho QLCS dễ nhận thấy" nay do
            CHÍNH KHỐI NỘI DUNG làm: khối đang chờ đổi nền + tiêu đề đậm màu cảnh báo
            (xem `KhoiXetDuyet`). Một dòng tóm tắt ở trên là lớp thứ hai nói cùng một
            điều, và nó đẩy phần thật sự phải đọc xuống thấp hơn một hàng. */}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-muted-foreground">Phụ huynh</div>
            <div className="font-medium text-foreground">{order.customerName}</div>
            <div className="text-foreground">{order.customerPhone}</div>
          </div>

          <div>
            <div className="mb-1 text-muted-foreground">Sản phẩm mua</div>
            <ul className="space-y-1">
              {/* ⚠️ TÊN BÉ ĐỨNG TRƯỚC TÊN KHOÁ [25/09/2026]. Danh sách này vốn chỉ in
                  `itemName`; đơn hai con cùng khoá ra hai dòng y hệt nhau. Không biết
                  tên bé thì nói "chưa gắn bé" — đừng im, và đừng in tên khoá như thể
                  nó là tên người (luật 12). */}
              {order.items.map((it) => (
                <li key={it.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-foreground">
                    {it.tenCon ? (
                      <>
                        <span className="font-medium">{it.tenCon}</span>
                        <span className="text-muted-foreground"> · {it.itemName}</span>
                      </>
                    ) : (
                      <>
                        {it.itemName}
                        <span className="text-muted-foreground"> · chưa gắn bé</span>
                      </>
                    )}
                  </span>
                  {/* ── SỐ BUỔI IN TRÊN MỌI DÒNG KHOÁ HỌC [26/09/2026] ──────────────
                      🔴 Chủ dự án: *"không hiển thị bao nhiêu buổi thì sao biết mà duyệt"*.

                      Bản trước in số buổi CHỈ khi `metadata.soBuoi` có giá trị — mà cột
                      đó trống trên mọi đơn cũ và mọi đơn đi đường convert/backfill. Quản
                      lý mở thẻ và thấy `Sata 4 · SL 1 · 10.400.003đ`: được hỏi "gật hay
                      không" về một con số KHÔNG có trên màn. Luật 12 — vắng mặt phải NÓI
                      RA, không được im.

                      Chữ dựng ở `nhanSoBuoiDong` (thuần, bộ ca `[SBH-07]`) nên nó phân
                      biệt được "48 buổi" (sale gõ) với "48 buổi (đủ khoá)" (hệ thống suy
                      ra vì không ai gõ) — hai sự thật khác nhau với người đang ký. */}
                  <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                    {it.laKhoaHoc
                      ? (() => {
                          const n = nhanSoBuoiDong({
                            tongSoBuoiKhoa: it.tongSoBuoiKhoa,
                            soBuoiMua: it.soBuoi,
                          });
                          return (
                            <span
                              className={
                                n.lech
                                  ? "font-semibold text-state-warning-ink"
                                  : n.nguon === "khai"
                                    ? "font-medium text-foreground"
                                    : ""
                              }
                            >
                              {n.chu}
                            </span>
                          );
                        })()
                      : null}
                    {it.laKhoaHoc ? " · " : ""}SL {it.quantity} · {formatVndPlain(it.totalPrice)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <span className="text-muted-foreground">Hình thức thanh toán: </span>
            <span className="text-foreground">{order.paymentMethodName ?? "—"}</span>
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <MoneyRow label="Tiền niêm yết" value={order.subtotal} />
            {order.discountAmount > 0 && (
              <MoneyRow
                label={
                  order.discountPercent != null
                    ? `Giảm giá (theo %: ${order.discountPercent}%)`
                    : "Giảm giá (theo số tiền)"
                }
                value={order.discountAmount}
                negative
                hint={
                  <>
                    Nhân viên bán hàng nhập tay khoản giảm này — theo phần trăm hoặc
                    theo số tiền — và phải viết giải trình. Bạn duyệt nghĩa là đồng ý
                    bán ở mức giá sau giảm.
                  </>
                }
              />
            )}
            {order.shippingFee > 0 && (
              <MoneyRow label="Phí vận chuyển" value={order.shippingFee} />
            )}
            <MoneyRow label="Tổng tiền phải đóng" value={order.totalAmount} strong />
          </div>

          {/* ⚠️ BA TRẠNG THÁI, KHÔNG PHẢI HAI [25/09/2026].
              Bản cũ viết `{order.discountReason && …}` — tức CÓ giải trình thì in, không
              có thì IM. Hệ quả: quản lý mở thẻ và không phân biệt được "đơn này không
              giảm giá" với "có giảm mà sale không ghi lý do". Chủ dự án hỏi thẳng:
              *"không có giải trình giảm giá gì thì sao biết?"*

              Đường TẠO ĐƠN đã bắt buộc giải trình cho MỌI khoản (`dongThieuGiaiTrinh`
              bắt `giam > 0 && !lyDo`, không phân biệt to nhỏ), nên ô trống chỉ còn tới
              từ đơn CŨ hoặc một đường ghi không đi qua cổng ấy — mà đó đúng là ca quản
              lý cần biết nhất trước khi gật. Vắng mặt phải NÓI RA, không được im. */}
          {order.discountAmount > 0 &&
            (khoanGiam.length > 0 ? (
              // ⚠️ BA VẾ CHO MỖI KHOẢN: DÒNG NÀO · BAO NHIÊU TIỀN · VÌ SAO [25/09/2026].
              //
              // Bản trước in `order.discountReason` — chuỗi GỘP sẵn lúc ghi, ra thành
              // "Dòng 1: aaaa · Dòng 1: bbbbb". Người duyệt đọc được lý do nhưng KHÔNG
              // biết mỗi lý do ấy bớt bao nhiêu, mà số tiền mới là thứ họ đang gật.
              // Chủ dự án: *"giải trình dòng nào, bao nhiêu tiền thì ghi rõ ra"*.
              //
              // Nay đọc thẳng `OrderItem.discounts` — cùng một bộ đọc với màn chi tiết
              // đơn (`lib/orders/khoan-giam-da-ap.ts`), không chép bản thứ hai.
              <KhoiXetDuyet dangCho={choDuyetGiamGia} tieuDe="Giải trình giảm giá">
                <ul className="space-y-1">
                  {khoanGiam.map((k, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                      {/* BỐN VẾ: BÉ NÀO · DÒNG NÀO · BAO NHIÊU · VÌ SAO [25/09/2026].
                          Chủ dự án: *"2 con học cùng khoá thì sao biết là đang giảm đơn
                          cho con nào?"* — `tenDong` là `itemName`, mà trên `/orders/new`
                          cột đó là tên KHOÁ, nên hai con cùng khoá cho ra hai dòng mở
                          đầu bằng cùng một chuỗi. Tên bé phải đứng TRƯỚC, vì nó là thứ
                          phân biệt; tên khoá lùi về sau làm ngữ cảnh. */}
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {k.tenCon ? (
                          <>
                            {k.tenCon}
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {k.tenDong}
                            </span>
                          </>
                        ) : (
                          <>
                            {k.tenDong}
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · chưa gắn bé
                            </span>
                          </>
                        )}
                      </span>
                      <span className="whitespace-nowrap font-semibold tabular-nums text-state-danger-ink">
                        −{k.giam.toLocaleString("vi-VN")} đ
                        {k.phanTram != null ? ` (${k.phanTram}%)` : ""}
                      </span>
                      {/* Khoản THIẾU giải trình phải kêu lên, không im: đường tạo đơn
                          bắt buộc giải trình cho mọi khoản, nên một ô trống ở đây là dấu
                          hiệu dữ liệu tới từ đường khác — đúng ca cần soi trước khi gật. */}
                      {k.lyDo ? (
                        <span className="text-foreground">· {k.lyDo}</span>
                      ) : (
                        <span className="font-medium text-state-danger-ink">
                          · CHƯA có giải trình
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </KhoiXetDuyet>
            ) : order.discountReason ? (
              // Đơn CŨ: cột JSON rỗng, chỉ còn chuỗi gộp. In nguyên văn — mất vế số tiền
              // là mất thật, đừng bịa lại nó từ tổng.
              <div className="rounded-lg bg-muted p-3">
                <span className="font-semibold text-foreground">Giải trình giảm giá: </span>
                <span className="text-foreground">{order.discountReason}</span>
              </div>
            ) : (
              <div className="rounded-lg border border-state-danger-ink/25 bg-state-danger-soft p-3 text-state-danger-ink">
                <span className="font-semibold">Không có giải trình giảm giá.</span>{" "}
                Đơn bớt {order.discountAmount.toLocaleString("vi-VN")}đ mà không dòng nào
                ghi lý do — hỏi người bán trước khi duyệt.
              </div>
            ))}

          {/* ── SỐ BUỔI LỆCH MỐC HỌC PHẦN [25/09/2026] ─────────────────────────
              Chủ dự án: *"nếu buổi học khác 12 24 36 48 tức 1 học phần, 2 học phần, 3 học
              phần, 4 học phần thì phải qua quản lý duyệt"*.

              ⚠️ IN RA ĐÚNG DÒNG NÀO LỆCH, không chỉ gắn nhãn cho cả đơn. Một đơn hai con
              thì "đơn này lệch mốc" không trả lời được câu người gật đang hỏi — và bắt họ
              mở sang trang chi tiết rồi quay lại là bỏ phí chính cú bấm vừa xin được.

              ⚠️ CÓ CỜ MÀ KHÔNG TÌM RA DÒNG NÀO thì phải NÓI RA, không im (luật 12). Nó
              nghĩa là cột trong DB và phép xét đang bất đồng — đơn cũ, khoá vừa đổi
              `totalSessions`, hoặc `soBuoi` không được ghi. Im là để quản lý gật cho một
              thứ họ không nhìn thấy. */}
          {choDuyetSoBuoi && (
            <KhoiXetDuyet dangCho tieuDe="Số buổi không khớp mốc học phần">
              {dongLechMoc.length > 0 ? (
                <ul className="space-y-1">
                  {dongLechMoc.map((it) => (
                    <li key={it.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {it.tenCon ? (
                          <>
                            {it.tenCon}
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {it.itemName}
                            </span>
                          </>
                        ) : (
                          <>
                            {it.itemName}
                            <span className="font-normal text-muted-foreground"> · chưa gắn bé</span>
                          </>
                        )}
                      </span>
                      <span className="whitespace-nowrap font-semibold tabular-nums text-state-warning-ink">
                        {it.soBuoi ?? it.tongSoBuoiKhoa} buổi
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-state-danger-ink">
                  Đơn được đánh dấu chờ duyệt số buổi nhưng không dòng nào đọc ra số buổi
                  lệch mốc — hỏi người bán trước khi duyệt.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Khoá đủ 4 học phần chỉ bán theo mốc {moTaMocHopLe()}. Duyệt nghĩa là đồng ý
                bán số buổi ngoài mốc.
              </p>
            </KhoiXetDuyet>
          )}

          {coKeHoach && (
            <KhoiXetDuyet
              dangCho={choDuyetKeHoach}
              tieuDe="Kế hoạch thanh toán 2 đợt"
              chiDan={
                <HelpHint>
                  Phụ huynh đóng làm hai lần. Duyệt là KHOÁ kế hoạch lại: sau đó số
                  tiền và số đợt không sửa được nữa, vì phiếu thu và mã QR phát cho
                  khách đã bám theo nó.
                </HelpHint>
              }
            >
              {keHoachDuDong ? (
                <ul className="space-y-1">
                  {order.installments.map((i) => (
                    <li
                      key={i.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                    >
                      <span className="min-w-0 text-foreground">
                        Đợt {i.soDot}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({INSTALLMENT_STATUS_LABEL[i.status] ?? i.status}
                          {i.dueDate ? ` · hạn ${formatVnDate(i.dueDate)}` : ""}
                          {!i.dueDate && i.paidAt ? ` · ${formatVnDate(i.paidAt)}` : ""})
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-foreground">
                        {formatVndPlain(i.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                /* Nói thẳng là kế hoạch KHÔNG có gì để xem, thay vì ẩn khối rồi để
                   người duyệt tưởng đơn không có kế hoạch nào. */
                <p className="rounded-lg bg-state-warning-soft p-3 text-xs text-state-warning-ink">
                  {order.installments.length === 0
                    ? "Đơn xin duyệt kế hoạch thanh toán nhưng CHƯA CÓ dòng đợt nào."
                    : "Đơn xin duyệt kế hoạch thanh toán nhưng bảng đợt mới có 1 dòng — chưa thành kế hoạch 2 đợt."}{" "}
                  Mở đơn xem lại trước khi duyệt; nếu sai thì bấm &ldquo;Từ chối&rdquo;
                  kèm lý do để nhân viên lập lại.
                </p>
              )}
            </KhoiXetDuyet>
          )}
        </div>
      </div>

      {(order.customerNote || order.internalNote) && (
        <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
          {order.customerNote && (
            <div>
              <span className="text-muted-foreground">Ghi chú khách hàng: </span>
              <span className="text-foreground">{order.customerNote}</span>
            </div>
          )}
          {order.internalNote && (
            <div>
              <span className="text-muted-foreground">Ghi chú nội bộ: </span>
              <span className="text-foreground">{order.internalNote}</span>
            </div>
          )}
        </div>
      )}

      {!anNut && (
        <div className="mt-4 border-t border-border pt-3">
          <OrderApprovalButtons orderId={order.id} />
        </div>
      )}
    </section>
  );
}
