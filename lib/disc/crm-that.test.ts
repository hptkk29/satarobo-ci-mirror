// @vitest-environment node
/**
 * [DISC-CRM-07] Nối CRM thật (crm-that.ts): hành vi với module phụ thuộc được GIẢ LẬP (không chạm DB/mạng).
 *  · F-15: đường DISC KHÔNG gọi Meta CAPI / GA4 MP / lib/tracking — kiểm bằng hành vi (mock không được gọi) VÀ bằng đọc mã.
 *  · F-09/F-13: lead tạo ra có consentMarketing=false và không mang tên con.
 *  · H-2: đồng hồ được tiêm — mọi dấu thời gian lead/nguồn là giờ tiêm, không phải giờ thật.
 * Dữ liệu GIẢ.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { boChuThich, docTep, lietKeTep, tuongDoi } from "../../tests/disc/_quet";

const M = vi.hoisted(() => {
  const leadCreate = vi.fn(async (_a: { data: Record<string, unknown> }) => ({ id: "lead-moi", centerId: null as string | null }));
  return {
    leadCreate,
    discUpdateMany: vi.fn(async () => ({ count: 1 })),
    chuanBiQuyNguon: vi.fn(async (_db: unknown, _x: unknown[]) => [{ nguon: "n" }]),
    guiCapi: vi.fn(),
    guiGa4: vi.fn(),
    autoAssign: vi.fn(async () => {}),
    discFindUnique: vi.fn(async (_a: unknown) => null as { consentMarketing: boolean; leadId: string | null } | null),
    leadUpdateMany: vi.fn(async (_a: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({ count: 1 })),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db", () => ({
  db: {
    lead: { findUnique: vi.fn(async () => null), create: M.leadCreate, updateMany: M.leadUpdateMany },
    discSubmission: { updateMany: M.discUpdateMany, findUnique: M.discFindUnique },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ lead: { create: M.leadCreate } }),
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/lead/dedup", () => ({ findRecentDuplicate: vi.fn(async () => null), logDuplicateAttempt: vi.fn() }));
vi.mock("@/lib/lead/auto-assign", () => ({ autoAssignNewLead: M.autoAssign }));
vi.mock("@/lib/lead/assign-lead", () => ({ chiaChoLead: vi.fn() }));
vi.mock("@/lib/affiliate/nhan-referral", () => ({ chuanBiReferral: vi.fn(), ghiReferralChoLeadCu: vi.fn(), ghiReferralSauKhiTaoLead: vi.fn() }));
vi.mock("@/lib/affiliate/theo-doi-cong-khai", () => ({ COOKIE_GIOI_THIEU: "sr_aff", docCoTheoDoi: async () => false }));
vi.mock("@/lib/nguon/noi-day", () => ({ chuanBiQuyNguon: M.chuanBiQuyNguon, ghiNguonDenSauChoLeadCu: vi.fn(), ghiQuyNguonLeadMoi: vi.fn() }));
vi.mock("@/lib/nguon/tin-hieu", () => ({ KHONG_CO_TIN_HIEU_NGUON: { quangCao: {}, utm: {} } }));
// Cổng bên ngoài mà đường DISC KHÔNG ĐƯỢC chạm. Nếu mã sản phẩm import chúng thì mock này ghi nhận lời gọi.
vi.mock("@/lib/tracking", () => ({ sendMetaCapi: M.guiCapi, sendGa4Event: M.guiGa4 }));

import { taoCongCrmThat, xacNhanTiepThiSauNhan } from "./crm-that";

const GIO_TIEM = new Date("2026-11-01T03:00:00Z");
const D = { submissionId: "sub1", soDienThoai: "84905000111", tenPhuHuynh: "Phụ Huynh Giả", email: "gia@example.invalid", tenCon: "Bé Giả Tên Con", tiepThi: true, chienDich: "DISC", diaChi: null };

beforeEach(() => vi.clearAllMocks());

describe("[DISC-CRM-07] CRM thật: không CAPI/GA4, không tên con, đồng ý tiếp thị false, giờ tiêm", () => {
  it("tạo lead mới: consentMarketing=false dù tiepThi=true; không có tên con; không gọi CAPI/GA4", async () => {
    const r = await taoCongCrmThat(() => GIO_TIEM)(D);
    expect(r).toEqual({ leadId: "lead-moi" });
    expect(M.leadCreate).toHaveBeenCalledTimes(1);
    const data = M.leadCreate.mock.calls[0]![0].data;
    expect(data.consentMarketing).toBe(false);
    expect(data).not.toHaveProperty("childName");
    expect(JSON.stringify(data)).not.toContain("Bé Giả");
    expect(data.phone).toBe("84905000111");
    expect(M.guiCapi).not.toHaveBeenCalled();
    expect(M.guiGa4).not.toHaveBeenCalled();
  });

  it("H-2: mọi dấu thời gian lead/nguồn là giờ TIÊM (lastInboundAt, bayGio)", async () => {
    await taoCongCrmThat(() => GIO_TIEM)(D);
    expect(M.leadCreate.mock.calls[0]![0].data.lastInboundAt).toEqual(GIO_TIEM);
    const tinHieu = M.chuanBiQuyNguon.mock.calls[0]![1][0] as { bayGio: Date };
    expect(tinHieu.bayGio).toEqual(GIO_TIEM);
  });

  it("soDienThoai không phải SĐT chuẩn hoá (HMAC) ⇒ không tạo lead", async () => {
    const r = await taoCongCrmThat(() => GIO_TIEM)({ ...D, soDienThoai: "f".repeat(64) });
    expect(r).toEqual({ leadId: null });
    expect(M.leadCreate).not.toHaveBeenCalled();
  });
});

describe("[DISC-CRM-07c] bật đồng ý tiếp thị sau xác thực: điều kiện nằm TRONG phép ghi", () => {
  it("bài có ô tích + có lead ⇒ updateMany ràng id + SĐT chủ số + chỉ khi đang chưa bật", async () => {
    M.discFindUnique.mockResolvedValueOnce({ consentMarketing: true, leadId: "lead-1" });
    expect(await xacNhanTiepThiSauNhan({ submissionId: "sub1", sdtChuan: "84905000111" })).toBe("DA_BAT");
    expect(M.leadUpdateMany).toHaveBeenCalledTimes(1);
    // N7: ô tích của NGƯỜI GÕ chỉ áp cho lead do CHÍNH bài này tạo (eventId) — không bao giờ lật lead có sẵn.
    expect(M.leadUpdateMany.mock.calls[0]![0]).toEqual({
      where: { id: "lead-1", phone: { in: ["84905000111", "0905000111"] }, consentMarketing: false, eventId: "disc:sub1" },
      data: { consentMarketing: true },
    });
  });
  it("N7: chủ số TỰ tích ở form nhận ⇒ phép ghi KHÔNG ràng eventId (đồng ý mới của chính họ, vẫn ràng id + SĐT + đang chưa bật)", async () => {
    M.discFindUnique.mockResolvedValueOnce({ consentMarketing: false, leadId: "lead-1" });
    expect(await xacNhanTiepThiSauNhan({ submissionId: "sub1", sdtChuan: "84905000111", chuSoDongY: true })).toBe("DA_BAT");
    expect(M.leadUpdateMany.mock.calls[0]![0]).toEqual({
      where: { id: "lead-1", phone: { in: ["84905000111", "0905000111"] }, consentMarketing: false },
      data: { consentMarketing: true },
    });
  });
  it("đối chứng: bài không tích ⇒ không ghi gì; lead khác SĐT (count 0) ⇒ KHONG_DOI", async () => {
    M.discFindUnique.mockResolvedValueOnce({ consentMarketing: false, leadId: "lead-1" });
    expect(await xacNhanTiepThiSauNhan({ submissionId: "sub1", sdtChuan: "84905000111" })).toBe("KHONG_DOI");
    expect(M.leadUpdateMany).not.toHaveBeenCalled();
    M.discFindUnique.mockResolvedValueOnce({ consentMarketing: true, leadId: "lead-1" });
    M.leadUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await xacNhanTiepThiSauNhan({ submissionId: "sub1", sdtChuan: "84905000111" })).toBe("KHONG_DOI");
  });
});

describe("[DISC-CRM-07b] lưới đọc mã: đường DISC không có LỜI GỌI CAPI/GA4 và không import lib/tracking", () => {
  const tep = [
    ...lietKeTep("lib/disc", /\.(ts|tsx)$/),
    ...lietKeTep("app/api/disc", /\.(ts|tsx)$/),
    ...lietKeTep("app/(public)/disc", /\.(ts|tsx)$/),
    ...lietKeTep("app/(auth)/kich-hoat", /^nhan-disc.*\.(ts|tsx)$/),
  ].filter((p) => !/\.test\.(ts|tsx)$/.test(p));

  it("quét được các tệp lõi (lưới không rỗng)", () => {
    const ten = tep.map(tuongDoi);
    for (const t of ["lib/disc/crm.ts", "lib/disc/crm-that.ts", "lib/disc/nhan.ts"]) expect(ten).toContain(t);
  });

  // Neo vào LỜI GỌI / lệnh import thật (đã bỏ chú thích) — không neo vào dòng import chung chung (luật 14).
  const LOI_GOI = /\b(?:sendMetaCapi|sendGa4Event)\s*\(/;
  const NHAP_TRACKING = /from\s*["'](?:@\/lib\/tracking|\.\.?\/(?:\.\.\/)*lib\/tracking)["']/;
  it("không tệp sản phẩm nào gọi sendMetaCapi/sendGa4Event hay import lib/tracking", () => {
    const vp: string[] = [];
    for (const p of tep) {
      const ma = boChuThich(docTep(p));
      if (LOI_GOI.test(ma)) vp.push(`${tuongDoi(p)}: có lời gọi gửi sự kiện đo lường`);
      if (NHAP_TRACKING.test(ma)) vp.push(`${tuongDoi(p)}: import lib/tracking`);
    }
    expect(vp).toEqual([]);
  });

  it("[tự kiểm] bộ so khớp bắt được mẫu xấu và bỏ qua chú thích", () => {
    expect(LOI_GOI.test(boChuThich("await sendMetaCapi({ x })"))).toBe(true);
    expect(LOI_GOI.test(boChuThich("await sendGa4Event (x)"))).toBe(true);
    expect(NHAP_TRACKING.test(boChuThich('import { a } from "@/lib/tracking";'))).toBe(true);
    expect(LOI_GOI.test(boChuThich("// sendMetaCapi(x) — cấm gọi ở đây"))).toBe(false);
    expect(NHAP_TRACKING.test(boChuThich('/* from "@/lib/tracking" */'))).toBe(false);
  });
});
