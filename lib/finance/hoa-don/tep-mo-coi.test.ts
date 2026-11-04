// Ca [TMC-*] — CHỌN TỆP MỒ CÔI để dọn khỏi kho hoá đơn. THUẦN: khoá + LastModified + tập tham chiếu
// + mốc giờ ⇒ danh sách xoá. Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §6 ("tệp mồ côi … dọn bằng cron
// hằng tuần theo tiền tố").
//
// Mỗi luật an toàn một ca, và mỗi ca đã được CẤY LẠI (luật 14) — xem commit message.
// `now` là HẰNG (luật 19): hàm không đọc đồng hồ thật, test không bao giờ nổ theo tờ lịch.
import { describe, it, expect } from "vitest";
import { chonTepMoCoi, laKhoaTepHoaDon, TRAN_XOA_MOI_LUOT, TUOI_TOI_THIEU_MS, type TepTrongKho } from "./tep-mo-coi";

const NOW = new Date("2026-09-28T15:00:00.000Z");
const NGAY = 24 * 3600_000;
const truoc = (ms: number) => new Date(NOW.getTime() - ms);

const K1 = "hoa-don/CS1/2026/cmorder1/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.pdf";
const K2 = "hoa-don/CS1/2026/cmorder1/1a2b3c4d-4b5a-6978-8a9b-0c1d2e3f4a5b.xml";
const K3 = "hoa-don/CS2/2025/cmorder9/2b3c4d5e-4b5a-6978-8a9b-0c1d2e3f4a5b.pdf";

const tep = (khoa: string, tuoiMs: number | null): TepTrongKho => ({
  khoa,
  lastModified: tuoiMs == null ? null : truoc(tuoiMs),
});

const chon = (ds: readonly TepTrongKho[], thamChieu: readonly string[] = [], tran = TRAN_XOA_MOI_LUOT) =>
  chonTepMoCoi({ tep: ds, thamChieu: new Set(thamChieu), now: NOW, tran });

describe("[TMC-01] chỉ khoá đúng hình dạng khoá hoá đơn dưới tiền tố `hoa-don/`", () => {
  it("khoá do `khoaTepHoaDon` sinh ra đạt; khoá lạ không đạt", () => {
    expect(laKhoaTepHoaDon(K1)).toBe(true);
    expect(laKhoaTepHoaDon(K2)).toBe(true);
    for (const la of [
      "anh-lop/CS1/2026/cmorder1/x.pdf", // tiền tố khác — kho khác
      "hoa-don-cu/CS1/2026/cmorder1/x.pdf", // tiền tố GẦN giống
      "hoa-don/CS1/2026/cmorder1/x.png", // đuôi lạ
      "hoa-don/CS1/cmorder1/x.pdf", // thiếu năm
      "hoa-don/CS1/2026/cmorder1/../x.pdf", // thoát thư mục
      "hoa-don/ghi-chu.txt",
      "",
    ]) {
      expect(laKhoaTepHoaDon(la), la).toBe(false);
    }
  });

  it("tệp ngoài hình dạng đó KHÔNG bao giờ vào danh sách xoá, dù cũ và không ai tham chiếu", () => {
    const kq = chon([tep("anh-lop/CS1/2026/cmorder1/x.pdf", 30 * NGAY), tep("hoa-don/ghi-chu.txt", 30 * NGAY), tep(K1, 30 * NGAY)]);
    expect(kq.xoa).toEqual([K1]);
  });
});

describe("[TMC-02] chỉ xoá tệp CŨ HƠN 7 ngày theo LastModified — tệp đang tải dở không bị đụng", () => {
  it("7 ngày là ngưỡng", () => {
    expect(TUOI_TOI_THIEU_MS).toBe(7 * NGAY);
  });

  it("vừa tải (vài phút) / 6 ngày 23 giờ ⇒ GIỮ; 7 ngày + 1 ms ⇒ xoá", () => {
    const kq = chon([tep(K1, 5 * 60_000), tep(K2, 7 * NGAY - 3600_000), tep(K3, 7 * NGAY + 1)]);
    expect(kq.xoa).toEqual([K3]);
  });

  it("đúng 7 ngày (không hơn) ⇒ GIỮ", () => {
    expect(chon([tep(K1, 7 * NGAY)]).xoa).toEqual([]);
  });

  it("thiếu LastModified ⇒ GIỮ (không biết tuổi thì không đoán)", () => {
    expect(chon([tep(K1, null)]).xoa).toEqual([]);
  });

  it("LastModified ở TƯƠNG LAI (đồng hồ lệch) ⇒ GIỮ", () => {
    expect(chon([{ khoa: K1, lastModified: new Date(NOW.getTime() + NGAY) }]).xoa).toEqual([]);
  });
});

describe("[TMC-03] KHÔNG xoá khoá đang được hoá đơn nào tham chiếu", () => {
  it("khoá PDF và khoá XML trong tập tham chiếu ⇒ GIỮ; khoá ngoài tập ⇒ xoá", () => {
    const kq = chon([tep(K1, 30 * NGAY), tep(K2, 30 * NGAY), tep(K3, 30 * NGAY)], [K1, K2]);
    expect(kq.xoa).toEqual([K3]);
    expect(kq.moCoi).toBe(1);
  });

  it("so ĐÚNG NGUYÊN khoá — khoá chỉ khác đuôi không được coi là đã tham chiếu", () => {
    const pdf = K1;
    const xml = K1.replace(/\.pdf$/, ".xml");
    expect(chon([tep(pdf, 30 * NGAY), tep(xml, 30 * NGAY)], [pdf]).xoa).toEqual([xml]);
  });
});

describe("[TMC-04] trần số tệp mỗi lượt — cũ nhất trước, phần còn lại lượt sau dọn tiếp", () => {
  it("trần mặc định là 200", () => {
    expect(TRAN_XOA_MOI_LUOT).toBe(200);
  });

  it("5 tệp mồ côi, trần 2 ⇒ xoá 2 tệp CŨ NHẤT; `moCoi` vẫn đếm đủ 5", () => {
    const ds = [8, 30, 10, 45, 9].map((d, i) => tep(`hoa-don/CS1/2026/cmorder${i}/u${i}.pdf`, d * NGAY));
    const kq = chon(ds, [], 2);
    expect(kq.xoa).toEqual(["hoa-don/CS1/2026/cmorder3/u3.pdf", "hoa-don/CS1/2026/cmorder1/u1.pdf"]);
    expect(kq.moCoi).toBe(5);
  });

  it("trần 0 hoặc âm ⇒ không xoá gì (không bao giờ hiểu thành 'không trần')", () => {
    expect(chon([tep(K1, 30 * NGAY)], [], 0).xoa).toEqual([]);
    expect(chon([tep(K1, 30 * NGAY)], [], -1).xoa).toEqual([]);
  });

  it("khoá liệt kê TRÙNG (hai trang trả cùng khoá) chỉ vào danh sách một lần", () => {
    expect(chon([tep(K1, 30 * NGAY), tep(K1, 30 * NGAY)]).xoa).toEqual([K1]);
  });
});
