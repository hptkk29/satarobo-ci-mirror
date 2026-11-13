// @vitest-environment node
// [NF-*] Chuông/feed phụ huynh (03/11/2026): KHÔNG còn mục «học phí cần đóng»; GIỮ «Đã xác nhận thanh toán» (Notification);
// THÊM «Có hoá đơn mới» CHỈ khi nguồn hoá đơn (đã lọc theo nhu cầu) trả về. Mọi nguồn bị giả lập — ca khẳng định HÀNH VI của feed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getChildren: vi.fn(),
  getStudentBilling: vi.fn(),
  getParentNotifications: vi.fn(),
  docHoaDonMoiChoFeed: vi.fn(),
}));

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("@/lib/portal/feed-read", () => ({ idsDaDoc: async () => new Set<string>() }));
vi.mock("@/lib/portal/feedback", () => ({ getStudentFeedback: async () => [] }));
vi.mock("@/lib/portal/makeup", () => ({
  getStudentMakeup: async () => ({ centerName: null, needCount: 0, pendingCount: 0, doneCount: 0, needList: [], history: [] }),
}));
vi.mock("@/lib/portal/billing-student", () => ({ getStudentBilling: m.getStudentBilling }));
vi.mock("@/lib/portal/surveys", () => ({ getCenterSurveys: async () => ({ cards: [], todoCount: 0 }) }));
vi.mock("@/lib/portal/notifications", () => ({ getParentNotifications: m.getParentNotifications }));
vi.mock("@/lib/portal/session", () => ({ getChildren: m.getChildren }));
vi.mock("@/lib/lms/report-card", () => ({ getPublishedReportCards: async () => [] }));
vi.mock("@/lib/portal/hoa-don-phu-huynh", () => ({ docHoaDonMoiChoFeed: m.docHoaDonMoiChoFeed }));

import { getParentNotificationFeed } from "@/lib/portal/notification-feed";

const NOW = new Date();
let phSo = 0;
const feed = () => getParentNotificationFeed(`ph-${++phSo}`); // React cache theo tham số — mỗi ca một phụ huynh

beforeEach(() => {
  vi.clearAllMocks();
  m.getChildren.mockResolvedValue([{ id: "s1", name: "Bảo An", centerId: null, preferredCenterId: null }]);
  // CON ĐANG CÒN NỢ + có hạn: trước 03/11 sinh «Học phí cần thanh toán»
  m.getStudentBilling.mockResolvedValue({ outstanding: 5_000_000, nextDueDate: "2026-01-01T00:00:00.000Z", tamHoanThu: null, rows: [], receipts: [] });
  m.getParentNotifications.mockResolvedValue([]);
  m.docHoaDonMoiChoFeed.mockResolvedValue([]);
});

describe("[NF-01] không còn thông báo «học phí cần đóng»", () => {
  it("con còn nợ / quá hạn / đang bảo lưu ⇒ KHÔNG có mục fee-* và KHÔNG có chữ 'cần thanh toán' / 'tạm hoãn thu'", async () => {
    for (const tam of [null, { denNgay: "2026-12-31T00:00:00.000Z" }]) {
      m.getStudentBilling.mockResolvedValue({ outstanding: 5_000_000, nextDueDate: "2026-01-01T00:00:00.000Z", tamHoanThu: tam, rows: [], receipts: [] });
      const f = await feed();
      expect(f.items.filter((i) => i.id.startsWith("fee-"))).toEqual([]);
      expect(JSON.stringify(f.items)).not.toMatch(/cần thanh toán|tạm hoãn thu|công nợ/i);
      expect(f.unreadByCategory.HOC_PHI).toBe(0);
    }
    expect(m.getStudentBilling).not.toHaveBeenCalled(); // feed thôi đọc công nợ hoàn toàn
  });
});

describe("[NF-02] GIỮ «Đã xác nhận thanh toán»", () => {
  it("Notification «Đã xác nhận thanh toán» vẫn vào feed (đối chứng dương)", async () => {
    m.getParentNotifications.mockResolvedValue([
      { id: "n1", title: "Đã xác nhận thanh toán", body: "Trung tâm đã xác nhận khoản thanh toán 2.520.000", publishedAt: NOW.toISOString(), scope: "Riêng con bạn", audience: "STUDENT", studentId: "s1" },
    ]);
    const f = await feed();
    const it = f.items.find((i) => i.id === "nt-n1");
    expect(it?.title).toBe("Đã xác nhận thanh toán");
    expect(it?.childName).toBe("Bảo An");
  });
});

describe("[NF-03] «Có hoá đơn mới» — chỉ khi nguồn hoá đơn (đơn CÓ NHU CẦU) trả về", () => {
  it("có hoá đơn đã xuất ⇒ một mục «Có hoá đơn mới», thuộc HOC_PHI, kèm tên con, chưa đọc", async () => {
    m.docHoaDonMoiChoFeed.mockResolvedValue([{ id: "hd1", soHoaDon: "0000127", kyHieu: "1C26TSR", at: NOW.toISOString(), studentId: "s1" }]);
    const f = await feed();
    const it = f.items.find((i) => i.id === "hd-hd1");
    expect(it).toMatchObject({ category: "HOC_PHI", title: "Có hoá đơn mới", childName: "Bảo An", read: false });
    expect(it?.body).toContain("0000127");
    expect(f.unreadByCategory.HOC_PHI).toBe(1);
  });
  it("không có hoá đơn (hoặc đơn không nhu cầu ⇒ nguồn trả rỗng) ⇒ không có mục nào", async () => {
    const f = await feed();
    expect(f.items.filter((i) => i.id.startsWith("hd-"))).toEqual([]);
    expect(f.unreadTotal).toBe(0);
  });
  it("nguồn hoá đơn ném lỗi ⇒ bỏ qua mục này, feed vẫn dựng được", async () => {
    m.docHoaDonMoiChoFeed.mockRejectedValue(new Error("db"));
    const f = await feed();
    expect(f.items.filter((i) => i.id.startsWith("hd-"))).toEqual([]);
  });
  it("nguồn hoá đơn được hỏi với danh sách con của phụ huynh (từ phiên, không từ tham số ngoài)", async () => {
    await feed();
    expect(m.docHoaDonMoiChoFeed).toHaveBeenCalledWith([{ id: "s1", name: "Bảo An", centerId: null, preferredCenterId: null }]);
  });
});
