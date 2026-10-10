// Ca [LTT-*] — ô "Trạng thái đơn" gộp cả "Chờ duyệt". Thuần, không DB.
//
// 🔴 Chủ dự án 25/09/2026: *"thêm trạng thái đơn chờ duyệt, khi đơn vượt quá mức mà quản
// lý chưa duyệt nữa chứ"*.
//
// Bộ này khoá phép ánh xạ HAI CHIỀU vào nhau. Test một chiều thì xanh vĩnh viễn kể cả khi
// chiều kia hỏng — và chiều GHI mới là chiều đẻ ra bug câm.
import { describe, it, expect } from "vitest";
import {
  giaTriOLocTrangThai,
  docOLocTrangThai,
  MOI_TRANG_THAI,
  CHO_DUYET,
} from "./loc-trang-thai";

describe("[LTT-01] chiều ĐỌC — ô chọn hiện đúng mục đang bật", () => {
  it("không lọc gì ⇒ 'Mọi trạng thái'", () => {
    expect(giaTriOLocTrangThai({})).toBe(MOI_TRANG_THAI);
  });

  it("lọc theo trạng thái thật ⇒ chính nó", () => {
    expect(giaTriOLocTrangThai({ status: "COMPLETED" })).toBe("COMPLETED");
  });

  it("lọc chờ duyệt ⇒ 'Chờ duyệt'", () => {
    expect(giaTriOLocTrangThai({ choDuyet: true })).toBe(CHO_DUYET);
  });

  it("cả hai cùng bật ⇒ 'Chờ duyệt' THẮNG", () => {
    // Trạng thái này chỉ tới được bằng URL gõ tay; khi ấy `choDuyet` là vế siết chặt hơn,
    // nên hiện nó là mô tả đúng hơn.
    expect(giaTriOLocTrangThai({ status: "COMPLETED", choDuyet: true })).toBe(CHO_DUYET);
  });
});

describe("[LTT-02] chiều GHI — chọn 'Chờ duyệt' phải XOÁ trạng thái cũ", () => {
  it("trả về ĐỦ HAI khoá, `status` là `undefined`", () => {
    // ⚠️ Ca đắt nhất của bộ. Trả về đối tượng thưa (`{ choDuyet: true }`) thì phép trộn
    // `{...cũ, ...mới}` ở chỗ gọi GIỮ NGUYÊN `status` cũ ⇒ hai điều kiện AND với nhau ⇒
    // danh sách rỗng, và người dùng không hiểu vì sao. Không lỗi nào báo.
    const ra = docOLocTrangThai(CHO_DUYET);
    expect(ra).toEqual({ status: undefined, choDuyet: true });
    expect(Object.keys(ra).sort()).toEqual(["choDuyet", "status"]);
  });

  it("chọn một trạng thái thật ⇒ TẮT `choDuyet`", () => {
    // Chiều ngược lại của cùng một cái bẫy.
    const ra = docOLocTrangThai("CANCELLED");
    expect(ra).toEqual({ status: "CANCELLED", choDuyet: undefined });
    expect(Object.keys(ra).sort()).toEqual(["choDuyet", "status"]);
  });

  it("'Mọi trạng thái' ⇒ tắt cả hai", () => {
    expect(docOLocTrangThai(MOI_TRANG_THAI)).toEqual({ status: undefined, choDuyet: undefined });
  });

  it.each([null, undefined, ""])("giá trị rỗng (%s) ⇒ tắt cả hai, KHÔNG ném", (v) => {
    expect(docOLocTrangThai(v)).toEqual({ status: undefined, choDuyet: undefined });
  });
});

describe("[LTT-03] hai chiều KHỚP NHAU — đi vòng tròn phải về chỗ cũ", () => {
  it.each([MOI_TRANG_THAI, CHO_DUYET, "DRAFT", "PENDING_PAYMENT", "CONFIRMED", "COMPLETED", "CANCELLED", "REFUNDED"])(
    "%s → đọc → ghi → vẫn là %s",
    (giaTri) => {
      // Đây là khoá giữ hai hàm không lệch nhau. Sửa một bên mà quên bên kia là ô chọn
      // hiện một đằng, danh sách lọc một nẻo — và cả hai đều trông bình thường.
      expect(giaTriOLocTrangThai(docOLocTrangThai(giaTri))).toBe(giaTri);
    },
  );
});
