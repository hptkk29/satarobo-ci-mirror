// [NLC] — quyết định nối học viên CŨ về lead nguồn (25/09/2026). THUẦN.
import { describe, it, expect } from "vitest";
import { quyetDinhNoiLead, type BangChungNoiLead } from "./noi-lead-cu";

const RONG: BangChungNoiLead = { tuGhiDanh: [], tuThanhToan: [], tuDonHang: [], tuNhatKy: [] };
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("[NLC] quyetDinhNoiLead", () => {
  it("[NLC-01] không bằng chứng ⇒ null (chưa nối, không phải 'không có lead')", () => {
    expect(quyetDinhNoiLead(RONG)).toBeNull();
  });

  it("[NLC-02] ① ghi danh SỚM NHẤT thắng, và cho leadChildId", () => {
    const kq = quyetDinhNoiLead({
      ...RONG,
      tuGhiDanh: [
        { leadId: "L-sau", leadChildId: "C-sau", enrolledAt: d("2026-03-01") },
        { leadId: "L-goc", leadChildId: "C-goc", enrolledAt: d("2025-09-01") },
      ],
    });
    expect(kq).toEqual({ leadId: "L-goc", leadChildId: "C-goc", chain: "GHI_DANH" });
  });

  it("[NLC-03] ① thắng cả khi ②③④ chỉ về phiếu KHÁC (không thành mập mờ)", () => {
    const kq = quyetDinhNoiLead({
      tuGhiDanh: [{ leadId: "L1", leadChildId: "C1", enrolledAt: d("2025-01-01") }],
      tuThanhToan: ["L2"],
      tuDonHang: ["L3"],
      tuNhatKy: ["L4"],
    });
    expect(kq).toEqual({ leadId: "L1", leadChildId: "C1", chain: "GHI_DANH" });
  });

  it("[NLC-04] ① hoà giờ ⇒ kết quả KHÔNG phụ thuộc thứ tự đầu vào", () => {
    const a = { leadId: "LB", leadChildId: "C1", enrolledAt: d("2025-01-01") };
    const b = { leadId: "LA", leadChildId: "C2", enrolledAt: d("2025-01-01") };
    const x = quyetDinhNoiLead({ ...RONG, tuGhiDanh: [a, b] });
    const y = quyetDinhNoiLead({ ...RONG, tuGhiDanh: [b, a] });
    expect(x).toEqual(y);
    expect(x).toEqual({ leadId: "LA", leadChildId: "C2", chain: "GHI_DANH" });
  });

  it("[NLC-05] không ① + đúng MỘT lead ở ②③④ (kể cả lặp lại) ⇒ nối, leadChildId null", () => {
    expect(quyetDinhNoiLead({ ...RONG, tuThanhToan: ["L1", "L1"], tuNhatKy: ["L1"] })).toEqual({
      leadId: "L1",
      leadChildId: null,
      chain: "THANH_TOAN",
    });
    expect(quyetDinhNoiLead({ ...RONG, tuDonHang: ["L2"], tuNhatKy: ["L2"] })).toEqual({
      leadId: "L2",
      leadChildId: null,
      chain: "DON_HANG",
    });
    expect(quyetDinhNoiLead({ ...RONG, tuNhatKy: ["L3"] })).toEqual({
      leadId: "L3",
      leadChildId: null,
      chain: "NHAT_KY",
    });
  });

  it("[NLC-06] không ① + HAI lead trở lên ở ②③④ ⇒ MẬP MỜ (không tự ghi), danh sách đã sắp", () => {
    expect(quyetDinhNoiLead({ ...RONG, tuThanhToan: ["L2"], tuNhatKy: ["L1"] })).toEqual({
      mapHo: true,
      leadIds: ["L1", "L2"],
    });
    expect(quyetDinhNoiLead({ ...RONG, tuDonHang: ["L9", "L8"] })).toEqual({
      mapHo: true,
      leadIds: ["L8", "L9"],
    });
  });
});
