/**
 * [AFR-BC-*] — LÕI THUẦN của khối «Hiệu quả» campaign (AFF-P3 H1): khoảng ngày · tóm tắt lượt bấm · tỉ lệ · gộp theo đối tác. Không DB, không đồng hồ thật (luật 19: `now` truyền vào).
 *
 *   [AFR-BC-01..04] khoảng ngày: mặc định 30 ngày GỒM hôm nay (theo ngày VN, kể cả sát nửa đêm UTC); khoảng hợp lệ giữ nguyên + mốc lọc nửa mở; mọi đầu vào sai ⇒ mặc định KÈM cảnh báo
 *   [AFR-BC-05..06] lượt bấm: OK tách khỏi «link không dùng được»; nhãn đúng mã; mã lạ không bị nuốt
 *   [AFR-BC-07] tỉ lệ: mẫu 0 ⇒ null (không «0%»); khác phạm vi ⇒ null
 *   [AFR-BC-08..10] gộp đối tác: đủ chiều, thứ tự, cắt kèm số bị cắt, đối tác không rõ tên vẫn có dòng, tiền null ≠ 0
 */
import { describe, expect, it } from "vitest";

import { gopTheoDoiTac, giaiKhoangNgay, SO_NGAY_TOI_DA, tiLe, tomTatLuotBam } from "./bao-cao";

const NOW = new Date("2026-10-13T03:00:00.000Z"); // 10:00 ngày 13/10 giờ VN

describe("[AFR-BC-01..04] giaiKhoangNgay", () => {
  it("[AFR-BC-01] không chọn ⇒ 30 ngày gần nhất GỒM hôm nay (14/09 → 13/10), mặc định = true, không cảnh báo", () => {
    const k = giaiKhoangNgay({ tu: null, den: null, now: NOW });
    expect([k.tu, k.den, k.macDinh, k.canhBao]).toEqual(["2026-09-14", "2026-10-13", true, null]);
  });

  it("[AFR-BC-02] ngày VN, không phải ngày UTC: 20:00 UTC ngày 12 đã là ngày 13 ở VN", () => {
    const k = giaiKhoangNgay({ tu: null, den: null, now: new Date("2026-10-12T20:00:00.000Z") });
    expect(k.den).toBe("2026-10-13");
  });

  it("[AFR-BC-03] khoảng hợp lệ giữ nguyên; mốc lọc là NỬA MỞ theo giờ VN: [00:00 của `tu`, 00:00 ngày SAU `den`)", () => {
    const k = giaiKhoangNgay({ tu: "2026-10-01", den: "2026-10-05", now: NOW });
    expect([k.tu, k.den, k.macDinh, k.canhBao]).toEqual(["2026-10-01", "2026-10-05", false, null]);
    expect(k.tuLuc.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(k.denLuc.toISOString()).toBe("2026-10-05T17:00:00.000Z"); // 00:00 VN ngày 06
    // một ngày: tuLuc..denLuc rộng đúng 24 giờ
    const mot = giaiKhoangNgay({ tu: "2026-10-05", den: "2026-10-05", now: NOW });
    expect(mot.denLuc.getTime() - mot.tuLuc.getTime()).toBe(24 * 3_600_000);
  });

  it("[AFR-BC-04] đầu vào sai ⇒ rơi về mặc định KÈM cảnh báo (không im lặng đổi khoảng): thiếu một đầu · không có thật trên lịch · đảo thứ tự · quá dài; đúng 366 ngày vẫn được", () => {
    const sai: [string | null, string | null][] = [
      ["2026-10-01", null],
      [null, "2026-10-05"],
      ["2026-02-30", "2026-03-05"],
      ["abc", "2026-10-05"],
      ["2026-10-05", "2026-10-01"],
      ["2025-01-01", "2026-10-05"],
    ];
    for (const [tu, den] of sai) {
      const k = giaiKhoangNgay({ tu, den, now: NOW });
      expect(k.macDinh, `${tu}→${den}`).toBe(true);
      expect(k.canhBao, `${tu}→${den}`).toMatch(/30 ngày gần nhất/);
      expect([k.tu, k.den]).toEqual(["2026-09-14", "2026-10-13"]);
    }
    // đối chứng dương: biên 366 ngày hợp lệ, 367 thì không
    const bien = giaiKhoangNgay({ tu: "2025-10-13", den: "2026-10-13", now: NOW }); // 365 khoảng cách + 1 (gồm đầu mút) = 366 ngày
    expect(bien.macDinh).toBe(false);
    expect(SO_NGAY_TOI_DA).toBe(366);
    expect(giaiKhoangNgay({ tu: "2025-10-12", den: "2026-10-13", now: NOW }).macDinh).toBe(true);
  });
});

describe("[AFR-BC-05..06] tomTatLuotBam", () => {
  it("[AFR-BC-05] OK tách khỏi link không dùng được; nhãn đúng từng mã; xếp theo số lượt ↓; tổng = OK + lỗi", () => {
    const t = tomTatLuotBam([
      { outcome: "OK", n: 40 },
      { outcome: "LINK_DA_THU_HOI", n: 5 },
      { outcome: "CAMPAIGN_HET_HAN", n: 7 },
    ]);
    expect(t.hopLe).toBe(40);
    expect(t.khongDung).toBe(12);
    expect(t.tong).toBe(52);
    expect(t.theoLyDo.map((x) => [x.ma, x.n])).toEqual([["CAMPAIGN_HET_HAN", 7], ["LINK_DA_THU_HOI", 5]]);
    expect(t.theoLyDo[0]!.nhan).toBe("Campaign đã hết hạn.");
  });

  it("[AFR-BC-06] mã kết cục LẠ không bị nuốt (vẫn được đếm, nhãn nói là «lý do khác»); rỗng ⇒ toàn 0", () => {
    const t = tomTatLuotBam([{ outcome: "MA_MOI_CHUA_BIET", n: 3 }]);
    expect(t.khongDung).toBe(3);
    expect(t.theoLyDo[0]!.nhan).toBe("Lý do khác (MA_MOI_CHUA_BIET)");
    expect(tomTatLuotBam([])).toEqual({ tong: 0, hopLe: 0, khongDung: 0, theoLyDo: [] });
  });
});

describe("[AFR-BC-07] tiLe", () => {
  it("mẫu 0 ⇒ null (không «0%» của một tập rỗng); khác phạm vi ⇒ null; còn lại làm tròn 1 chữ số — đối chứng dương", () => {
    expect(tiLe(0, 0, true)).toBeNull();
    expect(tiLe(5, 0, true)).toBeNull();
    expect(tiLe(5, 10, false)).toBeNull();
    expect(tiLe(1, 3, true)).toBe(33.3);
    expect(tiLe(0, 10, true)).toBe(0); // tử 0 trên mẫu có thật là 0% THẬT
    expect(tiLe(10, 10, true)).toBe(100);
  });
});

const DANH_TINH = new Map([
  ["p1", { ten: "An", ma: "AN" }],
  ["p2", { ten: "Bình", ma: "BINH" }],
]);

describe("[AFR-BC-08..10] gopTheoDoiTac", () => {
  const dauVao = {
    luotBam: [
      { partyId: "p1", outcome: "OK", n: 10 },
      { partyId: "p1", outcome: "LINK_DA_THU_HOI", n: 2 },
      { partyId: "p2", outcome: "OK", n: 50 },
    ],
    referral: [
      { partyId: "p1", status: "VALID" as const, n: 4 },
      { partyId: "p1", status: "MANUAL_REVIEW" as const, n: 1 },
      { partyId: "p2", status: "VALID" as const, n: 1 },
    ],
    daDangKy: [{ partyId: "p1", n: 2 }],
    tien: [{ partyId: "p1", soDong: 3, tien: 300_000 }],
    danhTinh: DANH_TINH,
  };

  it("[AFR-BC-08] gộp đủ chiều; xếp theo đã đăng ký ↓ rồi hợp lệ ↓ rồi lượt bấm ↓; lượt bấm lỗi KHÔNG lẫn vào lượt bấm hợp lệ", () => {
    const { dong, biCat } = gopTheoDoiTac(dauVao);
    expect(biCat).toBe(0);
    expect(dong.map((d) => d.partyId)).toEqual(["p1", "p2"]);
    expect(dong[0]).toMatchObject({ ten: "An", luotBam: 10, luotBamLoi: 2, daDangKy: 2, hoaHong: { soDong: 3, tien: 300_000 } });
    expect(dong[0]!.referral).toMatchObject({ VALID: 4, MANUAL_REVIEW: 1, REJECTED: 0 });
    expect(dong[1]).toMatchObject({ luotBam: 50, daDangKy: 0, hoaHong: { soDong: 0, tien: 0 } });
  });

  it("[AFR-BC-09] cắt ở ngưỡng và NÓI số bị cắt; đối tác không có tên vẫn có dòng (mã id rút gọn), số của họ không mất", () => {
    const nhieu = { ...dauVao, luotBam: [...dauVao.luotBam, { partyId: "xyz123456", outcome: "OK", n: 1 }], danhTinh: DANH_TINH };
    const r = gopTheoDoiTac(nhieu, 2);
    expect(r.dong).toHaveLength(2);
    expect(r.biCat).toBe(1);
    const day = gopTheoDoiTac(nhieu, 10);
    const la = day.dong.find((d) => d.partyId === "xyz123456")!;
    expect(la.ten).toBe("Đối tác 123456");
    expect(la.luotBam).toBe(1);
  });

  it("[AFR-BC-10] tiền: `tien = null` (không có quyền xem sổ) ⇒ hoaHong null ở MỌI dòng — KHÁC {0 đồng}", () => {
    const { dong } = gopTheoDoiTac({ ...dauVao, tien: null });
    expect(dong.every((d) => d.hoaHong === null)).toBe(true);
    // đối chứng dương: có quyền thì dòng không có tiền là 0 đồng THẬT
    expect(gopTheoDoiTac(dauVao).dong.find((d) => d.partyId === "p2")!.hoaHong).toEqual({ soDong: 0, tien: 0 });
  });
});
