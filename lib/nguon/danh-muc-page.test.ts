// @vitest-environment node
/** [DMP] Danh mục Page — phần THUẦN (kiểm đầu vào + cảnh báo). Phần DB: tests/lead-intake/danh-muc-page.spec.ts. */
import { describe, expect, it } from "vitest";
import { canhBaoDoiPage, kiemNhapPage, type NhapPageDanhMuc } from "./danh-muc-page";

const OK: NhapPageDanhMuc = { pageId: "106792644490999", pageName: "Page thử", phamVi: "HO", centerId: null, isActive: true, lyDo: "Thêm Page canary AI Lead" };

describe("[DMP] kiemNhapPage", () => {
  it("[DMP-01] đầu vào hợp lệ ⇒ null", () => expect(kiemNhapPage(OK)).toBeNull());
  it("[DMP-02] mã Page sai định dạng (ngắn / ký tự lạ) ⇒ lỗi trường pageId", () => {
    expect(kiemNhapPage({ ...OK, pageId: "abc" })?.truong).toBe("pageId");
    expect(kiemNhapPage({ ...OK, pageId: "có dấu cách 123" })?.truong).toBe("pageId");
  });
  it("[DMP-03] Page mẫu của gói bàn giao bị chặn (cả hai mã)", () => {
    for (const pageId of ["104500000000001", "999999999999999"]) expect(kiemNhapPage({ ...OK, pageId })?.loi).toMatch(/Page mẫu/);
  });
  it("[DMP-04] Page thuộc cơ sở mà thiếu cơ sở ⇒ lỗi coSo; Hội sở thì không cần", () => {
    expect(kiemNhapPage({ ...OK, phamVi: "CENTER", centerId: null })?.truong).toBe("coSo");
    expect(kiemNhapPage({ ...OK, phamVi: "CENTER", centerId: "co-so-1" })).toBeNull();
  });
  it("[DMP-05] lý do < 10 ký tự (sau cắt khoảng trắng) ⇒ lỗi lyDo", () => {
    expect(kiemNhapPage({ ...OK, lyDo: "  ngắn  " })?.truong).toBe("lyDo");
  });
});

describe("[DMP] canhBaoDoiPage", () => {
  const cu = { pageId: "p", pageName: null, scopeType: "HO" as const, centerId: null, isActive: true };
  it("[DMP-06] Page mới ⇒ không cảnh báo", () => expect(canhBaoDoiPage(null, { ...cu }, false)).toEqual([]));
  it("[DMP-07] đổi phạm vi HO → CENTER ⇒ nói rõ ảnh hưởng hội thoại Messenger MỚI", () => {
    const r = canhBaoDoiPage(cu, { ...cu, scopeType: "CENTER", centerId: "c1" }, false);
    expect(r.join(" ")).toMatch(/Messenger CRM MỚI/);
  });
  it("[DMP-08] tắt Page đang có nguồn gán ⇒ cảnh báo nhắc dòng gán nguồn được giữ", () => {
    expect(canhBaoDoiPage(cu, { ...cu, isActive: false }, true).join(" ")).toMatch(/giữ nguyên/);
    expect(canhBaoDoiPage(cu, { ...cu, isActive: false }, false).join(" ")).toMatch(/webhook Messenger bỏ qua/);
  });
});
