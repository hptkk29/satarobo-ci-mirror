import { AlertTriangle, BadgeCheck, Wallet } from "lucide-react";

import type { CongNoDon } from "@/lib/finance/cong-no-don";

/**
 * Khối CÔNG NỢ của một đơn — ô ĐẦU TIÊN trên trang chi tiết đơn.
 *
 * Vì sao đặt trên cùng: câu hỏi đầu tiên khi mở một đơn là "còn thiếu bao nhiêu".
 * Trước bản này con số đó ĐÃ được tính ở server nhưng không hiện ở đâu, và ô duy nhất
 * nói về tiền trong khối kế hoạch là một dòng `text-xs` viền gạch đứt — người xem đơn
 * tạo từ màn Thiếu học phí không thấy được mình còn thiếu gì.
 *
 * Thiết kế theo DESIGN.md (mode Operate): số `text-xl` là trần (tiền 9 chữ số từng tràn
 * thẻ), `min-w-0` + `truncate` + `tabular-nums`, mọi màu qua token, `rounded-xl`,
 * transition 150ms, không gradient. Lưới 2 cột ở 375px nên không có dải trắng.
 */
const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

function O({
  nhan,
  giaTri,
  tone = "neutral",
  chu,
}: {
  nhan: string;
  giaTri: string;
  tone?: "neutral" | "ok" | "warn" | "danger";
  chu?: string;
}) {
  const mauSo =
    tone === "ok"
      ? "text-state-success-ink"
      : tone === "warn"
        ? "text-state-warning-ink"
        : tone === "danger"
          ? "text-state-danger-ink"
          : "text-foreground";
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background px-4 py-3">
      <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {nhan}
      </p>
      <p className={`mt-1 truncate text-xl font-bold tabular-nums ${mauSo}`}>{giaTri}</p>
      {chu && <p className="mt-0.5 truncate text-xs text-muted-foreground">{chu}</p>}
    </div>
  );
}

export function OrderDebtSummary({ congNo }: { congNo: CongNoDon }) {
  const { phaiDong, daThu, conThieu, choXacNhan, traVuot, xong } = congNo;

  return (
    <section
      aria-labelledby="order-debt-title"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="order-debt-title"
          className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground"
        >
          <Wallet className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          Công nợ đơn hàng
        </h2>
        {/* Nhãn tổng kết để không phải đọc 4 con số mới biết đơn này ổn hay không. */}
        {conThieu > 0 ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-state-danger-soft px-2 py-0.5 text-xs font-semibold text-state-danger-ink">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Còn thiếu {vnd(conThieu)}
          </span>
        ) : xong ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-state-success-soft px-2 py-0.5 text-xs font-semibold text-state-success-ink">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            Đã đóng đủ
          </span>
        ) : (
          // Đơn 0đ: `xong` cố ý FALSE — đóng dấu xanh cho đơn không có tiền là che
          // mất đúng nhóm dữ liệu cần người xem (lượt chốt hàng loạt không nhập số).
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-state-warning-soft px-2 py-0.5 text-xs font-semibold text-state-warning-ink">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Đơn 0đ — chưa có học phí
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <O nhan="Tổng phải đóng" giaTri={vnd(phaiDong)} />
        <O nhan="Đã thu" giaTri={vnd(daThu)} tone={daThu > 0 ? "ok" : "neutral"} />
        <O
          nhan="Còn thiếu"
          giaTri={vnd(conThieu)}
          tone={conThieu > 0 ? "danger" : "neutral"}
        />
        {/* Ô thứ 4 đổi vai theo tình trạng — không hiện cả hai cùng lúc vì chúng loại
            trừ nhau: thu vượt thì không còn phần "sale đã thu chưa xác nhận" đáng lo. */}
        {traVuot > 0 ? (
          <O
            nhan="Thu vượt"
            giaTri={vnd(traVuot)}
            tone="warn"
            chu="Khách chuyển nhiều hơn tổng đơn"
          />
        ) : (
          <O
            nhan="Chờ kế toán xác nhận"
            giaTri={vnd(choXacNhan)}
            tone={choXacNhan > 0 ? "warn" : "neutral"}
            chu={choXacNhan > 0 ? "Sale đã thu, kế toán chưa đối soát" : undefined}
          />
        )}
      </div>

      {/* Nói ra ĐỊNH NGHĨA đang dùng. Repo có nhiều cách đếm "đã thu"; không ghi rõ thì
          người xem tự đoán, và hai người đoán hai kiểu sẽ tranh nhau về cùng một đơn. */}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        <b className="font-semibold text-foreground">Đã thu</b> = tiền hệ thống đã ghi nhận
        cho đơn này, kể cả khoản kế toán chưa đối soát — vì tiền đã về là đã về.{" "}
        <a href="/payments" className="font-semibold text-primary underline underline-offset-2">
          Mở sổ Khoản thu
        </a>{" "}
        để xem từng khoản.
      </p>
    </section>
  );
}
