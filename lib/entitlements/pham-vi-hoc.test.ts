import { describe, expect, it } from "vitest";
import {
  CAU_HINH_PHAM_VI_MAC_DINH,
  LoiPhamVi,
  suyLoaiMua,
  tinhPhamViHoc,
  type CauHinhPhamVi,
} from "./pham-vi-hoc";
import { chiaBaiThanhBuoi, soBuoiHocVuot } from "./hoc-vuot";

const r = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const maLoi = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof LoiPhamVi ? e.ma : `KHAC:${String(e)}`;
  }
};
const cfg = (p: Partial<CauHinhPhamVi>): CauHinhPhamVi => ({ ...CAU_HINH_PHAM_VI_MAC_DINH, ...p });

// Số liệu: n-vi-du-so-b.md §9a, §9b (nghĩa I), §10 — đáp án tính độc lập trong tài liệu BA.
describe("[PVH] gói trọn 48 — vào trễ (BA §9a)", () => {
  it.each([
    [1, "NONE", false, 0],
    [3, "LATE_ENTRY", false, 2], //  k = 2 bài đã qua
    [5, "LATE_ENTRY", false, 4], //  k = 4 = đúng ngưỡng ⇒ vẫn bù miễn phí
    [6, "LATE_ENTRY_NEEDS_DECISION", true, 5],
    [10, "LATE_ENTRY_NEEDS_DECISION", true, 9],
    [15, "LATE_ENTRY_NEEDS_DECISION", true, 14],
    [37, "LATE_ENTRY_NEEDS_DECISION", true, 36],
  ] as const)("[PVH-01] lớp ở bài %i ⇒ %s, QLCS quyết=%s, %i bài đã qua", (N, loaiBu, quyet, k) => {
    const x = tinhPhamViHoc({ loai: "FULL", soBuoi: 48, baiKeTiepCuaLop: N });
    expect(x).toMatchObject({ start: 1, end: 48, loaiBu, canQuyetDinhCuaQLCS: quyet });
    expect(x.baiCanBu).toEqual(k === 0 ? [] : r(1, k));
    expect(x.baiBoQua).toEqual([]);
  });

  it("[PVH-02] gói trọn KHÔNG áp trần học vượt 6: k = 36 vẫn dạy đủ 36 bài (QĐ-10)", () => {
    const x = tinhPhamViHoc({ loai: "FULL", soBuoi: 48, baiKeTiepCuaLop: 37 });
    expect(x.baiCanBu).toHaveLength(36);
    expect(x.baiBoQua).toHaveLength(0);
  });

  it("[PVH-03] ngưỡng vào trễ là THAM SỐ: đặt 2 thì k=3 đã cần QLCS quyết", () => {
    const x = tinhPhamViHoc({ loai: "FULL", soBuoi: 48, baiKeTiepCuaLop: 4, cauHinh: cfg({ lateEntryMaxLessons: 2 }) });
    expect(x.loaiBu).toBe("LATE_ENTRY_NEEDS_DECISION");
  });
});

describe("[PVH] gói 12/24/36 lần đầu — nghĩa I của MT-03a (BA §9b, §2.3)", () => {
  it.each([
    [13, 12, 13, 24, [], []],
    [15, 12, 13, 24, [13, 14], []],
    [19, 12, 13, 24, r(13, 18), []], //  6 bài đã qua = đúng trần ⇒ vẫn học vượt hết
    [20, 12, 13, 24, r(14, 19), [13]], // 7 > 6, KEEP_LATEST (mặc định)
    [13, 24, 13, 36, [], []],
    [15, 24, 13, 36, [13, 14], []],
  ] as const)("[PVH-10] KEEP_LATEST: lớp ở bài %i, mua %i ⇒ %i–%i, vượt %j, bỏ %j", (N, n, s, e, vuot, bo) => {
    const x = tinhPhamViHoc({ loai: "MILESTONE", soBuoi: n, baiKeTiepCuaLop: N });
    expect(x).toMatchObject({ start: s, end: e });
    expect(x.baiCanBu).toEqual(vuot);
    expect(x.baiBoQua).toEqual(bo);
  });

  it("[PVH-11] DROP_ALL: lớp ở bài 20 ⇒ bỏ TOÀN BỘ 13–19, không học vượt bài nào (nghịch lý MT-03b)", () => {
    const c = cfg({ catchUpOverCapPolicy: "DROP_ALL" });
    const x = tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 20, cauHinh: c });
    expect(x.baiCanBu).toEqual([]);
    expect(x.baiBoQua).toEqual(r(13, 19));
    // nghịch lý: vào ở bài 19 được 6 bài, vào ở bài 20 được 0
    const truoc = tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 19, cauHinh: c });
    expect(truoc.baiCanBu).toHaveLength(6);
  });

  it("[PVH-12] trần học vượt là THAM SỐ: đặt 0 ⇒ mọi bài đã qua bị bỏ (KEEP_LATEST không giữ bài nào)", () => {
    const x = tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 15, cauHinh: cfg({ catchUpMaxSessions: 0 }) });
    expect(x.baiCanBu).toEqual([]);
    expect(x.baiBoQua).toEqual([13, 14]);
  });

  it("[PVH-13] số buổi lẻ (CUSTOM) cùng luật như 12/24/36: bắt đầu đầu học phần", () => {
    const x = tinhPhamViHoc({ loai: "CUSTOM", soBuoi: 18, baiKeTiepCuaLop: 14 });
    expect(x).toMatchObject({ start: 13, end: 30, loaiBu: "CATCH_UP" });
    expect(x.baiCanBu).toEqual([13]);
  });

  it("[PVH-15] biên học phần: bài kế tiếp là bội của 12 thuộc học phần TRƯỚC (12 ⇒ HP1, 13 ⇒ HP2, 24 ⇒ HP2, 25 ⇒ HP3)", () => {
    const f = (N: number) => tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: N });
    expect(f(12)).toMatchObject({ start: 1, end: 12 });
    expect(f(12).baiCanBu).toEqual(r(6, 11)); // 11 bài đã qua > 6, KEEP_LATEST
    expect(f(13)).toMatchObject({ start: 13, end: 24 });
    expect(f(24)).toMatchObject({ start: 13, end: 24 });
    expect(f(25)).toMatchObject({ start: 25, end: 36 });
  });

  it("[PVH-14] phạm vi vượt giáo trình bị từ chối thay vì cắt lặng lẽ (mua 36 khi lớp ở bài 25 ⇒ 25–60)", () => {
    expect(maLoi(() => tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 36, baiKeTiepCuaLop: 25 }))).toBe(
      "PHAM_VI_VUOT_GIAO_TRINH",
    );
  });
});

describe("[PVH] mua tiếp và ân hạn (BA §10, MT-07)", () => {
  // Mua 12 (13–24), học hết, ân hạn bài 25–26 (2 buổi), mua tiếp 12.
  const truoc = { end: 24, graceUsed: 2 };

  it("[PVH-20] R1 (mặc định): ân hạn trừ vào gói mới ⇒ 25–36", () => {
    const x = tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 27, truoc });
    expect(x).toMatchObject({ start: 25, end: 36 });
  });

  it("[PVH-21] R2: ân hạn là quà ⇒ gói mới bắt đầu 27, kết thúc 38; chênh đúng 2 bài", () => {
    const x = tinhPhamViHoc({
      loai: "MILESTONE",
      soBuoi: 12,
      baiKeTiepCuaLop: 27,
      truoc,
      cauHinh: cfg({ graceCountsTowardNext: false }),
    });
    expect(x).toMatchObject({ start: 27, end: 38 });
  });

  it("[PVH-22] mua tiếp khi lớp đã đi qua vài bài trong lúc chưa đóng ⇒ LATE_RENEWAL, bù từ start tới N-1", () => {
    const x = tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 29, truoc: { end: 24, graceUsed: 0 } });
    expect(x).toMatchObject({ start: 25, end: 36, loaiBu: "LATE_RENEWAL" });
    expect(x.baiCanBu).toEqual(r(25, 28));
  });

  it("[PVH-23] mua tiếp đúng nhịp ⇒ không bù", () => {
    const x = tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 25, truoc: { end: 24, graceUsed: 0 } });
    expect(x.loaiBu).toBe("NONE");
  });
});

describe("[PVH] đầu vào rác và suy loại mua", () => {
  it("[PVH-30] đầu vào rác bị chặn", () => {
    expect(maLoi(() => tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 0, baiKeTiepCuaLop: 1 }))).toBe("DAU_VAO_KHONG_HOP_LE");
    expect(maLoi(() => tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 0 }))).toBe("DAU_VAO_KHONG_HOP_LE");
    expect(maLoi(() => tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 60, baiKeTiepCuaLop: 1 }))).toBe("DAU_VAO_KHONG_HOP_LE");
    expect(maLoi(() => tinhPhamViHoc({ loai: "FULL", soBuoi: 24, baiKeTiepCuaLop: 1 }))).toBe("LOAI_KHONG_KHOP_SO_BUOI");
    expect(maLoi(() => tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 48, baiKeTiepCuaLop: 1 }))).toBe("LOAI_KHONG_KHOP_SO_BUOI");
  });

  it("[PVH-31] bất biến: end − start + 1 = số buổi mua, cho mọi tổ hợp hợp lệ", () => {
    for (const n of [12, 18, 24, 36, 48]) {
      for (let N = 1; N <= 48; N++) {
        let x;
        try {
          x = tinhPhamViHoc({ loai: suyLoaiMua(n), soBuoi: n, baiKeTiepCuaLop: N });
        } catch (e) {
          expect(e).toBeInstanceOf(LoiPhamVi); // chỉ được từ chối kiểu PHAM_VI_VUOT_GIAO_TRINH
          continue;
        }
        expect({ n, N, dai: x.end - x.start + 1 }).toEqual({ n, N, dai: n });
        // bài cần bù và bài bỏ qua đều nằm TRONG phạm vi và không giao nhau
        for (const b of [...x.baiCanBu, ...x.baiBoQua]) {
          expect(b).toBeGreaterThanOrEqual(x.start);
          expect(b).toBeLessThanOrEqual(x.end);
        }
        expect(x.baiCanBu.filter((b) => x.baiBoQua.includes(b))).toEqual([]);
      }
    }
  });

  it("[PVH-32] suyLoaiMua", () => {
    expect(suyLoaiMua(48)).toBe("FULL");
    expect(suyLoaiMua(12)).toBe("MILESTONE");
    expect(suyLoaiMua(36)).toBe("MILESTONE");
    expect(suyLoaiMua(18)).toBe("CUSTOM");
  });
});

describe("[HVU] học vượt: số buổi theo cấu hình bài/buổi (BA §9a bảng nhạy cảm)", () => {
  it.each([
    [2, [3, 5, 7, 10, 18]],
    [3, [2, 3, 5, 7, 12]],
    [4, [2, 3, 4, 5, 9]],
  ] as const)("[HVU-01] %i bài/buổi", (baiMoiBuoi, kyVong) => {
    expect([5, 9, 14, 20, 36].map((k) => soBuoiHocVuot(k, baiMoiBuoi))).toEqual(kyVong);
  });

  it("[HVU-02] chia bài thành buổi giữ thứ tự và không mất bài", () => {
    expect(chiaBaiThanhBuoi(r(1, 7), 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chiaBaiThanhBuoi([], 3)).toEqual([]);
  });

  it("[HVU-03] tham số sai bị chặn", () => {
    expect(() => soBuoiHocVuot(-1)).toThrow(RangeError);
    expect(() => soBuoiHocVuot(3, 0)).toThrow(RangeError);
  });
});
