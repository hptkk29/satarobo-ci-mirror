// lib/cham-cong/so-phep-thuan.test.ts — phần thuần của sổ phép năm (P2.1A). Không chạm DB, không đọc đồng hồ.
import { describe, expect, it } from "vitest";
import { doiSoatChuoi, loiButToan, namPhep, nhanNgayPhep, phutTruCaNgay, type DongSo } from "./so-phep-thuan";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("[SPT] sổ phép — luật thuần", () => {
  it("[SPT-01] dấu bút toán: trừ phải âm, cộng phải dương, điều chỉnh hai chiều, 0 và số lẻ bị chặn", () => {
    expect(loiButToan("LEAVE_USED", -480)).toBeNull();
    expect(loiButToan("LEAVE_USED", 480)).toMatch(/số âm/);
    expect(loiButToan("EXPIRY", 60)).toMatch(/số âm/);
    expect(loiButToan("OPENING", -1)).toMatch(/số dương/);
    expect(loiButToan("LEAVE_REFUND", -480)).toMatch(/số dương/);
    expect(loiButToan("MANUAL_ADJUSTMENT", -30)).toBeNull();
    expect(loiButToan("MANUAL_ADJUSTMENT", 30)).toBeNull();
    expect(loiButToan("OPENING", 0)).toMatch(/khác 0/);
    expect(loiButToan("OPENING", 1.5)).toMatch(/nguyên/);
  });

  it("[SPT-02] năm phép theo ngày @db.Date (nửa đêm UTC) — 31/12 và 01/01 rơi đúng năm", () => {
    expect(namPhep(utc(2026, 12, 31))).toBe(2026);
    expect(namPhep(utc(2027, 1, 1))).toBe(2027);
  });

  it("[SPT-03] nghỉ cả ngày chỉ trừ ngày LÀM VIỆC, chia theo năm khi vắt qua giao thừa", () => {
    const r = phutTruCaNgay(
      [
        { ngay: utc(2026, 12, 30), laNgayLamViec: true },
        { ngay: utc(2026, 12, 31), laNgayLamViec: false },
        { ngay: utc(2027, 1, 1), laNgayLamViec: true },
        { ngay: utc(2027, 1, 2), laNgayLamViec: true },
      ],
      480,
    );
    expect(r.soNgayTru).toBe(3);
    expect([...r.theoNam.entries()]).toEqual([
      [2026, 480],
      [2027, 960],
    ]);
  });

  const dong = (o: Partial<DongSo> & Pick<DongSo, "id" | "minutes" | "balanceBefore" | "balanceAfter">, phut: number): DongSo => ({
    userId: "u1",
    leaveTypeId: "lt",
    year: 2026,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, phut)),
    ...o,
  });

  it("[SPT-04] đối soát: chuỗi liền mạch ⇒ không báo gì", () => {
    const rows = [
      dong({ id: "a", minutes: 960, balanceBefore: 0, balanceAfter: 960 }, 1),
      dong({ id: "b", minutes: -480, balanceBefore: 960, balanceAfter: 480 }, 2),
    ];
    expect(doiSoatChuoi(rows, false)).toEqual([]);
  });

  it("[SPT-05] đối soát: đứt chuỗi, sai cộng, và âm khi không cho ứng — mỗi lỗi một dòng", () => {
    const rows = [
      dong({ id: "a", minutes: 480, balanceBefore: 0, balanceAfter: 480 }, 1),
      dong({ id: "b", minutes: -960, balanceBefore: 400, balanceAfter: -560 }, 2), // đứt chuỗi (mong 480)
      dong({ id: "c", minutes: 0 + 10, balanceBefore: -560, balanceAfter: -500 }, 3), // sai cộng (mong -550)
    ];
    const lech = doiSoatChuoi(rows, false);
    expect(lech).toEqual([
      { loai: "DUT_CHUOI", id: "b", mongDoi: 480, thucTe: 400 },
      { loai: "SAI_CONG", id: "c", mongDoi: -550, thucTe: -500 },
      { loai: "AM", userId: "u1", leaveTypeId: "lt", year: 2026, soDu: -470 },
    ]);
    // Chính sách cho ứng ⇒ âm không phải lỗi, hai lỗi chuỗi vẫn báo.
    expect(doiSoatChuoi(rows, true).map((x) => x.loai)).toEqual(["DUT_CHUOI", "SAI_CONG"]);
  });

  it("[SPT-06] đối soát tách nhóm theo (người × loại × năm) — năm sau mở chuỗi mới từ 0", () => {
    const rows = [
      dong({ id: "a", minutes: 480, balanceBefore: 0, balanceAfter: 480 }, 1),
      dong({ id: "b", year: 2027, minutes: 480, balanceBefore: 0, balanceAfter: 480 }, 2),
      dong({ id: "c", userId: "u2", minutes: 480, balanceBefore: 0, balanceAfter: 480 }, 3),
    ];
    expect(doiSoatChuoi(rows, false)).toEqual([]);
  });

  it("[SPT-07] nhãn ngày công: theo phút một ngày đang cấu hình, giữ dấu âm, làm tròn 2 chữ số", () => {
    expect(nhanNgayPhep(960, 480)).toBe("2 ngày");
    expect(nhanNgayPhep(210, 480)).toBe("0,44 ngày");
    expect(nhanNgayPhep(-240, 480)).toBe("−0,5 ngày");
    expect(nhanNgayPhep(960, 420)).toBe("2,29 ngày");
  });
});
