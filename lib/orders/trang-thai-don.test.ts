// Ca [TTD-DON-*] — trạng thái đơn suy từ TIỀN, hai trục. Thuần.
//
// Thứ đang canh là một luật HIỂN THỊ về tiền, và nó có hai cách sai im lặng:
//   · nói QUÁ  — in "Đã đóng đủ" cho đơn còn nợ (đúng lỗi đang có ở 108/507 đơn thật);
//   · nuốt chênh lệch A/B — gộp "tiền đã về" với "kế toán đã đối soát" thành một câu, làm
//     mất tín hiệu duy nhất dùng để phát hiện webhook hỏng (49/507 đơn đang ở giữa hai câu).
// Không ca nào dưới đây đọc đồng hồ thật (luật 19).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { congNoDon } from "@/lib/finance/cong-no-don";
import {
  MA_TRANG_THAI_DON,
  TRANG_THAI_NGUOI_QUYET,
  trangThaiDon,
} from "./trang-thai-don";

/** Dựng bộ số qua ĐÚNG hàm thật `congNoDon` — không gõ tay `CongNoDon`. */
const so = (totalAmount: number, daGhiNhan: number, daXacNhan: number) =>
  congNoDon({ totalAmount, daGhiNhan, daXacNhan });

const tt = (status: string, tong: number, b: number, a: number) =>
  trangThaiDon({ status, so: so(tong, b, a) });

describe("[TTD-DON-01] TIỀN thắng `Order.status` — gốc của cả đợt vá", () => {
  it("đơn CONFIRMED mà chưa đóng đồng nào ⇒ 'Chưa đóng', KHÔNG phải 'đã chốt'", () => {
    // 43 đơn thật trên satarobo_local đang ở đúng ca này.
    const r = tt("CONFIRMED", 8_000_000, 0, 0);
    expect(r.ma).toBe(MA_TRANG_THAI_DON.CHUA_THU);
    expect(r.nhan).toBe("Chưa đóng");
    expect(r.conThieu).toBe(8_000_000);
    expect(r.doNguoiQuyet).toBe(false);
  });

  it("đơn COMPLETED mà mới đóng một phần ⇒ 'Đang đóng' + còn thiếu ĐÚNG số", () => {
    const r = tt("COMPLETED", 8_000_000, 3_000_000, 3_000_000);
    expect(r.ma).toBe(MA_TRANG_THAI_DON.DANG_THU);
    expect(r.conThieu).toBe(5_000_000);
  });

  it("ba giá trị status 'về tiền' cho ra CÙNG kết quả — chúng bị bỏ qua hoàn toàn", () => {
    const ket = ["PENDING_PAYMENT", "CONFIRMED", "COMPLETED"].map(
      (s) => tt(s, 8_000_000, 3_000_000, 0).ma,
    );
    expect(new Set(ket).size).toBe(1);
    expect(ket[0]).toBe(MA_TRANG_THAI_DON.DANG_THU);
  });

  it("status lạ / rỗng cũng chỉ đi theo tiền, không ném lỗi", () => {
    expect(tt("", 1_000_000, 1_000_000, 1_000_000).ma).toBe(
      MA_TRANG_THAI_DON.DA_DOI_SOAT,
    );
    expect(tt("MOT_GIA_TRI_MOI", 1_000_000, 0, 0).ma).toBe(MA_TRANG_THAI_DON.CHUA_THU);
  });
});

describe("[TTD-DON-02] HAI TRỤC — chênh lệch A/B không bị nuốt", () => {
  it("tiền về đủ mà kế toán chưa đối soát ⇒ DU_CHO_DOI_SOAT, nói ra ở nhãn phụ", () => {
    // 49/507 đơn thật đang ở ca này.
    const r = tt("CONFIRMED", 5_000_000, 5_000_000, 0);
    expect(r.ma).toBe(MA_TRANG_THAI_DON.DU_CHO_DOI_SOAT);
    expect(r.nhan).toBe("Đã đóng đủ");
    expect(r.nhanPhu).toBe("Chờ kế toán đối soát");
    expect(r.choDoiSoat).toBe(5_000_000);
    expect(r.conThieu).toBe(0);
  });

  it("kế toán đối soát xong ⇒ DA_DOI_SOAT, chênh về 0", () => {
    const r = tt("CONFIRMED", 5_000_000, 5_000_000, 5_000_000);
    expect(r.ma).toBe(MA_TRANG_THAI_DON.DA_DOI_SOAT);
    expect(r.nhanPhu).toBe("Kế toán đã đối soát");
    expect(r.choDoiSoat).toBe(0);
  });

  it("HAI MÃ PHẢI KHÁC NHAU — gộp chúng là xoá tín hiệu phát hiện webhook hỏng", () => {
    const chuaDoiSoat = tt("CONFIRMED", 5_000_000, 5_000_000, 0);
    const daDoiSoat = tt("CONFIRMED", 5_000_000, 5_000_000, 5_000_000);
    expect(chuaDoiSoat.ma).not.toBe(daDoiSoat.ma);
    expect(chuaDoiSoat.sacThai).not.toBe(daDoiSoat.sacThai);
  });

  it("đóng một phần mà phần đó chưa đối soát ⇒ vẫn DANG_THU, nhưng nhãn phụ nói ra", () => {
    const r = tt("CONFIRMED", 8_000_000, 3_000_000, 0);
    expect(r.ma).toBe(MA_TRANG_THAI_DON.DANG_THU);
    expect(r.nhanPhu).toBe("Có khoản chờ kế toán đối soát");
    expect(r.choDoiSoat).toBe(3_000_000);
  });

  it("đóng một phần và đã đối soát hết phần đó ⇒ không bịa nhãn phụ", () => {
    expect(tt("CONFIRMED", 8_000_000, 3_000_000, 3_000_000).nhanPhu).toBeNull();
  });
});

describe("[TTD-DON-03] quyết định của NGƯỜI thắng tiền — ngoại lệ có chủ đích", () => {
  it("HUỶ thắng, kể cả khi sổ còn khoản đã thu", () => {
    const r = tt("CANCELLED", 8_000_000, 8_000_000, 8_000_000);
    expect(r.ma).toBe(MA_TRANG_THAI_DON.HUY);
    expect(r.doNguoiQuyet).toBe(true);
    // Nhưng KHÔNG im lặng về số tiền đang nằm đó.
    expect(r.nhanPhu).toBe("Có khoản đã thu — kiểm tra hoàn tiền");
  });

  it("huỷ mà chưa thu gì thì không cảnh báo hoàn tiền", () => {
    expect(tt("CANCELLED", 8_000_000, 0, 0).nhanPhu).toBeNull();
  });

  it("HOÀN TIỀN và NHÁP đều là người quyết", () => {
    expect(tt("REFUNDED", 8_000_000, 8_000_000, 8_000_000).ma).toBe(
      MA_TRANG_THAI_DON.HOAN_TIEN,
    );
    expect(tt("DRAFT", 8_000_000, 0, 0).ma).toBe(MA_TRANG_THAI_DON.NHAP);
    for (const s of ["REFUNDED", "DRAFT"]) {
      expect(tt(s, 8_000_000, 0, 0).doNguoiQuyet).toBe(true);
    }
  });

  it("đơn NHÁP không được in như đang nợ", () => {
    // "Chưa đóng" trên một đơn nháp hàm ý khách đang nợ một thoả thuận chưa tồn tại.
    const r = tt("DRAFT", 8_000_000, 0, 0);
    expect(r.nhan).not.toBe("Chưa đóng");
    expect(r.nhanPhu).toContain("Chưa phải thoả thuận");
  });

  it("danh sách người-quyết ĐÚNG BA giá trị — thêm nữa là lặng lẽ tắt phép suy từ tiền", () => {
    expect([...TRANG_THAI_NGUOI_QUYET]).toEqual(["DRAFT", "CANCELLED", "REFUNDED"]);
    // Ba giá trị "về tiền" TUYỆT ĐỐI không được có mặt ở đây.
    for (const s of ["PENDING_PAYMENT", "CONFIRMED", "COMPLETED"]) {
      expect(TRANG_THAI_NGUOI_QUYET as readonly string[]).not.toContain(s);
    }
  });
});

describe("[TTD-DON-04] ca cần NGƯỜI XEM không được giấu dưới 'xong'", () => {
  it("THU VƯỢT thắng DA_DOI_SOAT dù `xong` cũng đúng", () => {
    const r = tt("CONFIRMED", 5_000_000, 6_000_000, 6_000_000);
    // `congNoDon` cho ca này: xong = true VÀ traVuot = 1.000.000. Nhánh THU_VUOT phải
    // đứng TRƯỚC, kẻo ca cần người xem bị nhãn "đã đối soát" giấu đi.
    expect(congNoDon({ totalAmount: 5_000_000, daGhiNhan: 6_000_000, daXacNhan: 6_000_000 }).xong).toBe(true);
    expect(r.ma).toBe(MA_TRANG_THAI_DON.THU_VUOT);
    expect(r.sacThai).toBe("canh-bao");
  });

  it("đơn 0đ KHÔNG phải 'đã đóng đủ'", () => {
    const r = tt("CONFIRMED", 0, 0, 0);
    expect(r.ma).toBe(MA_TRANG_THAI_DON.CHUA_CO_SO);
    expect(r.ma).not.toBe(MA_TRANG_THAI_DON.DA_DOI_SOAT);
  });

  it("đơn 0đ mà có tiền về ⇒ THU VƯỢT, vì đó là thứ cần xem ngay", () => {
    expect(tt("CONFIRMED", 0, 500_000, 0).ma).toBe(MA_TRANG_THAI_DON.THU_VUOT);
  });
});

describe("[TTD-DON-05] số trả ra luôn dùng được để in, không bao giờ âm/NaN", () => {
  it("conThieu và choDoiSoat không âm ở mọi tổ hợp", () => {
    const bo = [-1, 0, 1_000_000, 8_000_000, Number.NaN, Number.POSITIVE_INFINITY];
    for (const tong of bo)
      for (const b of bo)
        for (const a of bo) {
          const r = tt("CONFIRMED", tong, b, a);
          expect(r.conThieu, `${tong}/${b}/${a}`).toBeGreaterThanOrEqual(0);
          expect(r.choDoiSoat, `${tong}/${b}/${a}`).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(r.conThieu)).toBe(true);
          expect(Number.isFinite(r.choDoiSoat)).toBe(true);
          expect(typeof r.nhan).toBe("string");
          expect(r.nhan.length).toBeGreaterThan(0);
        }
  });

  it("mọi mã trả ra đều nằm trong bảng mã — không có chuỗi lạ", () => {
    const hopLe = new Set(Object.values(MA_TRANG_THAI_DON));
    for (const s of ["DRAFT", "PENDING_PAYMENT", "CONFIRMED", "COMPLETED", "CANCELLED", "REFUNDED", "?"])
      for (const [tong, b, a] of [
        [0, 0, 0],
        [8_000_000, 0, 0],
        [8_000_000, 3_000_000, 0],
        [8_000_000, 8_000_000, 0],
        [8_000_000, 8_000_000, 8_000_000],
        [5_000_000, 9_000_000, 9_000_000],
      ] as const) {
        expect(hopLe.has(tt(s, tong, b, a).ma)).toBe(true);
      }
  });
});

// ═══ [TTD-DON-06] GHIM HAI LỖ TIỀN CÒN SỐNG — chưa tới lượt vá ═══════════════
//
// Hai đường ĐỌC dưới đây vẫn suy tiền từ `Order.status`, và đó là chỗ con số sai chảy ra
// ngoài. Viết theo nếp `it.fails` của repo: hôm nay thân ca NÉM (nên CI không đỏ, không
// chặn merge của người khác); ngày ai đó vá thì ca chuyển XANH và vitest báo
// "expected to fail" ⇒ buộc người vá gỡ ghim. Đừng đổi sang `it.skip` — skip là quên,
// `it.fails` là hẹn.
//
// ⚠️ Đây là test ĐỌC MÃ NGUỒN, loại mong manh nhất (luật 11). Nên: neo chuỗi HẸP, KHÔNG
// dùng cờ `/s`, và BỎ CHÚ THÍCH trước khi soi — bài học vừa trả giá ở `[LOC-06]`: chú
// thích giải thích bản vá chứa đúng chuỗi đang cấm, nên lưới đỏ ngay trên bản đã vá.
describe("[TTD-DON-06] hai đường đọc còn suy tiền từ Order.status", () => {
  const boChuThich = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*/g, "$1");

  const docMa = (duongDan: string) =>
    boChuThich(readFileSync(resolve(process.cwd(), duongDan), "utf8"));

  // ✅ ĐÃ VÁ — gỡ ghim 18/09/2026 (lượt hợp nhất `main` → `test`). `main` chuyển
  // đường đọc doanh thu funnel sang sổ `Payment`; ghim `it.fails` lập tức báo
  // "Expect test to fail", đúng cơ chế mà chú thích ở trên mô tả. Nay là ca THẬT.
  it("doanh thu funnel KHÔNG được = Σ totalAmount của đơn CONFIRMED/COMPLETED", () => {
    // ĐO 16/09/2026 trên satarobo_local: 384 đơn CONFIRMED/COMPLETED có Σ totalAmount
    // 1.785.608.000đ, nhưng kế toán chỉ xác nhận 1.400.301.000đ ⇒ funnel khai thừa
    // 385.307.000đ. Tiền chưa về được báo là doanh thu.
    // Vá đúng = cộng từ sổ `Payment` (trục A), như `lib/reports/trung-tam.ts` đã làm.
    const ma = docMa("lib/crm/funnel-query.ts");
    expect(ma).not.toMatch(/status:\s*\{\s*in:\s*\["CONFIRMED",\s*"COMPLETED"\]\s*\}/);
  });

  it.fails("cron nhắc nợ KHÔNG được lọc cứng status PENDING_PAYMENT", () => {
    // ĐO 16/09/2026: 108 đơn còn nợ mà mang CONFIRMED (79) hoặc COMPLETED (29) ⇒ VÔ HÌNH
    // với cron. Cron chỉ thấy 123 đơn PENDING_PAYMENT. Đơn nợ nhiều nhất trong nhóm ẩn:
    // ORD-260915-000007 — còn thiếu 8.617.000đ mà nhãn là "Đã xác nhận đơn".
    // Vá đúng = lọc theo TIỀN (`congNoDon(...).conThieu > 0`), không theo nhãn.
    const ma = docMa("lib/finance/debt.ts");
    expect(ma).not.toMatch(/where:\s*\{\s*status:\s*"PENDING_PAYMENT"/);
  });

  it("bộ bỏ chú thích của ca này PHẢI thật sự bỏ được", () => {
    // Lưới-canh-lưới: nếu bộ lọc hỏng, hai ca `it.fails` trên có thể đổi kết quả vì bắt
    // được chuỗi trong chú thích thay vì trong mã. Kiểm cả hai kiểu chú thích.
    const mau = "alpha /* KHOI */ beta // DONG\ngamma";
    const sach = boChuThich(mau);
    expect(sach).not.toContain("KHOI");
    expect(sach).not.toContain("DONG");
    expect(sach).toContain("alpha");
    expect(sach).toContain("gamma");
  });
});

// ═══ [TTD-DON-07] LƯỚI GHIM: HAI MÀN PHẢI NÓI CÙNG MỘT NHÃN ══════════════════
//
// Ca này sinh ra từ một lỗi TÔI TỰ TẠO trong phiên: nối badge ở trang chi tiết trước, để
// danh sách nguyên nhãn cũ ⇒ CÙNG MỘT ĐƠN mang hai nhãn khác nhau ở hai màn. Đo lúc đó:
// lọc "Đã xác nhận đơn" ra 81 đơn mà 0/81 đơn nào còn mang nhãn đó ở trang chi tiết.
//
// Không có lưới thì lần sau ai sửa một màn sẽ lại mở ra đúng khoảng lệch ấy, và nó KHÔNG
// làm test nào đỏ, không ném lỗi, console sạch — chỉ người dùng đối chiếu hai màn mới thấy.
//
// Luật 11: neo HẸP, KHÔNG cờ `/s`, BỎ CHÚ THÍCH trước khi soi. Đã cấy lại để thấy đỏ.
describe("[TTD-DON-07] badge ở DANH SÁCH và CHI TIẾT cùng một nguồn", () => {
  const boChuThich = (x: string) =>
    x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*/g, "$1");
  const doc = (p: string) =>
    boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

  const DS = doc("app/(admin)/admin/orders/_components/orders-list-client.tsx");
  const CT = doc("app/(admin)/admin/orders/_components/order-detail-client.tsx");

  it("bộ bỏ chú thích thật sự bỏ được (lưới-canh-lưới)", () => {
    const mau = "a /* K */ b // D\nc";
    expect(boChuThich(mau)).not.toContain("K");
    expect(boChuThich(mau)).not.toContain("D");
  });

  it("DANH SÁCH in nhãn suy từ tiền, KHÔNG in ORDER_STATUS_LABEL cho badge", () => {
    expect(DS).toMatch(/\{o\.trangThai\.nhan\}/);
    // Bảng nhãn cũ vẫn được phép tồn tại cho Ô LỌC (nó lọc `Order.status` thật), nhưng
    // KHÔNG được quay lại làm badge của dòng.
    expect(DS).not.toMatch(/<Badge className=\{STATUS_BADGE_CLASS\[o\.status\]\}>/);
  });

  it("CHI TIẾT in nhãn suy từ tiền ở đầu trang", () => {
    expect(CT).toMatch(/\{ttDon\.nhan\}/);
    expect(CT).toMatch(/trangThaiDon\(\{ status: order\.status, so: congNo \}\)/);
  });

  it("cả hai màn đọc sắc thái từ CÙNG một khoá ngữ nghĩa", () => {
    expect(DS).toMatch(/SAC_THAI_CLASS\[o\.trangThai\.sacThai\]/);
    expect(CT).toMatch(/SAC_THAI_CLASS\[ttDon\.sacThai\]/);
  });

  it("DANH SÁCH nhận nhãn từ SERVER, không tự suy lại", () => {
    // `queryOrders` tính sẵn (nó có số tiền); client gọi lại `trangThaiDon` là hai chỗ
    // quyết định cùng một nhãn.
    expect(DS).not.toMatch(/trangThaiDon\(/);
    const ACT = doc("app/(admin)/admin/orders/_actions.ts");
    expect(ACT.match(/trangThaiDon\(\{ status: o\.status, so \}\)/g)?.length).toBe(1);
    expect(ACT).toMatch(/haiTrucTheoDon\(sdb, rawItems\.map\(\(o\) => o\.id\)\)/);
  });
});
