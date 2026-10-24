/**
 * Khoá luật của ô lọc "Cơ sở". Mỗi ca dưới đây là một lỗi ĐÃ ĐO ĐƯỢC trên máy
 * ngày 03/09/2026 ở `/admin/students`, không phải ca giả định.
 */
import { describe, it, expect } from "vitest";
import { locDanhSachCoSo, resolveCenterParam } from "./center-options";

// Đúng hình dạng dữ liệu thật đo được: 6 dòng Center, nhưng chỉ 2 dòng có
// OrgUnit type=CENTER trỏ tới. 4 dòng còn lại mồ côi (Hội sở + 3 dòng rác ITLI_*).
const CS1 = { id: "co-so-nguyen-huu-tho", name: "Trụ sở chính - Nguyễn Hữu Thọ", code: "CS1" };
const CS2 = { id: "co-so-hoang-dieu", name: "Cơ sở Hoàng Diệu", code: "CS2" };
const HO = { id: "hoi-so", name: "Hội sở", code: "HO" };
const ITLI_A = { id: "cmtf6vpvz0000", name: "ITLI_Cơ sở A", code: "CS91" };
const ITLI_HO = { id: "cmtf6vpwa0004", name: "ITLI_Hội sở", code: "ITLI_HO" };

const TAT_CA = [CS1, CS2, HO, ITLI_A, ITLI_HO];
const DAY_HOC = [CS1.id, CS2.id];
// Chỉ dòng "Hội sở" là đơn vị HO thật; ITLI_Hội sở là bản ghi rác, KHÔNG phải HO.
const HO_IDS = [HO.id];

const quanTriHeThong = { isSuperAdmin: true, isHoLevel: false, visibleCenterIds: [] };
const nguoiHoiSo = { isSuperAdmin: false, isHoLevel: true, visibleCenterIds: [] };
const saleCS1 = { isSuperAdmin: false, isHoLevel: false, visibleCenterIds: [CS1.id] };

const ten = (r: { name: string }[]) => r.map((x) => x.name);

describe("ô lọc cơ sở — màn GIẢNG DẠY", () => {
  it("bỏ Hội sở kể cả với quản trị hệ thống", () => {
    // Hội sở không dạy học: 0 lớp, 0 học viên. Bày ra là một lựa chọn không bao
    // giờ đúng, và người dùng đọc bảng rỗng thành "mất dữ liệu".
    expect(ten(locDanhSachCoSo(TAT_CA, DAY_HOC, quanTriHeThong, "teaching", HO_IDS)))
      .toEqual(["Trụ sở chính - Nguyễn Hữu Thọ", "Cơ sở Hoàng Diệu"]);
  });

  it("bỏ luôn Center MỒ CÔI mà không cần biết tên chúng", () => {
    // 3 dòng ITLI_* là cặn của bộ test còn sót trong DB. Luật là "không có OrgUnit
    // type=CENTER trỏ tới thì không phải cơ sở", nên chúng rụng mà không cần
    // hardcode chữ "ITLI" ở bất kỳ đâu — thêm CS3 cũng không phải sửa code.
    const ra = locDanhSachCoSo(TAT_CA, DAY_HOC, quanTriHeThong, "teaching", HO_IDS);
    expect(ra.some((c) => c.name.startsWith("ITLI"))).toBe(false);
  });

  it("người cấp cơ sở chỉ thấy cơ sở của mình", () => {
    expect(ten(locDanhSachCoSo(TAT_CA, DAY_HOC, saleCS1, "teaching", HO_IDS)))
      .toEqual(["Trụ sở chính - Nguyễn Hữu Thọ"]);
  });

  it("người cấp Hội sở thấy mọi CƠ SỞ DẠY HỌC, nhưng vẫn không thấy Hội sở", () => {
    expect(ten(locDanhSachCoSo(TAT_CA, DAY_HOC, nguoiHoiSo, "teaching", HO_IDS)))
      .toEqual(["Trụ sở chính - Nguyễn Hữu Thọ", "Cơ sở Hoàng Diệu"]);
  });
});

describe("ô lọc cơ sở — màn TỔ CHỨC (nhân sự, kho, thông báo…)", () => {
  it("CHỈ quản trị hệ thống thấy Hội sở", () => {
    // Chủ dự án chốt 03/09: "ngoại trừ role admin thì các role khác không có lọc HO".
    expect(ten(locDanhSachCoSo(TAT_CA, DAY_HOC, quanTriHeThong, "org", HO_IDS))).toContain("Hội sở");
  });

  it("người cấp Hội sở KHÔNG phải quản trị hệ thống ⇒ vẫn không thấy Hội sở", () => {
    // `isHoLevel` chỉ nói "thấy mọi cơ sở", không đồng nghĩa với vai quản trị.
    // Nhầm hai thứ này là nới quyền ở đúng chỗ nguy hiểm nhất.
    expect(ten(locDanhSachCoSo(TAT_CA, DAY_HOC, nguoiHoiSo, "org", HO_IDS))).not.toContain("Hội sở");
  });

  it("người cấp cơ sở không thấy Hội sở", () => {
    expect(ten(locDanhSachCoSo(TAT_CA, DAY_HOC, saleCS1, "org", HO_IDS))).toEqual([
      "Trụ sở chính - Nguyễn Hữu Thọ",
    ]);
  });

  it("dòng mồ côi KHÔNG lọt kể cả ở màn tổ chức của quản trị hệ thống", () => {
    // "org" mở cửa cho ĐÚNG Hội sở, KHÔNG phải cho mọi thứ không-phải-cơ-sở.
    //
    // ⚠️ Ca này TỪNG XANH GIẢ: tên và chú thích nói "KHÔNG lọt" nhưng khẳng định
    // lại là `toBe(true)` — nó khoá đúng cái hành vi sai. Bắt được khi soi màn
    // Duyệt ca: ô chọn vẫn bày đủ 6 dòng gồm cả ITLI. Một test xanh mà khẳng
    // định ngược với tên nó còn tệ hơn không có test.
    const ra = locDanhSachCoSo(TAT_CA, DAY_HOC, quanTriHeThong, "org", HO_IDS);
    expect(ra.some((c) => c.name.startsWith("ITLI"))).toBe(false);
    expect(ra.map((c) => c.name)).toEqual([
      "Trụ sở chính - Nguyễn Hữu Thọ",
      "Cơ sở Hoàng Diệu",
      "Hội sở",
    ]);
  });

  it("KHÔNG khai hoCenterIds → không dòng nào ngoài cơ sở dạy học lọt", () => {
    // Mặc định `[]`: nơi gọi quên truyền thì fail-closed, không phải mở toang.
    const ra = locDanhSachCoSo(TAT_CA, DAY_HOC, quanTriHeThong, "org");
    expect(ra.map((c) => c.name)).toEqual([
      "Trụ sở chính - Nguyễn Hữu Thọ",
      "Cơ sở Hoàng Diệu",
    ]);
  });
});

describe("resolveCenterParam — id lạ phải NÓI RA, không lặng lẽ ra bảng rỗng", () => {
  const opts = [CS1, CS2];

  it("id hợp lệ đi qua", () => {
    expect(resolveCenterParam(CS1.id, opts)).toEqual({ centerId: CS1.id, invalid: false });
  });

  it("rỗng = không lọc", () => {
    expect(resolveCenterParam("", opts)).toEqual({ invalid: false });
    expect(resolveCenterParam(undefined, opts)).toEqual({ invalid: false });
  });

  it("id NGOÀI danh sách (link cũ, cơ sở vừa tắt, cơ sở ngoài tầm nhìn) → invalid", () => {
    // Đây là ca khiến bảng trắng im lặng: trước đây id lạ được nhét thẳng vào
    // `where` và truy vấn trả 0 dòng, không ai biết là do lọc sai.
    expect(resolveCenterParam(HO.id, opts)).toEqual({ invalid: true });
    expect(resolveCenterParam("khong-ton-tai", opts)).toEqual({ invalid: true });
  });
});
