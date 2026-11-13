// PORT từ repo hodacphuchtc/DISC · tests/muc-do.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import { NGUONG_NOI_RO, NGUONG_PHA } from "@/lib/disc/engine-goc/config/disc-nguong";
import { napBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/nap";
import type { MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { cham } from "@/lib/disc/engine-goc/modules/report/cham";
import { noiRo, viTriTrongHoSo } from "@/lib/disc/engine-goc/modules/report/muc-do";

const XEP_HANG: readonly MaTruc[] = ["C", "S", "I", "D"];

describe("viTriTrongHoSo", () => {
  it("nhận ra trục nổi nhất và trục nhẹ nhất", () => {
    expect(viTriTrongHoSo(XEP_HANG, "C")).toBe("noiNhat");
    expect(viTriTrongHoSo(XEP_HANG, "D")).toBe("nheNhat");
  });

  it("hai trục ở giữa đều là 'giua'", () => {
    expect(viTriTrongHoSo(XEP_HANG, "S")).toBe("giua");
    expect(viTriTrongHoSo(XEP_HANG, "I")).toBe("giua");
  });

  it("🔴 hai trục giữa HOÁN CHỖ nhau thì kết quả KHÔNG đổi", () => {
    // Đây chính là lý do gộp hạng 2 và hạng 3. Hai trục giữa thường chỉ cách nhau vài
    // điểm nên thừa sức đổi chỗ chỉ vì một câu trả lời nhích một nấc. Gộp lại thì cú
    // hoán chỗ đó không đổi lấy một chữ nào trong báo cáo.
    const daoGiua: readonly MaTruc[] = ["C", "I", "S", "D"];
    for (const t of ["C", "S", "I", "D"] as const) {
      expect(viTriTrongHoSo(daoGiua, t), t).toBe(viTriTrongHoSo(XEP_HANG, t));
    }
  });
});

describe("noiRo — phải thoả CẢ HAI điều kiện", () => {
  const xh: readonly MaTruc[] = ["D", "I", "S", "C"];

  it("đạt khi điểm cao VÀ cách trục kế đủ xa", () => {
    expect(noiRo({ D: 88, I: 60, S: 40, C: 35 }, xh)).toBe(true);
  });

  it("KHÔNG đạt khi điểm cao nhưng bốn trục cùng cao", () => {
    // Người trả lời cái gì cũng gật. Không có trục nào thật sự nổi — nói "nhóm D nổi rất
    // rõ" ở đây là bịa.
    expect(noiRo({ D: 92, I: 90, S: 88, C: 86 }, xh)).toBe(false);
  });

  it("KHÔNG đạt khi tách bạch nhưng điểm chưa tới ngưỡng", () => {
    expect(noiRo({ D: 55, I: 20, S: 15, C: 10 }, xh)).toBe(false);
  });

  it("bám sát đúng hai ngưỡng đã khai trong config, không gõ cứng số", () => {
    const vuaDu = { D: NGUONG_NOI_RO, I: NGUONG_NOI_RO - NGUONG_PHA, S: 10, C: 5 };
    expect(noiRo(vuaDu, xh)).toBe(true);
    expect(noiRo({ ...vuaDu, D: NGUONG_NOI_RO - 0.1 }, xh)).toBe(false);
    expect(noiRo({ ...vuaDu, I: NGUONG_NOI_RO - NGUONG_PHA + 0.1 }, xh)).toBe(false);
  });
});

/**
 * 🔴 TEST ỔN ĐỊNH — lý do cả file này tồn tại.
 *
 * Phép đo thô: một nấc trả lời dịch điểm chuẩn hoá 4–10 điểm tuỳ bộ đề. Nếu nội dung báo
 * cáo khoá theo thang cao/vừa/thấp thì cùng một đứa trẻ làm lại sau năm phút sẽ đọc được
 * một bản khác nghĩa. Khoá theo THỨ HẠNG thì không.
 */
describe("🔴 đổi một câu một nấc không được xoay mạch văn", () => {
  const bo = napBoDe("THCS");

  /** Hồ sơ nhóm C nổi rõ — cùng dáng với mẫu 03 ở tests/DATA_TEST. */
  function traLoiGoc(): Record<string, number> {
    const muc: Record<MaTruc, number[]> = {
      D: [4, 3, 2, 2, 2, 2],
      I: [4, 4, 3, 2, 2, 2],
      S: [4, 4, 4, 3, 2, 2],
      C: [5, 5, 4, 4, 4, 3],
    };
    const dem: Record<string, number> = { D: 0, I: 0, S: 0, C: 0 };
    const tl: Record<string, number> = {};
    for (const c of bo.cau) {
      const v = muc[c.truc][dem[c.truc]++];
      tl[c.ma] = c.dao ? bo.mucToiDa + 1 - v : v;
    }
    return tl;
  }

  it("hồ sơ gốc đúng như mong đợi: C nổi nhất, D nhẹ nhất", () => {
    const kq = cham(bo, traLoiGoc(), 300);
    expect(kq.hopLe).toBe(true);
    if (!kq.hopLe) return;
    expect(viTriTrongHoSo(kq.xepHang, "C")).toBe("noiNhat");
    expect(viTriTrongHoSo(kq.xepHang, "D")).toBe("nheNhat");
  });

  it("nhích BẤT KỲ câu nào một nấc: trục nổi nhất và trục nhẹ nhất giữ nguyên", () => {
    const goc = cham(bo, traLoiGoc(), 300);
    expect(goc.hopLe).toBe(true);
    if (!goc.hopLe) return;

    for (const c of bo.cau) {
      for (const buoc of [-1, 1]) {
        const tl = traLoiGoc();
        const moi = tl[c.ma] + buoc;
        if (moi < 1 || moi > bo.mucToiDa) continue;
        tl[c.ma] = moi;

        const kq = cham(bo, tl, 300);
        if (!kq.hopLe) continue; // lệch quá thành phẳng thì hàng rào lo, không phải việc ở đây
        expect(viTriTrongHoSo(kq.xepHang, "C"), `${c.ma} ${buoc > 0 ? "+" : "−"}1`).toBe("noiNhat");
        expect(viTriTrongHoSo(kq.xepHang, "D"), `${c.ma} ${buoc > 0 ? "+" : "−"}1`).toBe("nheNhat");
      }
    }
  });
});
