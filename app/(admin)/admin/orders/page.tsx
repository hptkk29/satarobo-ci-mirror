import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ClipboardCheck, Plus, ShoppingBag } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { Button } from "@/components/ui/button";
import { OrdersListClient } from "./_components/orders-list-client";
import { KhoiChoDuyet } from "./_components/khoi-cho-duyet";
import { tuyChonPhamViDon } from "@/lib/orders/tuy-chon-pham-vi";
import { duocDuyetDon, demDonChoDuyet } from "@/lib/orders/cho-duyet-server";

export const metadata = { title: "Đơn hàng | Admin" };
export const dynamic = "force-dynamic";

/**
 * ⚠️ MÀN DUYỆT LÀ MỘT **MÀN CON** CỦA `/orders`, MỞ BẰNG `?duyet=1` [25/09/2026].
 *
 * Chủ dự án: *"ẩn list chờ duyệt đi, làm 1 màn trong màn đơn hàng, khi bấm nút đơn hàng
 * cần duyệt thì mới hiển thị ra để duyệt"*.
 *
 * Vì sao dùng THAM SỐ URL chứ không phải state của client:
 *   · bấm Back của trình duyệt quay về đúng danh sách — không có nó, người ta bấm Back
 *     là văng khỏi cả màn Đơn hàng;
 *   · gửi được đường dẫn cho nhau ("vào đây mà duyệt");
 *   · chạy không cần JS, và giữ `/orders/duyet` cũ đá về đúng chỗ này.
 */
const KHOA_MAN_DUYET = "duyet";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate list-level (nhiều đơn) — không có 1 centerId cụ thể, không truyền target.
  if (!(await checkPermission("orders:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const actor = await resolveActor(session.user.id);

  // Một lô: bốn câu không cần kết quả của nhau. Trang đơn đã có bài học "độ sâu tuần tự"
  // (CLAUDE.md) — mỗi `await` nối đuôi là một lượt đi-về cộng thêm vào thời gian chờ.
  const [sp, canCreate, duocDuyet, soChoDuyet, phamVi] = await Promise.all([
    searchParams,
    // G-A (21/08/2026) — nút "Tạo đơn" theo `orders:create` (Sale nay có).
    checkPermission("orders:create"),
    duocDuyetDon(),
    demDonChoDuyet(actor),
    tuyChonPhamViDon(actor),
  ]);

  // ⚠️ Không có quyền duyệt mà gõ tay `?duyet=1` ⇒ rơi về danh sách, KHÔNG phải trang
  // lỗi: họ vẫn có việc chính đáng ở màn Đơn hàng. Cổng thật nằm trong `KhoiChoDuyet`
  // (và trong từng action duyệt) — đây chỉ là chuyện chọn vẽ cái gì.
  const moManDuyet = sp[KHOA_MAN_DUYET] === "1" && duocDuyet;

  return (
    /* ── TRẦN BỀ RỘNG — CÂU TRẢ LỜI CHO MÀN LỚN [25/09/2026] ─────────────────────
       Chủ dự án: *"responsive tất cả các màn từ nhỏ nhất đến màn 8K"*.

       ⚠️ Với màn rất lớn, câu trả lời KHÔNG phải là giãn ra cho đầy. Playbook `adapt.md`
       nói thẳng: *"Fixed widths with max-width constraints (don't stretch to 4K)"*. Một
       dòng bảng kéo ngang 7000px thì mắt không lần được từ mã đơn sang số tiền.

       ⚠️ ĐÂY LÀ BẢN VÁ CỤC BỘ, và gốc thì rộng hơn: `<main>` của khung admin
       (`components/admin/admin-shell.tsx:205`) là `flex-1 … p-4 sm:p-6` — **không có
       `max-width` nào**, nên CẢ 205 màn admin đều giãn vô hạn ở màn 8K. Sửa ở đó là
       đổi bố cục của mọi màn cùng lúc ⇒ phải là một quyết định riêng. */
    <div className="mx-auto max-w-[120rem]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
            <ShoppingBag className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">
              {moManDuyet ? "Duyệt đơn hàng" : "Đơn hàng"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {moManDuyet
                ? "Đơn ngoài khung cho phép — duyệt xong sale mới xuất được mã QR"
                : "Theo dõi & quản lý đơn hàng khoá học, gói combo, kỳ thi"}
            </p>
          </div>
        </div>
        {!moManDuyet && canCreate && (
          <Link href="/orders/new" className="max-sm:w-full">
            <Button className="max-sm:w-full">
              <Plus className="h-4 w-4" />
              Tạo đơn thủ công
            </Button>
          </Link>
        )}
      </div>

      {moManDuyet ? (
        <Suspense fallback={<KhungDangTai />}>
          <KhoiChoDuyet />
        </Suspense>
      ) : (
        <>
          {/* ── NÚT MỞ MÀN DUYỆT ──────────────────────────────────────────────────
              Danh sách chờ duyệt nay ẨN; đây là thứ duy nhất báo có việc.

              ⚠️ Vì vậy nó phải mang ĐỦ THÔNG TIN ĐỂ QUYẾT ĐỊNH CÓ BẤM HAY KHÔNG —
              số lượng, và hậu quả của việc không bấm. Một cái nút chỉ ghi "Duyệt đơn"
              thì người ta không biết có việc hay không, và sẽ bấm vào một màn rỗng vài
              lần rồi thôi bấm hẳn.

              ⚠️ Chỉ vẽ khi `soChoDuyet > 0`. Nút thường trực dẫn tới màn rỗng là lời
              hứa suông (luật 12) — và nó còn làm mất luôn giá trị tín hiệu của chính
              nút khi có việc thật. */}
          {duocDuyet && soChoDuyet > 0 && (
            <Link
              href={`/orders?${KHOA_MAN_DUYET}=1`}
              className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-state-warning-soft px-4 py-3 shadow-sm transition-colors hover:bg-state-warning-soft-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ClipboardCheck
                className="h-5 w-5 shrink-0 text-state-warning-ink"
                aria-hidden
              />
              <span className="text-base font-semibold text-state-warning-ink">
                {soChoDuyet} đơn cần bạn duyệt
              </span>
              <span className="text-sm text-state-warning-ink/90">
                Chưa duyệt thì đơn không xuất được mã QR — sale đang phải chờ.
              </span>
              <span className="ml-auto whitespace-nowrap text-sm font-medium text-state-warning-ink underline-offset-2 group-hover:underline">
                Mở màn duyệt →
              </span>
            </Link>
          )}

          <OrdersListClient coSo={phamVi.coSo} khuVuc={phamVi.khuVuc} />
        </>
      )}
    </div>
  );
}

/**
 * Khung chờ của màn duyệt.
 *
 * ⚠️ Cố ý MỎNG: người dùng vừa bấm từ một cái nút nói rõ "N đơn cần bạn duyệt", nên họ
 * đã biết sắp thấy gì. Một khung xương to bằng cả danh sách thẻ chỉ làm trang giật thêm
 * một nhịp.
 */
function KhungDangTai() {
  return <div className="h-1 animate-pulse rounded-full bg-muted" aria-hidden />;
}
