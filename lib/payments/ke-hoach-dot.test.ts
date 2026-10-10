// lib/payments/ke-hoach-dot.test.ts — THANH TOÁN LINH HOẠT: 1/2/3/4 đợt thay cho "2 đợt".
//
// Chủ dự án chốt: "ở phần kế hoạch thanh toán 2 đợt thì bây giờ phải chuyển thành thanh
// toán theo các chính sách và công văn mới nhất: đóng theo 1, 2, 3, 4 học phần".
//
// ⚠️ ĐO TRÊN CÔNG VĂN — mô hình "đóng theo học phần" là CHÍNH SÁCH MỚI, không phải thi
// hành công văn, và điều đó phải nói ra vì chủ dự án yêu cầu "mọi chính sách dựa theo
// công văn":
//   · SR.QD.219 Điều 2: "đóng toàn bộ một lần hoặc đóng theo THÁNG (chia đều 12 tháng)"
//     cho khoá 48 buổi Nhóm 2.
//   · SR.QD.223 (Bậc thang chốt): "đóng theo đợt (có thể 2 ĐỢT CÁCH 30 NGÀY)".
//   · Học phần chỉ là mốc HỌC: Điều 4 ghi chú 1 (48 buổi = 4 học phần × 12 buổi),
//     Điều 7 (cuối mỗi 12 buổi tổ chức thuyết trình dự án).
// Thứ CÓ văn bản là "cách 30 ngày" và "trần 12 kỳ" — nên bước hạn 30 ngày và trần 12
// là bám văn bản, còn con số 4 là chính sách của chủ dự án (mặc định, chỉnh được).
//
// ⚠️ PHẦN LẺ: đo bảng giá thật — cả 5 khoá Sata3-7 chia 1/2/3/4 đều CHẴN TUYỆT ĐỐI
// (mọi giá niêm yết = 48 × giá/buổi, giá/buổi là bội 10.000 nên chia hết cho mọi ước của
// 48). Phần lẻ CÓ THẬT nhưng đến từ chỗ khác: Sata2 3.040.000÷3, Sata8 2.500.000÷3, và
// quan trọng hơn — mọi đơn có `totalAmount ≠ giá niêm yết` (giảm giá kiểu SỐ TIỀN,
// voucher, đơn nhiều học viên). Nên luật dồn lẻ vẫn phải có, chỉ là vì giảm giá chứ
// không vì bảng giá.
import { describe, it, expect } from "vitest";
import {
  chiaDotHocPhi,
  hanChoDot,
  kiemKeHoachDot,
  chenCoc,
  phanBoGhiTheoDot,
  TRAN_SO_DOT,
  chiaDotGiuDotDaKhoa,
  dotsGhiTuForm,
} from "./ke-hoach-dot";

describe("[KH-01] chia tiền theo số đợt — tổng LUÔN bằng tổng đơn", () => {
  it("1 đợt = trả một lần", () => {
    expect(chiaDotHocPhi(10_560_000, 1)).toEqual([10_560_000]);
  });

  it("khoá Sata3 (10.560.000) chia 2/3/4 đều CHẴN — số đo thật từ bảng giá", () => {
    expect(chiaDotHocPhi(10_560_000, 2)).toEqual([5_280_000, 5_280_000]);
    expect(chiaDotHocPhi(10_560_000, 3)).toEqual([3_520_000, 3_520_000, 3_520_000]);
    expect(chiaDotHocPhi(10_560_000, 4)).toEqual([2_640_000, 2_640_000, 2_640_000, 2_640_000]);
  });

  it("có phần lẻ → DỒN VÀO ĐỢT CUỐI, các đợt đầu tròn số", () => {
    // Sata3 giảm 500.000 rồi chia 3 — ca lẻ THẬT (giảm giá kiểu số tiền).
    const r = chiaDotHocPhi(10_060_000, 3);
    expect(r).toEqual([3_353_333, 3_353_333, 3_353_334]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(10_060_000);
  });

  it("bất biến tiền: tổng các đợt === tổng đơn, với mọi số đợt", () => {
    for (const tong of [2_500_000, 3_040_000, 10_060_000, 9_999_999, 1]) {
      for (const n of [1, 2, 3, 4, 12]) {
        const r = chiaDotHocPhi(tong, n);
        expect(r.reduce((a, b) => a + b, 0), `${tong} chia ${n}`).toBe(tong);
        expect(r.length).toBe(n);
        expect(r.every((x) => x >= 0)).toBe(true);
      }
    }
  });

  it("TỈ LỆ tuỳ chỉnh (đợt đầu đóng nhiều hơn) vẫn giữ bất biến tổng", () => {
    const r = chiaDotHocPhi(10_000_000, 3, [50, 25, 25]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(10_000_000);
    expect(r[0]).toBeGreaterThan(r[1]!);
  });

  it("ca biên: tổng 0 / số đợt 0 hoặc âm / không hữu hạn → không ném, không số âm", () => {
    expect(chiaDotHocPhi(0, 4)).toEqual([0, 0, 0, 0]);
    expect(chiaDotHocPhi(1_000_000, 0)).toEqual([]);
    expect(chiaDotHocPhi(1_000_000, -3)).toEqual([]);
    expect(chiaDotHocPhi(Number.NaN, 2)).toEqual([0, 0]);
  });
});

describe("[KH-02] hạn từng đợt — bám 'cách 30 ngày' của SR.QD.223", () => {
  const moc = new Date("2026-09-14T00:00:00.000Z");

  it("đợt 1 đến hạn NGAY ngày lập, các đợt sau cách đều 30 ngày", () => {
    const h = hanChoDot(moc, 4);
    expect(h[0]!.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(h[1]!.toISOString().slice(0, 10)).toBe("2026-10-14");
    expect(h[2]!.toISOString().slice(0, 10)).toBe("2026-11-13");
    expect(h[3]!.toISOString().slice(0, 10)).toBe("2026-12-13");
  });

  it("bước ngày cấu hình được (theo tháng = 30, theo học phần có thể dài hơn)", () => {
    const h = hanChoDot(moc, 2, 45);
    expect(h[1]!.toISOString().slice(0, 10)).toBe("2026-10-29");
  });

  it("KHÔNG đọc đồng hồ thật — mốc luôn phải truyền vào", () => {
    // Luật 19: test đọc `new Date()` là bom hẹn giờ. Hàm bắt buộc nhận mốc.
    expect(hanChoDot(moc, 1)).toHaveLength(1);
  });
});

describe("[KH-03] kiểm kế hoạch trước khi ghi", () => {
  const dot = (amount: number, daThu: boolean, dueDate: Date | null = new Date("2026-10-14")) => ({
    amount,
    daThu,
    dueDate,
  });

  it("tổng các đợt phải BẰNG tổng đơn", () => {
    const r = kiemKeHoachDot([dot(5_000_000, true, null), dot(4_000_000, false)], 10_000_000);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("10.000.000");
  });

  it("đợt CHƯA thu bắt buộc có hạn — không hạn thì cron không nhắc được ai", () => {
    const r = kiemKeHoachDot([dot(5_000_000, true, null), dot(5_000_000, false, null)], 10_000_000);
    expect(r.ok).toBe(false);
    // Thông báo nói "ngày hẹn đóng" chứ không nói "hạn" — giữ nguyên chữ của thông báo
    // vì đó là chữ người dùng đọc; test bám theo thông báo, không bắt thông báo bám test.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("ngày hẹn đóng");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Đợt 2");
  });

  it("đợt ĐÃ thu KHÔNG cần hạn", () => {
    expect(kiemKeHoachDot([dot(10_000_000, true, null)], 10_000_000).ok).toBe(true);
  });

  it("kế hoạch hợp lệ 4 đợt", () => {
    const d = [
      dot(2_640_000, true, null),
      dot(2_640_000, false),
      dot(2_640_000, false),
      dot(2_640_000, false),
    ];
    expect(kiemKeHoachDot(d, 10_560_000).ok).toBe(true);
  });

  it("KHÔNG đợt nào → từ chối (đơn phải có ít nhất một đợt)", () => {
    expect(kiemKeHoachDot([], 10_000_000).ok).toBe(false);
  });

  it("vượt trần số đợt → từ chối", () => {
    const d = Array.from({ length: TRAN_SO_DOT + 1 }, () => dot(1, false));
    expect(kiemKeHoachDot(d, TRAN_SO_DOT + 1).ok).toBe(false);
  });

  it("đợt âm → từ chối", () => {
    const r = kiemKeHoachDot([dot(-1, false), dot(10_000_001, false)], 10_000_000);
    expect(r.ok).toBe(false);
  });

  it("kế hoạch 100% TRẢ SAU (không đợt nào đã thu) là HỢP LỆ — sale cấp tín dụng", () => {
    // ⚠️ Ca này cố ý hợp lệ, và cố ý được nêu tên: trước đây nó bị cơ chế duyệt chặn.
    // Điều kiện dùng cổng tiền phải là `some(!daThu)`, KHÔNG phải đếm số đợt — kế hoạch
    // 1 đợt trả sau vẫn là 100% nợ, đếm đợt thì nó lọt.
    const r = kiemKeHoachDot([dot(10_000_000, false)], 10_000_000);
    expect(r.ok).toBe(true);
    expect(r.coDotChuaThu).toBe(true);
  });
});

describe("[KH-04] phân phần chênh Ledger-A cho TỪNG marker đợt", () => {
  it("chưa có khoản nào → mỗi đợt đã thu ghi đúng số của nó", () => {
    expect(phanBoGhiTheoDot([3_000_000, 2_000_000], 0)).toEqual([3_000_000, 2_000_000]);
  });

  it("đã có đủ tiền trong sổ (tiền cổng/backfill) → KHÔNG ghi thêm đồng nào", () => {
    // Đây là R-01: ghi lại nguyên số là cộng đôi với tiền khách đã chuyển qua cổng.
    expect(phanBoGhiTheoDot([3_000_000, 2_000_000], 5_000_000)).toEqual([0, 0]);
  });

  it("đã có MỘT PHẦN → chỉ ghi phần còn thiếu, đổ vào đợt ĐẦU trước", () => {
    expect(phanBoGhiTheoDot([3_000_000, 2_000_000], 4_000_000)).toEqual([1_000_000, 0]);
  });

  it("phần thiếu lớn hơn đợt đầu → tràn sang đợt sau, mỗi đợt KHÔNG vượt số của nó", () => {
    expect(phanBoGhiTheoDot([3_000_000, 2_000_000], 1_000_000)).toEqual([3_000_000, 1_000_000]);
  });

  it("sổ có NHIỀU hơn kế hoạch → không ra số âm", () => {
    expect(phanBoGhiTheoDot([1_000_000], 9_000_000)).toEqual([0]);
  });

  it("không đợt nào đã thu → mảng rỗng", () => {
    expect(phanBoGhiTheoDot([], 0)).toEqual([]);
  });

  it("bất biến: Σ phần ghi thêm === max(0, Σ đợt đã thu − đã có trong sổ)", () => {
    for (const daCo of [0, 1, 999_999, 4_000_000, 5_000_000, 9_000_000]) {
      const r = phanBoGhiTheoDot([3_000_000, 2_000_000], daCo);
      expect(r.reduce((a, b) => a + b, 0), `daCo=${daCo}`).toBe(
        Math.max(0, 5_000_000 - daCo),
      );
    }
  });

  it("số không hữu hạn → coi như 0", () => {
    expect(phanBoGhiTheoDot([Number.NaN, 2_000_000], Number.NaN)).toEqual([0, 2_000_000]);
  });
});

describe("[KH-05] TIỀN CỌC — trừ vào đợt 1, sinh phiếu riêng để quét QR trước", () => {
  // Chủ dự án chốt 14/09/2026: "có 1 ô tích cọc tiền, nếu tích vào thì điền cọc bao
  // nhiêu, số tiền đó sẽ được sinh mã QR trước để KH thanh toán, và sau khi KH cọc thì
  // lần sau thanh toán sẽ được trừ cọc trên số tiền khoá học, và cọc trừ vào đợt 1
  // (tuỳ theo KH chọn đóng bao nhiêu học phần)."
  //
  // ⚠️ BẤT BIẾN KHÔNG ĐƯỢC PHÁ: Σ (cọc + các đợt) === tổng đơn. Cọc KHÔNG phải khoản
  // thu thêm — nó là phần ĐẦU của học phí, đóng sớm. Cộng cọc vào ngoài tổng là đòi
  // khách trả nhiều hơn giá khoá.

  it("cọc 1tr + 1 đợt: đợt 1 còn lại đúng phần trừ cọc", () => {
    const r = chenCoc(chiaDotHocPhi(10_000_000, 1), 1_000_000);
    expect(r.map((d) => d.amount)).toEqual([1_000_000, 9_000_000]);
    expect(r[0]!.laCoc).toBe(true);
    expect(r[1]!.laCoc).toBe(false);
  });

  it("cọc 1tr + 2 đợt (mỗi đợt 2 học phần): cọc trừ vào ĐỢT 1, đợt 2 giữ nguyên", () => {
    const r = chenCoc(chiaDotHocPhi(10_560_000, 2), 1_000_000);
    expect(r.map((d) => d.amount)).toEqual([1_000_000, 4_280_000, 5_280_000]);
  });

  it("cọc 1tr + 4 đợt: chỉ đợt 1 bị trừ, ba đợt sau nguyên", () => {
    const r = chenCoc(chiaDotHocPhi(10_560_000, 4), 1_000_000);
    expect(r.map((d) => d.amount)).toEqual([1_000_000, 1_640_000, 2_640_000, 2_640_000, 2_640_000]);
  });

  it("BẤT BIẾN: tổng luôn bằng tổng đơn, với mọi số đợt và mọi mức cọc", () => {
    for (const tong of [10_560_000, 2_500_000, 9_999_999]) {
      for (const n of [1, 2, 3, 4]) {
        for (const coc of [0, 1, 500_000, 1_000_000, tong - 1, tong]) {
          const r = chenCoc(chiaDotHocPhi(tong, n), coc);
          expect(r.reduce((s, d) => s + d.amount, 0), `${tong}/${n} đợt/cọc ${coc}`).toBe(tong);
        }
      }
    }
  });

  it("cọc LỚN HƠN đợt 1 → tràn sang đợt sau, không để đợt nào âm", () => {
    // Khách cọc 5tr trong khi đợt 1 chỉ 2,64tr.
    const r = chenCoc(chiaDotHocPhi(10_560_000, 4), 5_000_000);
    expect(r.map((d) => d.amount)).toEqual([5_000_000, 0, 280_000, 2_640_000, 2_640_000]);
    expect(r.every((d) => d.amount >= 0)).toBe(true);
  });

  it("cọc bằng CẢ ĐƠN → mọi đợt về 0, tổng vẫn đúng", () => {
    const r = chenCoc(chiaDotHocPhi(10_000_000, 2), 10_000_000);
    expect(r.map((d) => d.amount)).toEqual([10_000_000, 0, 0]);
  });

  it("cọc 0 hoặc âm hoặc không hữu hạn → KHÔNG chèn phiếu cọc nào", () => {
    const goc = chiaDotHocPhi(10_000_000, 2);
    expect(chenCoc(goc, 0).some((d) => d.laCoc)).toBe(false);
    expect(chenCoc(goc, -5).some((d) => d.laCoc)).toBe(false);
    expect(chenCoc(goc, Number.NaN).some((d) => d.laCoc)).toBe(false);
    expect(chenCoc(goc, 0).map((d) => d.amount)).toEqual(goc);
  });

  it("cọc VƯỢT tổng đơn → kẹp về tổng đơn, không tạo tiền từ không khí", () => {
    const r = chenCoc(chiaDotHocPhi(10_000_000, 2), 99_000_000);
    expect(r.reduce((s, d) => s + d.amount, 0)).toBe(10_000_000);
    expect(r[0]!.amount).toBe(10_000_000);
  });
});

/**
 * CHIA LẠI KHI ĐÃ CÓ ĐỢT THU TIỀN (15/09/2026).
 *
 * Chủ dự án: *"khoá phần đã thu lại, chỉ cho sửa các đợt sau đó với số tiền còn thiếu
 * chưa thanh toán."* Bất biến quan trọng nhất vẫn là Σ === tổng đơn: một đồng lệch ở đây
 * là một đồng lệch giữa số phải thu của đơn và tổng phiếu thu, và nó không tự lộ ra ở
 * màn nào.
 */
describe("[KHOA] chiaDotGiuDotDaKhoa — giữ đợt đã thu, chia phần còn thiếu", () => {
  it("[KHOA-01] giữ nguyên đợt đã khoá, chia đều phần còn lại, Σ vẫn bằng tổng đơn", () => {
    // Đơn 10tr, đợt 1 đã thu 6tr ⇒ còn 4tr chia cho 2 đợt sau.
    const r = chiaDotGiuDotDaKhoa(10_000_000, [6_000_000], 2);
    expect(r).toEqual([6_000_000, 2_000_000, 2_000_000]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(10_000_000);
  });

  it("[KHOA-02] nhiều đợt đã khoá", () => {
    const r = chiaDotGiuDotDaKhoa(10_000_000, [6_000_000, 1_000_000], 1);
    expect(r).toEqual([6_000_000, 1_000_000, 3_000_000]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(10_000_000);
  });

  it("[KHOA-03] phần lẻ dồn vào đợt CUỐI, không dồn vào đợt đã khoá", () => {
    // Đợt đã khoá là tiền THẬT đã nhận — cộng một đồng lẻ vào đó là sửa số đã thu.
    const r = chiaDotGiuDotDaKhoa(10_000_001, [6_000_000], 3);
    expect(r[0]).toBe(6_000_000);
    expect(r.reduce((a, b) => a + b, 0)).toBe(10_000_001);
    expect(r[3]).toBe(1_333_335);
  });

  it("[KHOA-04] Σ đã khoá VƯỢT tổng đơn ⇒ đợt sau nhận 0, KHÔNG nhận số ÂM", () => {
    // Ca thật: giảm giá sau khi đã thu, hoặc khách đóng thừa. Một phiếu thu ÂM không
    // tồn tại trong nghiệp vụ; trả 0 để người bán thấy là không còn gì để chia.
    const r = chiaDotGiuDotDaKhoa(5_000_000, [6_000_000], 2);
    expect(r).toEqual([6_000_000, 0, 0]);
    expect(r.every((n) => n >= 0)).toBe(true);
  });

  it("[KHOA-05] không còn đợt nào sau ⇒ trả đúng phần đã khoá", () => {
    expect(chiaDotGiuDotDaKhoa(10_000_000, [6_000_000, 4_000_000], 0)).toEqual([
      6_000_000, 4_000_000,
    ]);
  });

  it("[KHOA-06] không có đợt nào khoá ⇒ hành vi TRÙNG chiaDotHocPhi", () => {
    // Nếu hai hàm lệch nhau ở ca này thì màn hình sẽ nhảy số vào đúng lúc đợt đầu
    // được thu tiền — thời điểm khó soi nhất.
    expect(chiaDotGiuDotDaKhoa(10_000_000, [], 3)).toEqual(chiaDotHocPhi(10_000_000, 3));
  });

  it("[KHOA-07] đầu vào rác không sinh số âm cũng không ném", () => {
    expect(chiaDotGiuDotDaKhoa(Number.NaN, [1_000], 2)).toEqual([1_000, 0, 0]);
    expect(chiaDotGiuDotDaKhoa(1_000, [Number.NaN], 1)).toEqual([0, 1_000]);
    expect(chiaDotGiuDotDaKhoa(1_000, [-5], 1)).toEqual([0, 1_000]);
  });
});

// ═══ BIÊN FORM → BẢN GHI ═══════════════════════════════════════════════════════
//
// Từ 15/09/2026 có HAI đường ghi kế hoạch: `recordOrderInstallmentsAction` (đơn đã có) và
// `createOrderManualAction` (kế hoạch lập ngay lúc tạo đơn). Phép quy đổi ngày + cờ đã-thu
// vì thế phải là MỘT — hai bản là hai cách ghi lệch sổ, và cả hai đều im lặng.
describe("[GTF-01] Invalid Date → null, KHÔNG đi tiếp vào DB", () => {
  it("chuỗi ngày rác quy về null để `kiemKeHoachDot` từ chối cho ra tiếng", () => {
    for (const xau of ["hôm nay", "20/01/2026", "2026-13-45", "  "]) {
      expect(dotsGhiTuForm([{ amount: 100, daThu: false, dueDate: xau }])[0]!.dueDate).toBeNull();
    }
  });

  it("ngày đúng khuôn giữ nguyên (yyyy-mm-dd đọc là nửa đêm UTC)", () => {
    const ra = dotsGhiTuForm([{ amount: 100, daThu: false, dueDate: "2026-01-20" }]);
    expect(ra[0]!.dueDate?.toISOString()).toBe("2026-01-20T00:00:00.000Z");
  });

  it("null / thiếu hẳn → null", () => {
    expect(dotsGhiTuForm([{ amount: 100, daThu: false, dueDate: null }])[0]!.dueDate).toBeNull();
    expect(dotsGhiTuForm([{ amount: 100, daThu: false }])[0]!.dueDate).toBeNull();
  });
});

describe("[GTF-02] `daThu` so TUYỆT ĐỐI — cờ này quyết định có ghi Ledger-A hay không", () => {
  it("chỉ `true` mới là đã thu", () => {
    expect(dotsGhiTuForm([{ amount: 1, daThu: true, dueDate: null }])[0]!.daThu).toBe(true);
    expect(dotsGhiTuForm([{ amount: 1, daThu: false, dueDate: null }])[0]!.daThu).toBe(false);
  });

  it("giá trị truthy KHÁC true KHÔNG thành 'đã thu'", () => {
    for (const xau of ["true", 1, {}, []] as unknown[]) {
      const ra = dotsGhiTuForm([
        { amount: 1, daThu: xau as boolean, dueDate: "2026-01-20" },
      ]);
      expect(ra[0]!.daThu, `daThu=${JSON.stringify(xau)}`).toBe(false);
    }
  });
});

describe("[GTF-03] đợt ĐÃ THU thì KHÔNG mang hạn và KHÔNG mang số ngày nhắc", () => {
  it("hạn bị bỏ dù client có gửi — nhắc nợ trên tiền đã nằm trong két là nhắc bậy", () => {
    const ra = dotsGhiTuForm([
      { amount: 5_000_000, daThu: true, dueDate: "2026-02-19", reminderDays: 7 },
    ]);
    expect(ra[0]!.dueDate).toBeNull();
    expect(ra[0]!.reminderDays).toBeNull();
  });

  it("đợt CHƯA thu thì giữ cả hai", () => {
    const ra = dotsGhiTuForm([
      { amount: 5_000_000, daThu: false, dueDate: "2026-02-19", reminderDays: 7 },
    ]);
    expect(ra[0]!.dueDate?.toISOString().slice(0, 10)).toBe("2026-02-19");
    expect(ra[0]!.reminderDays).toBe(7);
  });
});

describe("[GTF-04] số tiền và số ngày nhắc được làm sạch", () => {
  it("làm tròn số tiền, kẹp số ngày nhắc về ≥ 0", () => {
    const ra = dotsGhiTuForm([
      { amount: 1_000_000.6, daThu: false, dueDate: "2026-01-20", reminderDays: -5 },
    ]);
    expect(ra[0]!.amount).toBe(1_000_001);
    expect(ra[0]!.reminderDays).toBe(0);
  });

  it("số tiền không hữu hạn → 0, để cổng Σ từ chối chứ không ghi NaN vào cột tiền", () => {
    expect(
      dotsGhiTuForm([{ amount: Number.NaN, daThu: false, dueDate: "2026-01-20" }])[0]!.amount,
    ).toBe(0);
  });

  it("reminderDays thiếu → null (cron rơi về tham số vận hành)", () => {
    expect(
      dotsGhiTuForm([{ amount: 1, daThu: false, dueDate: "2026-01-20" }])[0]!.reminderDays,
    ).toBeNull();
  });
});

describe("[GTF-05] giữ nguyên THỨ TỰ — soDot đánh theo thứ tự này", () => {
  it("3 đợt ra đúng 3 bản ghi, đúng thứ tự", () => {
    const ra = dotsGhiTuForm([
      { amount: 3, daThu: false, dueDate: "2026-03-21" },
      { amount: 1, daThu: true, dueDate: null },
      { amount: 2, daThu: false, dueDate: "2026-02-19" },
    ]);
    expect(ra.map((d) => d.amount)).toEqual([3, 1, 2]);
  });

  it("mảng rỗng → mảng rỗng", () => {
    expect(dotsGhiTuForm([])).toEqual([]);
  });
});
