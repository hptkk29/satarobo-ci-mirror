"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCheck, Loader2, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

import { bulkConfirmBackfillPaymentsAction } from "../_actions";
import { KhoanBiBo } from "./khoan-bi-bo";

/**
 * Xác nhận HÀNG LOẠT khoản NHẬP LIỆU BAN ĐẦU (học phí chốt trước 06/08, nhập từ sheet).
 *
 * VÌ SAO CÓ KHỐI NÀY: import tạo `Payment` mang dấu `[backfill-import]` nhưng để
 * `accountantStatus: PENDING`, mà doanh thu chỉ đếm `CONFIRMED` ⇒ tiền cũ không vào
 * doanh thu, và xác nhận từng khoản thì hàng trăm dòng là không khả thi.
 *
 * ⚠️ BẮT BUỘC XEM THỬ TRƯỚC KHI GHI — không phải chi tiết cho đẹp. Lượt này đụng
 * `accountantStatus` của tiền thật và SINH PHIẾU THU cho phụ huynh. Người bấm phải thấy
 * TRƯỚC: số khoản, tổng tiền, và **số khoản sẽ bị bỏ kèm lý do**. Cổng tách nhiệm vụ
 * ("người ghi nhận không tự xác nhận") giữ nguyên, nên với đội nhỏ rất có thể MỌI khoản
 * bị bỏ — màn phải nói ra thay vì báo "xong 0 khoản" rồi thôi.
 *
 * Thiết kế theo DESIGN.md (mode Operate): số liệu `text-xl` (KHÔNG to hơn — `955.563.000đ`
 * từng tràn thẻ), mọi màu qua token, `whitespace-nowrap` cho số và nhãn, `rounded-xl`,
 * transition 150ms, không gradient, không bóng nặng.
 */
type XemThuState = {
  /** Số khoản backfill CHỜ KẾ TOÁN tìm được — 0 nghĩa là CHƯA NHẬP GÌ, khác hẳn "bị bỏ". */
  quet: number;
  soNhan: number;
  tongNhan: number;
  soBo: number;
  demTheoLyDo: Record<string, number>;
};

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

/** Ô số liệu — `min-w-0` + `truncate` là thứ chặn tiền 9 chữ số tràn thẻ. */
function O({
  nhan,
  giaTri,
  tone = "neutral",
}: {
  nhan: string;
  giaTri: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const mauSo =
    tone === "ok"
      ? "text-state-success-ink"
      : tone === "warn"
        ? "text-state-warning-ink"
        : "text-foreground";
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background px-4 py-3">
      <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {nhan}
      </p>
      <p className={`mt-1 truncate text-xl font-bold tabular-nums ${mauSo}`}>{giaTri}</p>
    </div>
  );
}

export function BulkBackfillConfirm() {
  const [xemThu, setXemThu] = useState<XemThuState | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangChay, startTransition] = useTransition();

  const napXemThu = async () => {
    const r = await bulkConfirmBackfillPaymentsAction({ xemThu: true });
    // Thu hẹp theo cờ `xemThu`: cả hai nhánh đều `ok: true` nên `in` không thu hẹp được.
    if (!r.ok || r.xemThu !== true) return null;
    return {
      quet: r.quet,
      soNhan: r.soNhan,
      tongNhan: r.tongNhan,
      soBo: r.soBo,
      demTheoLyDo: r.demTheoLyDo,
    } satisfies XemThuState;
  };

  const bamXemThu = () => {
    setLoi(null);
    startTransition(async () => {
      const s = await napXemThu();
      if (!s) {
        setLoi("Không đọc được danh sách khoản chờ. Tải lại trang rồi thử lại.");
        return;
      }
      setXemThu(s);
    });
  };

  const bamChayThat = () => {
    setLoi(null);
    startTransition(async () => {
      const r = await bulkConfirmBackfillPaymentsAction();
      if (!r.ok || r.xemThu !== false) {
        setLoi("Chạy không thành công. Không khoản nào bị thay đổi — thử lại hoặc báo dev.");
        return;
      }
      if (r.thanhCong === 0) {
        toast.warning(`Không xác nhận được khoản nào — ${r.soBo} khoản bị bỏ`);
      } else {
        toast.success(`Đã xác nhận ${r.thanhCong} khoản · ${vnd(r.tongTien)} vào doanh thu`);
      }
      if (r.loi.length > 0) {
        toast.error(`${r.loi.length} khoản lỗi khi ghi — xem nhật ký ở /audit-log`);
      }
      // Nạp lại để bảng số khớp trạng thái mới (khoản vừa xác nhận rời khỏi danh sách).
      setXemThu((await napXemThu()) ?? null);
    });
  };

  return (
    <section
      aria-labelledby="bulk-backfill-title"
      className="rounded-xl border border-border bg-muted/30 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            id="bulk-backfill-title"
            className="flex items-center gap-2 text-sm font-semibold text-foreground"
          >
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
            Học phí nhập từ file Excel
          </h2>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            Khoản của khách chốt <b className="font-semibold text-foreground">trước 06/08</b>{" "}
            đang ở trạng thái <b className="font-semibold text-foreground">chờ kế toán</b> nên
            chưa vào doanh thu. Xem thử trước, rồi xác nhận cả lượt.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={bamXemThu}
          disabled={dangChay}
          className="shrink-0 transition-colors duration-150"
        >
          {dangChay ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <CheckCheck className="h-4 w-4" aria-hidden />
          )}
          {xemThu ? "Xem lại" : "Xem thử"}
        </Button>
      </div>

      {/* Trạng thái LỖI — câu tiếng Việt đọc được + đường thử lại (DESIGN.md §5). */}
      {loi && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-state-danger bg-state-danger-soft px-4 py-3"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-state-danger-ink" aria-hidden />
          <p className="text-xs leading-relaxed text-state-danger-ink">{loi}</p>
        </div>
      )}

      {/* Đang tải: skeleton đúng hình dạng 3 ô số, không phải spinner giữa màn. */}
      {dangChay && !xemThu && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-xl border border-border bg-muted" />
          ))}
        </div>
      )}

      {xemThu && (
        <div className="mt-5 space-y-4 border-t border-border pt-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <O nhan="Đang chờ kế toán" giaTri={`${xemThu.quet} khoản`} />
            <O nhan="Sẽ xác nhận" giaTri={`${xemThu.soNhan} khoản`} tone={xemThu.soNhan > 0 ? "ok" : "neutral"} />
            <O nhan="Vào doanh thu" giaTri={vnd(xemThu.tongNhan)} tone={xemThu.soNhan > 0 ? "ok" : "neutral"} />
            <O nhan="Bỏ qua" giaTri={`${xemThu.soBo} khoản`} tone={xemThu.soBo > 0 ? "warn" : "neutral"} />
          </div>

          {xemThu.soBo > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Lý do bỏ qua
              </p>
              <ul className="space-y-1.5">
                {Object.entries(xemThu.demTheoLyDo).map(([lyDo, n]) => (
                  <li key={lyDo} className="flex items-start gap-2 text-xs leading-relaxed">
                    <span className="inline-flex shrink-0 whitespace-nowrap rounded-md bg-state-warning-soft px-1.5 py-0.5 font-semibold tabular-nums text-state-warning-ink">
                      {n}
                    </span>
                    <span className="text-muted-foreground">{lyDo}</span>
                  </li>
                ))}
              </ul>
              {/* Đếm theo lý do là CHƯA ĐỦ: chủ dự án 14/09 — "bấm xem thử xong chỉ xem
                  và không có thao tác gì nữa à?". Khối dưới bày từng khoản và cho SỬA
                  đúng những ca sửa được. */}
              <KhoanBiBo />
            </div>
          )}

          {/* Trạng thái RỖNG — HAI nguyên nhân KHÁC NHAU, cố ý không gộp một câu:
              · quet = 0  → chưa nhập học phí cũ vào hệ thống lần nào ⇒ chỉ đường NHẬP.
              · quet > 0 nhưng soNhan = 0 → có khoản nhưng cổng bỏ hết ⇒ nói lý do.
              Bản đầu gộp lại và báo "Bạn là người ghi nhận khoản này" cho cả hai — sai
              nguyên nhân, và dẫn người dùng đi tìm người xác nhận trong khi thật ra chưa
              có gì để xác nhận. */}
          {xemThu.quet === 0 ? (
            <div className="rounded-xl border border-state-info bg-state-info-soft px-4 py-3">
              <p className="text-xs font-semibold text-state-info-ink">
                Chưa có khoản học phí cũ nào trong hệ thống.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-state-info-ink">
                Khối này chỉ xác nhận khoản ĐÃ nhập. Nhập học phí cũ bằng một trong hai đường:
              </p>
              <ol className="mt-2 space-y-1 text-xs leading-relaxed text-state-info-ink">
                {/* Đường nhập tiền cũ là HAI BƯỚC, và bước ghi tiền là bước 2. Bản đầu
                    của khối này chỉ tay sang /leads/import/registered — màn đó nhập
                    DANH SÁCH lead, KHÔNG có ô tiền nào (đo: grep amount/paid trong
                    leads/import/registered/page.tsx ra 0 dòng) — nên người làm theo
                    sẽ nhập xong danh sách rồi quay lại đây thấy vẫn 0 khoản. */}
                <li>
                  <b className="font-semibold">1.</b>{" "}
                  <a
                    href="/leads/import/registered"
                    className="font-semibold underline underline-offset-2"
                  >
                    Nhập danh sách từ file Excel
                  </a>{" "}
                  — cả sheet nhiều tháng, có bước xem thử từng dòng. Bước này CHƯA ghi
                  tiền.
                </li>
                <li>
                  <b className="font-semibold">2.</b>{" "}
                  <a
                    href="/leads/bulk-convert"
                    className="font-semibold underline underline-offset-2"
                  >
                    Chốt hàng loạt
                  </a>{" "}
                  — điền ô <b>&quot;Đã đóng (đ) · ngày&quot;</b> cho từng phụ huynh (có
                  nút điền sẵn theo số trong file Excel). ĐÂY là bước sinh khoản thu để
                  xác nhận ở màn này.
                </li>
                <li>
                  <b className="font-semibold">Hoặc:</b>{" "}
                  <a href="/thieu-hoc-phi" className="font-semibold underline underline-offset-2">
                    Thiếu học phí
                  </a>{" "}
                  — từng phụ huynh một, nhập được cả loại đơn, giảm giá và phần còn nợ.
                </li>
              </ol>
            </div>
          ) : xemThu.soNhan === 0 ? (
            <div className="rounded-xl border border-state-warning bg-state-warning-soft px-4 py-3">
              <p className="text-xs font-semibold text-state-warning-ink">
                Có {xemThu.quet} khoản chờ kế toán, nhưng không khoản nào đủ điều kiện xác nhận.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-state-warning-ink">
                Xem lý do ở trên. Nếu là <b>&quot;Bạn là người ghi nhận khoản này&quot;</b> thì
                cần một người khác xác nhận — quy tắc tách nhiệm vụ giữa người nhập tiền và
                người xác nhận tiền, cố ý không bỏ.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={bamChayThat}
                disabled={dangChay}
                className="min-h-11 transition-colors duration-150"
              >
                {dangChay && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                <span className="whitespace-nowrap">
                  Xác nhận {xemThu.soNhan} khoản · {vnd(xemThu.tongNhan)}
                </span>
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Mỗi khoản sinh phiếu thu và ghi nhật ký, y như xác nhận từng khoản.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
