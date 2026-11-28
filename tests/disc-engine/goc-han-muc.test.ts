// PORT từ repo hodacphuchtc/DISC · tests/han-muc.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import { GIOI_HAN_BAI_MOI_NGUOI, GIOI_HAN_THU_MUC } from "@/lib/disc/engine-goc/config/disc-gia-dinh";
import {
  chonBaiPhaiXoa,
  chonThuMucPhaiXoa,
  daChamTran,
} from "@/lib/disc/engine-goc/modules/core/gia-dinh/han-muc";

/**
 * 🔴 HÀM THUẦN, KHÔNG CẦN TRÌNH DUYỆT — và đó là chủ ý của cả thiết kế.
 *
 * Việc "cái gì phải mất" là quyết định đắt nhất trong sản phẩm này: sai một lần là mất
 * bài của một đứa trẻ, không lấy lại được. Tách nó thành hàm thuần nghĩa là nó kiểm được
 * cạn kiệt, không phụ thuộc IndexedDB, không phụ thuộc thứ tự bất đồng bộ.
 *
 * Và quan trọng hơn: hàm này KHÔNG XOÁ GÌ. Nó chỉ trả danh sách để đem hỏi người dùng.
 */

const bai = (id: string, ketThuc: string) => ({ id, ketThuc });

describe("chonBaiPhaiXoa — ai phải đi", () => {
  it("chưa đầy thì KHÔNG ai phải đi", () => {
    expect(chonBaiPhaiXoa([])).toEqual([]);
    expect(chonBaiPhaiXoa([bai("a", "2026-03-01T00:00:00Z")])).toEqual([]);
  });

  it("🔴 đã có 2 bài, thêm bài thứ 3 ⇒ bài CŨ NHẤT phải đi, đúng một bài", () => {
    const ds = [
      bai("cu", "2026-01-01T00:00:00Z"),
      bai("moi", "2026-06-01T00:00:00Z"),
    ];
    expect(chonBaiPhaiXoa(ds).map((b) => b.id)).toEqual(["cu"]);
  });

  it("có 4 bài (dữ liệu cũ trước khi có hạn mức) ⇒ giữ 1 mới nhất, chừa chỗ cho bài mới", () => {
    const ds = [
      bai("a", "2026-01-01T00:00:00Z"),
      bai("b", "2026-02-01T00:00:00Z"),
      bai("c", "2026-03-01T00:00:00Z"),
      bai("d", "2026-04-01T00:00:00Z"),
    ];
    expect(chonBaiPhaiXoa(ds).map((b) => b.id)).toEqual(["c", "b", "a"]);
  });

  it("hỏi 'hiện đang thừa cái gì' (không thêm bài nào) ⇒ giữ đủ 2", () => {
    const ds = [
      bai("a", "2026-01-01T00:00:00Z"),
      bai("b", "2026-02-01T00:00:00Z"),
      bai("c", "2026-03-01T00:00:00Z"),
    ];
    expect(chonBaiPhaiXoa(ds, GIOI_HAN_BAI_MOI_NGUOI, 0).map((b) => b.id)).toEqual(["a"]);
  });

  it("🔴 hai bài CÙNG thời điểm vẫn cho ra kết quả CỐ ĐỊNH, không ngẫu nhiên", () => {
    // Hộp thoại nêu đích danh bài sắp mất. Nếu thứ tự phụ thuộc vào kho trả về thế nào
    // thì cùng một máy, hai lần bấm, có thể mất hai bài khác nhau.
    const luc = "2026-03-01T00:00:00Z";
    const xuoi = [bai("a", luc), bai("b", luc), bai("c", luc)];
    const nguoc = [bai("c", luc), bai("b", luc), bai("a", luc)];
    expect(chonBaiPhaiXoa(xuoi).map((b) => b.id)).toEqual(chonBaiPhaiXoa(nguoc).map((b) => b.id));
  });

  it("KHÔNG đụng vào mảng gốc — nơi gọi còn dùng nó để hiển thị", () => {
    const ds = [bai("a", "2026-01-01T00:00:00Z"), bai("b", "2026-02-01T00:00:00Z")];
    const ban = [...ds];
    chonBaiPhaiXoa(ds);
    expect(ds).toEqual(ban);
  });

  it("giới hạn 0 hoặc âm ⇒ trả về tất cả, không im lặng bỏ qua", () => {
    const ds = [bai("a", "2026-01-01T00:00:00Z")];
    expect(chonBaiPhaiXoa(ds, 0)).toHaveLength(1);
    expect(chonBaiPhaiXoa(ds, -1)).toHaveLength(1);
  });
});

describe("chonThuMucPhaiXoa — cùng luật cho thư mục phân tích", () => {
  const tm = (id: string, taoLuc: string) => ({ id, taoLuc });

  it("dưới trần thì không ai phải đi", () => {
    expect(chonThuMucPhaiXoa([tm("a", "2026-01-01T00:00:00Z")])).toEqual([]);
  });

  it("đủ 5 rồi thêm cái thứ 6 ⇒ cái cũ nhất đi", () => {
    const ds = Array.from({ length: GIOI_HAN_THU_MUC }, (_, i) =>
      tm(`t${i}`, `2026-0${i + 1}-01T00:00:00Z`),
    );
    expect(chonThuMucPhaiXoa(ds).map((t) => t.id)).toEqual(["t0"]);
  });
});

describe("daChamTran", () => {
  it("dưới trần thì chưa chạm, đúng trần thì chạm", () => {
    expect(daChamTran(0)).toBe(false);
    expect(daChamTran(GIOI_HAN_BAI_MOI_NGUOI - 1)).toBe(false);
    expect(daChamTran(GIOI_HAN_BAI_MOI_NGUOI)).toBe(true);
    expect(daChamTran(GIOI_HAN_BAI_MOI_NGUOI + 1)).toBe(true);
  });
});

describe("🔴 hằng số nghiệp vụ đọc từ config, không gõ cứng", () => {
  it("giới hạn bài mỗi người là 2, và nó đến từ config", () => {
    expect(GIOI_HAN_BAI_MOI_NGUOI).toBe(2);
    // Gọi không truyền giới hạn phải cho ra CÙNG kết quả với gọi truyền hằng của config —
    // nếu ai đó gõ cứng một con số khác vào mặc định, cửa này đỏ.
    const ds = [
      bai("a", "2026-01-01T00:00:00Z"),
      bai("b", "2026-02-01T00:00:00Z"),
      bai("c", "2026-03-01T00:00:00Z"),
    ];
    expect(chonBaiPhaiXoa(ds)).toEqual(chonBaiPhaiXoa(ds, GIOI_HAN_BAI_MOI_NGUOI));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   14.5 — HẠN MỨC THƯ MỤC PHÂN TÍCH
   ──────────────────────────────────────────────────────────────────────────── */

describe("🔴 14.5 — hạn mức 5 thư mục phân tích", () => {
  const tm = (id: string, taoLuc: string) => ({ id, taoLuc });

  /** Năm lần chạy, cũ nhất trước. */
  const NAM_LAN = [
    tm("t1", "2026-01-01T00:00:00Z"),
    tm("t2", "2026-02-01T00:00:00Z"),
    tm("t3", "2026-03-01T00:00:00Z"),
    tm("t4", "2026-04-01T00:00:00Z"),
    tm("t5", "2026-05-01T00:00:00Z"),
  ];

  it("bốn lần chạy ⇒ lần thứ năm KHÔNG làm mất gì", () => {
    expect(chonThuMucPhaiXoa(NAM_LAN.slice(0, 4))).toEqual([]);
  });

  it("🔴 đủ 5 lần ⇒ lần thứ 6 làm mất ĐÚNG lần cũ nhất", () => {
    expect(chonThuMucPhaiXoa(NAM_LAN).map((t) => t.id)).toEqual(["t1"]);
  });

  it("dữ liệu cũ có 8 thư mục ⇒ dọn về đúng 4, chừa chỗ cho lần mới", () => {
    const tam = [
      ...NAM_LAN,
      tm("t6", "2026-06-01T00:00:00Z"),
      tm("t7", "2026-07-01T00:00:00Z"),
      tm("t8", "2026-08-01T00:00:00Z"),
    ];
    const xoa = chonThuMucPhaiXoa(tam);
    expect(tam.length - xoa.length).toBe(GIOI_HAN_THU_MUC - 1);
    expect(xoa.map((t) => t.id)).toEqual(["t4", "t3", "t2", "t1"]);
  });

  it("🔴 hai lần chạy CÙNG thời điểm vẫn cho kết quả cố định", () => {
    const luc = "2026-03-01T00:00:00Z";
    const xuoi = [tm("a", luc), tm("b", luc), tm("c", luc), tm("d", luc), tm("e", luc)];
    const nguoc = [...xuoi].reverse();
    expect(chonThuMucPhaiXoa(xuoi).map((t) => t.id)).toEqual(
      chonThuMucPhaiXoa(nguoc).map((t) => t.id),
    );
  });

  it("giới hạn thư mục đọc từ config, không gõ cứng", () => {
    expect(GIOI_HAN_THU_MUC).toBe(5);
    expect(chonThuMucPhaiXoa(NAM_LAN)).toEqual(chonThuMucPhaiXoa(NAM_LAN, GIOI_HAN_THU_MUC));
  });

  it("KHÔNG đụng vào mảng gốc", () => {
    const ban = [...NAM_LAN];
    chonThuMucPhaiXoa(NAM_LAN);
    expect(NAM_LAN).toEqual(ban);
  });
});
