// PORT từ repo hodacphuchtc/DISC · tests/cau-hoi.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import { NGAN_HANG, PHIEN_BAN_BO_DE } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { THU_TU } from "@/lib/disc/engine-goc/config/disc-thu-tu";
import { MA_BO_DE, MA_TRUC } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

/**
 * CANH BẤT BIẾN CỦA NGÂN HÀNG CÂU HỎI.
 *
 * Mấy test này bảo vệ những thứ hỏng IM LẶNG: bài vẫn chạy, kết quả vẫn ra, chỉ là sai.
 * Đừng gỡ. Nếu một test ở đây đỏ, hãy sửa dữ liệu chứ đừng sửa test.
 */

const boDes = MA_BO_DE.map((ma) => NGAN_HANG[ma]);

describe("ngân hàng câu hỏi — bất biến", () => {
  it("có đủ 5 bộ đề và tổng 104 câu", () => {
    expect(boDes).toHaveLength(5);
    expect(boDes.reduce((t, b) => t + b.cau.length, 0)).toBe(104);
  });

  it.each(boDes)("bộ $ma: mã câu không trùng nhau", (bo) => {
    const ma = bo.cau.map((c) => c.ma);
    expect(new Set(ma).size).toBe(ma.length);
  });

  it("không mã câu nào trùng giữa hai bộ đề khác nhau", () => {
    const tatCa = boDes.flatMap((b) => b.cau.map((c) => c.ma));
    expect(new Set(tatCa).size).toBe(tatCa.length);
  });

  it.each(boDes)("bộ $ma: bốn trục có SỐ CÂU BẰNG NHAU", (bo) => {
    const dem = MA_TRUC.map((t) => bo.cau.filter((c) => c.truc === t).length);
    expect(new Set(dem).size, `số câu mỗi trục: ${dem.join(", ")}`).toBe(1);
    expect(dem[0]).toBeGreaterThan(0);
  });

  it.each(boDes)("bộ $ma: MỖI TRỤC có ít nhất MỘT câu đảo chiều", (bo) => {
    for (const t of MA_TRUC) {
      const soDao = bo.cau.filter((c) => c.truc === t && c.dao).length;
      expect(
        soDao,
        `Trục ${t} của bộ ${bo.ma} không còn câu đảo nào. Đây là hàng rào chống ` +
          `tick-một-cột: gỡ nó thì bài vẫn chạy, chỉ sai kết quả — và không có gì báo đỏ.`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it.each(boDes)("bộ $ma: thang trả lời liền mạch từ 1 và khớp mucToiDa", (bo) => {
    expect(bo.thang).toHaveLength(bo.mucToiDa);
    expect(bo.thang.map((m) => m.giaTri)).toEqual(
      Array.from({ length: bo.mucToiDa }, (_, i) => i + 1),
    );
    for (const m of bo.thang) expect(m.nhan.trim()).not.toBe("");
  });

  it.each(boDes)("bộ $ma: không câu nào bỏ trống nội dung", (bo) => {
    for (const c of bo.cau) expect(c.noiDung.trim().length).toBeGreaterThan(5);
  });

  it("bộ QS: MỌI câu đều khai soiGuong, và trỏ tới mã CÓ THẬT", () => {
    const moiMa = new Set(boDes.flatMap((b) => b.cau.map((c) => c.ma)));
    for (const c of NGAN_HANG.QS.cau) {
      expect(c.soiGuong, `Câu ${c.ma} của bộ QS thiếu soiGuong`).toBeDefined();
      expect(c.soiGuong!.length).toBeGreaterThan(0);
      for (const dich of c.soiGuong!) {
        expect(moiMa.has(dich), `Câu ${c.ma} soi gương tới "${dich}" — mã này không tồn tại`).toBe(
          true,
        );
      }
    }
  });

  it("chỉ bộ QS mới khai soiGuong", () => {
    for (const bo of boDes) {
      if (bo.ma === "QS") continue;
      for (const c of bo.cau) expect(c.soiGuong).toBeUndefined();
    }
  });

  it("phiên bản bộ đề có dạng số.số", () => {
    expect(PHIEN_BAN_BO_DE).toMatch(/^\d+\.\d+$/u);
  });
});

describe("thứ tự hiển thị — luật §6.6", () => {
  it.each(boDes)("bộ $ma: thứ tự phủ ĐÚNG mọi câu, không thừa không thiếu", (bo) => {
    const thuTu = THU_TU[bo.ma];
    expect([...thuTu].sort()).toEqual([...bo.cau.map((c) => c.ma)].sort());
  });

  it.each(boDes)("bộ $ma: KHÔNG có hai câu cùng trục đứng liền nhau", (bo) => {
    const truc = THU_TU[bo.ma].map((ma) => bo.cau.find((c) => c.ma === ma)!.truc);
    for (let i = 1; i < truc.length; i += 1) {
      expect(
        truc[i],
        `Vị trí ${i} và ${i - 1} cùng trục ${truc[i]} — người làm sẽ đọc ra bài đang đo gì`,
      ).not.toBe(truc[i - 1]);
    }
  });

  it.each(boDes)("bộ $ma: KHÔNG có hai câu đảo đứng liền nhau", (bo) => {
    const dao = THU_TU[bo.ma].map((ma) => bo.cau.find((c) => c.ma === ma)!.dao);
    for (let i = 1; i < dao.length; i += 1) {
      expect(dao[i] && dao[i - 1], `Hai câu đảo liền nhau ở vị trí ${i - 1}, ${i}`).toBe(false);
    }
  });

  it.each(boDes)("bộ $ma: câu ĐẦU BÀI là câu thuận", (bo) => {
    const dau = bo.cau.find((c) => c.ma === THU_TU[bo.ma][0])!;
    expect(dau.dao, `Câu mở đầu ${dau.ma} là câu đảo — người làm chưa vào nhịp`).toBe(false);
  });

  it.each(boDes)("bộ $ma: mỗi vòng 4 câu đủ cả D–I–S–C", (bo) => {
    const truc = THU_TU[bo.ma].map((ma) => bo.cau.find((c) => c.ma === ma)!.truc);
    for (let v = 0; v < truc.length; v += 4) {
      expect(new Set(truc.slice(v, v + 4)).size, `Vòng bắt đầu ở vị trí ${v} không đủ 4 trục`).toBe(4);
    }
  });
});
