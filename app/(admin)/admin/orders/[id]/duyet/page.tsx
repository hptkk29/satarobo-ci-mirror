import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { Button } from "@/components/ui/button";
import { NoPermission } from "@/components/admin/ui/states";
import { OrderApprovalCard } from "../../duyet/_components/order-approval-card";
import { OrderApprovalButtons } from "../../duyet/_components/order-approval-buttons";
import { duocDuyetDon } from "@/lib/orders/cho-duyet-server";
import { docTheDuyet, donChoDuyetKeTiep } from "@/lib/orders/du-lieu-the-duyet";

export const metadata = { title: "Duyệt đơn | Admin" };
export const dynamic = "force-dynamic";

/**
 * MÀN DUYỆT MỘT ĐƠN — dựng cho ĐIỆN THOẠI [25/09/2026].
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Chủ dự án: *"làm riêng 1 màn duyệt riêng trên điện thoại cho qly, khi qly thấy thông
 * báo chỉ cần bấm vào xem đơn hàng cần duyệt đó và duyệt luôn"*.
 *
 * ⚠️ ĐÂY KHÔNG PHẢI ĐẢO NGƯỢC quyết định sáng nay (gộp hàng chờ duyệt vào `/orders`).
 * Hai lối vào cho hai hoàn cảnh khác nhau, và chúng cùng tồn tại:
 *   · `/orders?duyet=1`      — người NGỒI MÁY mở hàng chờ ra xử một lượt;
 *   · `/orders/<id>/duyet`   — người CẦM ĐIỆN THOẠI nhận thông báo, làm xong MỘT việc.
 * Thông báo nay trỏ thẳng vào đường thứ hai (`lib/orders/tin-cho-duyet.ts`).
 *
 * ⚠️ Khuôn lấy từ `/cham-cong/checkin` — tiền lệ mobile-first DUY NHẤT của admin (đo
 * 25/09): route bình thường trong cùng route group, tự giới hạn bề ngang bằng
 * `mx-auto max-w-*`, `force-dynamic`, và dùng lại bộ trạng thái chuẩn ở
 * `components/admin/ui/states.tsx`. KHÔNG dựng route group riêng: admin chỉ có MỘT
 * layout, và tước khung của nó là đổi bố cục cả 246 màn.
 *
 * ⚠️ KHÔNG khai `ADMIN_ROUTE_SEGMENTS` cho route này — đo `lib/auth/route-policy.ts`:
 * `isAdminRoute` chỉ so SEGMENT ĐẦU TIÊN, và `orders` đã có sẵn. Luật ấy chỉ cắn khi
 * thêm một module gốc mới.
 */
export default async function DuyetMotDonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;

  // Khuôn gác của 37 route `[id]/<hành-động>` đang có: auth → quyền → scopedDb → notFound.
  const [duocDuyet, canViewPii] = await Promise.all([
    duocDuyetDon(),
    checkPermission("orders:view-pii"),
  ]);

  // ⚠️ KHÔNG có quyền duyệt ⇒ nói RÕ thiếu quyền nào, KHÔNG đá về dashboard.
  // DESIGN.md §5 xếp "không có quyền" là trạng thái HẠNG NHẤT của hệ này, và người tới
  // đây đến từ một thông báo — đá họ đi là để họ tưởng link hỏng.
  if (!duocDuyet) {
    return (
      <div className="mx-auto max-w-lg">
        <NoPermission
          what="màn duyệt đơn"
          permission="discounts:approve hoặc installments:approve"
          askWho="Quản trị hệ thống"
        />
      </div>
    );
  }

  const actor = await resolveActor(session.user.id);
  const [don] = await docTheDuyet(actor, { canViewPii, orderId: id });

  // Không thấy đơn CHỜ DUYỆT với id này. Hai nguyên nhân, và chúng cần hai câu khác nhau:
  //   · đơn thuộc cơ sở khác (scopedDb lọc mất) hoặc id sai  ⇒ `notFound()`;
  //   · đơn CÓ THẬT nhưng vừa được người khác duyệt/từ chối  ⇒ màn "xong rồi" bên dưới.
  // Phân biệt bằng một câu tra KHÔNG lọc trạng thái duyệt.
  if (!don) {
    const conTonTai = await docTheDuyetConTonTai(actor, id);
    if (!conTonTai) notFound();
    return <ManXongRoi orderId={id} />;
  }

  const keTiep = await donChoDuyetKeTiep(actor, id);

  return (
    /* `max-w-lg` (32rem) chứ không `max-w-sm` như màn quét QR: thẻ duyệt chở bảng kế
       hoạch đợt và danh sách sản phẩm, hẹp quá là mọi dòng tiền đều xuống hai hàng.
       Trên màn rộng nó vẫn là một cột — đây là màn MỘT VIỆC, không phải bảng dữ liệu. */
    <div className="mx-auto max-w-lg">
      <Link
        href="/orders?duyet=1"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Tất cả đơn chờ duyệt
      </Link>

      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-state-warning-soft">
          <ClipboardCheck className="h-5 w-5 text-state-warning-ink" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground">Duyệt đơn {don.code}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Duyệt xong sale mới xuất được mã QR cho khách.
          </p>
        </div>
      </div>

      {/* ⚠️ `anNut` — thẻ KHÔNG vẽ cặp nút của nó. Chúng được dựng lại ở thanh dính đáy
          bên dưới. Hai bộ nút cùng lúc trên một màn là hai lời hứa cho một hành động. */}
      <OrderApprovalCard order={don} anNut />

      {/* Chừa chỗ cho thanh dính đáy, kẻo nó che mất phần cuối thẻ khi cuộn tới đáy. */}
      <div className="h-24" aria-hidden />

      {/* ── THANH HÀNH ĐỘNG DÍNH ĐÁY ────────────────────────────────────────────
          `adapt.md`: *"Thumbs-first design (controls within thumb reach)"*. Người duyệt
          đang đứng, cầm một tay; nút nằm cuối một trang cuộn dài là nút phải đi tìm.

          ⚠️ `pb-[max(0.75rem,env(safe-area-inset-bottom))]` — và tôi CỐ Ý KHÔNG thêm
          `viewportFit: "cover"` vào layout admin. Đo 25/09: toàn repo chưa có chỗ nào
          khai nó. Không khai thì trình duyệt tự chừa vùng home-indicator (env trả 0, còn
          lại `0.75rem`), tức thanh này an toàn sẵn. Khai `cover` là cho phép nội dung
          tràn xuống vùng ấy trên CẢ 246 màn admin — một bán kính nổ không xứng với một
          thanh nút. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto max-w-lg">
          {/* `size="lg"` = 44px, mức TỐI THIỂU cho ngón tay. Mặc định của cặp nút này là
              `sm` (36px) — hợp với chuột, không hợp với tay. */}
          <OrderApprovalButtons orderId={don.id} size="lg" tranNgang />
          {keTiep && (
            // Nói có việc TIẾP THEO ngay tại chỗ bấm: người duyệt đang ở đúng nhịp làm
            // việc, và biết còn đơn nữa thì họ làm luôn thay vì đóng máy rồi quên.
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Còn đơn khác đang chờ — xong đơn này sẽ tới {keTiep.code}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Đơn có tồn tại trong tầm nhìn không (KHÔNG xét trạng thái duyệt) — để phân biệt hai ca. */
async function docTheDuyetConTonTai(
  actor: Awaited<ReturnType<typeof resolveActor>>,
  orderId: string,
): Promise<boolean> {
  const row = await scopedDb(actor).order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Đơn đã được xử lý — bởi chính mình vừa bấm, hoặc bởi người khác nhanh tay hơn.
 *
 * ⚠️ Ca "người khác duyệt trước" là ca THẬT, không phải phòng xa: thông báo gửi cho MỌI
 * người có quyền duyệt tại cơ sở, nên hai người cùng mở một link là chuyện thường. Trả
 * `notFound()` cho ca này là nói dối — đơn có thật, chỉ là hết việc.
 */
function ManXongRoi({ orderId }: { orderId: string }) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <CheckCircle2
          className="mx-auto h-10 w-10 text-state-success-ink"
          aria-hidden
        />
        <p className="mt-3 text-base font-semibold text-foreground">Đơn này đã xử lý xong</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Nó đã được duyệt hoặc từ chối — có thể bởi một người duyệt khác cùng cơ sở.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link href="/orders?duyet=1">
            <Button className="w-full" size="lg">
              Xem các đơn còn chờ duyệt
            </Button>
          </Link>
          <Link href={`/orders/${orderId}`}>
            <Button variant="outline" className="w-full" size="lg">
              Mở chi tiết đơn này
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
