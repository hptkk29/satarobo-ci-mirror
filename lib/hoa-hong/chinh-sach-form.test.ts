// @vitest-environment node
// [NHH-FE-FORM-*] · [NHH-FE-04*] — MÔ HÌNH FORM của builder chính sách (thuần): kiểm theo bước, dựng payload, đảo ngược,
// map lỗi máy chủ về ô. Đây là chỗ quyết định "tiền nào được lưu" nên phải có ca cho từng đường, không chỉ cho đường vui.
import { describe, expect, it } from "vitest";
import {
  anhXaLoiMayChu,
  buocCuaTruong,
  dungPayload,
  formRong,
  formTuPhienBan,
  kiemForm,
  loiLuuNhap,
  loiTepVanBan,
  loiTheoBuoc,
  formChinhSachSchema,
  type FormChinhSach,
} from "./chinh-sach-form";

const formDu = (p: Partial<FormChinhSach> = {}): FormChinhSach => ({
  ...formRong(),
  policyCode: "SR.QD.300/HV_MOI",
  name: "Hoa hồng học viên mới",
  description: "",
  phamVi: { loai: "GLOBAL" },
  loaiGd: ["NEW"],
  vai: ["SALE", "CENTER_MANAGER"],
  o: {
    "NEW|SALE": { kieu: "PERCENT", phanTram: "4" },
    "NEW|CENTER_MANAGER": { kieu: "PERCENT", phanTram: "2" },
  },
  vanBan: { kieu: "co-san", id: "vb_1" },
  hieuLucTu: "2026-11-01",
  hieuLucDen: "",
  lyDo: "Theo SR.QD.300",
  ...p,
});

const truongLoi = (ls: { truong: string }[]) => ls.map((l) => l.truong).sort();

describe("[NHH-FE-FORM-01] dungPayload — form đủ ⇒ payload service ăn được", () => {
  it("tỉ lệ lưu dạng 0.04 (không phải 4), 00:00 giờ VN, rule theo thứ tự loại × vai", () => {
    const r = dungPayload(formDu());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.payload;
    expect(p.rules.map((x) => [x.transactionTypeCode, x.roleCode, x.calcKind, x.rate])).toEqual([
      ["NEW", "SALE", "PERCENT", "0.04"],
      ["NEW", "CENTER_MANAGER", "PERCENT", "0.02"],
    ]);
    expect(p.effectiveFrom.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(p.effectiveTo).toBeNull();
    expect(p.ownerOrgUnitId).toBeNull();
    expect(p.phamVi).toEqual({ loai: "GLOBAL" });
    expect(p.description).toBeNull();
    expect(p.vanBan).toEqual({ kieu: "co-san", id: "vb_1" });
  });

  it("ô trống = KHÔNG có rule (không sinh 0%); ô EXCLUDE = rule loại trừ không giá trị", () => {
    const r = dungPayload(
      formDu({
        loaiGd: ["NEW", "RENEWAL"],
        vai: ["SALE"],
        o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" }, "RENEWAL|SALE": { kieu: "EXCLUDE", phanTram: "" } },
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.loi));
    expect(r.payload.rules.map((x) => [x.transactionTypeCode, x.calcKind, x.rate])).toEqual([
      ["NEW", "PERCENT", "0.04"],
      ["RENEWAL", "EXCLUDE", null],
    ]);
    const trong = dungPayload(formDu({ loaiGd: ["NEW", "RENEWAL"], vai: ["SALE"], o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" }, "RENEWAL|SALE": { kieu: "PERCENT", phanTram: "" } } }));
    if (!trong.ok) throw new Error(JSON.stringify(trong.loi));
    expect(trong.payload.rules).toHaveLength(1);
  });

  it("ô của vai/loại KHÔNG còn được chọn bị bỏ (không rò rule ma)", () => {
    const r = dungPayload(
      formDu({
        vai: ["SALE"],
        o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" }, "NEW|MARKETING": { kieu: "PERCENT", phanTram: "9" }, "RENEWAL|SALE": { kieu: "PERCENT", phanTram: "9" } },
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.loi));
    expect(r.payload.rules.map((x) => x.roleCode + x.transactionTypeCode)).toEqual(["SALENEW"]);
  });

  it("'đến hết ngày' là NGÀY CUỐI gồm cả: effectiveTo = 00:00 VN của ngày kế tiếp (biên mở)", () => {
    const r = dungPayload(formDu({ hieuLucDen: "2026-12-31" }));
    if (!r.ok) throw new Error(JSON.stringify(r.loi));
    expect(r.payload.effectiveTo?.toISOString()).toBe("2026-12-31T17:00:00.000Z");
  });

  it("phạm vi nhóm nguồn / cơ sở sang PhamViInput; chủ sở hữu cơ sở sang ownerOrgUnitId", () => {
    const a = dungPayload(formDu({ phamVi: { loai: "SOURCE_GROUP", sourceGroupId: "g1" } }));
    const b = dungPayload(formDu({ phamVi: { loai: "ORG_UNIT", orgUnitId: "ou1" }, chuSoHuuOrgUnitId: "ou1" }));
    if (!a.ok || !b.ok) throw new Error("payload lẽ ra hợp lệ");
    expect(a.payload.phamVi).toEqual({ loai: "SOURCE_GROUP", sourceGroupId: "g1" });
    expect(b.payload.phamVi).toEqual({ loai: "ORG_UNIT", orgUnitId: "ou1" });
    expect(b.payload.ownerOrgUnitId).toBe("ou1");
  });

  it("văn bản mới: giữ tệp (key/tên/url) cho tầng ghi", () => {
    const r = dungPayload(
      formDu({
        vanBan: {
          kieu: "moi",
          documentCode: "SR.QD.300",
          title: "Quy định hoa hồng",
          issuedOn: "2026-10-01",
          publishedOn: "2026-10-05",
          effectiveOn: "2026-11-01",
          approvedByName: "Hồ Đắc Phúc",
          tep: { key: "documents/a.pdf", ten: "a.pdf", url: "https://x.test/a.pdf" },
        },
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.loi));
    expect(r.payload.vanBan).toMatchObject({ kieu: "moi", documentCode: "SR.QD.300", fileKey: "documents/a.pdf", fileName: "a.pdf", fileUrl: "https://x.test/a.pdf" });
  });
});

describe("[NHH-FE-04] kiemForm — lỗi CẠNH Ô, theo bước", () => {
  it("[NHH-FE-04a] form đủ ⇒ không lỗi; form rỗng ⇒ lỗi ở bước 1, 2, 5 (bước 3 chỉ lỗi khi đã chọn vai)", () => {
    expect(kiemForm(formDu())).toEqual([]);
    const l = kiemForm(formRong());
    expect(truongLoi(l)).toEqual(expect.arrayContaining(["policyCode", "name", "loaiGd", "vai", "hieuLucTu", "lyDo"]));
  });

  it("[NHH-FE-04b] bước 1: mã sai ký tự, tên trống, phạm vi nhóm nguồn thiếu id, chủ sở hữu cơ sở nhưng phạm vi ORG_UNIT khác cơ sở", () => {
    const l = kiemForm(formDu({ policyCode: "sai mã!", name: " ", phamVi: { loai: "SOURCE_GROUP", sourceGroupId: "" } }));
    expect(truongLoi(l.filter((x) => x.buoc === "boi-canh"))).toEqual(["name", "phamVi.sourceGroupId", "policyCode"]);
  });

  // Cấy 08/10 (rà soát độc lập): `{1,79}` → `{0,79}` XANH — mọi mã trong fixture đều dài. Biên: mã 1 ký tự bị từ chối (tối thiểu 2), 2 ký tự qua;
  // 80 ký tự qua, 81 bị từ chối (trần khớp `z.string().max(80)` của kiểu dây).
  it("[NHH-FE-04b2] mã chính sách: biên độ dài 2…80 ký tự", () => {
    const loiMa = (m: string) => truongLoi(kiemForm(formDu({ policyCode: m }))).includes("policyCode");
    expect(loiMa("A")).toBe(true);
    expect(loiMa("AB")).toBe(false);
    expect(loiMa("A".repeat(80))).toBe(false);
    expect(loiMa("A".repeat(81))).toBe(true);
  });

  it("[NHH-FE-04c] bước 3: tỉ lệ rác báo ĐÚNG ô; vai được chọn mà không có ô nào ⇒ báo ở ô đầu tiên của vai", () => {
    const l = kiemForm(formDu({ o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "3,12345" }, "NEW|CENTER_MANAGER": { kieu: "PERCENT", phanTram: "" } } }));
    const b3 = l.filter((x) => x.buoc === "cach-tinh");
    expect(truongLoi(b3)).toEqual(["o.NEW|CENTER_MANAGER", "o.NEW|SALE"]);
    expect(b3.find((x) => x.truong === "o.NEW|SALE")?.thongBao).toMatch(/4 chữ số thập phân/);
    expect(b3.find((x) => x.truong === "o.NEW|CENTER_MANAGER")?.thongBao).toMatch(/Quản lý cơ sở|chưa có tỉ lệ/);
  });

  it("[NHH-FE-04d] bước 4: văn bản mới thiếu trường ⇒ lỗi từng trường; ngày không có thật bị bắt; 'chưa có văn bản' KHÔNG phải lỗi của form", () => {
    const rong = kiemForm(formDu({ vanBan: { kieu: "moi", documentCode: "", title: "", issuedOn: "2026-02-30", publishedOn: "", effectiveOn: "2026-11-01", approvedByName: "", tep: null } }));
    expect(truongLoi(rong.filter((x) => x.buoc === "van-ban"))).toEqual([
      "vanBan.approvedByName",
      "vanBan.documentCode",
      "vanBan.issuedOn",
      "vanBan.publishedOn",
      "vanBan.title",
    ]);
    expect(kiemForm(formDu({ vanBan: { kieu: "chua" } }))).toEqual([]);
    expect(truongLoi(kiemForm(formDu({ vanBan: { kieu: "co-san", id: "" } })))).toEqual(["vanBan.id"]);
  });

  it("[NHH-FE-04e] bước 5: đến-hết-ngày phải SAU từ-ngày; ngày rác; lý do trống", () => {
    const l = kiemForm(formDu({ hieuLucTu: "2026-11-01", hieuLucDen: "2026-10-31", lyDo: "  " }));
    expect(truongLoi(l)).toEqual(["hieuLucDen", "lyDo"]);
    // cùng ngày = áp dụng đúng một ngày: hợp lệ
    expect(kiemForm(formDu({ hieuLucTu: "2026-11-01", hieuLucDen: "2026-11-01" }))).toEqual([]);
    expect(truongLoi(kiemForm(formDu({ hieuLucTu: "01/11/2026" })))).toEqual(["hieuLucTu"]);
  });

  it("[NHH-FE-04f] loiTheoBuoc chỉ trả lỗi CỦA BƯỚC ấy — 'Tiếp' không bị chặn bởi lỗi bước sau", () => {
    const f = formDu({ hieuLucTu: "", lyDo: "" });
    expect(loiTheoBuoc(f, "boi-canh")).toEqual([]);
    expect(loiTheoBuoc(f, "cach-tinh")).toEqual([]);
    expect(truongLoi(loiTheoBuoc(f, "hieu-luc"))).toEqual(["hieuLucTu", "lyDo"]);
    expect(loiTheoBuoc(f, "thu-tinh")).toEqual([]);
  });

  it("[NHH-FE-04g] mọi trường lỗi đều thuộc một bước (không có lỗi mồ côi không chỗ để focus)", () => {
    const f = formDu({ policyCode: "", name: "", vai: [], loaiGd: [], hieuLucTu: "", lyDo: "", vanBan: { kieu: "moi", documentCode: "", title: "", issuedOn: "", publishedOn: "", effectiveOn: "", approvedByName: "", tep: null } });
    for (const l of kiemForm(f)) expect(buocCuaTruong(l.truong), l.truong).toBe(l.buoc);
  });

  it("[NHH-FE-04h] loiLuuNhap: Lưu nháp cần ĐÚNG phần service đòi (mã, tên, phạm vi, ngày, lý do) — KHÔNG đòi văn bản hay tỉ lệ", () => {
    const f = formDu({ vai: [], o: {}, vanBan: { kieu: "chua" } });
    expect(loiLuuNhap(f)).toEqual([]);
    expect(truongLoi(loiLuuNhap(formDu({ name: "", lyDo: "" })))).toEqual(["lyDo", "name"]);
    // đã chọn gõ dở một ô tỉ lệ rác thì KHÔNG lưu được: lưu im lặng rác là đổi tiền sau lưng người gõ
    expect(truongLoi(loiLuuNhap(formDu({ o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "abc" } } })))).toEqual(["o.NEW|SALE"]);
  });
});

describe("[NHH-FE-FORM-02] formTuPhienBan — đảo ngược payload (sửa nháp / tạo version mới)", () => {
  const phienBan = {
    policyCode: "SR.QD.300/HV_MOI",
    name: "Hoa hồng học viên mới",
    description: "ghi chú",
    ownerOrgUnitId: null,
    effectiveFrom: new Date("2026-10-31T17:00:00.000Z"),
    effectiveTo: new Date("2026-12-31T17:00:00.000Z"),
    reason: "Theo SR.QD.300",
    documentId: "vb_1",
    scope: { scopeType: "GLOBAL" as const, scopeSourceGroupId: null, scopeOrgUnitId: null },
    rules: [
      { transactionTypeCode: "NEW", roleCode: "SALE", calcKind: "PERCENT" as const, rate: "0.040000" },
      { transactionTypeCode: "NEW", roleCode: "CENTER_MANAGER", calcKind: "PERCENT" as const, rate: "0.020000" },
      { transactionTypeCode: "RENEWAL", roleCode: "SALE", calcKind: "EXCLUDE" as const, rate: null },
    ],
  };

  it("rate 0.040000 ⇒ ô '4'; EXCLUDE giữ nguyên; effectiveTo trừ một ngày về 'đến hết ngày'", () => {
    const r = formTuPhienBan(phienBan);
    expect(r.khongBieuDienDuoc).toEqual([]);
    expect(r.form.o["NEW|SALE"]).toEqual({ kieu: "PERCENT", phanTram: "4" });
    expect(r.form.o["RENEWAL|SALE"].kieu).toBe("EXCLUDE");
    expect(r.form.hieuLucTu).toBe("2026-11-01");
    expect(r.form.hieuLucDen).toBe("2026-12-31");
    expect(r.form.loaiGd).toEqual(["NEW", "RENEWAL"]);
    expect(r.form.vai).toEqual(["SALE", "CENTER_MANAGER"]);
    expect(r.form.vanBan).toEqual({ kieu: "co-san", id: "vb_1" });
  });

  it("khứ hồi: form → payload → form → payload cho cùng payload", () => {
    const a = formTuPhienBan(phienBan).form;
    const p1 = dungPayload(a);
    if (!p1.ok) throw new Error(JSON.stringify(p1.loi));
    const p2 = dungPayload(formTuPhienBan(phienBan).form);
    if (!p2.ok) throw new Error("x");
    expect(p2.payload).toEqual(p1.payload);
  });

  it("rule kiểu thưởng bậc / số tiền cố định, phạm vi PERSON/ROLE: KHÔNG biểu diễn được ⇒ nêu rõ, không lặng lẽ bỏ", () => {
    const r = formTuPhienBan({
      ...phienBan,
      scope: { scopeType: "PERSON" as never, scopeSourceGroupId: null, scopeOrgUnitId: null },
      rules: [...phienBan.rules, { transactionTypeCode: "NEW", roleCode: "MARKETING", calcKind: "TIER_PERIOD_BONUS" as const, rate: null }],
    });
    expect(r.khongBieuDienDuoc.length).toBe(2);
    expect(r.khongBieuDienDuoc.join(" ")).toMatch(/PERSON/);
    expect(r.khongBieuDienDuoc.join(" ")).toMatch(/TIER_PERIOD_BONUS|thưởng/);
  });

  // Cấy 08/10 (rà soát độc lập): bỏ vế `revenueComponent !== "TUITION"` XANH — mọi rule của fixture đều không khai thành phần (mặc định TUITION),
  // nên không ca nào có rule HỌC CỤ/VẬT TƯ. Bản không có vế này hiện rule MATERIAL như một ô phần trăm của học phí rồi LƯU LẠI thành TUITION.
  it("rule thành phần khác học phí (MATERIAL…): KHÔNG biểu diễn được ⇒ nêu rõ và KHÔNG chui vào ô phần trăm của học phí", () => {
    const r = formTuPhienBan({
      ...phienBan,
      rules: [...phienBan.rules, { transactionTypeCode: "NEW", roleCode: "MARKETING", calcKind: "PERCENT" as const, rate: "0.010000", revenueComponent: "MATERIAL" }],
    });
    expect(r.khongBieuDienDuoc).toHaveLength(1);
    expect(r.khongBieuDienDuoc[0]).toMatch(/MARKETING/);
    expect(r.khongBieuDienDuoc[0]).toMatch(/MATERIAL/);
    expect(r.form.o["NEW|MARKETING"]).toBeUndefined();
    expect(r.form.vai).not.toContain("MARKETING");
    // đối chứng dương: khai TUITION tường minh thì biểu diễn được
    const tuition = formTuPhienBan({ ...phienBan, rules: [{ transactionTypeCode: "NEW", roleCode: "SALE", calcKind: "PERCENT" as const, rate: "0.010000", revenueComponent: "TUITION" }] });
    expect(tuition.khongBieuDienDuoc).toEqual([]);
    expect(tuition.form.o["NEW|SALE"]).toEqual({ kieu: "PERCENT", phanTram: "1" });
  });
});

describe("[NHH-FE-04i] anhXaLoiMayChu — lỗi máy chủ về đúng ô, không về 'có lỗi xảy ra'", () => {
  it("lỗi kiemRuleDauVao 'Rule #2 (SALE · NEW): …' ⇒ ô o.NEW|SALE", () => {
    const r = anhXaLoiMayChu({
      kieu: "hoa-hong",
      ma: "DU_LIEU_KHONG_HOP_LE",
      message: "Rule #1 (SALE · NEW): tỉ lệ phải trong (0, 1].",
      chiTiet: ["Rule #1 (SALE · NEW): tỉ lệ phải trong (0, 1].", "Rule #2 (MARKETING · RENEWAL): kiểu PERCENT cần tỉ lệ."],
    });
    expect(r.chung).toBeNull();
    expect(r.loi.map((l) => l.truong)).toEqual(["o.NEW|SALE", "o.RENEWAL|MARKETING"]);
    expect(r.loi[0]?.thongBao).toBe("tỉ lệ phải trong (0, 1].");
  });

  it("các lỗi nghiệp vụ biết trước ⇒ đúng ô", () => {
    const m = (message: string, ma = "DU_LIEU_KHONG_HOP_LE") => anhXaLoiMayChu({ kieu: "hoa-hong", ma, message });
    expect(m("Phải có lý do / căn cứ cho version.").loi[0]?.truong).toBe("lyDo");
    expect(m("Hiệu lực kết thúc phải sau hiệu lực bắt đầu.").loi[0]?.truong).toBe("hieuLucDen");
    expect(m("Chính sách cần mã và tên.").loi[0]?.truong).toBe("policyCode");
    expect(m("Văn bản abc không tồn tại.", "VAN_BAN_KHONG_TON_TAI").loi[0]?.truong).toBe("vanBan.id");
    expect(m("Đơn vị x không hợp lệ", "DON_VI_KHONG_HOP_LE").loi[0]?.truong).toBe("chuSoHuu");
    expect(m("Nhóm nguồn g1 không tồn tại.").loi[0]?.truong).toBe("phamVi.sourceGroupId");
    expect(m("Đơn vị ou1 không tồn tại.").loi[0]?.truong).toBe("phamVi.orgUnitId");
  });

  it("trùng khoá duy nhất ⇒ ô mã tương ứng; lỗi lạ ⇒ chung (không bịa ô)", () => {
    expect(anhXaLoiMayChu({ kieu: "trung-khoa", cot: ["policyCode"] }).loi[0]).toMatchObject({ truong: "policyCode" });
    expect(anhXaLoiMayChu({ kieu: "trung-khoa", cot: ["documentCode"] }).loi[0]).toMatchObject({ truong: "vanBan.documentCode" });
    const la = anhXaLoiMayChu({ kieu: "hoa-hong", ma: "VERSION_DA_KHOA", message: "Version đã sinh dòng sổ hoa hồng — chỉ tạo version mới, không sửa." });
    expect(la.loi).toEqual([]);
    expect(la.chung).toMatch(/Version đã sinh dòng sổ/);
  });

  it("mọi ô mà map trả về đều thuộc một bước (focus được)", () => {
    const r = anhXaLoiMayChu({ kieu: "hoa-hong", ma: "DU_LIEU_KHONG_HOP_LE", message: "x", chiTiet: ["Rule #1 (SALE · NEW): lỗi."] });
    for (const l of r.loi) expect(buocCuaTruong(l.truong)).toBe(l.buoc);
  });
});

describe("[NHH-FE-FORM-03] formChinhSachSchema — hình dạng dây (zod là nguồn kiểu)", () => {
  it("form hợp lệ qua; thiếu trường / kiểu lạ bị từ chối ở biên máy chủ", () => {
    expect(formChinhSachSchema.safeParse(formDu()).success).toBe(true);
    expect(formChinhSachSchema.safeParse({ ...formDu(), o: { "NEW|SALE": { kieu: "FIXED", phanTram: "1" } } }).success).toBe(false);
    expect(formChinhSachSchema.safeParse({ ...formDu(), phamVi: { loai: "PERSON", userId: "u" } }).success).toBe(false);
    expect(formChinhSachSchema.safeParse({ ...formDu(), loaiGd: ["UPSELL"] }).success).toBe(false);
    expect(formChinhSachSchema.safeParse(null).success).toBe(false);
  });
});

describe("[NHH-FE-FORM-04] loiTepVanBan — tệp đính kèm do client khai, máy chủ chỉ tin tệp NẰM TRONG kho công khai của mình", () => {
  const GOC = "https://cdn.satarobo.test";
  const KEY = "uploads/documents/2026-10/quy-dinh-ab12cd34.pdf";
  const tep = (p: Partial<{ key: string; url: string }> = {}) => ({ key: KEY, url: `${GOC}/${KEY}`, ...p });

  it("đúng đường upload: key dưới uploads/documents hoặc uploads/images, url = gốc công khai + key ⇒ qua", () => {
    expect(loiTepVanBan(tep(), GOC)).toBeNull();
    const anh = "uploads/images/2026-10/chup-van-ban-ab12cd34.png";
    expect(loiTepVanBan({ key: anh, url: `${GOC}/${anh}` }, GOC)).toBeNull();
    // gốc công khai có thể mang cả đường dẫn con
    expect(loiTepVanBan({ key: KEY, url: `${GOC}/kho/${KEY}` }, `${GOC}/kho`)).toBeNull();
  });

  it("url không phải https vào kho của mình ⇒ từ chối (javascript:, http:, host lạ, key khác url)", () => {
    expect(loiTepVanBan(tep({ url: "javascript:alert(1)" }), GOC)).not.toBeNull();
    expect(loiTepVanBan(tep({ url: `http://cdn.satarobo.test/${KEY}` }), GOC)).not.toBeNull();
    expect(loiTepVanBan(tep({ url: `https://evil.example/${KEY}` }), GOC)).not.toBeNull();
    expect(loiTepVanBan(tep({ url: `${GOC}/uploads/documents/2026-10/khac.pdf` }), GOC)).not.toBeNull();
    // gốc là TIỀN TỐ chứ không phải "bắt đầu bằng chuỗi": cdn.satarobo.test.evil.example không được qua
    expect(loiTepVanBan(tep({ url: `https://cdn.satarobo.test.evil.example/${KEY}` }), GOC)).not.toBeNull();
  });

  it("key lạ ⇒ từ chối (thư mục khác, đi ngược ..., rỗng, ký tự lạ)", () => {
    for (const key of ["uploads/videos/2026-10/x.mp4", "documents/fx.pdf", "uploads/documents/../../etc/x.pdf", "", "uploads/documents/ x y.pdf", "/uploads/documents/x.pdf"]) {
      expect(loiTepVanBan({ key, url: `${GOC}/${key}` }, GOC), key).not.toBeNull();
    }
  });

  it("chưa cấu hình kho công khai (gốc = null): vẫn chặn url không phải https và key lạ; https có đúng đuôi key thì qua", () => {
    expect(loiTepVanBan(tep({ url: "javascript:alert(1)" }), null)).not.toBeNull();
    expect(loiTepVanBan(tep({ url: `http://x.test/${KEY}` }), null)).not.toBeNull();
    expect(loiTepVanBan(tep({ url: "https://x.test/khac.pdf" }), null)).not.toBeNull();
    expect(loiTepVanBan(tep({ url: `https://x.test/${KEY}` }), null)).toBeNull();
  });
});
