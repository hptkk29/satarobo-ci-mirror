import Link from "next/link";
import { checkPermission } from "@/lib/auth/check-permission";
import type { Actor } from "@/lib/auth/actor";
import type { ScopeFilters } from "@/lib/reports/scope-filters";
import {
  getDailyRevenue,
  DAILY_REVENUE_MAX_DAYS,
  type DailyRevenueReport,
} from "@/lib/reports/revenue-daily";
import { getRevenueTargetsForRange } from "@/lib/reports/revenue-target-data";
import {
  buildRangeTarget,
  buildRevenueTargetCard,
  formatPeriodVN,
  targetScopeMode,
  type RevenueTargetCard,
} from "@/lib/reports/revenue-target-range";
import { formatDayKeyDMY } from "@/lib/students/birthday-dates";
import { formatVndPlain } from "@/lib/format/money";
import { LineChart } from "@/components/charts/line-chart";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { ChoDuLieu } from "../_components/cho-du-lieu";

/** Màn đặt mục tiêu doanh thu (B-01) — lối đi khi kỳ đang xem chưa có mục tiêu. */
const DUONG_DAT_MUC_TIEU = "/bao-cao/doanh-thu";

/**
 * Tab Tài chính — khu vực B (**B-02 hàng chỉ số 1** · B-03 hàng chỉ số 2 · **B-04 doanh
 * thu theo ngày** · B-05 import chi phí).
 *
 * B-02 và B-04 đã nối số liệu thật; B-03/B-05 vẫn chờ (vế CHI chưa có bảng nào trong hệ
 * thống) nên phần dưới màn giữ khối `ChoDuLieu` — cố ý KHÔNG hiện thẻ "Chi phí: 0 ₫",
 * vì một thẻ 0 trông y hệt kết quả đo thật.
 *
 * ⚠️ B-02 và B-04 dùng CHUNG một lần đọc `getDailyRevenue`. Không phải để tiết kiệm truy
 * vấn mà để hai khối trên CÙNG MỘT MÀN không thể nói hai con số doanh thu khác nhau: ô
 * "Doanh thu" của hàng chỉ số và ô "Tổng thực thu" của bảng theo ngày là ĐÚNG MỘT giá
 * trị, và khoảng ngày dùng để tra mục tiêu là khoảng ĐANG VẼ (đã cắt nếu quá dài).
 *
 * Gate riêng của tab: trang `/dashboard-qlcs` mở bằng `dashboard:view`, nhưng SỐ TIỀN
 * thì không — vào được trang ≠ xem được tiền (ghi sẵn ở `lib/auth/page-gates.ts:219`).
 */
export async function TabTaiChinh({
  actor,
  filters,
  visibleCenters,
  isGlobalAllowed,
}: {
  actor: Actor;
  filters: ScopeFilters;
  visibleCenters: { id: string; name: string }[];
  /** `ScopeFilterContext.isGlobalAllowed` — người xem có phạm vi TOÀN hệ thống hay không. */
  isGlobalAllowed: boolean;
}) {
  if (!(await checkPermission("payments:view"))) {
    return (
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">
          Tab Tài chính: bạn không có quyền xem số tiền
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Vào được dashboard không đồng nghĩa xem được doanh thu. Ba tab còn lại vẫn dùng
          được bình thường. Cần xem số tiền thì đề nghị quản trị viên cấp quyền
          &quot;Xem thanh toán&quot;.
        </p>
      </section>
    );
  }

  // MỘT lần đọc doanh thu cho cả B-02 và B-04 (xem chú thích đầu hàm).
  const bc = await getDailyRevenue(actor, filters);

  // Chế độ lấy mục tiêu: chỉ người ĐẶT được mục tiêu toàn hệ thống mới được ĐỌC dòng
  // `centerId = NULL`. Quản lý cơ sở chọn "tất cả" = tất cả cơ sở CỦA HỌ, không phải
  // cả công ty — xem `targetScopeMode`.
  const mode = targetScopeMode({
    isAllCenters: filters.isAllCenters,
    isGlobalAllowed,
    centerIds: filters.centerIds,
  });
  const [targetRows, coQuyenDatMucTieu] = await Promise.all([
    getRevenueTargetsForRange(actor, { fromKey: bc.fromKey, toKey: bc.toKey }, mode),
    checkPermission("revenue_targets:manage"),
  ]);
  const the = buildRevenueTargetCard(
    buildRangeTarget(targetRows, { fromKey: bc.fromKey, toKey: bc.toKey, mode }),
    bc.total,
  );

  return (
    <div className="space-y-5">
      <HangChiSoMucTieu
        the={the}
        coQuyenDatMucTieu={coQuyenDatMucTieu}
        soCoSoDangChon={filters.centerIds.length}
        laToanHeThong={mode.kind === "SYSTEM"}
      />

      <DoanhThuTheoNgay bc={bc} visibleCenters={visibleCenters} />

      <ChoDuLieu
        maSpec="B-03 · B-05"
        tieuDe="Chỉ số tài chính còn lại: chưa có vế CHI"
        giaiThich={
          "Mục tiêu / Doanh thu / Tỷ lệ hoàn thành (B-02) và doanh thu theo ngày (B-04) " +
          "đã chạy trên dữ liệu thật ở hai khối trên. Phần còn lại kẹt ở vế CHI: hệ " +
          "thống hôm nay không có bảng chi phí vận hành, nên Chi phí / Lợi nhuận / Dòng " +
          "tiền chưa tính được từ dữ liệu. Cố ý không hiện thẻ số 0 — một hàng chỉ số " +
          "toàn 0 trông y hệt kết quả đo thật."
        }
        daCo={[
          "Doanh thu thực thu (đã trừ hoàn tiền + bút toán điều chỉnh) — lib/finance/thuc-thu.ts",
          "Mục tiêu doanh thu tháng × cơ sở (B-01) — bảng RevenueTarget + màn /bao-cao/doanh-thu",
        ]}
        chuaCo={[
          "Bảng chi phí vận hành + 3 quyền costs:view / costs:manage / costs:approve",
          "B-03 hàng chỉ số 2 (Chi phí · Lợi nhuận · Dòng tiền)",
          "B-05 mẫu import chi phí (định nghĩa cột + kiểm tra + báo dòng lỗi)",
        ]}
      />
    </div>
  );
}

/** Tỷ lệ → "62,5%". `null` không bao giờ được rơi về "0%". */
function phanTram(r: number | null): string {
  return r === null ? "—" : `${(r * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

/**
 * B-02 · hàng chỉ số 1 — **Mục tiêu · Doanh thu · Tỷ lệ hoàn thành**.
 *
 * Ba chỗ màn hình BẮT BUỘC nói ra thay vì để người đọc tự suy:
 *  1. Mục tiêu được cộng từ BAO NHIÊU cơ sở — đây đúng là chỗ từng sai (mục tiêu của N
 *     cơ sở bị đè còn một cơ sở), nên con số phải tự khai nguồn gốc của nó.
 *  2. Khoảng ngày cắt ngang tháng ⇒ mục tiêu vẫn là TRỌN THÁNG, KHÔNG chia theo ngày.
 *     Chia lặng lẽ là in ra một con số chưa ai cam kết.
 *  3. Chưa đặt mục tiêu ⇒ chữ "Chưa đặt" + lối đi tới màn đặt. KHÔNG hiện 0 (0 đọc
 *     thành "mục tiêu bằng không", và tỷ lệ hoàn thành thành vô nghĩa).
 */
function HangChiSoMucTieu({
  the,
  coQuyenDatMucTieu,
  soCoSoDangChon,
  laToanHeThong,
}: {
  the: RevenueTargetCard;
  coQuyenDatMucTieu: boolean;
  soCoSoDangChon: number;
  laToanHeThong: boolean;
}) {
  const s = the.summary;
  const nguonMucTieu = (() => {
    if (the.totalTarget === null) return undefined;
    const veCoSo =
      s.contributingCenters === 0
        ? null
        : `cộng mục tiêu của ${s.contributingCenters} cơ sở`;
    const veHe = s.usesSystemTarget ? "mục tiêu toàn hệ thống" : null;
    const ve = [veHe, veCoSo].filter(Boolean).join(" + ");
    const soKy = s.periods.length > 1 ? ` · ${s.periods.length} kỳ` : "";
    return ve ? `${ve.charAt(0).toUpperCase()}${ve.slice(1)}${soKy}` : undefined;
  })();

  const nhanTyLe =
    the.rateBlocked === "CHUA_DAT"
      ? "Chưa đặt mục tiêu"
      : the.rateBlocked === "THIEU_THANG"
        ? "Kỳ đang xem thiếu mục tiêu"
        : the.rateBlocked === "MUC_TIEU_KHONG_DUONG"
          ? "Mục tiêu đang đặt bằng 0"
          : s.partialMonths
            ? "So với mục tiêu TRỌN tháng"
            : undefined;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Mục tiêu · Doanh thu · Tỷ lệ hoàn thành
        </h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          B-02
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <ONho
          nhan="Mục tiêu"
          giaTri={the.totalTarget === null ? "Chưa đặt" : formatVndPlain(the.totalTarget)}
          phu={nguonMucTieu}
        />
        <ONho
          nhan="Doanh thu"
          giaTri={formatVndPlain(the.actual)}
          phu="Thực thu trong khoảng — cùng con số với bảng theo ngày bên dưới"
        />
        <ONho nhan="Tỷ lệ hoàn thành" giaTri={phanTram(the.achievedRate)} phu={nhanTyLe} />
      </div>

      {/* Chưa đặt mục tiêu: nói rõ đang thiếu kỳ nào + chỉ đường. Không có lối đi thì
          người dùng chỉ biết là thiếu chứ không biết đi đâu để hết thiếu. */}
      {s.periodsMissingTarget.length > 0 ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {the.rateBlocked === "CHUA_DAT" ? (
            <>
              Chưa đặt mục tiêu doanh thu cho{" "}
              {s.periodsMissingTarget.length === 1 ? "kỳ" : "các kỳ"}{" "}
              <strong>{s.periodsMissingTarget.map(formatPeriodVN).join(" · ")}</strong>
              {laToanHeThong ? "" : ` (phạm vi ${soCoSoDangChon} cơ sở đang chọn)`}. Ô Mục
              tiêu để trống chứ không hiện 0 — 0 đọc thành &quot;mục tiêu bằng không&quot;
              và tỷ lệ hoàn thành sẽ vô nghĩa.
            </>
          ) : (
            <>
              Khoảng đang xem chạm{" "}
              <strong>{s.periods.length} kỳ</strong> nhưng mới đặt mục tiêu cho{" "}
              <strong>{s.periodsWithTarget.map(formatPeriodVN).join(" · ")}</strong>; còn
              thiếu <strong>{s.periodsMissingTarget.map(formatPeriodVN).join(" · ")}</strong>.
              Ô Mục tiêu chỉ cộng các kỳ ĐÃ đặt, trong khi Doanh thu tính cả khoảng — chia
              hai số đó cho nhau sẽ ra một tỷ lệ cao giả, nên Tỷ lệ hoàn thành để trống
              cho tới khi đặt đủ.
            </>
          )}{" "}
          {coQuyenDatMucTieu ? (
            <Link href={DUONG_DAT_MUC_TIEU} className="font-semibold underline">
              Đặt mục tiêu doanh thu →
            </Link>
          ) : (
            <span>
              Tài khoản của bạn không có quyền đặt mục tiêu — đề nghị quản lý cơ sở hoặc
              hội sở đặt cho kỳ này.
            </span>
          )}
        </p>
      ) : null}

      {/* Khoảng cắt ngang tháng: NÓI RA cách quy đổi. Đây là chỗ dễ hiểu nhầm nhất —
          mục tiêu là cam kết TRỌN tháng, doanh thu chỉ có một phần tháng. */}
      {s.partialMonths && the.totalTarget !== null ? (
        <p className="mt-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
          Khoảng đang xem <strong>không trùng biên tháng</strong> — nó chạm{" "}
          {s.periods.map((p) => formatPeriodVN(p.period)).join(" + ")} nhưng chỉ lấy{" "}
          <strong>
            {s.daysInRange}/{s.daysInMonths} ngày
          </strong>{" "}
          của các tháng đó. Ô Mục tiêu ở trên là mục tiêu{" "}
          <strong>trọn tháng cộng lại, KHÔNG chia theo số ngày</strong> — mục tiêu là con
          số đã cam kết, tự chia ra sẽ thành một con số chưa ai duyệt.
          {the.achievedRate !== null ? (
            <>
              {" "}
              Vì vậy tỷ lệ hoàn thành ở trên đang so tiền của {s.daysInRange} ngày với mục
              tiêu của {s.daysInMonths} ngày.
              {the.progressRate !== null ? (
                <>
                  {" "}
                  So cho công bằng theo tiến độ thời gian:{" "}
                  <strong className="text-foreground">{phanTram(the.progressRate)}</strong>{" "}
                  (tỷ lệ hoàn thành ÷ {phanTram(s.coverage)} thời gian đã tính).
                </>
              ) : null}
            </>
          ) : null}
        </p>
      ) : null}

      {/* Bảng nhỏ theo kỳ: chỉ hiện khi có gì để so — nhiều kỳ, hoặc kỳ bị cắt. Một kỳ
          trọn tháng thì bảng này chỉ chép lại đúng con số phía trên. */}
      {s.periods.length > 1 || s.partialMonths ? (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">Kỳ</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Ngày trong khoảng
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Mục tiêu trọn tháng
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Nguồn mục tiêu
                </th>
              </tr>
            </thead>
            <tbody>
              {s.periods.map((p) => (
                <tr key={p.period} className="border-t border-border">
                  <td className="px-3 py-1.5 tabular-nums text-foreground">
                    {formatPeriodVN(p.period)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {p.daysInRange}/{p.daysInMonth}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-foreground">
                    {p.target === null ? (
                      <span className="text-amber-700 dark:text-amber-400">Chưa đặt</span>
                    ) : (
                      formatVndPlain(p.target)
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {p.source === "SYSTEM"
                      ? "Mục tiêu toàn hệ thống"
                      : p.source === "CENTERS"
                        ? `Cộng từ ${p.centerCount} cơ sở`
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** Bảng màu đường biểu đồ khi tách theo cơ sở. Quay vòng — 2–3 cơ sở là ca thật. */
const MAU_CO_SO = ["#F97316", "#7C3AED", "#0EA5E9", "#16A34A", "#DC2626", "#CA8A04"];
const MAU_TONG = "#0F172A";
const KEY_TONG = "tong";

function DoanhThuTheoNgay({
  bc,
  visibleCenters,
}: {
  /** ĐÃ nạp ở `TabTaiChinh` và dùng chung với B-02 — xem chú thích đầu tệp. */
  bc: DailyRevenueReport;
  visibleCenters: { id: string; name: string }[];
}) {
  const tenCoSo = new Map(visibleCenters.map((c) => [c.id, c.name]));
  const cot = bc.centerIds.map((id, i) => ({
    id,
    // Khoá chuỗi dữ liệu của biểu đồ có TIỀN TỐ: id cơ sở dùng thẳng làm khoá thì một
    // id trùng "ngay"/"tong" sẽ ĐÈ cột trục hoặc cột tổng, và đè im lặng.
    chartKey: `cs_${id}`,
    name: tenCoSo.get(id) ?? id,
    color: MAU_CO_SO[i % MAU_CO_SO.length]!,
  }));

  // Tổng các điểm ĐANG VẼ. Đặt cạnh `bc.total` (đi đường `aggregate`) để chênh lệch —
  // dấu hiệu duy nhất của việc quét bị cắt — không thể trốn ở đâu được.
  const tongDiem = bc.points.reduce((s, p) => s + p.revenue, 0);
  const lech = bc.total - tongDiem;
  const soNgayCo = bc.points.filter((p) => p.txnCount > 0).length;

  const duLieu = bc.points.map((p) => ({
    ngay: formatNhanNgay(p.day),
    [KEY_TONG]: p.revenue,
    ...(p.byCenter
      ? Object.fromEntries(cot.map((c) => [c.chartKey, p.byCenter![c.id] ?? 0]))
      : {}),
  }));

  const duong =
    cot.length > 0
      ? [
          ...cot.map((c) => ({ key: c.chartKey, name: c.name, color: c.color })),
          { key: KEY_TONG, name: "Tổng", color: MAU_TONG },
        ]
      : [{ key: KEY_TONG, name: "Thực thu", color: MAU_CO_SO[0]! }];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Doanh thu chi tiết theo ngày
        </h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          B-04
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <ONho nhan="Tổng thực thu trong khoảng" giaTri={formatVndPlain(bc.total)} />
        <ONho
          nhan="Số ngày trên trục"
          giaTri={`${bc.points.length} ngày`}
          phu={`${soNgayCo} ngày có phát sinh`}
        />
        <ONho
          nhan="Trung bình / ngày"
          giaTri={
            bc.points.length > 0
              ? formatVndPlain(Math.round(bc.total / bc.points.length))
              : "—"
          }
          phu="Chia đều cho MỌI ngày, kể cả ngày nghỉ"
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Thực thu = khoản kế toán đã xác nhận, đã trừ hoàn tiền và bút toán điều chỉnh,
        tính theo ngày tiền về (giờ Việt Nam). Ngày không phát sinh vẫn nằm trên trục với
        giá trị 0. Ngày có hoàn tiền lớn hơn tiền thu sẽ ra số âm — đó là số đúng.
      </p>

      {bc.rangeTrimmed ? (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Khoảng bạn chọn dài hơn {DAILY_REVENUE_MAX_DAYS} ngày. Biểu đồ và bảng dưới đây
          chỉ tính từ {formatDayKeyDMY(bc.fromKey)} đến {formatDayKeyDMY(bc.toKey)} — mọi
          con số trong khối này đều theo khoảng đã cắt đó, không phải khoảng trên thanh lọc.
        </p>
      ) : null}

      {bc.truncated ? (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Khoảng này có quá nhiều giao dịch để dựng chi tiết từng ngày. Số liệu từng ngày
          chỉ đầy đủ đến hết{" "}
          {bc.completeThroughDay ? formatDayKeyDMY(bc.completeThroughDay) : "ngày đầu kỳ"};
          các ngày sau đó đang THIẾU. Ô &quot;Tổng thực thu&quot; phía trên vẫn đúng cho
          cả khoảng. Hãy thu hẹp khoảng ngày để xem đủ.
        </p>
      ) : null}

      {!bc.truncated && lech !== 0 ? (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Tổng các ngày ({formatVndPlain(tongDiem)}) không khớp tổng của khoảng (
          {formatVndPlain(bc.total)}). Đây là lỗi phần mềm, không phải số liệu — báo cho
          đội kỹ thuật trước khi dùng con số này.
        </p>
      ) : null}

      <div className="mt-4">
        <LineChart
          data={duLieu}
          xKey="ngay"
          lines={duong}
          height={300}
          yFormat="vnd-compact"
          showLegend={duong.length > 1}
        />
      </div>

      {/* Bảng đi kèm biểu đồ: biểu đồ cho HÌNH DẠNG, bảng cho con số chính xác.
          Phân trang chỉ cắt ở tầng hiển thị — biểu đồ phía trên vẫn vẽ đủ mọi ngày, nên
          không có chuyện "trang 2 mới thấy đỉnh". */}
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <PhanTrangBang cuonNgang tenDonVi="ngày" khoaGhiNho="qlcs-doanh-thu-ngay">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">Ngày</th>
                {cot.map((c) => (
                  <th key={c.id} className="px-3 py-2 text-right font-medium text-muted-foreground">
                    {c.name}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  {cot.length > 0 ? "Tổng" : "Thực thu"}
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Số giao dịch
                </th>
              </tr>
            </thead>
            <tbody>
              {bc.points.map((p) => (
                <tr key={p.day} className="border-t border-border">
                  <td className="px-3 py-1.5 tabular-nums text-foreground">
                    {formatDayKeyDMY(p.day)}
                  </td>
                  {cot.map((c) => (
                    <td
                      key={c.id}
                      className={`px-3 py-1.5 text-right tabular-nums ${tone(p.byCenter?.[c.id] ?? 0)}`}
                    >
                      {formatVndPlain(p.byCenter?.[c.id] ?? 0)}
                    </td>
                  ))}
                  <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${tone(p.revenue)}`}>
                    {formatVndPlain(p.revenue)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {p.txnCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </section>
  );
}

/** Ngày 0 là số ĐO ĐƯỢC, không phải thiếu dữ liệu — làm mờ, không ẩn. */
function tone(v: number): string {
  if (v < 0) return "text-red-600 dark:text-red-400";
  if (v === 0) return "text-muted-foreground";
  return "text-foreground";
}

function ONho({ nhan, giaTri, phu }: { nhan: string; giaTri: string; phu?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">{nhan}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{giaTri}</p>
      {phu ? <p className="mt-0.5 text-[11px] text-muted-foreground">{phu}</p> : null}
    </div>
  );
}

/** "2026-08-15" → "15/08" — nhãn trục X. Bảng bên dưới mới hiện đủ cả năm. */
function formatNhanNgay(dayKey: string): string {
  const [, m, d] = dayKey.split("-");
  return `${d}/${m}`;
}
