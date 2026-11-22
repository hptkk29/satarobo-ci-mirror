// Ca [TCD-*] — "dòng này của bé nào". Thuần, không DB.
//
// 🔴 CA SINH RA BỘ NÀY, 25/09/2026. Chủ dự án nhìn ô giải trình giảm giá trên thẻ duyệt:
//   *"2 con học cùng khoá thì sao biết là đang giảm đơn cho con nào?"*
// Không biết được — nhãn dòng là `OrderItem.itemName`, mà trên `/orders/new` cột đó là tên
// KHOÁ HỌC. Hai con cùng khoá ⇒ hai dòng đọc y hệt nhau.
import { describe, it, expect } from "vitest";
import {
  tenConTrenDong,
  moTaDong,
  banDoTenConLead,
  type DanhTinhCon,
} from "./ten-con-tren-dong";

const RONG = new Map<string, string>();

describe("[TCD-01] thứ tự ưu tiên là thứ tự ĐỘ TIN CẬY", () => {
  it("có hồ sơ học viên ⇒ lấy tên học viên, kể cả khi còn `leadChildId`", () => {
    // Dòng đã convert vẫn giữ `metadata.leadChildId` (không đường nào dọn nó). Hồ sơ thật
    // là nguồn đúng hơn: tên trên lead có thể đã được sửa lại lúc lập hồ sơ.
    const ra = tenConTrenDong(
      { tenHocVien: "Nguyễn Minh An", leadChildId: "lc1" },
      banDoTenConLead([{ id: "lc1", fullName: "Bé An" }]),
    );
    expect(ra).toEqual({ ten: "Nguyễn Minh An", nguon: "hoc-vien" });
  });

  it("chưa có hồ sơ ⇒ rơi về con của lead, và ĐÁNH DẤU nguồn", () => {
    // Nhánh này chiếm 96,8% (121/125 lead không có Student khớp SĐT), nên nó KHÔNG phải
    // đường lùi — nó là đường chính. `nguon` để màn hình nói được "chưa chốt hồ sơ".
    expect(
      tenConTrenDong(
        { tenHocVien: null, leadChildId: "lc2" },
        banDoTenConLead([{ id: "lc2", fullName: "Trần Bảo Bình" }]),
      ),
    ).toEqual({ ten: "Trần Bảo Bình", nguon: "con-lead" });
  });
});

describe("[TCD-02] KHÔNG BIẾT thì trả `null` — TUYỆT ĐỐI không rơi về tên dòng", () => {
  // ⚠️ Ca quan trọng nhất của bộ này. `itemName` mang bốn khuôn khác nhau tuỳ đường tạo
  // dòng; rơi về nó là in ra một chuỗi TRÔNG NHƯ tên bé, tức biến bug thành bug tàng hình.
  // Hàm này cố ý KHÔNG NHẬN `itemName` — không có đường nào để nó lỡ tay dùng.
  it.each<[string, DanhTinhCon]>([
    ["cả hai vế trống", { tenHocVien: null, leadChildId: null }],
    ["chuỗi rỗng", { tenHocVien: "", leadChildId: "" }],
    ["toàn khoảng trắng", { tenHocVien: "   ", leadChildId: "  " }],
  ])("%s ⇒ null", (_ten, dt) => {
    expect(tenConTrenDong(dt, RONG)).toBeNull();
  });

  it("có `leadChildId` nhưng KHÔNG tra được ⇒ null, KHÔNG in cái id ra màn", () => {
    // Con lead đã bị xoá, hoặc dòng trỏ sang lead khác. In `lc404` lên màn là rác; nói
    // "chưa gắn bé" là sự thật.
    const ra = tenConTrenDong({ tenHocVien: null, leadChildId: "lc404" }, RONG);
    expect(ra).toBeNull();
  });

  it("tên trong bản đồ mà toàn khoảng trắng cũng là KHÔNG BIẾT", () => {
    expect(
      tenConTrenDong(
        { tenHocVien: null, leadChildId: "lc3" },
        banDoTenConLead([{ id: "lc3", fullName: "   " }]),
      ),
    ).toBeNull();
  });
});

describe("[TCD-03] CHÍNH CA CHỦ DỰ ÁN HỎI: hai con CÙNG KHOÁ", () => {
  it("hai dòng cùng `itemName` vẫn ra HAI nhãn khác nhau", () => {
    // Đây là hình dạng dữ liệu THẬT của `/orders/new`: cả hai dòng mang đúng một chuỗi
    // `itemName` ("Sata 4 — Lập trình khối"), phân biệt duy nhất nằm ở danh tính con.
    const banDo = banDoTenConLead([
      { id: "lcA", fullName: "Nguyễn Minh An" },
      { id: "lcB", fullName: "Nguyễn Minh Bình" },
    ]);
    const dong: DanhTinhCon[] = [
      { tenHocVien: null, leadChildId: "lcA" },
      { tenHocVien: null, leadChildId: "lcB" },
    ];
    const nhan = dong.map((d) => tenConTrenDong(d, banDo));

    expect(nhan.map((n) => n?.ten)).toEqual(["Nguyễn Minh An", "Nguyễn Minh Bình"]);
    // Bất biến thật sự cần: KHÔNG TRÙNG. Đây là thứ màn hình đang vi phạm trước bản vá.
    expect(new Set(nhan.map((n) => n?.ten)).size).toBe(2);
  });
});

describe("[TCD-04] `moTaDong` — biết thì gọi tên, không biết thì nói rõ là DÒNG", () => {
  it("biết bé ⇒ đúng tên bé, không kèm tên khoá", () => {
    expect(moTaDong({ ten: "Nguyễn Minh An", nguon: "hoc-vien" }, "Sata 4")).toBe(
      "Nguyễn Minh An",
    );
  });

  it("không biết ⇒ trích tên dòng trong NGOẶC KÉP, có chữ `dòng`", () => {
    // Ngoặc kép + chữ "dòng" để người đọc thấy ngay đây là tên sản phẩm, không phải tên
    // người. "Tạo đợt thu cho Sata 4 — Lập trình khối" đọc như thể Sata 4 là một đứa trẻ.
    const ra = moTaDong(null, "Sata 4 — Lập trình khối");
    expect(ra).toBe('dòng "Sata 4 — Lập trình khối"');
    expect(ra).toContain("dòng");
  });
});
