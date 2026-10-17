// @vitest-environment node
/**
 * LUẬT GẮN ĐƠN VỊ cho hộp thư — phần THUẦN, tách khỏi DB để test được thật.
 *
 * Đây là chỗ một quyết định sai không văng ra lỗi nào: ghi nhầm `orgUnitId` thì hội
 * thoại lặng lẽ đổi cơ sở, người đang xử lý mất nó khỏi danh sách, và ghi `null` đè
 * lên một hội thoại đã có cơ sở là đẩy nó trở lại nhóm "ai cũng đọc được" — đúng lỗ
 * rò mà B2 sinh ra để bịt.
 *
 * Nên luật ở đây nghiêng hẳn về ĐIỀN VÀO CHỖ TRỐNG, không đè:
 *   • chưa biết đơn vị  ⇒ không đụng gì (mồ côi vẫn là trạng thái BÌNH THƯỜNG);
 *   • đang trống        ⇒ điền;
 *   • đã có, trùng      ⇒ lan lại (idempotent — chữa dòng lệch);
 *   • đã có, KHÁC       ⇒ TỪ CHỐI. Nguồn mạnh hơn (nối `Lead`) đã quyết rồi.
 */
import { describe, it, expect } from "vitest";
import { quyetDinhGanDonVi } from "@/lib/inbox/don-vi";

describe("chưa biết đơn vị ⇒ không ghi gì", () => {
  it("đơn vị mới `null`/`undefined`/rỗng ⇒ KHONG_BIET_DON_VI, kể cả khi đang trống", () => {
    // Nick ZaloCRM chưa khai cơ sở là chuyện thường ở đợt đầu. Ghi `null` xuống ba
    // bảng "cho đủ bước" thì không thêm được gì, mà nếu hội thoại đã có cơ sở thì
    // đó là xoá cách ly.
    for (const moi of [null, undefined, "", "   "]) {
      expect(quyetDinhGanDonVi({ donViHienTai: null, donViMoi: moi }), String(moi)).toEqual({
        gan: false,
        lyDo: "KHONG_BIET_DON_VI",
      });
    }
  });

  it("đơn vị mới rỗng KHÔNG được xoá đơn vị đang có", () => {
    expect(quyetDinhGanDonVi({ donViHienTai: "ou-cs1", donViMoi: null })).toEqual({
      gan: false,
      lyDo: "KHONG_BIET_DON_VI",
    });
  });
});

describe("điền vào chỗ trống", () => {
  it("đang mồ côi (`null`/`undefined`) ⇒ ghi", () => {
    expect(quyetDinhGanDonVi({ donViHienTai: null, donViMoi: "ou-cs1" })).toEqual({
      gan: true,
      donVi: "ou-cs1",
    });
    expect(quyetDinhGanDonVi({ donViHienTai: undefined, donViMoi: "ou-cs1" })).toEqual({
      gan: true,
      donVi: "ou-cs1",
    });
  });

  it("đã đúng đơn vị đó rồi ⇒ VẪN ghi (lan lại là idempotent, để chữa dòng lệch)", () => {
    // Tin đến SAU lúc gắn đơn vị vẫn thừa hưởng đúng; nhưng tin đã nằm sẵn trong DB
    // từ trước lúc gắn thì chỉ phép lan mới sửa được. Chặn ca "trùng" là bỏ mất
    // đường tự chữa duy nhất.
    expect(quyetDinhGanDonVi({ donViHienTai: "ou-cs1", donViMoi: "ou-cs1" })).toEqual({
      gan: true,
      donVi: "ou-cs1",
    });
  });

  it("trả về giá trị ĐÃ chuẩn hoá — chỗ gọi ghi `donVi`, không ghi lại đầu vào", () => {
    // Ghi thẳng đầu vào chưa cắt khoảng trắng là đẻ ra "ou-cs1 " bên cạnh "ou-cs1":
    // hai chuỗi khác nhau với Postgres ⇒ hai cơ sở khác nhau với `inboxOrgScopeWhere`
    // ⇒ hội thoại tàng hình với chính người vừa nhận nó.
    expect(quyetDinhGanDonVi({ donViHienTai: null, donViMoi: "  ou-cs1  " })).toEqual({
      gan: true,
      donVi: "ou-cs1",
    });
    expect(quyetDinhGanDonVi({ donViHienTai: "  ou-cs1 ", donViMoi: "ou-cs1" })).toEqual({
      gan: true,
      donVi: "ou-cs1",
    });
  });
});

describe("🔴 KHÔNG đè đơn vị khác", () => {
  it("đang thuộc CS1, đòi gắn CS2 ⇒ DA_CO_DON_VI_KHAC", () => {
    // Hội thoại có cơ sở gần như luôn vì đã nối `Lead` — mà `Lead` là nguồn mạnh
    // hơn nick/người phụ trách. Đè lên nó là chuyển hội thoại sang cơ sở khác sau
    // lưng người đang xử lý, và không có dòng log nào nói ra chuyện đó.
    expect(quyetDinhGanDonVi({ donViHienTai: "ou-cs1", donViMoi: "ou-cs2" })).toEqual({
      gan: false,
      lyDo: "DA_CO_DON_VI_KHAC",
    });
  });
});
