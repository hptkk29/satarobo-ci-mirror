// lib/cham-cong/suy-huong.test.ts — luật suy VÀO/RA của chấm công một nút (06/10/2026).
//
// Mỗi ca dựng lại cả NGÀY bằng `chuoi()`: cho từng lượt vào hàm như máy chủ thật làm (lượt sau
// thấy mọi lượt trước), rồi so CẢ CHUỖI hướng. Ca kiểu "một lượt lẻ" không bắt được lỗi dây
// chuyền — một lượt suy sai làm lệch mọi lượt sau — mà đó đúng là thứ suy theo ca sinh ra để chặn.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cacBuoiTuCa, cauDuDoan, nhanBuoi, suyHuongLuot, type BuoiCa, type HuongLuot, type LuotTruoc } from "./suy-huong";

const m = (hhmm: string) => {
  const [h, mm] = hhmm.split(":").map(Number);
  return h! * 60 + mm!;
};
const V: HuongLuot = "CHECK_IN";
const R: HuongLuot = "CHECK_OUT";

/** Ca 1 buổi 07:30–11:30. */
const MOT_BUOI: BuoiCa[] = [{ batDau: m("07:30"), ketThuc: m("11:30") }];
/** Ca 2 buổi 07:30–11:30 · 13:30–17:30 (kiểu `ST`). */
const HAI_BUOI: BuoiCa[] = [
  { batDau: m("07:30"), ketThuc: m("11:30") },
  { batDau: m("13:30"), ketThuc: m("17:30") },
];

/** Chạy cả ngày: mỗi lượt thấy mọi lượt đã ghi trước nó. Trả chuỗi hướng + kết quả từng lượt. */
function chuoi(cacBuoi: BuoiCa[], gio: string[], phutTrung = 2) {
  const daGhi: LuotTruoc[] = [];
  const kq = gio.map((g) => {
    const r = suyHuongLuot({ gioQuet: m(g), cacBuoi, luotTruoc: [...daGhi], phutTrung });
    daGhi.push({ gio: m(g), huong: r.huong });
    return r;
  });
  return { huong: kq.map((r) => r.huong), kq };
}

describe("suyHuongLuot — có ca", () => {
  it("[SH-01] ca 1 buổi: vào đúng giờ, ra đúng giờ", () => {
    const { huong, kq } = chuoi(MOT_BUOI, ["07:28", "11:32"]);
    expect(huong).toEqual([V, R]);
    expect(kq.map((r) => r.buoi)).toEqual([1, 1]);
  });

  it("[SH-02] ca 2 buổi đủ 4 lượt: VÀO-RA-VÀO-RA, đúng buổi", () => {
    const { huong, kq } = chuoi(HAI_BUOI, ["07:25", "11:31", "13:24", "17:33"]);
    expect(huong).toEqual([V, R, V, R]);
    expect(kq.map((r) => r.buoi)).toEqual([1, 1, 2, 2]);
    expect(kq.map((r) => r.lyDo)).toEqual(["VAO", "RA_CUNG_BUOI", "VAO", "RA_CUNG_BUOI"]);
  });

  it("[SH-03] đi muộn quá nửa buổi chiều vẫn là VÀO (sáng đã RA)", () => {
    const { huong } = chuoi(HAI_BUOI, ["07:25", "11:31", "16:00", "17:33"]);
    expect(huong).toEqual([V, R, V, R]);
  });

  it("[SH-04] về sớm ngay đầu buổi (VÀO mở CÙNG buổi) là RA", () => {
    const { huong, kq } = chuoi(HAI_BUOI, ["07:25", "11:31", "13:28", "14:05"]);
    expect(huong).toEqual([V, R, V, R]);
    expect(kq[3]!.lyDo).toBe("RA_CUNG_BUOI");
  });

  it("[SH-05] quên RA trưa: lượt đầu buổi chiều là VÀO buổi mới, lượt về vẫn RA", () => {
    const { huong, kq } = chuoi(HAI_BUOI, ["07:25", "13:25", "17:35"]);
    expect(huong).toEqual([V, V, R]);
    expect(kq[1]).toMatchObject({ lyDo: "VAO_BUOI_MOI", buoi: 2 });
  });

  it("[SH-06] làm liền qua trưa (VÀO sáng, quét lần sau ở nửa sau buổi chiều) là RA", () => {
    const { huong, kq } = chuoi(HAI_BUOI, ["07:25", "17:31"]);
    expect(huong).toEqual([V, R]);
    expect(kq[1]).toMatchObject({ lyDo: "RA_LAM_LIEN", buoi: 2 });
  });

  it("[SH-07] quên VÀO buổi chiều: quét sau giờ kết thúc, buổi chưa có lượt ⇒ RA", () => {
    const { huong, kq } = chuoi(HAI_BUOI, ["07:25", "11:31", "17:35"]);
    expect(huong).toEqual([V, R, R]);
    expect(kq[2]).toMatchObject({ lyDo: "RA_QUEN_VAO", buoi: 2 });
  });

  it("[SH-07b] quên VÀO cả ngày ca 1 buổi: lượt duy nhất sau giờ về là RA", () => {
    const { huong } = chuoi(MOT_BUOI, ["11:40"]);
    expect(huong).toEqual([R]);
  });

  it("[SH-08] bấm 2 lần trong 2′: CÙNG chiều, cờ trùng; lượt kế tiếp không lệch", () => {
    const { huong, kq } = chuoi(HAI_BUOI, ["07:25", "07:26", "11:31", "11:32", "13:24", "17:33"]);
    expect(huong).toEqual([V, V, R, R, V, R]);
    expect(kq.map((r) => r.trung)).toEqual([false, true, false, true, false, false]);
    expect(kq[1]!.lyDo).toBe("TRUNG");
  });

  it("[SH-08b] cách đúng `phutTrung` phút thì KHÔNG còn là trùng", () => {
    const { kq } = chuoi(MOT_BUOI, ["07:25", "07:27"], 2);
    expect(kq[1]).toMatchObject({ trung: false, huong: R });
  });

  it("[SH-09] quét sớm trước giờ ca (07:10 cho ca 07:30) là VÀO buổi 1", () => {
    const { kq } = chuoi(MOT_BUOI, ["07:10"]);
    expect(kq[0]).toMatchObject({ huong: V, buoi: 1, lyDo: "VAO" });
  });

  it("[SH-10] đã RA trưa, quét sau giờ hết buổi sáng (gần sáng hơn) ⇒ VÀO, nhãn là buổi KẾ TIẾP", () => {
    const { kq } = chuoi(HAI_BUOI, ["07:25", "11:31", "12:20"]);
    expect(kq[2]).toMatchObject({ huong: V, buoi: 2 });
  });

  it("[SH-11] lượt giờ MUỘN hơn lượt đang ghi (mốc chỉnh tay ghi trước) không được tính là lượt trước", () => {
    const r = suyHuongLuot({
      gioQuet: m("07:25"),
      cacBuoi: MOT_BUOI,
      luotTruoc: [{ gio: m("11:30"), huong: R }],
      phutTrung: 2,
    });
    expect(r.huong).toBe(V);
  });

  it("[SH-12] luotTruoc không sắp xếp vẫn ra đúng (lấy lượt CUỐI theo giờ, không theo mảng)", () => {
    const r = suyHuongLuot({
      gioQuet: m("11:35"),
      cacBuoi: MOT_BUOI,
      luotTruoc: [
        { gio: m("07:25"), huong: V },
        { gio: m("06:00"), huong: R },
      ],
      phutTrung: 2,
    });
    expect(r.huong).toBe(R);
  });
});

describe("suyHuongLuot — không ca", () => {
  it("[SH-20] không ca: xen kẽ theo lượt trước, buoi null", () => {
    const { huong, kq } = chuoi([], ["08:00", "12:00", "13:00", "17:00"]);
    expect(huong).toEqual([V, R, V, R]);
    expect(kq.every((r) => r.buoi === null && r.lyDo === "KHONG_CA")).toBe(true);
  });

  it("[SH-21] không ca vẫn bắt bấm trùng", () => {
    const { huong, kq } = chuoi([], ["08:00", "08:01"]);
    expect(huong).toEqual([V, V]);
    expect(kq[1]!.trung).toBe(true);
  });
});

describe("cacBuoiTuCa — dựng buổi Y NHƯ engine dựng cụm quét", () => {
  it("[SH-30] ST (2 đoạn WORK, soCap 2) ⇒ 2 buổi", () => {
    expect(
      cacBuoiTuCa(
        [
          { start: "07:30", end: "11:30" },
          { start: "13:30", end: "17:30" },
        ],
        2,
      ),
    ).toEqual(HAI_BUOI);
  });

  it("[SH-31] CS (nghỉ CÓ tính công giữa ca) ⇒ 1 buổi, nên về sớm 18:00 là RA", () => {
    const cs = cacBuoiTuCa(
      [
        { start: "14:00", end: "16:30" },
        { start: "16:30", end: "17:00" },
        { start: "17:00", end: "21:00" },
      ],
      1,
    );
    expect(cs).toEqual([{ batDau: m("14:00"), ketThuc: m("21:00") }]);
    expect(chuoi(cs, ["13:55", "18:00"]).huong).toEqual([V, R]);
  });

  it("[SH-32] CG (2 đoạn WORK nhưng danh mục khai 1 cặp) ⇒ 1 buổi, về 15:00 là RA", () => {
    const cg = cacBuoiTuCa(
      [
        { start: "09:00", end: "11:30" },
        { start: "14:00", end: "17:45" },
      ],
      1,
    );
    expect(cg).toHaveLength(1);
    expect(chuoi(cg, ["08:55", "15:00"]).huong).toEqual([V, R]);
  });

  it("[SH-33] soCap 0 (nghỉ / không đòi quét) ⇒ không buổi nào ⇒ xen kẽ", () => {
    expect(cacBuoiTuCa([{ start: "08:00", end: "17:00" }], 0)).toEqual([]);
  });
});

describe("nhanBuoi", () => {
  it("[SH-40] ca 1 buổi ⇒ 'ca hôm nay'; 2 buổi ⇒ sáng/chiều; null ⇒ null", () => {
    expect(nhanBuoi(MOT_BUOI, 1)).toBe("ca hôm nay");
    expect(nhanBuoi(HAI_BUOI, 1)).toBe("buổi sáng");
    expect(nhanBuoi(HAI_BUOI, 2)).toBe("buổi chiều");
    expect(nhanBuoi([], null)).toBeNull();
  });

  it("[SH-41] hai buổi cùng nhãn giờ ⇒ rơi về 'buổi 1/2'", () => {
    const chieu: BuoiCa[] = [
      { batDau: m("13:00"), ketThuc: m("14:00") },
      { batDau: m("15:00"), ketThuc: m("16:00") },
    ];
    expect(nhanBuoi(chieu, 2)).toBe("buổi 2");
  });
});

// ── LƯỚI GHIM DÂY NỐI ─────────────────────────────────────────────────────────────────────
//
// Luật cần khoá: hai Server Action chấm công lấy hướng từ MÁY CHỦ, không từ `type` client gửi.
// Test thuần ở trên không chạm được chỗ này (action cần auth + DB), nên đọc chính mã nguồn.
// Mã TRƯỚC bản vá: `direction: d.type` ở cả hai tệp. Đã cấy lại `d.type` ⇒ [SH-W1]/[SH-W2] đỏ.
/** Bỏ chú thích TRƯỚC khi soi — chú thích giải thích bản vá có chứa đúng chữ `type`. */
const maKhongChuThich = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("dây nối: hướng do máy chủ suy", () => {
  it("[SH-W1] checkin-action: không đọc `d.type`; mọi `direction:` lấy từ suyHuongHomNay", () => {
    const s = maKhongChuThich("lib/attendance/checkin-action.ts");
    expect(dem(s, /\bd\.type\b/g)).toBe(0);
    expect(dem(s, /suyHuongHomNay\(/g)).toBe(2); // lượt thật + lượt vé hỏng
    expect(dem(s, /direction:\s*suy\.huong/g)).toBe(2); // recordTimeLog + recordRejectedLog
    expect(dem(s, /direction:\s*goiY\.huong/g)).toBe(1);
    expect(dem(s, /direction:/g)).toBe(3);
  });

  it("[SH-W2] cong-tac-action: không đọc `d.type`; `direction:` lấy từ suyHuongHomNay", () => {
    const s = maKhongChuThich("lib/cham-cong/cong-tac-action.ts");
    expect(dem(s, /\bd\.type\b/g)).toBe(0);
    expect(dem(s, /suyHuongHomNay\(/g)).toBe(1);
    expect(dem(s, /direction:\s*suy\.huong/g)).toBe(1);
    expect(dem(s, /direction:/g)).toBe(1);
  });
});

describe("cauDuDoan", () => {
  it("[SH-50] nói rõ là DỰ ĐOÁN, kèm hướng + buổi; trùng thì cảnh báo trùng", () => {
    expect(cauDuDoan({ huong: "CHECK_IN", nhanBuoi: "buổi chiều", trung: false })).toBe("Dự đoán: lần này sẽ ghi VÀO · buổi chiều.");
    expect(cauDuDoan({ huong: "CHECK_OUT", nhanBuoi: null, trung: false })).toBe("Dự đoán: lần này sẽ ghi RA.");
    expect(cauDuDoan({ huong: "CHECK_IN", nhanBuoi: null, trung: true })).toMatch(/TRÙNG \(VÀO\)/);
  });
});
