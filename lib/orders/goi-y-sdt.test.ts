// lib/orders/goi-y-sdt.test.ts — ô SĐT phải tự nói kết quả tra của nó.
//
// Chủ dự án 15/09/2026: *"đang nhập ở sđt thì lọc theo sđt chứ sao lại lọc xuống dưới
// khoá học → học viên?"*
//
// Đo trước khi kết luận: việc tra lead VẪN CHẠY (gõ `0910000001` hiện đúng lead
// "Dương Duy Bình · 1 con: Hoàng Bá Thịnh"). Cái hỏng là nhánh RỖNG — gõ `930000001`
// (0 lead, 1 học viên) thì ô SĐT im hoàn toàn, còn phản ứng duy nhất nhìn thấy được lại
// nằm tận dưới khối Khoá học. Im lặng có hai nghĩa và người dùng không tách được.
import { describe, it, expect } from "vitest";
import { nhacTraLead, SO_CHU_SO_TOI_THIEU_TRA_LEAD } from "./goi-y-sdt";

const nen = {
  soChuSo: 10,
  dangTra: false,
  daTraXong: true,
  soLead: 0,
  soCon: 0,
};

describe("[SDT-01] chưa đủ chữ số ⇒ IM, đừng làm ồn khi người ta mới gõ vài số", () => {
  it("0..5 chữ số không nói gì, kể cả khi đang tra", () => {
    for (let n = 0; n < SO_CHU_SO_TOI_THIEU_TRA_LEAD; n++) {
      expect(nhacTraLead({ ...nen, soChuSo: n }), `n=${n}`).toBeNull();
      expect(nhacTraLead({ ...nen, soChuSo: n, dangTra: true }), `n=${n} dangTra`).toBeNull();
    }
  });

  it("đủ chữ số thì mới bắt đầu nói", () => {
    expect(nhacTraLead({ ...nen, soChuSo: SO_CHU_SO_TOI_THIEU_TRA_LEAD })).toBeTypeOf("string");
  });
});

describe("[SDT-02] đang tra ⇒ nói đang tra, kẻo tưởng hệ thống đứng im", () => {
  it("thắng mọi nhánh sau", () => {
    const s = nhacTraLead({ ...nen, dangTra: true, soLead: 3, soCon: 2 });
    expect(s).toContain("Đang tìm");
  });
});

describe("[SDT-03] chưa có kết quả cho ĐÚNG số này ⇒ IM", () => {
  it("khoảnh khắc giữa hai lần gõ không được báo về số CŨ", () => {
    expect(nhacTraLead({ ...nen, daTraXong: false })).toBeNull();
    expect(nhacTraLead({ ...nen, daTraXong: false, soCon: 5 })).toBeNull();
  });
});

describe("[SDT-04] CÓ lead ⇒ IM — danh sách ngay dưới đã tự nói", () => {
  it("không thêm giọng thứ hai cho cùng một sự việc", () => {
    expect(nhacTraLead({ ...nen, soLead: 1 })).toBeNull();
    expect(nhacTraLead({ ...nen, soLead: 8, soCon: 3 })).toBeNull();
  });
});

describe("[SDT-05] KHÔNG lead ⇒ PHẢI NÓI RA, và chỉ đường nếu có hồ sơ học viên", () => {
  it("có học viên khớp ⇒ nói số lượng VÀ chỉ xuống ô Học viên", () => {
    const s = nhacTraLead({ ...nen, soLead: 0, soCon: 1 });
    expect(s).toContain("Không có lead");
    expect(s).toContain("1 hồ sơ học viên");
    // Câu trả lời trực tiếp cho "sao lại lọc xuống dưới khoá học": nói RÕ nó ở đâu.
    expect(s).toContain("Học viên");
    expect(s).toContain("Khoá học");
  });

  it("nhiều con ⇒ đúng con số, không phải chữ chung chung", () => {
    expect(nhacTraLead({ ...nen, soCon: 3 })).toContain("3 hồ sơ học viên");
  });

  it("không lead, không học viên ⇒ nói là khách mới, không im", () => {
    const s = nhacTraLead({ ...nen, soLead: 0, soCon: 0 });
    expect(s).toContain("Không có lead");
    expect(s).toContain("khách mới");
    // KHÔNG được chỉ xuống ô Học viên khi dưới đó chẳng có con nào khớp.
    expect(s).not.toContain("hồ sơ học viên");
  });
});

describe("[SDT-06] bốn trạng thái LOẠI TRỪ NHAU", () => {
  it("mỗi bộ đầu vào cho đúng MỘT câu (hoặc null), không chồng nhau", () => {
    const boc = (x: Partial<typeof nen>) => nhacTraLead({ ...nen, ...x });
    expect(boc({ dangTra: true })).toContain("Đang tìm");
    expect(boc({ dangTra: true, soLead: 5 })).toContain("Đang tìm"); // tra thắng
    expect(boc({ soLead: 5 })).toBeNull(); // có lead thì im
    expect(boc({ soLead: 0, soCon: 0 })).toContain("khách mới");
    expect(boc({ soLead: 0, soCon: 2 })).toContain("2 hồ sơ học viên");
  });
});
