import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { BangDoiSoat } from "./_components/bang-doi-soat";
import type { DongDoiSoat } from "./_components/types";
// lib/finance/debt.ts — parallel agent owns. Combined typecheck resolves.
import { getDebtRows, overdueBucket } from "@/lib/finance/debt";
import { locDonDangBaoLuu } from "@/lib/bao-luu/dang-bao-luu-db";
import { NutXuat } from "@/components/admin/nut-xuat";

export const metadata = { title: "Công nợ | Admin" };
export const dynamic = "force-dynamic";

/**
 * ═══ KHỐI "GOM NHÓM CÔNG NỢ" ĐÃ GỠ [16/09/2026] ═══
 *
 * Chủ dự án: *"ở màn công nợ, bỏ hẳn phần từ … trở xuống đi"* — xác nhận lại là khối CUỐI,
 * tức `<h2>Gom nhóm công nợ</h2>` + thanh lọc + bảng Nhóm/Số đăng ký/Tổng nợ + câu ghi chú
 * tuổi nợ ở chân trang. Bảng **Đối soát học phí từng học viên** GIỮ LẠI: đó là chỗ duy nhất
 * trên màn này có thao tác thật (sửa học phí ghi danh) và là bảng cần cho đợt nhập lại dữ
 * liệu — bỏ nó đi là mất đường "em nào đủ, em nào thiếu".
 *
 * Vì sao khối đó đáng gỡ, không chỉ vì được yêu cầu: nó là một BÁO CÁO gom nhóm đặt trong
 * một màn VẬN HÀNH. Ba chiều gom (ghi danh / học viên / cơ sở) đều trả lời câu "tổng nợ
 * chia theo chiều nào", mà câu đó đã có ở `/bao-cao/*`; còn câu người dùng mở màn này để
 * hỏi là "em nào còn thiếu bao nhiêu" — bảng đối soát.
 *
 * ⚠️ `_components/debt-filter-bar.tsx` XOÁ cùng lượt: sau khi gỡ khối thì nó không còn
 * đường gọi nào (đã grep), và nó đẩy `/cong-no?groupBy=…&search=…` — một địa chỉ không
 * còn ai đọc. Giữ lại một thanh lọc mồ côi là để sẵn một thứ sẽ lệch khỏi màn.
 *
 * ⚠️ MỘT SỐ ĐỔI NGHĨA, cố ý: ô "Tổng nợ (đăng ký)" trước đây cộng trên tập ĐÃ LỌC theo ô
 * tìm kiếm — tức nó co lại khi người ta gõ tìm. Ô tìm kiếm nằm trong khối vừa gỡ, nên con
 * số nay luôn là TỔNG THẬT. Đó là nghĩa đúng của một ô mang nhãn "Tổng nợ".
 */

type Bucket = "none" | "1-7" | "8-30" | ">30";
const BUCKETS: Bucket[] = ["none", "1-7", "8-30", ">30"];
const BUCKET_LABEL: Record<Bucket, string> = {
  none: "Chưa quá hạn",
  "1-7": "Quá hạn 1-7 ngày",
  "8-30": "Quá hạn 8-30 ngày",
  ">30": "Quá hạn > 30 ngày",
};

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + " đ";
}

export default async function CongNoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // 03/08 — Quản lý cơ sở được ĐỐI SOÁT nhưng chỉ XEM: `payments:view` mở màn này,
  // mọi thao tác tiền vẫn đòi `payments:manage`/`payments:confirm`.
  const [canManagePayments, canViewPayments] = await Promise.all([
    checkPermission("payments:manage"),
    checkPermission("payments:view"),
  ]);
  if (!canManagePayments && !canViewPayments) {
    redirect("/dashboard?error=unauthorized");
  }
  const uid = session.user.id;
  if (!uid) redirect("/login");

  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);

  // ⚠️ SỐ `debt` NAY LÀ SỐ RÒNG (NỢ-4, hợp nhất 18/09/2026). `getDebtRows` tính công nợ
  // bằng `computeEnrollmentDebt` — trừ bút toán HOÀN, và có ngoại lệ "ghi danh đã RỜI LỚP
  // thì không trừ hoàn" để không đẻ nợ ma cho học viên đã nghỉ. Trước bản vá, màn này
  // cộng gộp nên tiền đã hoàn vẫn nằm trong "đã thu".
  //
  // Hai cột của bảng đối soát bên dưới thì KHÔNG ròng, và đó là chủ đích: `daXacNhan`
  // (trục A) đặt cạnh `daGhiNhan` (trục B) để ra số CHỜ XÁC NHẬN. Ròng một vế là báo
  // động giả. Xem khối ghi chú trong `lib/finance/debt.ts`.
  // ── Debt rows (CHỈ Payment CONFIRMED) — lib getDebtRows. Cast tránh so kiểu
  // sâu giữa Prisma client mở rộng và DebtScopedDb hẹp của lib. ──
  //
  // ⚠️ HAI LƯỢT TRA, HAI PHẠM VI KHÁC NHAU — cố ý, không phải thừa:
  //   · `rows` (dưới) giữ nguyên phạm vi cũ để ô TỔNG NỢ không đổi định nghĩa.
  //   · `dongDoiSoat` mở thêm nhóm CHƯA CHỐT GIÁ và không lọc `debt > 0`, vì màn đối soát
  //     phải hiện cả em đã đóng đủ (để người nhập biết đã xong) lẫn em chưa chốt giá
  //     (nhóm mà bộ lọc cũ giấu mất hẳn).
  const [rowsGoc, rowsDoiSoat] = await Promise.all([
    getDebtRows(sdb as unknown as Parameters<typeof getDebtRows>[0]),
    getDebtRows(sdb as unknown as Parameters<typeof getDebtRows>[0], {
      keCaChuaChotGia: true,
    }),
  ]);
  // Chỉ tính đăng ký còn nợ (> 0).
  const rows = rowsGoc.filter((r) => r.debt > 0);

  const dongDoiSoat: DongDoiSoat[] = rowsDoiSoat.map((r) => ({
    enrollmentId: r.enrollmentId,
    hocVien: r.studentName,
    khoa: r.courseName,
    hocPhi: r.finalPrice,
    daGhiNhan: r.recordedPaid,
    daXacNhan: r.confirmedPaid,
    chuaChotGia: r.chuaChotGia,
  }));
  // Nút "Sửa học phí" chỉ hiện khi thật sự bấm được — nhãn/nút là LỜI HỨA (luật 12
  // docs/luat-doc-so-va-ket-luan.md); hiện nút rồi để action từ chối là hứa suông.
  // Server action vẫn tự gác độc lập.
  const suaDuoc = await checkPermission("enrollments:edit");

  // ── Aging buckets từ installment PENDING của các đơn trong scope ──
  const now = new Date();
  const orders = await sdb.order.findMany({
    where: { installments: { some: { status: "PENDING" } } },
    select: {
      id: true,
      installments: {
        where: { status: "PENDING" },
        select: { amount: true, dueDate: true },
      },
    },
  });
  // Phiên 1 bảo lưu: đơn mà MỌI bé đang bảo lưu thì đợt thu của nó KHÔNG vào nhóm quá hạn (BR-16)
  // — gom vào "chưa tới hạn". Sổ cũ `OrderInstallment` không dời hạn theo bảo lưu nên phải chặn
  // ở đầu đọc. Số TIỀN không đổi, chỉ đổi nhóm tuổi nợ.
  const donBaoLuu = await locDonDangBaoLuu(orders.map((o) => o.id), now);
  const bucketTotals: Record<Bucket, number> = {
    none: 0,
    "1-7": 0,
    "8-30": 0,
    ">30": 0,
  };
  for (const o of orders) {
    for (const inst of o.installments) {
      const b = (donBaoLuu.has(o.id) ? "none" : overdueBucket(inst.dueDate, now)) as Bucket;
      bucketTotals[b] += inst.amount;
    }
  }

  const totalDebt = rows.reduce((s, r) => s + r.debt, 0);

  return (
    <div>
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
          <Wallet className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Công nợ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nợ học phí (đã trừ hoàn tiền) &amp; phân nhóm tuổi nợ quá hạn
          </p>
        </div>
        {/* `ml-auto` vì khối tiêu đề này dùng `gap-3` chứ không `justify-between` — thêm
            `justify-between` vào thẻ cha sẽ đẩy icon rời khỏi chữ. */}
        <div className="ml-auto shrink-0">
          <NutXuat ma="cong-no" />
        </div>
      </div>

      {/* Aging summary từ installment quá hạn */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Tổng nợ (đăng ký)</div>
          <div className="mt-1 text-lg font-bold text-foreground">
            {vnd(totalDebt)}
          </div>
        </div>
        {BUCKETS.map((b) => (
          <div
            key={b}
            className="rounded-lg border border-border bg-card p-3"
          >
            <div className="text-xs text-muted-foreground">{BUCKET_LABEL[b]}</div>
            <div className="mt-1 text-lg font-bold text-foreground">
              {vnd(bucketTotals[b])}
            </div>
          </div>
        ))}
      </div>
      {/* Hai cách đo KHÁC phạm vi — không phải lỗi khi tổng lệch nhau: */}
      <p className="mb-6 -mt-3 text-xs text-muted-foreground">
        “Tổng nợ (đăng ký)” tính theo <b>ghi danh</b> = học phí − khoản kế toán ĐÃ xác
        nhận. Các ô tuổi nợ tính theo <b>đợt thanh toán đơn hàng có hạn</b> (chỉ đơn có
        lịch trả góp) — hai phạm vi khác nhau nên có thể không bằng nhau.
      </p>

      {/* ── ĐỐI SOÁT TỪNG HỌC VIÊN ───────────────────────────────────────
          Nay là khối DUY NHẤT của màn. Câu hỏi "em nào đủ, em nào thiếu" là việc hằng
          ngày sau đợt nhập liệu — và trước hôm 14/09 màn này KHÔNG có một thao tác nào
          (chủ dự án: "màn này cũng chỉ vào xem công nợ chứ không có thao tác gì"). */}
      <BangDoiSoat dong={dongDoiSoat} suaDuoc={suaDuoc} />
    </div>
  );
}
