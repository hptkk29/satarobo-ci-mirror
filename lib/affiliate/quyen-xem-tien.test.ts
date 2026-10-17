// [QXT-*] — AFF-L3a: ĐỐI TÁC có thấy SỐ TIỀN hoa hồng ở cổng không. Hàm thuần, MỘT chỗ phân giải: campaign (khai tường minh) THẮNG loại; loại thắng mặc định; mặc định = ẨN.
// Viết TRƯỚC hiện thực (luật Nền #5) — commit đầu ĐỎ vì chưa có `quyen-xem-tien.ts`.
import { describe, expect, it } from "vitest";
import { boolTuLuaChon, luaChonTuBool, NHAN_LUA_CHON_XEM_TIEN, quyenXemTien, XEM_TIEN_MAC_DINH } from "./quyen-xem-tien";

describe("[QXT-01] thứ tự phân giải: campaign > loại > mặc định ẨN", () => {
  const bang: { ten: string; campaign: boolean | null; loai: boolean | null; ra: boolean }[] = [
    { ten: "không ai khai ⇒ ẨN", campaign: null, loai: null, ra: false },
    { ten: "chỉ loại bật ⇒ HIỆN", campaign: null, loai: true, ra: true },
    { ten: "chỉ loại tắt ⇒ ẨN", campaign: null, loai: false, ra: false },
    { ten: "chỉ campaign bật ⇒ HIỆN", campaign: true, loai: null, ra: true },
    { ten: "chỉ campaign tắt ⇒ ẨN", campaign: false, loai: null, ra: false },
    { ten: "campaign BẬT thắng loại TẮT", campaign: true, loai: false, ra: true },
    { ten: "campaign TẮT thắng loại BẬT", campaign: false, loai: true, ra: false },
    { ten: "cùng bật", campaign: true, loai: true, ra: true },
    { ten: "cùng tắt", campaign: false, loai: false, ra: false },
  ];
  for (const c of bang) it(c.ten, () => expect(quyenXemTien({ campaign: c.campaign, loai: c.loai })).toBe(c.ra));

  it("mặc định là ẨN và được đặt tên (không số ma thuật)", () => {
    expect(XEM_TIEN_MAC_DINH).toBe(false);
  });
});

describe("[QXT-02] ô ba trạng thái ↔ boolean|null (checkbox không diễn đạt được «theo cấp trên»)", () => {
  it("khứ hồi", () => {
    expect(boolTuLuaChon("THEO_CAP_TREN")).toBeNull();
    expect(boolTuLuaChon("HIEN")).toBe(true);
    expect(boolTuLuaChon("AN")).toBe(false);
    expect(luaChonTuBool(null)).toBe("THEO_CAP_TREN");
    expect(luaChonTuBool(true)).toBe("HIEN");
    expect(luaChonTuBool(false)).toBe("AN");
  });
  it("nhãn đủ ba lựa chọn, tiếng Việt", () => {
    expect(Object.keys(NHAN_LUA_CHON_XEM_TIEN).sort()).toEqual(["AN", "HIEN", "THEO_CAP_TREN"]);
  });
});
