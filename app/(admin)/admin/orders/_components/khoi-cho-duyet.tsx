import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { PageHelp } from "@/components/admin/ui/page-help";
import { OrderApprovalCard } from "../duyet/_components/order-approval-card";
import { duocDuyetDon } from "@/lib/orders/cho-duyet-server";
import { docTheDuyet } from "@/lib/orders/du-lieu-the-duyet";
import { ArrowLeft } from "lucide-react";

/**
 * KHỐI "CHỜ BẠN DUYỆT" — nhúng ở ĐẦU màn Đơn hàng [25/09/2026].
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO KHÔNG CÒN LÀ MỘT TRANG RIÊNG
 *
 * Chủ dự án: *"đưa mục duyệt đơn vào trong màn đơn hàng, các đơn hàng cần duyệt thì thiết
 * kế nổi bật lên để QLCS biết sẽ có những đơn nào cần duyệt để vào mục duyệt"*.
 *
 * Trang `/orders/duyet` cũ có một khuyết tật cố hữu: **người ta chỉ thấy việc khi đã tự
 * nghĩ ra là phải vào đó xem**. Không có tín hiệu nào ở nơi họ thật sự làm việc hằng ngày
 * (màn Đơn hàng), nên đơn nằm chờ mà không ai biết — mà đơn chờ duyệt là đơn **không xuất
 * được mã QR**, tức đang chặn sale thu tiền.
 *
 * Nay việc tự tìm đến người: mở màn Đơn hàng là thấy ngay. `/orders/duyet` đá 307 về
 * `/orders` để link cũ, bookmark và thói quen gõ tay đều không gãy.
 *
 * ⚠️ **Trả `null` khi không có gì để duyệt.** Một cái hộp rỗng ghi "Không có đơn nào đang
 * chờ duyệt" mỗi ngày là thứ người ta học cách không nhìn nữa — rồi hôm có đơn thật cũng
 * không nhìn. Vắng mặt tín hiệu CHÍNH LÀ tín hiệu (luật 12).
 *
 * ⚠️ Dựng trong `<Suspense>` ở trang gọi: khối này tra DB, và trang Đơn hàng đã có bài học
 * "độ sâu tuần tự" — bảng đơn không được đứng chờ khối này.
 */
export async function KhoiChoDuyet() {
  const session = await auth();
  if (!session?.user) return null;

  // Cổng: hiện khối nếu có ÍT NHẤT MỘT trong hai quyền duyệt. Gọi KHÔNG kèm target (chưa
  // có đơn nào ⇒ chưa có centerId) — an toàn vì cả hai action đều seed GLOBAL ở mọi vai
  // giữ chúng. Cách ly cơ sở do scopedDb lo.
  //
  // ⚠️ Không có quyền ⇒ `null`, KHÔNG phải đá đi đâu cả: đây là một khối trên trang Đơn
  // hàng, và người không duyệt được vẫn có việc chính đáng ở trang đó.
  if (!(await duocDuyetDon())) return null;

  const actor = await resolveActor(session.user.id);
  const canViewPii = await checkPermission("orders:view-pii");

  // Order ∈ SCOPED_MODELS: quản lý cơ sở 1 không thấy đơn cơ sở 2.
  // Xếp đơn CŨ NHẤT lên trước — đơn chờ lâu là đơn đang chặn sale chốt học phí.
  // ⚠️ MỘT nguồn dữ liệu cho CẢ HAI màn duyệt [25/09/2026] — hàng chờ ở đây và màn
  // MỘT ĐƠN trên điện thoại (`/orders/<id>/duyet`). Xem `lib/orders/du-lieu-the-duyet.ts`
  // để biết vì sao chép sang màn thứ hai là chép cả ba thứ hỏng câm (tên bé, che SĐT,
  // danh sách select).
  const orders = await docTheDuyet(actor, { canViewPii });

  // ⚠️ RỖNG Ở ĐÂY KHÁC HẲN RỖNG Ở BẢN CŨ [25/09/2026].
  //
  // Bản trước, khối này dựng THƯỜNG TRỰC ở đầu màn Đơn hàng nên rỗng ⇒ `return null` là
  // đúng: một cái hộp "không có đơn nào chờ duyệt" đứng đó mỗi ngày là thứ người ta học
  // cách không nhìn nữa.
  //
  // Nay nó là một MÀN người dùng CHỦ ĐỘNG bấm vào. Trả `null` cho một màn được gọi đích
  // danh là đưa họ tới một trang trắng — họ sẽ tưởng màn hỏng, chứ không đọc ra "hết
  // việc rồi". Vắng mặt chỉ là tín hiệu khi người ta KHÔNG đi tìm nó.
  if (orders.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card p-10 text-center shadow-sm">
        <p className="text-sm font-medium text-foreground">Không còn đơn nào chờ duyệt.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Mọi đơn vượt mức đều đã được xử lý.
        </p>
        <Link
          href="/orders"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Quay lại danh sách đơn
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="cho-duyet-tieu-de"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      {/* ⚠️ NỔI BẬT BẰNG **BỀ MẶT**, KHÔNG BẰNG VIỀN DÀY [25/09/2026].
          Bản đầu dùng `border-2` màu cảnh báo quanh cả khối. `craft-floor` xếp viền màu
          dày hơn 1px trên thẻ/cảnh báo vào nhóm refuse-default — nó là cách làm nổi bật
          mặc định của mọi dashboard, và nó ồn mà không thêm thông tin.

          Thứ thật sự làm khối này thắng được bảng dữ liệu dày ngay dưới nó là BA điều
          khác, không cái nào là trang trí:
            · VỊ TRÍ — nằm trên cùng, trước cả thanh lọc;
            · DẢI ĐẦU TÔ MÀU — một mặt phẳng đặc, không phải đường kẻ;
            · CON SỐ trong tiêu đề, cỡ chữ lớn hơn phần còn lại của trang.
          Viền giữ 1px và dùng `border` trung tính như mọi thẻ khác trong admin, nên khối
          vẫn thuộc về cùng một hệ. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-state-warning-soft px-4 py-3">
        <ClipboardCheck
          className="h-5 w-5 shrink-0 self-center text-state-warning-ink"
          aria-hidden
        />
        <h2 id="cho-duyet-tieu-de" className="text-base font-semibold text-state-warning-ink">
          {orders.length} đơn đang chờ bạn duyệt
        </h2>
        {/* Nói HẬU QUẢ, không chỉ nói số lượng: đơn chờ duyệt là đơn KHÔNG xuất được mã
            QR, tức đang chặn sale thu tiền. Một con số trần không làm ai bấm vào. */}
        <p className="text-sm text-state-warning-ink/90">
          Chưa duyệt thì đơn không xuất được mã QR — sale đang phải chờ.
        </p>
        {/* Đường LÙI phải nằm ngay trong tầm mắt của tiêu đề. Đây là một màn con không
            có breadcrumb riêng, nên thiếu nó là người dùng chỉ còn nút Back của trình
            duyệt — thứ họ không nghĩ tới khi đang ở "trong" một trang. */}
        <Link
          href="/orders"
          className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-state-warning-ink hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Quay lại danh sách
        </Link>
      </div>

      <div className="p-4 max-sm:p-3">
      <PageHelp>
        <p>
          Một đơn vào đây khi nó <strong className="text-foreground">VƯỢT MỨC</strong> bạn
          đặt ở Cấu hình vận hành: chia nhiều đợt hơn mức cho phép, hoặc chồng nhiều ưu đãi
          hơn mức cho phép trên cùng một con. Đơn trong mức thì KHÔNG vào đây — quầy chạy
          thẳng như thường.
        </p>
        <p className="mt-2">
          <strong className="text-foreground">Một nút duyệt cho cả đơn.</strong> Bấm
          &ldquo;Duyệt đơn&rdquo; là đồng ý CẢ kế hoạch chia đợt LẪN các ưu đãi của đơn đó.
          Không còn duyệt lẻ từng phần, nên không còn cảnh đơn duyệt được một nửa rồi nằm chờ.
          Chưa duyệt thì đơn <strong className="text-foreground">không xuất được mã QR</strong>;
          tiền phụ huynh đã chuyển thì vẫn vào sổ như thường.
        </p>
        <p className="mt-2">
          Duyệt xong, kế hoạch bị KHOÁ: số tiền và số đợt không sửa được nữa vì phiếu
          thu cùng mã QR gửi cho khách đã bám theo nó. Cần đổi thì bấm &ldquo;Từ
          chối&rdquo; kèm lý do, nhân viên lập lại rồi xin duyệt lần nữa.
        </p>
      </PageHelp>

      {(
        <div className="space-y-4">
          {orders.map((o) => (
            <OrderApprovalCard key={o.id} order={o} />
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
