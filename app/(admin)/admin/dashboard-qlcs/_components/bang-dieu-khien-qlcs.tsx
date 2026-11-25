import { resolveActor } from "@/lib/auth/actor";
import { resolveScopeFilters } from "@/lib/reports/filters";
import type { ScopeFilterSearchParams } from "@/lib/reports/scope-filters";
import { ScopeFilterBar, scopeSummaryText } from "@/components/admin/scope-filter-bar";
import { TabTaiChinh } from "../_tabs/tai-chinh";
import { TabKinhDoanh } from "../_tabs/kinh-doanh";
import { TabChiPhiMarketing } from "../_tabs/chi-phi-marketing";
import { TabTuongTacKh } from "../_tabs/tuong-tac-kh";

/**
 * Bốn khối của dashboard quản lý cơ sở, XẾP DỌC — không còn tab.
 *
 * ┌─ 27/08/2026 — vì sao bỏ tab ────────────────────────────────────────────────────┐
 * │ Chủ dự án chốt: Quản lý cơ sở và Quản trị hệ thống đăng nhập là thấy ngay bốn    │
 * │ khối này, không phải bấm sang màn thứ hai rồi bấm tiếp từng tab. Tab chỉ có giá  │
 * │ trị khi mỗi tab là một CÔNG VIỆC riêng; ở đây bốn khối là bốn mặt của cùng một   │
 * │ câu hỏi "cơ sở tôi đang chạy thế nào", và người xem cần đọc liền mạch.           │
 * │                                                                                  │
 * │ Hệ quả kỹ thuật phải biết: bỏ tab nghĩa là CẢ BỐN khối cùng truy vấn trong một   │
 * │ lượt tải, thay vì mỗi lượt một khối. Hôm nay chịu được vì hai khối (Chi phí      │
 * │ Marketing, Tương tác KH) chưa nối số liệu nên gần như không tốn gì. Khi hai khối │
 * │ đó có số thật, đo lại thời gian tải — chỗ cần sửa là bọc từng khối trong         │
 * │ <Suspense> để chúng chạy song song và hiện dần, KHÔNG phải quay về tab.          │
 * └──────────────────────────────────────────────────────────────────────────────────┘
 *
 * Bốn khối đọc CÙNG một bộ lọc do `resolveScopeFilters()` giải một lần ở đây — không
 * khối nào được tự giải lần hai (AC A-02-3).
 */
export async function BangDieuKhienQlcs({
  userId,
  searchParams,
  basePath,
}: {
  userId: string;
  /** searchParams ĐÃ await của trang cha. */
  searchParams: ScopeFilterSearchParams;
  /** Trang đang mount khối này — thanh lọc gửi form về đúng đây. */
  basePath: string;
}) {
  const actor = await resolveActor(userId);
  // Bộ lọc dùng chung A-02: cơ sở (giao visibleCenterIds × cơ sở chọn trong URL — cơ sở
  // ngoài phạm vi bị loại IM LẶNG) + khoảng ngày giờ VN + cờ tách theo cơ sở.
  const fc = await resolveScopeFilters(actor, searchParams);

  // Không có cơ sở nào trong tầm nhìn ⇒ mọi khối đều rỗng. Nói thẳng nguyên nhân (chưa
  // được gán cơ sở) thay vì để người dùng nhìn màn trống và tưởng hệ thống hỏng.
  const khongCoCoSo = fc.visibleCenters.length === 0;

  return (
    <div className="space-y-5">
      <ScopeFilterBar
        basePath={basePath}
        // Không còn tab, nhưng thanh lọc vẫn nhận khoá tab để dựng lại đường dẫn sau khi
        // bấm "Lọc". Ghim "tai-chinh" = khối đầu tiên; giá trị này không hiện ra đâu cả.
        tab="tai-chinh"
        visibleCenters={fc.visibleCenters}
        filters={fc.filters}
        dateFromStr={fc.dateFromStr}
        dateToStr={fc.dateToStr}
        canSplit={fc.canSplit}
        droppedCenterCount={fc.droppedCenterCount}
      />

      {khongCoCoSo ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Tài khoản của bạn chưa được gán cơ sở nào đang hoạt động, nên chưa có phạm vi
          để tổng hợp. Liên hệ quản trị viên để được gán cơ sở.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Đang xem: {scopeSummaryText(fc.filters, fc.visibleCenters, fc.dateFromStr, fc.dateToStr)}
        </p>
      )}

      <Khoi tieuDe="Tài chính">
        <TabTaiChinh
          actor={actor}
          filters={fc.filters}
          visibleCenters={fc.visibleCenters}
          // B-02: chỉ người ĐẶT được mục tiêu toàn hệ thống mới được ĐỌC dòng
          // `centerId = NULL`. Lấy thẳng cờ mà `resolveScopeFilters` đã tính, không để
          // khối tự so lại vai — hai chỗ tính cùng một luật là hai chỗ lệch nhau về sau.
          isGlobalAllowed={fc.isGlobalAllowed}
        />
      </Khoi>

      <Khoi tieuDe="Kinh doanh">
        <TabKinhDoanh
          actor={actor}
          filters={fc.filters}
          visibleCenters={fc.visibleCenters}
          // Khoá ngày ĐÃ chuẩn hoá (ngày tương lai đã kẹp) — khối không tự quy lại từ
          // mốc UTC, để dòng chữ "đang lọc theo ngày vào hệ thống …" luôn khớp đúng
          // thứ thanh lọc đang hiện.
          dateFromStr={fc.dateFromStr}
          dateToStr={fc.dateToStr}
        />
      </Khoi>

      <Khoi tieuDe="Chi phí Marketing">
        <TabChiPhiMarketing />
      </Khoi>

      <Khoi tieuDe="Tương tác khách hàng">
        <TabTuongTacKh />
      </Khoi>
    </div>
  );
}

/** Tiêu đề khối — thay cho nhãn tab cũ, để người đọc còn biết mình đang ở phần nào. */
function Khoi({ tieuDe, children }: { tieuDe: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          {tieuDe}
        </h2>
        <span className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}
