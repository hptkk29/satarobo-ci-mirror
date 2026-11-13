// Test cho tầng truy vấn "Khách của tôi" — phần THUẦN kiểm được không cần DB.
//
// Điều đáng khoá nhất ở đây không phải hình dạng dữ liệu mà là: mệnh đề "của
// tôi" phải đi qua CÙNG MỘT nguồn với trang admin. Nếu trang này gõ
// `assignedToId` tại chỗ thì khi ai đó bật lại chính sách chia sẻ lead bằng env
// `LEAD_SHARING_ENABLED`, trang admin đổi hành vi còn trang này thì không —
// và không có màn nào báo, chỉ có hai danh sách nói hai câu khác nhau.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import { buildMyLeadsWhere, moTaCatDanhSach, TRANG_THAI_DA_DONG } from "./sale-leads";
// S-8 — hai mệnh đề sở hữu đã dời sang `./ownership` (nguồn duy nhất cho cả
// trang quản trị, ô tìm và site Sale). Hình dạng của chúng được khoá ở
// `lib/lead/ownership.test.ts`; ở đây chỉ dùng để dựng `where` thật.
import { leadOwnershipWhere } from "./ownership";
import { injectScope } from "@/lib/db-scope";
import { buildActor } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";

const cuEnv = process.env.LEAD_SHARING_ENABLED;
afterEach(() => {
  if (cuEnv === undefined) delete process.env.LEAD_SHARING_ENABLED;
  else process.env.LEAD_SHARING_ENABLED = cuEnv;
});

describe("[site Sale] trạng thái đã đóng", () => {
  it("gồm đúng hai trạng thái kết thúc (GĐ5 gộp enum 15→10), KHÔNG gồm trạng thái đang chăm", () => {
    expect([...TRANG_THAI_DA_DONG].sort()).toEqual(["DA_DANG_KY", "DA_MAT"]);
    // NURTURING là "đang nuôi dưỡng" — vẫn là việc đang làm, lọc nhầm nó ra là
    // giấu mất nhóm khách cần chạm lại nhiều nhất.
    expect(TRANG_THAI_DA_DONG).not.toContain("NURTURING");
  });
});

describe("[site Sale] chốt chặn nguồn — truy vấn khách của tôi", () => {
  const src = () => fs.readFileSync("lib/lead/sale-leads.ts", "utf8");
  const boChuThich = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("đi qua scopedDb, KHÔNG import @/lib/db trần", () => {
    // Cách ly cơ sở của site Sale nằm ở đây; `db` trần là thủng cổng mà ESLint
    // chỉ chặn trong `app/(sale)/**`, còn file này ở `lib/`.
    const s = boChuThich(src());
    expect(s).toContain("scopedDb(actor)");
    expect(s).not.toMatch(/from\s+["']@\/lib\/db["']/);
  });

  it("mọi truy vấn lead đều kèm mệnh đề sở hữu — không có đường đọc lead người khác", () => {
    const s = boChuThich(src());
    const soLanTruyVan = (s.match(/sdb\.lead\.find/g) ?? []).length;
    const soLanSoHuu = (s.match(/leadOwnershipWhere\(/g) ?? []).length;
    expect(soLanTruyVan).toBeGreaterThan(0);
    // S-8 — không còn `-1`: định nghĩa hàm đã dời sang `lib/lead/ownership.ts`,
    // nên mọi lần khớp trong file này đều là một CHỖ DÙNG thật.
    expect(soLanSoHuu).toBeGreaterThanOrEqual(soLanTruyVan);
  });

  it("che PII ở SERVER, không để client tự che", () => {
    // Che ở UI là dữ liệu vẫn đi xuống trong payload RSC — mở DevTools là thấy.
    expect(boChuThich(src())).toContain("maskLeadPiiFields");
  });

  it("chi tiết trả null cho CẢ 'không tồn tại' lẫn 'không phải của bạn'", () => {
    // Phân biệt hai ca là biến trang thành công cụ dò xem lead nào tồn tại.
    const s = boChuThich(src());
    const i = s.indexOf("export async function getMyLeadDetail");
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(i)).toContain("if (!lead) return null;");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-4 (27/08/2026) — Sale Hội sở vào site Sale thấy danh sách TRẮNG.
//
// Gốc: site Sale hiểu "khách của tôi" HẸP HƠN khu quản trị. `/admin/leads` cho
// người chỉ có `leads:view-own` thấy `assignedToId = tôi` **HOẶC**
// `createdById = tôi`; site Sale chỉ có vế đầu. Mà phiếu do Sale Hội sở nhập thì
// TỰ CHIA về Sale cơ sở (chốt 04/08 "lead không bao giờ về Hội sở") ⇒ họ không
// bao giờ là assignee ⇒ mọi màn của site Sale rỗng trắng, không một dòng.
// ─────────────────────────────────────────────────────────────────────────────
// S-8 (27/08/2026) — cách khoá đã ĐỔI, và đổi vì cách cũ chưa đủ. Trước đây
// test này đọc chuỗi trong nguồn `/admin/leads` để so với mệnh đề của site Sale;
// nó bắt được lệch giữa ĐÚNG HAI màn ấy, nhưng không thấy màn thứ ba
// (`/admin/search`) đang chạy bản 2 vế. Nay chỉ còn MỘT định nghĩa
// (`lib/lead/ownership.ts`) và test khoá là "không màn nào tự dựng lấy" —
// xem `lib/lead/ownership.test.ts`. Ở đây chỉ giữ phần thuộc về site Sale.
describe("[S-4] 'khách của tôi' ở site Sale phải khớp khu quản trị", () => {
  it("gồm vế NGƯỜI NHẬP — thiếu nó thì Sale Hội sở không thấy phiếu nào", () => {
    delete process.env.LEAD_SHARING_ENABLED;
    expect(leadOwnershipWhere("u-ho").OR).toContainEqual({ createdById: "u-ho" });
  });

  it("dùng CHUNG hàm với khu quản trị, không tự dựng lại", () => {
    const s = fs.readFileSync("lib/lead/sale-leads.ts", "utf8");
    expect(s).toMatch(/import\s*\{[^}]*leadOwnershipWhere[^}]*\}\s*from\s*"@\/lib\/lead\/ownership"/);
    const admin = fs.readFileSync("app/(admin)/admin/leads/page.tsx", "utf8");
    expect(admin).toContain("leadOwnershipWhere(session.user.id)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-4 — chỗ dễ vá QUÁ TAY: nới vế "người nhập" mà làm thủng cách ly cơ sở.
// ─────────────────────────────────────────────────────────────────────────────
describe("[S-4] nới 'người nhập' KHÔNG được nới cách ly cơ sở", () => {
  const ORG: OrgUnitNode[] = [
    { id: "ho", code: "HO", type: "HO", parentId: null, centerId: null },
    { id: "cs1", code: "CS1", type: "CENTER", parentId: "ho", centerId: "c1" },
    { id: "cs2", code: "CS2", type: "CENTER", parentId: "ho", centerId: "c2" },
  ];
  const vai = (orgUnitId: string, code: string, action: string) => ({
    orgUnitId,
    status: "ACTIVE",
    effectiveFrom: new Date("2000-01-01"),
    effectiveTo: null,
    role: {
      code,
      isActive: true,
      permissions: [{ action, scopeType: "GLOBAL" as const }],
    },
  });
  const saleCS1 = buildActor({
    userId: "u-cs1",
    rows: [vai("cs1", "SALES_CSM", "leads:view-own")],
    orgNodes: ORG,
  });

  it("Sale CS1 vẫn KHÔNG đọc được khách CS2 — kể cả phiếu do chính mình nhập", () => {
    delete process.env.LEAD_SHARING_ENABLED;
    const where = buildMyLeadsWhere({ userId: "u-cs1" });
    const ra = injectScope("Lead", { where }, saleCS1) as { where: unknown };

    // Cách ly cơ sở là một VẾ AND NGANG HÀNG với toàn bộ mệnh đề "của tôi".
    // Hình dạng này là bằng chứng: không nhánh OR nào — kể cả `createdById` vừa
    // thêm — thoát được `centerId IN [c1]`, vì AND áp lên CẢ cụm.
    expect(ra.where).toEqual({ AND: [where, { centerId: { in: ["c1"] } }] });

    // Và `centerId` không bao giờ đứng chung một OR với vế sở hữu (nếu đứng
    // chung thì "phiếu tôi nhập" sẽ kéo theo khách của cơ sở khác).
    const ngoai = (ra.where as { AND: Record<string, unknown>[] }).AND;
    expect(ngoai).toHaveLength(2);
    expect(ngoai[1]).toEqual({ centerId: { in: ["c1"] } });
    expect(JSON.stringify(ngoai[0])).not.toContain("centerId");
  });

  it("tầm nhìn cơ sở của Sale CS1 đúng một cơ sở — không phải cả cây", () => {
    const ra = injectScope("Lead", {}, saleCS1) as { where: unknown };
    expect(ra.where).toEqual({ centerId: { in: ["c1"] } });
  });

  it("Sale Hội sở: cách ly cơ sở KHÔNG chặn, nên vế 'người nhập' là giới hạn DUY NHẤT", () => {
    // Vai neo tại HO ⇒ `isHoLevel` ⇒ scopedDb bỏ qua. Đó chính là lý do vế sở
    // hữu phải chặt: nếu ai đó thêm `leads:view-all` cho vai này thì trang danh
    // sách bỏ hẳn mệnh đề lọc và họ thấy phiếu của mọi người (đã có test riêng
    // khoá điều đó ở lib/auth/ho-sale-lead-policy.test.ts).
    const saleHO = buildActor({
      userId: "u-ho",
      rows: [vai("ho", "HO_SALE", "leads:view-own")],
      orgNodes: ORG,
    });
    expect(injectScope("Lead", { where: {} }, saleHO)).toEqual({ where: {} });
    delete process.env.LEAD_SHARING_ENABLED;
    const and = buildMyLeadsWhere({ userId: "u-ho" }).AND as Record<string, unknown>[];
    expect(and[0]).toEqual({
      OR: [{ assignedToId: "u-ho" }, { createdById: "u-ho" }],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-4 — bảng khách cắt cứng 200 dòng mà không nói gì.
//
// `PhanTrangBang` phân trang ở TẦNG HIỂN THỊ nên nó chỉ đếm được số dòng đã
// nhận: có 237 khách thì thanh dưới bảng in "/ 200 khách". Đó không phải giới
// hạn hiển thị, đó là một con số SAI.
// ─────────────────────────────────────────────────────────────────────────────
describe("[S-4] cắt 200 dòng phải nói ra, không được cắt câm", () => {
  it("chưa chạm giới hạn → không bày cảnh báo thừa", () => {
    expect(moTaCatDanhSach(37, 37)).toBeNull();
    expect(moTaCatDanhSach(0, 0)).toBeNull();
  });

  it("bị cắt → nói ĐÚNG số khách chưa hiện", () => {
    const s = moTaCatDanhSach(200, 237);
    expect(s).not.toBeNull();
    expect(s).toContain("200");
    expect(s).toContain("237");
    expect(s).toContain("37");
  });

  it("tổng nhỏ hơn số đã hiện (dữ liệu đổi giữa hai truy vấn) → im, không in số âm", () => {
    expect(moTaCatDanhSach(200, 150)).toBeNull();
  });
});

describe("[S-4] chốt chặn nguồn — truy vấn phải ĐẾM tổng, trang phải TRUYỀN xuống", () => {
  const boChuThich = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const doc = (f: string) => boChuThich(fs.readFileSync(f, "utf8"));

  it("getMyLeads đếm tổng bằng CÙNG mệnh đề `where` với truy vấn danh sách", () => {
    // Đếm bằng một `where` khác là ra một con số không liên quan tới thứ đang
    // hiện — còn tệ hơn không đếm. `where` phải là MỘT biến dùng cho cả hai.
    const s = doc("lib/lead/sale-leads.ts");
    expect(s).toContain("const where = buildMyLeadsWhere(input);");
    expect(s).toContain("sdb.lead.count({ where })");
    expect(s).toContain("moTaCatDanhSach(rows.length, tong)");
  });

  // ⚠️ 22/09/2026 — site Sale GỠ, hai ca "trang truyền cảnh báo xuống bảng" và
  // "bảng hiển thị cảnh báo đó" mất chỗ bám (`khach-cua-toi/page.tsx` +
  // `lead-table.tsx`). Bất biến TẦNG TRUY VẤN ngay trên vẫn khoá phần quan trọng:
  // `getMyLeads` phải ĐẾM tổng và trả cờ cắt. Phần hiển thị cảnh báo chưa có màn
  // nào trong admin nhận lại — ghi ra đây để không tưởng là đã phủ.

});
