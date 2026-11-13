import { checkPermission, canViewLeadPii } from "@/lib/auth/check-permission";
import type { Actor } from "@/lib/auth/actor";
import type { ScopeFilters } from "@/lib/reports/scope-filters";
import { getConvertedLeadRows } from "@/lib/reports/converted-leads";
import { getLostLeadRows } from "@/lib/reports/lost-leads";
import { loadStaleLeadThresholdsByCenter } from "@/lib/lead/stale-lead-config";
import { qlcsFilterParams } from "@/lib/dashboard/qlcs-tabs";
import { ChoDuLieu } from "../_components/cho-du-lieu";
import { BangLeadChuyenDoi } from "./_bang-lead-chuyen-doi";
import { BangLeadRot } from "./_bang-lead-rot";

/**
 * Tab Kinh doanh — khu vực C (C-02 khối chỉ số lead · **C-03 bảng lead đã chuyển đổi** ·
 * C-04 xuất Excel · **C-05 bảng lead rớt**).
 *
 * C-03, C-04 và C-05 đã chạy trên dữ liệu thật; C-02 vẫn chờ nên phần dưới màn giữ khối
 * `ChoDuLieu` — cố ý KHÔNG hiện thẻ "Tổng lead: 0", vì một thẻ 0 trông y hệt kết quả đo
 * thật.
 *
 * ⚠️ Hai bảng trên tab này lọc theo HAI TRỤC NGÀY khác nhau và đó là chủ ý: C-03 theo
 * **ngày chốt** (câu hỏi "kỳ này chốt được ai"), C-05 theo **ngày vào hệ thống** (cùng
 * mẫu số với tổng lead của kỳ). Ép chung một trục là làm hỏng một trong hai câu hỏi —
 * nên mỗi bảng tự viết trục của mình ra bằng chữ ở dòng mô tả.
 *
 * Gate riêng của tab: trang `/dashboard-qlcs` mở bằng `dashboard:view`, nhưng danh sách
 * lead thì không — chốt 24/08 ghi rõ tab C đi bằng `leads:view-all`
 * (`lib/auth/permissions.ts`). Cố ý KHÔNG nhận `leads:view-own` làm cửa thay thế: bảng
 * này là công cụ SOI của quản lý, cho người chỉ thấy phiếu của mình vào đây là đưa họ một
 * bảng thiếu mà không có gì trên màn nói rằng nó thiếu.
 */
export async function TabKinhDoanh({
  actor,
  filters,
  visibleCenters,
  dateFromStr,
  dateToStr,
}: {
  actor: Actor;
  filters: ScopeFilters;
  visibleCenters: { id: string; name: string }[];
  /** Khoá ngày ĐÃ chuẩn hoá của bộ lọc chung — nhận lại chứ không tự quy từ `Date`. */
  dateFromStr: string;
  dateToStr: string;
}) {
  if (!(await checkPermission("leads:view-all"))) {
    return (
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">
          Tab Kinh doanh: bạn không có quyền xem danh sách lead
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Vào được dashboard không đồng nghĩa xem được toàn bộ lead của cơ sở. Ba tab còn
          lại vẫn dùng được bình thường. Cần xem thì đề nghị quản trị viên cấp quyền
          &quot;Xem tất cả lead&quot;.
        </p>
      </section>
    );
  }

  // Hai ngưỡng cảnh báo là `centerOverridable` (quyết định 12(a)) ⇒ lấy theo TỪNG cơ sở
  // rồi áp cho đúng phiếu của cơ sở đó. Lấy một bộ chung cho cả bảng là cùng một phiếu
  // đổi màu tuỳ người xem đang mở một cơ sở hay nhiều cơ sở.
  const [nguong, coQuyenPii, coQuyenTien, coQuyenXuat] = await Promise.all([
    loadStaleLeadThresholdsByCenter(filters.centerIds),
    canViewLeadPii(),
    // Vào được tab Kinh doanh KHÔNG đồng nghĩa xem được tiền — cùng luật với tab Tài
    // chính ngay bên cạnh. Thiếu quyền thì hai cột tiền của C-03 không được dựng, và
    // đường đọc `Payment` cũng không chạy lần nào.
    checkPermission("payments:view"),
    // C-04 / A-03 — quyền MANG DỮ LIỆU RA NGOÀI, tách khỏi quyền xem bảng. Ở đây chỉ để
    // quyết định có dựng nút hay không; route xuất tự gác lại cả hai cửa, vì giấu nút
    // không phải là kiểm soát truy cập.
    checkPermission("leads:export"),
  ]);

  const bcChuyenDoi = await getConvertedLeadRows(actor, filters, {
    canViewPii: coQuyenPii,
    includeRevenue: coQuyenTien,
  });

  const bc = await getLostLeadRows(actor, filters, {
    canViewPii: coQuyenPii,
    thresholdsFor: (centerId) =>
      (centerId ? nguong.byCenter.get(centerId) : undefined) ?? nguong.fallback,
  });

  // Ngưỡng ĐỂ VIẾT RA BẰNG CHỮ: đúng một cơ sở thì nói ngưỡng của cơ sở đó; nhiều cơ sở
  // thì nói ngưỡng chung (từng dòng vẫn tính theo cơ sở của nó).
  const nguongHienThi =
    filters.centerIds.length === 1
      ? (nguong.byCenter.get(filters.centerIds[0]!) ?? nguong.fallback)
      : nguong.fallback;

  const centerNameById = new Map(visibleCenters.map((c) => [c.id, c.name]));

  // C-04 — link xuất dựng từ CHÍNH bộ lọc đã giải (`qlcsFilterParams`, dùng chung với
  // link chuyển tab), không phải từ chuỗi truy vấn thô: chuyền chuỗi thô sang là ngày
  // tương lai bị kẹp / cơ sở ngoài phạm vi bị loại sẽ "sống lại" trong tệp, và tệp tải
  // về khác thứ đang hiển thị trên màn.
  const exportHref = coQuyenXuat
    ? `/api/admin/dashboard-qlcs/lead-chuyen-doi-export?${qlcsFilterParams({
        centerIds: filters.centerIds,
        isAllCenters: filters.isAllCenters,
        dateFrom: dateFromStr,
        dateTo: dateToStr,
        split: filters.groupByCenter,
      }).toString()}`
    : null;

  return (
    <div className="space-y-5">
      <BangLeadChuyenDoi
        bc={bcChuyenDoi}
        centerNameById={centerNameById}
        dateFromStr={dateFromStr}
        dateToStr={dateToStr}
        exportHref={exportHref}
      />

      <BangLeadRot
        bc={bc}
        centerNameById={centerNameById}
        hienCotCoSo={filters.centerIds.length > 1}
        thresholds={nguongHienThi}
        dateFromStr={dateFromStr}
        dateToStr={dateToStr}
      />

      <ChoDuLieu
        maSpec="C-02"
        tieuDe="Khối chỉ số lead: chưa nối vào màn"
        giaiThich={
          "Ba bảng/nút làm việc của khu vực C (C-03 lead đã chuyển đổi, C-04 xuất Excel, " +
          "C-05 lead rớt) đã chạy trên dữ liệu thật. Phần còn lại là khối ba con số ở đầu " +
          "tab — nó cần thứ chưa có, không phải chỉ cần ghép giao diện."
        }
        daCo={[
          "Chỉ tiêu lead theo tháng × cơ sở (C-01) — bảng LeadTarget + màn /bao-cao/muc-tieu-lead",
          "Doanh thu thực thu quy về từng con — lib/reports/revenue-by-child.ts",
          "Mốc chốt + giá trị hợp đồng theo từng con (G-06) — LeadChild.closedAt / contractValue",
          "Bảng C-03 đủ 9 cột, đếm theo học sinh, kèm khối đối soát với tab Tài chính",
          "C-04 xuất Excel bảng C-03 theo đúng bộ lọc đang áp dụng, gác bằng quyền leads:export (A-03)",
        ]}
        chuaCo={[
          "C-02 tổng lead · tỷ lệ đạt chỉ tiêu · tỷ lệ chốt, theo khoảng ngày đang lọc",
        ]}
      />
    </div>
  );
}
