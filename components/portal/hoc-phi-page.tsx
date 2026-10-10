import {
  Wallet,
  CircleCheck,
  CalendarClock,
  Info,
  Phone,
  Receipt,
} from "lucide-react";
import type { StudentBilling } from "@/lib/portal/billing-student";
import { soTienCoDau, tongPhieuThuHienThi } from "@/lib/portal/phieu-thu";

import { PageHero, HeroMetric } from "@/components/portal/page-header";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { SATA_ROBO_PHONE } from "@/lib/locations";

// RSC render trên server (Vercel = UTC) → mọi ngày tháng phải quy về giờ VN,
// nếu không "hôm nay"/"hạn đóng" lệch 1 ngày trong khung 00:00–07:00 giờ VN.
const VN_TZ = "Asia/Ho_Chi_Minh";

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + " đ";
}
function dmy(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("vi-VN", {
    timeZone: VN_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
/** Số thứ tự ngày (epoch days) của `d` theo lịch Asia/Ho_Chi_Minh. */
function vnDayNumber(d: Date): number {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: VN_TZ })
    .format(d)
    .split("-")
    .map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1) / 86_400_000;
}
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return vnDayNumber(new Date(iso)) - vnDayNumber(new Date());
}

export function HocPhiPageV2({
  kids,
  activeId,
  studentName,
  data,
  methodLabels,
}: {
  kids: { id: string; name: string }[];
  activeId: string | null;
  studentName: string;
  data: StudentBilling;
  /**
   * Mã phương thức → nhãn tiếng Việt, dựng ở RSC bằng `getPaymentMethodLabels()`.
   * Truyền qua props chứ không import bảng cứng: từ 30/08/2026 mỗi cơ sở có thể có
   * phương thức riêng (mã "BANK_CS1"…) mà bảng cứng không biết ⇒ phụ huynh sẽ đọc thấy
   * mã nội bộ thay vì tên phương thức.
   */
  methodLabels: Record<string, string>;
}) {
  const dleft = daysLeft(data.nextDueDate);
  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      <ChildSwitcher kids={kids} activeId={activeId} />

      <PageHero
        icon={Wallet}
        overline="Cổng phụ huynh"
        title="Học phí & công nợ"
        subtitle={[studentName, data.courseName].filter(Boolean).join(" · ")}
        metric={<HeroMetric label="Công nợ" value={vnd(data.outstanding)} />}
      />

      <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>
          Phụ huynh chỉ thấy các khoản{" "}
          <b className="text-foreground">kế toán đã xác nhận thực thu</b>. Công
          nợ = giá phải đóng − số đã xác nhận. Phiếu thu tách riêng theo từng
          con/khóa học.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          icon={CircleCheck}
          tone="success"
          value={vnd(data.paid)}
          label="Đã thanh toán (đã xác nhận)"
        />
        <Stat
          icon={Wallet}
          tone="caution"
          value={vnd(data.outstanding)}
          label="Công nợ còn lại"
        />
        <Stat
          icon={CalendarClock}
          tone="destructive"
          value={dmy(data.nextDueDate)}
          label="Kỳ đến hạn"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Khoản cần thanh toán
          </h2>
          {/* 06/09 — ghi danh CHƯA CHỐT HỌC PHÍ hiện thành một dòng nói rõ, thay vì bị
              lọc mất (trước đây trang báo "Đã thanh toán đủ" ngay trên phiếu thu thật)
              hoặc in "0 đ" (đọc như khoá miễn phí). */}
          {data.rows
            .filter((r) => r.chuaChotGia)
            .map((r) => (
              <div
                key={r.enrollmentId}
                className="rounded-2xl border border-dashed border-caution bg-caution/5 p-4"
              >
                <p className="text-sm font-bold text-foreground">
                  {r.courseName ?? "Khoá học"}
                  {r.className ? ` · ${r.className}` : ""}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Trung tâm chưa chốt học phí cho khoá này. Vui lòng liên hệ để được báo
                  giá — số tiền bên dưới chưa bao gồm khoá này.
                </p>
              </div>
            ))}

          {data.outstanding > 0 ? (
            <div className="space-y-3">
              {data.rows
                .filter((r) => r.outstanding > 0)
                .map((r) => (
                  <div
                    key={r.enrollmentId}
                    className="rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Học phí
                        </p>
                        <p className="text-sm font-bold text-foreground">
                          {r.courseName ?? "Học phí khóa học"}
                          {r.className ? ` · ${r.className}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-destructive px-2 py-0.5 text-xs font-bold text-white">
                        Chưa thanh toán
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-bold text-primary">
                      {vnd(r.outstanding)}
                    </p>
                  </div>
                ))}
              {data.nextDueDate && (
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <CalendarClock className="size-4" /> Hạn đóng:{" "}
                  <b className="text-foreground">{dmy(data.nextDueDate)}</b>
                  {dleft != null
                    ? dleft >= 0
                      ? ` (còn ${dleft} ngày)`
                      : ` (quá hạn ${-dleft} ngày)`
                    : ""}
                </div>
              )}
              <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/50 p-3 text-xs font-medium text-muted-foreground">
                <Phone className="mt-0.5 size-4 shrink-0 text-primary" />
                <p>
                  Vui lòng liên hệ trung tâm ({SATA_ROBO_PHONE.hien}) để được hướng
                  dẫn thanh toán khoản còn lại.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success">
              <CircleCheck className="size-5 shrink-0" /> Đã thanh toán đủ —
              không có khoản nào cần đóng.
            </div>
          )}

          {/* D5/G.6 — chỉ dấu trạng thái (KHÔNG hiển thị số tiền khoản chưa xác nhận — giữ AC1) */}
          {(data.pendingCount > 0 || data.rejectedCount > 0) && (
            <div className="flex items-start gap-3 rounded-2xl border border-caution/30 bg-caution/5 p-4 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-5 shrink-0 text-caution" />
              <div className="space-y-1">
                {data.pendingCount > 0 && (
                  <p>
                    Có <b className="text-foreground">{data.pendingCount}</b>{" "}
                    khoản đang chờ kế toán xác nhận. Số tiền sẽ được cập nhật
                    vào mục “Đã thanh toán” sau khi được xác nhận.
                  </p>
                )}
                {data.rejectedCount > 0 && (
                  <p>
                    Có <b className="text-foreground">{data.rejectedCount}</b>{" "}
                    khoản bị từ chối — vui lòng liên hệ trung tâm (
                    {SATA_ROBO_PHONE.hien}) để được hỗ trợ.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Info className="size-4 text-primary" /> Lưu ý về học phí
          </p>
          <ul className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <li>
              • Chỉ hiển thị các khoản{" "}
              <b className="text-foreground">kế toán đã xác nhận thực thu</b>.
            </li>
            <li>• Phiếu thu tách riêng theo từng con / khóa học.</li>
            <li>• Công nợ = giá phải đóng − số đã xác nhận.</li>
          </ul>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
          <Receipt className="size-4 text-primary" /> Phiếu thu đã xác nhận
        </h2>
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {data.receipts.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Chưa có phiếu thu nào được xác nhận.
            </p>
          ) : (
            <>
              {data.receipts.map((r) =>
                r.paymentType === "ADJUSTMENT" ? (
                  // BÚT TOÁN ĐIỀU CHỈNH — dòng riêng, in phần chênh lệch kèm dấu + lý do.
                  // Thụt lề để đọc ra ngay là nó thuộc về phiếu thu ngay bên trên.
                  <div key={r.id} className="flex items-start gap-3 bg-muted/30 p-4 pl-8">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">
                        Điều chỉnh phiếu thu
                      </p>
                      {r.lyDoDieuChinh && (
                        <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                          Lý do: {r.lyDoDieuChinh}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                        {dmy(r.confirmedAt ?? r.paidDate)}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-sm font-bold ${
                        r.amount < 0 ? "text-destructive" : "text-success"
                      }`}
                    >
                      {soTienCoDau(r.amount)}
                    </p>
                  </div>
                ) : (
                  <div key={r.id} className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">
                        Học phí{r.orderCode ? ` · ${r.orderCode}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                        {dmy(r.paidDate)} ·{" "}
                        {methodLabels[r.method] ?? r.method}
                      </p>
                    </div>
                    {/* Số tiền của phiếu gốc GIỮ NGUYÊN — khớp biên lai phụ huynh đang cầm. */}
                    <p className="shrink-0 text-sm font-bold text-foreground">
                      {vnd(r.amount)}
                    </p>
                    {r.daBiDieuChinh ? (
                      <span className="shrink-0 rounded-md bg-caution/10 px-2 py-0.5 text-xs font-bold text-caution">
                        Đã điều chỉnh
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-success/10 px-2 py-0.5 text-xs font-bold text-success">
                        Đã xác nhận
                      </span>
                    )}
                  </div>
                ),
              )}
              {/* Tổng ở CUỐI: chỉ khi cộng cả dòng gốc lẫn dòng điều chỉnh mới ra số đúng. */}
              <div className="flex items-center gap-3 bg-muted/50 p-4">
                <p className="min-w-0 flex-1 text-sm font-bold text-foreground">
                  Tổng đã xác nhận
                </p>
                <p className="shrink-0 text-sm font-bold text-foreground">
                  {vnd(tongPhieuThuHienThi(data.receipts))}
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: typeof Wallet;
  tone: "success" | "caution" | "destructive";
  value: string;
  label: string;
}) {
  const box =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "caution"
        ? "bg-caution/10 text-caution"
        : "bg-destructive/10 text-destructive";
  const val =
    tone === "success"
      ? "text-success"
      : tone === "caution"
        ? "text-caution"
        : "text-destructive";
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl ${box}`}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className={`truncate text-lg font-bold tabular-nums ${val}`}>
          {value}
        </p>
        <p className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  );
}
