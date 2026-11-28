// @vitest-environment node
/** [VDB-*] QtSoanKhoa — bước hiện tại của "Vòng đời khoá" (chỉ để VẼ; cổng thao tác ở vongDoiKhoa). */
import { describe, expect, it } from "vitest";
import { BUOC_VONG_DOI, buocVongDoiKhoa } from "./vong-doi-buoc";

const v = (...s: string[]) => s.map((status) => ({ status }));

describe("[VDB-01] buocVongDoiKhoa", () => {
  it("đủ bốn bước theo thiết kế, đúng thứ tự", () => {
    expect(BUOC_VONG_DOI.map((b) => b.nhan)).toEqual(["Nháp", "Chờ duyệt", "Đã duyệt → xuất bản", "Lưu trữ"]);
  });
  it("khoá mới chưa có bản nào ⇒ Nháp", () => expect(buocVongDoiKhoa("DRAFT", [])).toBe("NHAP"));
  it("🔴 mỗi trạng thái bản ⇒ đúng bước (đối chứng giữa các giá trị, không chỉ một)", () => {
    expect(buocVongDoiKhoa("DRAFT", v("DRAFT"))).toBe("NHAP");
    expect(buocVongDoiKhoa("DRAFT", v("PENDING_REVIEW"))).toBe("CHO_DUYET");
    expect(buocVongDoiKhoa("DRAFT", v("APPROVED"))).toBe("DA_DUYET");
    expect(buocVongDoiKhoa("PUBLISHED", v("PUBLISHED"))).toBe("DA_DUYET");
  });
  it("🔴 khoá đang phát hành mà có bản NHÁP kế tiếp ⇒ Nháp (người soạn đang làm bản mới), không phải 'Đã duyệt'", () => {
    expect(buocVongDoiKhoa("PUBLISHED", v("PUBLISHED", "DRAFT"))).toBe("NHAP");
    expect(buocVongDoiKhoa("PUBLISHED", v("PUBLISHED", "PENDING_REVIEW"))).toBe("CHO_DUYET");
  });
  it("🔴 khoá đã lưu trữ ⇒ Lưu trữ, bất kể bản", () => {
    expect(buocVongDoiKhoa("ARCHIVED", v("PUBLISHED"))).toBe("LUU_TRU");
    expect(buocVongDoiKhoa("ARCHIVED", v("DRAFT"))).toBe("LUU_TRU");
  });
});
