// S1 · chọn cơ sở (tab) cho màn Zalo CRM — bộ luật THUẦN.
//
// Vì sao tách ra khỏi `page.tsx` và có test riêng: đây là chỗ quyết định vé SSO được ký
// cho ORG NÀO. Nếu `?org=` từ URL được tin, thì một tư vấn viên CS1 gõ
// `/zalo-crm?org=cs2` là cầm được vé vào tổ chức ZaloCRM của CS2 — leo quyền thật sự,
// và Sata sẽ KHÔNG báo lỗi gì vì cổng trang (`zalocrm:use`) đã cho qua từ trước.
import { describe, it, expect } from "vitest";
import { chonCoSoZaloCrm } from "./co-so";

const CENTERS = [
  { id: "c1", code: "CS1", name: "CS1 — 211 Nguyễn Hữu Thọ" },
  { id: "c2", code: "CS2", name: "CS2 — 114 Hoàng Diệu" },
  { id: "c9", code: null, name: "Cơ sở chưa đặt mã" },
];
const ORG_CODES = { CS1: "cs1", CS2: "cs2" };

describe("chonCoSoZaloCrm — danh sách tab + cơ sở đang chọn", () => {
  it("[ZC-ORG-01] chỉ cơ sở VỪA có orgCode VỪA nhìn thấy mới lên tab", () => {
    const kq = chonCoSoZaloCrm({
      centers: CENTERS,
      orgCodes: ORG_CODES,
      visibleCenterIds: ["c1"],
    });
    expect(kq.danhSach.map((c) => c.orgCode)).toEqual(["cs1"]);
    expect(kq.dangChon?.orgCode).toBe("cs1");
  });

  it("[ZC-ORG-02] ?org= LẠ ⇒ rơi về cơ sở đầu, KHÔNG ký vé cho org đó", () => {
    const kq = chonCoSoZaloCrm({
      centers: CENTERS,
      orgCodes: ORG_CODES,
      visibleCenterIds: ["c1"],
      chon: "cs2", // có thật trên hệ thống, nhưng KHÔNG thuộc tầm nhìn của người này
    });
    expect(kq.dangChon?.orgCode).toBe("cs1");
    expect(kq.chonKhongHopLe).toBe(true);
  });

  it("[ZC-ORG-03] ?org= hợp lệ ⇒ chọn đúng tab đó", () => {
    const kq = chonCoSoZaloCrm({
      centers: CENTERS,
      orgCodes: ORG_CODES,
      visibleCenterIds: ["c1", "c2"],
      chon: "cs2",
    });
    expect(kq.dangChon?.orgCode).toBe("cs2");
    expect(kq.chonKhongHopLe).toBe(false);
    expect(kq.danhSach.map((c) => c.orgCode)).toEqual(["cs1", "cs2"]);
  });

  it("[ZC-ORG-04] không nhìn thấy cơ sở nào ⇒ danh sách RỖNG (fail-closed)", () => {
    // Ca này xảy ra thật: tài khoản chưa có dòng `UserOrgRole` nào (bài học 114 tài
    // khoản PARENT). Kết quả đúng là màn hướng dẫn, KHÔNG phải "cho xem cơ sở đầu tiên".
    const kq = chonCoSoZaloCrm({
      centers: CENTERS,
      orgCodes: ORG_CODES,
      visibleCenterIds: [],
      chon: "cs1",
    });
    expect(kq.danhSach).toEqual([]);
    expect(kq.dangChon).toBeNull();
  });

  it("[ZC-ORG-05] cơ sở chưa đặt Center.code ⇒ bỏ qua, không ném", () => {
    // `Center.code` là `String?` — cơ sở mới tạo có thể chưa có mã.
    const kq = chonCoSoZaloCrm({
      centers: CENTERS,
      orgCodes: { ...ORG_CODES, "": "rong" },
      visibleCenterIds: ["c1", "c2", "c9"],
    });
    expect(kq.danhSach.map((c) => c.centerId)).toEqual(["c1", "c2"]);
  });

  it("[ZC-ORG-06] chưa ánh xạ orgCode nào ⇒ RỖNG (không đoán bừa CS1→cs1)", () => {
    const kq = chonCoSoZaloCrm({
      centers: CENTERS,
      orgCodes: {},
      visibleCenterIds: ["c1", "c2"],
    });
    expect(kq.danhSach).toEqual([]);
    expect(kq.dangChon).toBeNull();
    expect(kq.chonKhongHopLe).toBe(false);
  });

  it("[ZC-ORG-07] thứ tự tab ổn định theo tên cơ sở (tab không nhảy giữa hai lần tải)", () => {
    const kq = chonCoSoZaloCrm({
      centers: [CENTERS[1], CENTERS[0]], // đảo thứ tự đầu vào
      orgCodes: ORG_CODES,
      visibleCenterIds: ["c1", "c2"],
    });
    expect(kq.danhSach.map((c) => c.centerCode)).toEqual(["CS1", "CS2"]);
  });

  it("[ZC-ORG-08] orgCode sai khuôn trong cấu hình ⇒ loại, không đẩy sang fork", () => {
    // Cùng khuôn `^[a-z0-9-]{1,32}$` mà `zalocrm.orgCodes` và đường webhook dùng. Ô cấu
    // hình đã chặn, nhưng dữ liệu cũ (ghi trước khi có schema) vẫn có thể lọt.
    const kq = chonCoSoZaloCrm({
      centers: CENTERS,
      orgCodes: { CS1: "CS1_HOA", CS2: "cs2" },
      visibleCenterIds: ["c1", "c2"],
    });
    expect(kq.danhSach.map((c) => c.orgCode)).toEqual(["cs2"]);
  });

  it("[ZC-ORG-09] hai cơ sở trỏ CÙNG một orgCode ⇒ giữ cơ sở đầu, không sinh tab trùng", () => {
    // Khai nhầm trong ô JSON là chuyện xảy ra được. Hai tab cùng orgCode thì bấm tab nào
    // cũng ra một nơi — người dùng tưởng mình đổi cơ sở mà không đổi.
    const kq = chonCoSoZaloCrm({
      centers: CENTERS,
      orgCodes: { CS1: "cs1", CS2: "cs1" },
      visibleCenterIds: ["c1", "c2"],
    });
    expect(kq.danhSach.map((c) => c.centerCode)).toEqual(["CS1"]);
  });
});
