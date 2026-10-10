import { ChoDuLieu } from "../_components/cho-du-lieu";

/**
 * Tab Chi phí Marketing — khu vực D (D-03 khối chỉ số ngân sách · D-04 CPL · D-05 CPA ·
 * D-07 bảng gán tay campaign → cơ sở · D-08 cảnh báo chi tiêu chưa phân bổ).
 */
export function TabChiPhiMarketing() {
  return (
    <ChoDuLieu
      maSpec="D-01 · D-03 → D-05 · D-07 · D-08"
      tieuDe="Chi phí Marketing: chờ nối tài khoản quảng cáo"
      giaiThich={
        "Job đồng bộ chi tiêu Facebook Ads (D-01) chưa tồn tại, nên bảng snapshot chi " +
        "tiêu theo ngày vẫn rỗng. Chừng nào chưa có số chi tiêu thật thì Ngân sách thực " +
        "tế, CPL và CPA đều không tính được — hiện số ở đây chỉ là hiện số 0 và gọi nó " +
        "là kết quả đo."
      }
      daCo={[
        "Chỉ tiêu ngân sách quảng cáo tháng × cơ sở (D-02) — bảng AdsBudgetTarget + màn /bao-cao/ngan-sach-quang-cao",
        "Bóc mã cơ sở từ tên campaign theo quy ước SR.QD.232 (D-06) — lib/ads/campaign-code.ts",
      ]}
      chuaCo={[
        "D-01 job cron 00:00 quét chi tiêu Meta và lưu snapshot bất biến theo ngày",
        "D-03 chỉ tiêu · ngân sách thực tế · % thực tế trên chỉ tiêu",
        "D-04 CPL (chi phí / tổng lead) và D-05 CPA (chi phí / lead chốt)",
        "D-07 bảng gán tay campaign → cơ sở (ưu tiên cao hơn kết quả bóc mã)",
        "D-08 cảnh báo khi khoảng đang xem còn chi tiêu ở nhóm CHƯA PHÂN BỔ",
      ]}
    />
  );
}
