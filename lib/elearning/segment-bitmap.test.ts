// @vitest-environment node
/**
 * EL-12 — bitmap đoạn xem.
 *
 * Đây là chỗ mọi cơ chế chống học đối phó cuối cùng đổ về: nếu bitmap có thể bị
 * thổi phồng thì hình mờ, chặn tua, câu hỏi chèn giữa video đều thành trang trí —
 * người ta chỉ cần gửi một nhịp khai "đã xem hết".
 *
 * Ba nhóm case đầu là ba cách gian lận thật; nhóm cuối là một lỗi số học vô tình
 * nhưng sai theo hướng dễ dãi.
 */
import { describe, it, expect } from "vitest";
import {
  soDoanCua,
  bitmapRong,
  batDoan,
  doanDaBat,
  demDoan,
  phanTramPhu,
  gopNhipXem,
  daMatDoan,
  DOAN_GIAY,
  TRAN_DELTA_GIAY,
} from "@/lib/elearning/segment-bitmap";

describe("chia đoạn", () => {
  it("video 300 giây, đoạn 5 giây ⇒ 60 đoạn", () => {
    expect(soDoanCua(300)).toBe(60);
  });

  it("thời lượng lẻ làm tròn LÊN — đoạn cuối vẫn phải xem", () => {
    // Làm tròn xuống là bỏ mất đoạn đuôi; người xem hết bài vẫn không đủ 100%.
    expect(soDoanCua(302)).toBe(61);
  });

  it("thời lượng vô lý ⇒ 0 đoạn, không NaN", () => {
    for (const d of [0, -5, NaN, Infinity]) {
      expect(soDoanCua(d), String(d)).toBe(0);
    }
  });
});

describe("GIAN LẬN 1 — một nhịp khai đã xem hết bài", () => {
  it("trần delta cắt khoảng vượt quá 20 giây", () => {
    // Không có trần thì một lần gọi duy nhất "từ 0 tới 3600" là xong cả bài.
    const r = gopNhipXem({ bitmapCu: null, soDoan: 60, tuSec: 0, denSec: 3600 });
    expect(r.biCatTran).toBe(true);
    expect(r.coveredSec).toBe(TRAN_DELTA_GIAY);
    expect(r.coveragePercent).toBeLessThan(10);
  });

  it("trần áp TRƯỚC khi bật bit, không phải sau", () => {
    // Áp sau là đã ghi rồi mới cắt — bitmap vẫn mang những đoạn không được phép.
    const r = gopNhipXem({ bitmapCu: null, soDoan: 60, tuSec: 0, denSec: 3600 });
    expect(doanDaBat(r.bitmap, 5)).toBe(false);
    expect(demDoan(r.bitmap, 60)).toBe(TRAN_DELTA_GIAY / DOAN_GIAY);
  });

  it("nhịp đúng nhịp (dưới trần) thì KHÔNG bị cắt", () => {
    const r = gopNhipXem({ bitmapCu: null, soDoan: 60, tuSec: 0, denSec: 15 });
    expect(r.biCatTran).toBe(false);
    expect(r.doanMoi).toBe(3);
  });

  it("`biCatTran` báo ra ngoài để cơ chế gắn cờ dùng được", () => {
    // Bị cắt một lần là bình thường (tua); bị cắt liên tục là dấu hiệu.
    expect(gopNhipXem({ bitmapCu: null, soDoan: 60, tuSec: 0, denSec: 100 }).biCatTran).toBe(
      true,
    );
  });
});

describe("GIAN LẬN 2 — gửi snapshot 'sạch hơn' để xoá lịch sử", () => {
  it("gộp CHỈ bật bit, không bao giờ tắt", () => {
    // Nhịp xem là snapshot luỹ kế ghi đè; nhận nguyên snapshot của client thì tua
    // đi tua lại một đoạn ngắn có thể xoá lịch sử xem thật.
    const cu = bitmapRong(60);
    for (let i = 0; i < 20; i += 1) batDoan(cu, i);
    const r = gopNhipXem({ bitmapCu: cu, soDoan: 60, tuSec: 200, denSec: 210 });
    expect(daMatDoan(cu, r.bitmap, 60)).toBe(false);
    expect(demDoan(r.bitmap, 60)).toBeGreaterThan(20);
  });

  it("KHÔNG sửa bitmap cũ tại chỗ", () => {
    // Sửa tại chỗ làm người gọi không so được trước/sau — mà so trước/sau chính
    // là cách phát hiện nhịp gian.
    const cu = bitmapRong(60);
    batDoan(cu, 0);
    const truoc = [...cu];
    gopNhipXem({ bitmapCu: cu, soDoan: 60, tuSec: 100, denSec: 110 });
    expect([...cu]).toEqual(truoc);
  });

  it("xem lại đoạn đã xem ⇒ 0 đoạn mới, không cộng thêm", () => {
    const cu = bitmapRong(60);
    for (let i = 0; i < 4; i += 1) batDoan(cu, i);
    const r = gopNhipXem({ bitmapCu: cu, soDoan: 60, tuSec: 0, denSec: 20 });
    expect(r.doanMoi).toBe(0);
  });
});

describe("GIAN LẬN 3 — khoảng vô lý", () => {
  it("khoảng LÙI (đến < từ) ⇒ không cộng gì", () => {
    const r = gopNhipXem({ bitmapCu: null, soDoan: 60, tuSec: 100, denSec: 50 });
    expect(r.doanMoi).toBe(0);
  });

  it("giá trị âm / NaN / Infinity không làm hỏng bitmap", () => {
    for (const [tu, den] of [
      [-100, 10],
      [NaN, 10],
      [0, NaN],
      [0, Infinity],
    ]) {
      const r = gopNhipXem({ bitmapCu: null, soDoan: 60, tuSec: tu!, denSec: den! });
      expect(r.coveragePercent, `${tu}-${den}`).toBeLessThanOrEqual(100);
      expect(Number.isNaN(r.coveragePercent)).toBe(false);
    }
  });

  it("vượt quá số đoạn của video thì dừng ở đoạn cuối", () => {
    const r = gopNhipXem({ bitmapCu: null, soDoan: 4, tuSec: 0, denSec: 20 });
    expect(r.coveragePercent).toBe(100);
    expect(demDoan(r.bitmap, 4)).toBe(4);
  });
});

describe("bit thừa ở byte cuối KHÔNG được đếm", () => {
  it("video 7 đoạn dùng 1 byte — bit thứ 8 bị bỏ qua", () => {
    // Đếm cả bit thừa là báo phủ 114%, và mọi phép so với ngưỡng hoàn thành đều
    // sai theo hướng DỄ DÃI.
    const b = bitmapRong(7);
    for (let i = 0; i < 8; i += 1) batDoan(b, i);
    expect(demDoan(b, 7)).toBe(7);
    expect(phanTramPhu(b, 7)).toBe(100);
  });

  it("phần trăm không bao giờ vượt 100", () => {
    const b = bitmapRong(3);
    for (let i = 0; i < 8; i += 1) batDoan(b, i);
    expect(phanTramPhu(b, 3)).toBe(100);
  });

  it("0 đoạn ⇒ 0%, không chia cho 0", () => {
    expect(phanTramPhu(bitmapRong(0), 0)).toBe(0);
  });
});

describe("đoạn chỉ tính khi đã QUA TRỌN VẸN", () => {
  it("xem tới giây 12 ⇒ 2 đoạn (0–5, 5–10), chưa tính đoạn 10–15", () => {
    // Tính cả đoạn đang dở là cộng cho người học một đoạn họ chưa xem hết.
    const r = gopNhipXem({ bitmapCu: null, soDoan: 60, tuSec: 0, denSec: 12 });
    expect(r.doanMoi).toBe(2);
  });

  it("xem đúng tới biên đoạn thì tính trọn", () => {
    const r = gopNhipXem({ bitmapCu: null, soDoan: 60, tuSec: 0, denSec: 15 });
    expect(r.doanMoi).toBe(3);
  });
});

describe("video bị THAY TỆP — bitmap cũ không được mang thừa sang", () => {
  it("video ngắn lại ⇒ chỉ giữ phần nằm trong phạm vi mới", () => {
    // Không cắt thì một video 10 phút thay bằng bản 2 phút sẽ hiện phủ >100%,
    // hoặc tệ hơn, hiện 100% cho người chưa xem bản mới phút nào.
    const cu = bitmapRong(120);
    for (let i = 0; i < 120; i += 1) batDoan(cu, i);
    const r = gopNhipXem({ bitmapCu: cu, soDoan: 24, tuSec: 0, denSec: 0 });
    expect(r.bitmap.length).toBe(3);
    expect(r.coveragePercent).toBeLessThanOrEqual(100);
  });
});

describe("[YT-TAIL] đoạn ĐUÔI LẺ — video 19 giây xem hết phải ghi đủ 19 giây", () => {
  // Ca đo thật ở E2E YouTube: video 19 giây, xem trọn ⇒ server ghi 15/19 giây (79%), thấp hơn
  // ngưỡng hoàn thành 95% nên người xem hết bài vẫn KHÔNG hoàn thành được. Gốc: đoạn cuối chỉ dài
  // 4 giây, mà đoạn chỉ được bật khi `floor(đến / 5)` vượt qua nó.
  const SO_DOAN = soDoanCua(19); // 4 đoạn: 0–5, 5–10, 10–15, 15–19

  function xemTheoNhip(contentSec: number | undefined, nhip: Array<[number, number]>) {
    let bm: Uint8Array | null = null;
    let tongGiay = 0;
    let last = gopNhipXem({ bitmapCu: null, soDoan: SO_DOAN, tuSec: 0, denSec: 0, contentSec });
    for (const [tu, den] of nhip) {
      last = gopNhipXem({ bitmapCu: bm, soDoan: SO_DOAN, tuSec: tu, denSec: den, contentSec });
      bm = last.bitmap;
      tongGiay += last.giayMoi;
    }
    return { last, tongGiay };
  }

  it("TRƯỚC (không truyền thời lượng): xem hết chỉ được 75% — hành vi cũ, ghim lại để thấy sự khác biệt", () => {
    const { last } = xemTheoNhip(undefined, [[0, 15], [15, 19]]);
    expect(last.coveragePercent).toBe(75);
    expect(last.coveredSec).toBe(15);
  });

  it("SAU: xem hết ⇒ 100%, 19 giây (không phải 20), đủ ngưỡng hoàn thành 95%", () => {
    const { last, tongGiay } = xemTheoNhip(19, [[0, 15], [15, 19]]);
    expect(last.coveragePercent).toBe(100);
    expect(last.coveredSec).toBe(19);
    expect(tongGiay).toBe(19);
  });

  it("vị trí cuối lệch dưới 1 giây (18.4 so với 19 đã lưu) vẫn tính là chạm cuối", () => {
    const { last } = xemTheoNhip(19, [[0, 15], [15, 18.4]]);
    expect(last.coveragePercent).toBe(100);
  });

  it("dừng sớm hơn 1 giây (17 giây) thì đoạn đuôi CHƯA tính — không nới thành 'xem gần hết là xong'", () => {
    const { last } = xemTheoNhip(19, [[0, 15], [15, 17]]);
    expect(last.coveragePercent).toBe(75);
    expect(last.coveredSec).toBe(15);
  });

  it("khai vị trí VƯỢT nội dung (tua quá cuối) không tạo thêm gì ngoài phần thật", () => {
    // Bắt đầu 17, khai tới 5000: chỉ phần 17→19 là nội dung. Đoạn 10–15 chưa xem nên KHÔNG được bật.
    const r = gopNhipXem({ bitmapCu: null, soDoan: SO_DOAN, tuSec: 17, denSec: 5000, contentSec: 19 });
    expect(r.doanMoi).toBe(1); // chỉ đoạn đuôi 15–19 (tu=17 nằm trong nó)
    expect(r.coveredSec).toBe(4);
    expect(r.coveredSec).toBeLessThanOrEqual(19);
    // Khai vượt nội dung vẫn phải để lại dấu cho cơ chế gắn cờ.
    expect(r.biCatTran).toBe(true);
  });

  it("khoảng nằm hoàn toàn SAU cuối bài ⇒ không cộng gì", () => {
    const r = gopNhipXem({ bitmapCu: null, soDoan: SO_DOAN, tuSec: 30, denSec: 60, contentSec: 19 });
    expect(r.doanMoi).toBe(0);
    expect(r.giayMoi).toBe(0);
    expect(r.coveragePercent).toBe(0);
  });

  it("trần delta vẫn áp: nhịp 0→19 không vượt trần 25 nhưng 0→2000 trên video dài thì bị cắt", () => {
    const dai = gopNhipXem({ bitmapCu: null, soDoan: 120, tuSec: 0, denSec: 2000, contentSec: 600 });
    expect(dai.biCatTran).toBe(true);
    expect(dai.doanMoi).toBe(Math.floor(TRAN_DELTA_GIAY / DOAN_GIAY));
    // Và cuối bài không "nhảy cóc" được nhờ ngoại lệ đuôi lẻ: cắt ở giây 20, còn xa cuối.
    expect(dai.coveragePercent).toBeLessThan(5);
  });

  it("video chia hết cho 5 (100 giây): 99.5 giây tính chạm cuối, 98 giây thì chưa", () => {
    const a = gopNhipXem({ bitmapCu: null, soDoan: 20, tuSec: 85, denSec: 99.5, contentSec: 100 });
    expect(a.bitmap[2]! & (1 << 3)).not.toBe(0); // đoạn 19 (95–100) bật
    const b = gopNhipXem({ bitmapCu: null, soDoan: 20, tuSec: 85, denSec: 98, contentSec: 100 });
    expect(b.bitmap[2]! & (1 << 3)).toBe(0);
  });

  it("coveredSec không bao giờ vượt thời lượng bài, kể cả khi bật mọi đoạn", () => {
    const cu = bitmapRong(SO_DOAN);
    for (let i = 0; i < SO_DOAN; i += 1) batDoan(cu, i);
    const r = gopNhipXem({ bitmapCu: cu, soDoan: SO_DOAN, tuSec: 0, denSec: 0, contentSec: 19 });
    expect(r.coveredSec).toBe(19);
  });
});

describe("[BM-NGAN] trần truyền vào (ngân sách thời gian thật) — hết ngân sách thì KHÔNG cộng gì", () => {
  it("trần 0 ở giữa bài ⇒ không bật đoạn nào, báo bị cắt", () => {
    const r = gopNhipXem({ bitmapCu: null, soDoan: 120, tuSec: 100, denSec: 120, contentSec: 600, tranDeltaGiay: 0 });
    expect(r.doanMoi).toBe(0);
    expect(r.giayMoi).toBe(0);
    expect(r.biCatTran).toBe(true);
  });

  it("🔴 trần 0 khi `tu` đang SÁT CUỐI bài ⇒ đoạn đuôi lẻ KHÔNG được bật bằng ngoại lệ 'chạm cuối'", () => {
    // Không có nhánh `tran <= 0`: `denThuc = tu = 18.5 ≥ 19 − 1` ⇒ coi như chạm cuối ⇒ bật đoạn đuôi mà không tốn ngân sách.
    const r = gopNhipXem({ bitmapCu: null, soDoan: 4, tuSec: 18.5, denSec: 19, contentSec: 19, tranDeltaGiay: 0 });
    expect(r.doanMoi).toBe(0);
    expect(r.giayMoi).toBe(0);
    expect(r.coveragePercent).toBe(0);
    expect(r.biCatTran).toBe(true);
  });

  it("ĐỐI CHỨNG: cùng khoảng nhưng còn ngân sách ⇒ đoạn đuôi được bật bình thường", () => {
    const r = gopNhipXem({ bitmapCu: null, soDoan: 4, tuSec: 18.5, denSec: 19, contentSec: 19, tranDeltaGiay: 5 });
    expect(r.doanMoi).toBe(1);
    expect(r.biCatTran).toBe(false);
  });

  it("khoảng VÔ LÝ (lùi) với trần 0 không bị báo là 'bị cắt' — chỉ khoảng hợp lệ mới tính là một lần cắt", () => {
    const r = gopNhipXem({ bitmapCu: null, soDoan: 120, tuSec: 50, denSec: 40, contentSec: 600, tranDeltaGiay: 0 });
    expect(r.biCatTran).toBe(false);
  });

  it("trần phân số (ngân sách còn 7.5 giây) cắt đúng theo ranh giới đoạn", () => {
    const r = gopNhipXem({ bitmapCu: null, soDoan: 120, tuSec: 0, denSec: 20, contentSec: 600, tranDeltaGiay: 7.5 });
    expect(r.biCatTran).toBe(true);
    expect(r.giayMoi).toBe(5); // floor(7.5 / 5) = 1 đoạn
  });
});
