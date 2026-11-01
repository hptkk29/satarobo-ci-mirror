// @vitest-environment node
// [AIK-CH] Phần THUẦN của cấu hình AI Lead: dựng payload catalog đúng hợp đồng, etag có version, diff, schema đầu vào.
import { describe, expect, it } from "vitest";
import { catalogResponseSchema } from "../schemas";
import {
  LoiCatalog,
  doiChinhSachSchema,
  dungPayloadCatalog,
  jsonChuanTac,
  kiemToanVenSnapshot,
  moTaThayDoi,
  pageIdSchema,
  soSanhCatalog,
  taoAgentSchema,
  taoLaiKhoaSchema,
  tinhEtag,
  type HangXuatBan,
} from "./cau-hinh-thuan";

const coSo = (code: string | null, o: Partial<HangXuatBan["campus"]> = {}): HangXuatBan["campus"] => ({
  id: `c-${code}`,
  code,
  name: `Cơ sở ${code}`,
  address: `Địa chỉ ${code}`,
  isActive: true,
  ...o,
});
const hang = (pageId: string, code: string | null, o: Partial<Omit<HangXuatBan, "campus">> & { campus?: Partial<HangXuatBan["campus"]> } = {}): HangXuatBan => {
  const { campus, ...rest } = o;
  return { pageId, displayOrder: 0, acceptingLeads: true, publicVisible: true, campus: coSo(code, campus), ...rest };
};

const P1 = "104500000000777";
const P2 = "104500000000888";

describe("[CHT-CS] mã cơ sở là SLUG ở mọi schema hành động (lỗi CRITICAL do review độc lập 28/10: regex cuid từ chối cơ sở thật)", () => {
  const AG = "cm0agentaaaaaaaaaaaaaaaa1";
  const PG = "104500000000777";
  const LY = "Lý do đủ dài để ghi nhật ký";
  it("routing · thêm Page · xuất bản · gỡ xuất bản nhận slug thật của PROD; ký tự lạ bị từ chối", async () => {
    const { routingSchema, themPageSchema, luuXuatBanSchema, goXuatBanSchema } = await import("./cau-hinh-thuan");
    for (const cs of ["co-so-hoang-dieu", "co-so-nguyen-huu-tho", "cm0coso1aaaaaaaaaaaaaaaaa"]) {
      expect(routingSchema.safeParse({ agentId: AG, pageId: PG, routingCenterId: cs }).success, cs).toBe(true);
      expect(themPageSchema.safeParse({ agentId: AG, pageId: PG, routingCenterId: cs }).success, cs).toBe(true);
      expect(luuXuatBanSchema.safeParse({ pageId: PG, campusCenterId: cs, acceptingLeads: true, publicVisible: true, displayOrder: 1 }).success, cs).toBe(true);
      expect(goXuatBanSchema.safeParse({ pageId: PG, campusCenterId: cs }).success, cs).toBe(true);
    }
    for (const xau of ["", "co so", "../x", "a;b", "x".repeat(65)]) {
      expect(routingSchema.safeParse({ agentId: AG, pageId: PG, routingCenterId: xau }).success, JSON.stringify(xau)).toBe(false);
      expect(goXuatBanSchema.safeParse({ pageId: PG, campusCenterId: xau }).success, JSON.stringify(xau)).toBe(false);
    }
    expect(routingSchema.safeParse({ agentId: AG, pageId: PG, routingCenterId: null }).success).toBe(true);
    void LY;
  });
});

describe("[AIK-CH] payload catalog", () => {
  it("[AIK-CH-01] đúng hợp đồng (catalogResponseSchema), sắp xếp tất định theo pageId rồi displayOrder", () => {
    const p = dungPayloadCatalog([P2, P1], [hang(P1, "CS2", { displayOrder: 2 }), hang(P1, "CS1", { displayOrder: 1 }), hang(P2, "CS1")]);
    expect(p.pages.map((x) => x.pageId)).toEqual([P1, P2]);
    expect(p.pages[0]!.campuses.map((c) => c.campusCode)).toEqual(["CS1", "CS2"]);
    const dongGoi = { ok: true, data: { catalogVersion: 1, publishedAt: "2026-11-07T00:00:00Z", maxAgeSeconds: 300, etag: tinhEtag(1, p), pages: p.pages }, meta: { requestId: "req_abcdefghijkl", serverTime: 1 } };
    expect(catalogResponseSchema.safeParse(dongGoi).success).toBe(true);
  });

  it("[AIK-CH-02] CHỈ publicVisible vào catalog; Page không có cơ sở hiện công khai vẫn có mặt với campuses rỗng", () => {
    const p = dungPayloadCatalog([P1, P2], [hang(P1, "CS1", { publicVisible: false }), hang(P1, "CS2")]);
    expect(p.pages.find((x) => x.pageId === P1)!.campuses.map((c) => c.campusCode)).toEqual(["CS2"]);
    expect(p.pages.find((x) => x.pageId === P2)!.campuses).toEqual([]);
  });

  it("[AIK-CH-03] acceptingLeads=false vẫn xuất bản (Agent biết cơ sở nhưng không mời khách chọn)", () => {
    const p = dungPayloadCatalog([P1], [hang(P1, "CS1", { acceptingLeads: false })]);
    expect(p.pages[0]!.campuses[0]!.acceptingLeads).toBe(false);
  });

  it("[AIK-CH-04] cơ sở ngừng hoạt động ⇒ từ chối cả bản xuất bản, nêu tên cơ sở", () => {
    expect(() => dungPayloadCatalog([P1], [hang(P1, "CS1", { campus: { isActive: false } })])).toThrow(LoiCatalog);
    expect(() => dungPayloadCatalog([P1], [hang(P1, "CS1", { campus: { isActive: false, name: "Cơ sở Cũ" } })])).toThrow(/Cơ sở Cũ/);
  });

  it("[AIK-CH-05] mã cơ sở thiếu/sai định dạng ⇒ từ chối", () => {
    expect(() => dungPayloadCatalog([P1], [hang(P1, null)])).toThrow(/mã hợp lệ/);
    expect(() => dungPayloadCatalog([P1], [hang(P1, "cs 1")])).toThrow(/mã hợp lệ/);
    expect(() => dungPayloadCatalog([P1], [hang(P1, "A")])).toThrow(/mã hợp lệ/);
  });

  it("[AIK-CH-06] tên rỗng / địa chỉ quá 400 ký tự ⇒ từ chối (không tạo snapshot trái hợp đồng)", () => {
    expect(() => dungPayloadCatalog([P1], [hang(P1, "CS1", { campus: { name: "   " } })])).toThrow(LoiCatalog);
    expect(() => dungPayloadCatalog([P1], [hang(P1, "CS1", { campus: { address: "a".repeat(401) } })])).toThrow(LoiCatalog);
    expect(() => dungPayloadCatalog([P1], [hang(P1, "CS1", { campus: { name: "n".repeat(201) } })])).toThrow(LoiCatalog);
  });

  it("[AIK-CH-07] cùng đầu vào ⇒ cùng bytes (thứ tự hàng vào không ảnh hưởng)", () => {
    const a = dungPayloadCatalog([P1], [hang(P1, "CS1", { displayOrder: 1 }), hang(P1, "CS2", { displayOrder: 2 })]);
    const b = dungPayloadCatalog([P1], [hang(P1, "CS2", { displayOrder: 2 }), hang(P1, "CS1", { displayOrder: 1 })]);
    expect(jsonChuanTac(a)).toBe(jsonChuanTac(b));
  });
});

describe("[AIK-ETAG] etag", () => {
  const p = dungPayloadCatalog([P1], [hang(P1, "CS1")]);
  it("[AIK-ETAG-01] BAO GỒM version: cùng nội dung, version khác ⇒ etag khác (rollback không tái tạo etag cũ)", () => {
    expect(tinhEtag(3, p)).not.toBe(tinhEtag(1, p));
    expect(tinhEtag(3, p)).toBe(tinhEtag(3, p));
  });
  it("[AIK-ETAG-02] nội dung khác ⇒ etag khác; độ dài ≤ 128", () => {
    const q = dungPayloadCatalog([P1], [hang(P1, "CS1", { acceptingLeads: false })]);
    expect(tinhEtag(1, p)).not.toBe(tinhEtag(1, q));
    expect(tinhEtag(999999, p).length).toBeLessThanOrEqual(128);
  });
});

describe("[AIK-DIFF] so với snapshot hiện hành", () => {
  const cu = dungPayloadCatalog([P1], [hang(P1, "CS1"), hang(P1, "CS2")]);
  it("[AIK-DIFF-01] chưa từng xuất bản ⇒ mọi thứ là 'thêm'", () => {
    const d = soSanhCatalog(null, cu);
    expect(d.map((x) => x.loai)).toEqual(["THEM_PAGE", "THEM_CO_SO", "THEM_CO_SO"]);
  });
  it("[AIK-DIFF-02] không đổi ⇒ rỗng", () => {
    expect(soSanhCatalog(cu, cu)).toEqual([]);
  });
  it("[AIK-DIFF-03] thêm / bỏ / sửa cơ sở, thêm / bỏ Page", () => {
    const moi = dungPayloadCatalog([P1, P2], [hang(P1, "CS1", { acceptingLeads: false, campus: { name: "Tên mới" } }), hang(P1, "CS3"), hang(P2, "CS1")]);
    const d = soSanhCatalog(cu, moi);
    expect(d).toContainEqual({ loai: "SUA_CO_SO", pageId: P1, campusCode: "CS1", ten: "Tên mới", truong: ["name", "acceptingLeads"] });
    expect(d).toContainEqual(expect.objectContaining({ loai: "THEM_CO_SO", campusCode: "CS3" }));
    expect(d).toContainEqual(expect.objectContaining({ loai: "BO_CO_SO", campusCode: "CS2" }));
    expect(d).toContainEqual({ loai: "THEM_PAGE", pageId: P2 });
    const bo = soSanhCatalog(moi, cu);
    expect(bo).toContainEqual({ loai: "BO_PAGE", pageId: P2 });
    expect(d.every((x) => moTaThayDoi(x).length > 5)).toBe(true);
  });
});

describe("[AIK-SCH] schema đầu vào action", () => {
  it("[AIK-SCH-01] pageId mẫu của gói bàn giao bị chặn ở MỌI nơi dùng pageIdSchema", () => {
    expect(pageIdSchema.safeParse("104500000000001").success).toBe(false);
    expect(pageIdSchema.safeParse("999999999999999").success).toBe(false);
    expect(pageIdSchema.safeParse("104500000000777").success).toBe(true);
    expect(pageIdSchema.safeParse("ab").success).toBe(false);
  });
  it("[AIK-SCH-02] tạo lại khoá: lý do ≥ 10 ký tự (sau khi cắt), khoá lạ bị từ chối", () => {
    const ok = { agentId: "cm0abcdefghijklmnopqrstuv", secretVersionDangThay: 1, lyDo: "Nghi lộ khoá trong log" };
    expect(taoLaiKhoaSchema.safeParse(ok).success).toBe(true);
    expect(taoLaiKhoaSchema.safeParse({ ...ok, lyDo: "ngắn" }).success).toBe(false);
    expect(taoLaiKhoaSchema.safeParse({ ...ok, lyDo: "          " }).success).toBe(false);
    expect(taoLaiKhoaSchema.safeParse({ ...ok, thua: 1 }).success).toBe(false);
  });
  it("[AIK-SCH-03] tạo agent: tên 3–80, môi trường TEST|PROD", () => {
    expect(taoAgentSchema.safeParse({ name: "Agent Messenger", environment: "TEST" }).success).toBe(true);
    expect(taoAgentSchema.safeParse({ name: "ab", environment: "TEST" }).success).toBe(false);
    expect(taoAgentSchema.safeParse({ name: "Agent", environment: "STAGING" }).success).toBe(false);
  });
  it("[AIK-SCH-04] chính sách: chỉ hai khoá cổng PROD, đúng kiểu giá trị, bắt buộc lý do", () => {
    const lyDo = "Pháp lý đã duyệt ngày 10/11";
    expect(doiChinhSachSchema.safeParse({ key: "ai.prodEnabled", value: true, lyDo }).success).toBe(true);
    expect(doiChinhSachSchema.safeParse({ key: "ai.prodEnabled", value: "true", lyDo }).success).toBe(false);
    expect(doiChinhSachSchema.safeParse({ key: "ai.consentPolicyStatus", value: "APPROVED", lyDo }).success).toBe(true);
    expect(doiChinhSachSchema.safeParse({ key: "ai.consentPolicyStatus", value: "OK", lyDo }).success).toBe(false);
    expect(doiChinhSachSchema.safeParse({ key: "ai.heartbeatSeconds", value: 30, lyDo }).success).toBe(false);
    expect(doiChinhSachSchema.safeParse({ key: "ai.prodEnabled", value: true, lyDo: "x" }).success).toBe(false);
  });
});

describe("[AIK-TV] toàn vẹn catalog", () => {
  const pay = () => dungPayloadCatalog([P1], [hang(P1, "CS1"), hang(P1, "CS2", { displayOrder: 1 })]);
  it("[AIK-TV-01] hai cơ sở CÙNG mã trong một Page ⇒ từ chối cả bản xuất bản (không có cách chọn ra cơ sở nào)", () => {
    expect(() => dungPayloadCatalog([P1], [hang(P1, "CS1"), hang(P1, "CS1", { campus: { id: "c-khac" } })])).toThrow(/hai lần/);
    expect(() => dungPayloadCatalog([P1, P2], [hang(P1, "CS1"), hang(P2, "CS1")])).not.toThrow(); // cùng mã ở HAI Page khác nhau là bình thường
  });
  it("[AIK-TV-02] snapshot do bộ xuất bản sinh: etag khớp băm ⇒ toàn vẹn; sửa payload mà giữ etag ⇒ ETAG_LECH; đổi version mà giữ etag ⇒ ETAG_LECH", () => {
    const p = pay();
    const etag = tinhEtag(5, p);
    expect(kiemToanVenSnapshot({ version: 5, etag, payload: p })).toEqual({ ok: true });
    const sua = { pages: [{ ...p.pages[0]!, campuses: [{ ...p.pages[0]!.campuses[0]!, address: "Địa chỉ bị sửa tay" }, p.pages[0]!.campuses[1]!] }] };
    expect(kiemToanVenSnapshot({ version: 5, etag, payload: sua })).toEqual({ ok: false, ly: "ETAG_LECH" });
    expect(kiemToanVenSnapshot({ version: 6, etag, payload: p })).toEqual({ ok: false, ly: "ETAG_LECH" });
  });
  it("[AIK-TV-03] payload không còn đúng hợp đồng (thiếu trường · mã trùng · không phải đối tượng) ⇒ PAYLOAD_SAI_HOP_DONG, kể cả khi etag lạ", () => {
    for (const payload of [null, {}, { pages: "x" }, { pages: [{ pageId: P1, campuses: [{ campusCode: "CS1" }] }] }, { pages: [{ pageId: P1, campuses: [{ campusCode: "CS1", name: "A", address: "B", acceptingLeads: true }, { campusCode: "CS1", name: "C", address: "D", acceptingLeads: true }] }] }]) {
      expect(kiemToanVenSnapshot({ version: 1, etag: "cat-1-tuy-y", payload }), JSON.stringify(payload)).toEqual({ ok: false, ly: "PAYLOAD_SAI_HOP_DONG" });
    }
  });
  it("[AIK-TV-04] etag KHÔNG theo khuôn của bộ xuất bản (nhập tay / fixture hợp đồng) chỉ kiểm payload — không có gì để tính lại", () => {
    expect(kiemToanVenSnapshot({ version: 7, etag: "cat-7-a1b2c3", payload: pay() })).toEqual({ ok: true });
  });
});
