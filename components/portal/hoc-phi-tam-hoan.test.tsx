// @vitest-environment node
// [BL4-HP] Màn Học phí của cổng phụ huynh khi bé ĐANG BẢO LƯU (chốt 08/10/2026, mục C(c)):
// KHÔNG ẩn "kỳ đến hạn" — hiện "Tạm hoãn thu do bảo lưu đến <ngày>", không tô đỏ / không "quá hạn" / không "Chưa thanh toán".
// Render THẬT ra HTML (không soi mã nguồn): ca đỏ khi người sau gỡ nhánh tạm hoãn ra khỏi component.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/portal/child-switcher", () => ({ ChildSwitcher: () => null }));

import { HocPhiPageV2 } from "@/components/portal/hoc-phi-page";
import type { StudentBilling } from "@/lib/portal/billing-student";

const NO: StudentBilling = {
  courseName: "Sata 3",
  className: "S3-T7",
  tuition: 5_000_000,
  paid: 2_000_000,
  outstanding: 3_000_000,
  nextDueDate: "2026-09-20T03:00:00.000Z", // ĐÃ QUÁ HẠN so với "hôm nay" của test
  rows: [
    { enrollmentId: "e1", courseName: "Sata 3", className: "S3-T7", finalPrice: 5_000_000, paid: 2_000_000, outstanding: 3_000_000, chuaChotGia: false },
  ],
  receipts: [],
  pendingCount: 0,
  rejectedCount: 0,
  tamHoanThu: null,
};

const html = (d: StudentBilling) =>
  renderToStaticMarkup(<HocPhiPageV2 kids={[{ id: "s1", name: "An" }]} activeId="s1" studentName="An" data={d} methodLabels={{}} />);

describe("[BL4-HP] học phí cổng PH × bảo lưu theo quy chế", () => {
  it("[BL4-HP-01] ĐỐI CHỨNG: bé không bảo lưu ⇒ 'Kỳ đến hạn', 'Chưa thanh toán' và 'quá hạn N ngày' như cũ", () => {
    const h = html(NO);
    expect(h).toContain("Kỳ đến hạn");
    expect(h).toContain("Chưa thanh toán");
    expect(h).toMatch(/quá hạn \d+ ngày/);
    expect(h).not.toContain("Tạm hoãn thu");
  });

  it("[BL4-HP-02] bé ĐANG bảo lưu ⇒ nhãn 'Tạm hoãn thu do bảo lưu đến 07/04/2027'; KHÔNG 'quá hạn', KHÔNG 'Chưa thanh toán', KHÔNG 'Kỳ đến hạn' đỏ", () => {
    const h = html({ ...NO, tamHoanThu: { denNgay: "2027-04-07T03:00:00.000Z" } });
    expect(h).toContain("Tạm hoãn thu do bảo lưu đến 07/04/2027");
    expect(h).not.toMatch(/quá hạn/);
    expect(h).not.toContain("Chưa thanh toán");
    expect(h).not.toContain("Kỳ đến hạn");
    // Khoản nợ KHÔNG bị ẩn: số tiền vẫn hiện (ẩn là để phụ huynh tưởng nợ đã biến mất)
    expect(h).toContain("3.000.000");
    // Không có tông đỏ (destructive) ở khối hạn
    expect(h).not.toMatch(/bg-destructive/);
  });

  it("[BL4-HP-03] hồ sơ chưa có hạn ⇒ vẫn là tạm hoãn nhưng KHÔNG bịa ngày", () => {
    const h = html({ ...NO, tamHoanThu: { denNgay: null } });
    expect(h).toContain("Tạm hoãn thu do bảo lưu");
    expect(h).not.toMatch(/bảo lưu đến/);
  });
});
