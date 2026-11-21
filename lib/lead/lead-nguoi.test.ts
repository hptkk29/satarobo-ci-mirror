/**
 * LEAD NGUỘI — phép đo "bao lâu rồi không ai đụng".
 *
 * ── VÌ SAO BỘ NÀY KIỂM KỸ HƠN VẺ NGOÀI CỦA NÓ ────────────────────────────────────────────
 * Một con số lệch ở đây không dừng lại ở một con số lệch: màn hình dùng nó có nút PHÂN BỔ
 * HÀNG LOẠT, nên đếm sai là giật lead khỏi tay một Sale đang chăm tốt, và Sale đó mất luôn
 * hoa hồng. Sai theo chiều ngược lại thì lead nằm chết trong sổ mà không ai biết.
 *
 * ⚠️ Luật 19 của repo: test KHÔNG được đọc đồng hồ thật. Mọi ca ở đây truyền `now` tường
 * minh; không ca nào gọi `new Date()` trần.
 */
import { describe, expect, it } from "vitest";
import {
  NGUONG_NGUOI_MAC_DINH,
  NGUONG_NGUOI_TOI_DA,
  NGUONG_NGUOI_TOI_THIEU,
  chuanNguong,
  daNguoi,
  mocCatNguoi,
  mocTuongTacCuoi,
  nhanSoNgay,
  soNgayIm,
  type LeadDeDoNguoi,
} from "./lead-nguoi";

const NOW = new Date("2026-09-15T10:00:00.000Z");
const ngayTruoc = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/** Lead trần: chỉ có ngày tạo, chưa ai đụng tới. */
const tho = (over: Partial<LeadDeDoNguoi> = {}): LeadDeDoNguoi => ({
  lastActivityAt: null,
  firstContactAt: null,
  assignedAt: null,
  createdAt: ngayTruoc(200),
  ...over,
});

describe("[NGUOI-T10] mốc tương tác cuối lấy cột MUỘN NHẤT", () => {
  it("chưa ai đụng ⇒ tính từ ngày tạo", () => {
    expect(mocTuongTacCuoi(tho())).toEqual(ngayTruoc(200));
  });

  it("có hoạt động ⇒ lấy ngày hoạt động", () => {
    expect(mocTuongTacCuoi(tho({ lastActivityAt: ngayTruoc(10) }))).toEqual(ngayTruoc(10));
  });

  it("nhiều cột cùng có ⇒ lấy cột muộn nhất, không phải cột đầu danh sách", () => {
    const l = tho({
      lastActivityAt: ngayTruoc(100),
      firstContactAt: ngayTruoc(5),
      assignedAt: ngayTruoc(150),
    });
    expect(mocTuongTacCuoi(l)).toEqual(ngayTruoc(5));
  });

  it("⚠️ mỗi cột hợp lệ đều phải được tính — không cột nào bị bỏ quên", () => {
    // Quên một cột nghĩa là một loại thao tác chăm sóc không được ghi nhận, và Sale làm
    // đúng việc đó vẫn bị chấm là bỏ bê.
    for (const cot of ["lastActivityAt", "firstContactAt", "assignedAt"] as const) {
      expect(mocTuongTacCuoi(tho({ [cot]: ngayTruoc(3) })), `cột ${cot} bị bỏ quên`).toEqual(
        ngayTruoc(3),
      );
    }
  });

  it("⚠️ `statusChangedAt` KHÔNG được tính — cột đó bị ghi hàng loạt", () => {
    // Nghe rất hợp lý (đẩy lead qua một bậc phễu đúng là một lần chăm) và bản đầu ĐÃ tính nó.
    // Phép đo trên dữ liệu thật bác bỏ, 15/09/2026:
    //     lead cũ hơn 90 ngày, chưa chốt                  35
    //     trong đó `statusChangedAt` cũng cũ hơn 90 ngày   0
    //     số ngày KHÁC NHAU của cột đó trên cả bảng        2
    // Hai giá trị ngày cho cả sổ lead = cột được ghi hàng loạt (đợt rút phễu 13→10 bậc hồi
    // 08/2026), không mang thông tin về việc chăm từng lead. Tính nó vào thì bộ lọc trả về
    // ĐÚNG 0 dòng, mãi mãi, và không ai biết vì sao.
    //
    // Ca này khoá việc LOẠI BỎ: ai thấy nó "thiếu" mà thêm lại thì test đỏ ngay, kèm lý do.
    const l = { ...tho({ createdAt: ngayTruoc(200) }), statusChangedAt: ngayTruoc(1) } as
      LeadDeDoNguoi & { statusChangedAt: Date };
    expect(soNgayIm(l, NOW), "cột bị ghi hàng loạt đã lọt vào phép đo").toBe(200);
  });

  it("không bao giờ trả về null — luôn có đáy là ngày tạo", () => {
    // Thiếu đáy thì lead chưa từng được chăm rơi khỏi bộ lọc, đúng loại lead cần lọc nhất.
    expect(mocTuongTacCuoi(tho())).toBeInstanceOf(Date);
  });
});

describe("[NGUOI-T11] đếm số ngày im", () => {
  it("đếm đúng theo mốc muộn nhất", () => {
    expect(soNgayIm(tho({ lastActivityAt: ngayTruoc(91) }), NOW)).toBe(91);
  });

  it("⚠️ cắt XUỐNG, không làm tròn lên", () => {
    // 89,9 ngày phải đọc là 89. Làm tròn lên thì một lead CHƯA đủ ngưỡng lọt vào danh sách
    // 90 ngày, và quản lý bấm phân bổ mà không biết mình vừa phá luật.
    const gan90 = new Date(NOW.getTime() - (90 * 24 - 2) * 60 * 60 * 1000); // 89 ngày 22 giờ
    expect(soNgayIm(tho({ lastActivityAt: gan90 }), NOW)).toBe(89);
  });

  it("mốc ở TƯƠNG LAI (lệch đồng hồ) ⇒ 0, không phải số âm", () => {
    const mai = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000);
    expect(soNgayIm(tho({ lastActivityAt: mai }), NOW)).toBe(0);
  });

  it("vừa đụng xong ⇒ 0 ngày", () => {
    expect(soNgayIm(tho({ lastActivityAt: NOW }), NOW)).toBe(0);
  });
});

describe("[NGUOI-T12] ngưỡng nguội", () => {
  it("đúng bằng ngưỡng ⇒ TÍNH LÀ nguội", () => {
    // Biên phải rõ ràng: "90 ngày" nghĩa là từ ngày thứ 90 trở đi.
    expect(daNguoi(tho({ lastActivityAt: ngayTruoc(90) }), NOW, 90)).toBe(true);
  });

  it("thiếu một ngày ⇒ CHƯA nguội", () => {
    expect(daNguoi(tho({ lastActivityAt: ngayTruoc(89) }), NOW, 90)).toBe(false);
  });

  it("ngưỡng khác 90 vẫn đúng", () => {
    expect(daNguoi(tho({ lastActivityAt: ngayTruoc(31) }), NOW, 30)).toBe(true);
    expect(daNguoi(tho({ lastActivityAt: ngayTruoc(31) }), NOW, 60)).toBe(false);
  });
});

describe("[NGUOI-T13] ⚠️ ô nhập ngưỡng hỏng KHÔNG được thành 0", () => {
  // Ngưỡng 0 nghĩa là "mọi lead đều nguội", mà màn này có nút phân bổ hàng loạt. Một ô nhập
  // bỏ trống không được phép biến thành một lượt xáo trộn toàn bộ sổ lead.
  it("rỗng / chữ / null ⇒ về mặc định", () => {
    for (const x of ["", "  ", "abc", null, undefined, NaN]) {
      expect(chuanNguong(x), `đầu vào ${String(x)}`).toBe(NGUONG_NGUOI_MAC_DINH);
    }
  });

  it("số 0 và số âm ⇒ kéo lên sàn, KHÔNG giữ nguyên", () => {
    expect(chuanNguong(0)).toBe(NGUONG_NGUOI_TOI_THIEU);
    expect(chuanNguong(-500)).toBe(NGUONG_NGUOI_TOI_THIEU);
  });

  it("số quá lớn ⇒ kéo về trần", () => {
    expect(chuanNguong(99999)).toBe(NGUONG_NGUOI_TOI_DA);
  });

  it("số hợp lệ ⇒ giữ nguyên", () => {
    expect(chuanNguong(120)).toBe(120);
    expect(chuanNguong("45")).toBe(45);
  });

  it("số lẻ ⇒ cắt phần thập phân", () => {
    expect(chuanNguong(90.9)).toBe(90);
  });

  it("mặc định đúng con số chủ dự án chốt", () => {
    expect(NGUONG_NGUOI_MAC_DINH).toBe(90);
  });
});

describe("[NGUOI-T14] mốc cắt dùng cho câu truy vấn", () => {
  it("khớp với phép đếm ngày — hai đường không được lệch nhau", () => {
    // `mocCatNguoi` dựng câu `where` ở tầng DB, còn `daNguoi` chạy trên bản ghi đã lấy về.
    // Hai phép cùng một ý nghĩa mà lệch nhau thì danh sách hiện ra một đằng, con số cột
    // "im bao lâu" một nẻo.
    const moc = mocCatNguoi(NOW, 90);
    const vuaDu = tho({ lastActivityAt: moc });
    expect(daNguoi(vuaDu, NOW, 90)).toBe(true);

    const thieuMotGio = tho({ lastActivityAt: new Date(moc.getTime() + 60 * 60 * 1000) });
    expect(daNguoi(thieuMotGio, NOW, 90)).toBe(false);
  });
});

describe("[NGUOI-T15] nhãn số ngày", () => {
  it("dưới 60 ngày ⇒ để nguyên số ngày", () => {
    expect(nhanSoNgay(45)).toBe("45 ngày");
  });

  it("từ 60 ngày ⇒ kèm số tháng ước lượng", () => {
    // Đọc "437 ngày" thì khó ước lượng; "~14 tháng" mới ra quyết định được.
    expect(nhanSoNgay(120)).toContain("4 tháng");
    expect(nhanSoNgay(120)).toContain("120 ngày");
  });
});
