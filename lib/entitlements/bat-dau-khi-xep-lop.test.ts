import { describe, expect, it } from "vitest";
import { tinhBatDauKhiXepLop, type DauVaoXepLop } from "./bat-dau-khi-xep-lop";
import { CAU_HINH_PHAM_VI_MAC_DINH, LoiPhamVi, tinhPhamViHoc, type CauHinhPhamVi } from "./pham-vi-hoc";

// n = 6 (catchUpMaxSessions), 48 bài, 12 bài/học phần — mặc định của hệ thống; test đặt tường minh để không phụ thuộc mặc định.
const CH = CAU_HINH_PHAM_VI_MAC_DINH;
const r = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const maLoi = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof LoiPhamVi ? e.ma : `KHAC:${String(e)}`;
  }
};
const full = (N: number, cauHinh: CauHinhPhamVi = CH, baiMoiBuoiHocVuot = 3) =>
  tinhBatDauKhiXepLop({ loai: "FULL", soBuoi: 48, baiKeTiepCuaLop: N, cauHinh, baiMoiBuoiHocVuot });
const le = (loai: "MILESTONE" | "CUSTOM", soBuoi: number, N: number, cauHinh: CauHinhPhamVi = CH) =>
  tinhBatDauKhiXepLop({ loai, soBuoi, baiKeTiepCuaLop: N, cauHinh, baiMoiBuoiHocVuot: 3 });

describe("[XL] gói TRỌN 48 — theo quyết định 21/10/2026 (n = 6: ≤ n tạo case bù miễn phí, > n vào từ buổi kế tiếp)", () => {
  it("[XL-01] lớp chưa dạy bài nào (N=1): vào từ đầu, start=1, không bù, không học vượt", () => {
    expect(full(1)).toMatchObject({
      startLesson: 1,
      endLesson: 48,
      catchupMode: "NONE",
      skippedLessons: [],
      lessonsBeforeStart: [],
      freeMakeupLessons: [],
      requiredCatchupLessons: [],
      catchupSessions: [],
      canXemTay: false,
    });
  });

  it.each([
    [2, 1],
    [3, 2],
    [5, 4],
    [6, 5],
    [7, 6], // N=7 ⇒ đã dạy 6 = ĐÚNG n ⇒ vẫn tạo case bù
  ])("[XL-02] lớp ở bài %i (đã dạy %i ≤ n): CATCH_UP — MỌI bài đã qua thành nhu cầu bù (case bù miễn phí), không còn vùng «bù miễn phí không tạo case»", (N, daDay) => {
    const x = full(N);
    expect(x).toMatchObject({ startLesson: 1, endLesson: 48, catchupMode: "CATCH_UP", skippedLessons: [], freeMakeupLessons: [], canXemTay: false });
    expect(x.requiredCatchupLessons).toEqual(r(1, daDay));
    expect(x.catchupSessions.flat()).toEqual(r(1, daDay));
  });

  it("[XL-03] đúng n (đã dạy 6): chia 2 buổi bù, 3 bài/buổi", () => {
    const x = full(7);
    expect(x.catchupSessions).toHaveLength(2);
    expect(x.catchupSessions).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("[XL-04] n+1 (đã dạy 7): vào từ buổi kế tiếp — bỏ qua MỌI bài đã qua, KHÔNG bù, KHÔNG học vượt bài nào", () => {
    const x = full(8);
    expect(x).toMatchObject({ startLesson: 1, endLesson: 48, catchupMode: "OVER_CAP_SKIPPED", canXemTay: true, freeMakeupLessons: [], requiredCatchupLessons: [], catchupSessions: [] });
    expect(x.skippedLessons).toEqual(r(1, 7));
  });

  it("[XL-05] lớp đã học rất nhiều (đã dạy 36): bỏ cả 36 bài; bài bỏ qua LIỀN từ start (khớp skippedSessions + baiBoQuaTuSo)", () => {
    const x = full(37);
    expect(x.skippedLessons).toEqual(r(1, 36));
    expect(x.requiredCatchupLessons).toEqual([]);
    expect(x.skippedLessons[0]).toBe(x.startLesson);
  });

  it("[XL-06] chính sách vượt trần cũ (KEEP_LATEST / DROP_ALL) KHÔNG còn tác dụng với gói trọn: cùng kết quả", () => {
    const keep = full(8, { ...CH, catchUpOverCapPolicy: "KEEP_LATEST" });
    const drop = full(8, { ...CH, catchUpOverCapPolicy: "DROP_ALL" });
    expect(keep).toEqual(drop);
    expect(keep.skippedLessons).toEqual(r(1, 7));
    expect(keep.requiredCatchupLessons).toEqual([]);
  });

  it("[XL-07] n là CẤU HÌNH theo cơ sở: n=3 ⇒ đã dạy 4 là vượt (bỏ hết); n=12 ⇒ đã dạy 12 vẫn bù; lateEntryMaxLessons KHÔNG còn được đọc", () => {
    expect(full(5, { ...CH, catchUpMaxSessions: 3 })).toMatchObject({ catchupMode: "OVER_CAP_SKIPPED", skippedLessons: [1, 2, 3, 4], requiredCatchupLessons: [] });
    expect(full(13, { ...CH, catchUpMaxSessions: 12 })).toMatchObject({ catchupMode: "CATCH_UP", requiredCatchupLessons: r(1, 12) });
    expect(full(13, { ...CH, catchUpMaxSessions: 12 }).catchupSessions.flat()).toEqual(r(1, 12));
    expect(full(4, { ...CH, lateEntryMaxLessons: 0 })).toEqual(full(4, { ...CH, lateEntryMaxLessons: 12 }));
    expect(full(4, { ...CH, lateEntryMaxLessons: 0 }).catchupMode).toBe("CATCH_UP");
  });

  it("[XL-08] n = 0: không bài nào được bù, mọi bài đã qua bị bỏ", () => {
    const x = full(6, { ...CH, catchUpMaxSessions: 0 });
    expect(x.requiredCatchupLessons).toEqual([]);
    expect(x.skippedLessons).toEqual(r(1, 5));
  });

  it("[XL-09] lớp đã đi quá giáo trình: chỉ tính tới bài 48, không tạo bài 49+", () => {
    const x = full(60, { ...CH, catchUpMaxSessions: 100, lateEntryMaxLessons: 0 });
    expect(x.requiredCatchupLessons).toEqual(r(1, 48));
    expect(Math.max(...x.requiredCatchupLessons)).toBe(48);
  });
});

describe("[XL] gói KHÔNG TRỌN (12/24/36/lẻ) — bài kế tiếp của lớp LÀ bài đầu của học viên", () => {
  it.each([
    ["MILESTONE", 12, 1, 1, 12],
    ["MILESTONE", 12, 5, 5, 16], //  cũ: neo đầu học phần ⇒ start 1 + học vượt 1–4; mới: start 5
    ["MILESTONE", 24, 13, 13, 36],
    ["MILESTONE", 36, 10, 10, 45],
    ["CUSTOM", 9, 20, 20, 28],
    ["MILESTONE", 12, 37, 37, 48], // chạm đúng bài 48
  ] as const)("[XL-10] %s %i buổi, lớp ở bài %i ⇒ bài %i–%i", (loai, soBuoi, N, start, end) => {
    const x = le(loai, soBuoi, N);
    expect(x).toMatchObject({ startLesson: start, endLesson: end, catchupMode: "NONE", skippedLessons: [], freeMakeupLessons: [], requiredCatchupLessons: [], catchupSessions: [], canXemTay: false });
    expect(x.endLesson - x.startLesson + 1).toBe(soBuoi); // INV-01/02
    expect(x.lessonsBeforeStart).toEqual(N > 1 ? r(1, N - 1) : []);
  });

  it("[XL-11] KHÔNG tạo học vượt dù lớp đã dạy rất nhiều: N=30 gói 12 buổi ⇒ start 30, bỏ qua 29 bài trước, 0 bài học vượt", () => {
    const x = le("MILESTONE", 12, 30);
    expect(x.startLesson).toBe(30);
    expect(x.lessonsBeforeStart).toHaveLength(29);
    expect(x.requiredCatchupLessons).toEqual([]);
    // cột skippedSessions chỉ đếm bài bỏ qua TRONG phạm vi — bài trước start KHÔNG được đếm (nếu đếm, `tinhConLai` trừ oan 29 buổi đã trả tiền)
    expect(x.skippedLessons).toEqual([]);
  });

  it("[XL-12] phạm vi vượt giáo trình ⇒ ném LoiPhamVi (người gọi treo review, KHÔNG đoán): 12 buổi mà lớp ở bài 38 ⇒ 38–49", () => {
    expect(maLoi(() => le("MILESTONE", 12, 38))).toBe("PHAM_VI_VUOT_GIAO_TRINH");
    expect(maLoi(() => le("MILESTONE", 12, 37))).toBeNull(); //  ranh giới: 37–48 vừa khít
  });

  it("[XL-13] đối chứng với hàm cũ: tinhPhamViHoc vẫn neo ở đầu học phần (không bị sửa) — hai hàm KHÁC NHAU có chủ đích, không phải lỗi", () => {
    const cu = tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 5, cauHinh: CH });
    expect(cu).toMatchObject({ start: 1, end: 12, baiCanBu: [1, 2, 3, 4] });
    expect(le("MILESTONE", 12, 5)).toMatchObject({ startLesson: 5, endLesson: 16 });
  });
});

describe("[XL] kiểm đầu vào và mua tiếp", () => {
  it("[XL-14] đầu vào sai ⇒ LoiPhamVi do tinhPhamViHoc (không viết lại các phép kiểm)", () => {
    expect(maLoi(() => full(0))).toBe("DAU_VAO_KHONG_HOP_LE");
    expect(maLoi(() => tinhBatDauKhiXepLop({ loai: "FULL", soBuoi: 12, baiKeTiepCuaLop: 3, cauHinh: CH, baiMoiBuoiHocVuot: 3 }))).toBe("LOAI_KHONG_KHOP_SO_BUOI");
    expect(maLoi(() => tinhBatDauKhiXepLop({ loai: "MILESTONE", soBuoi: 60, baiKeTiepCuaLop: 1, cauHinh: CH, baiMoiBuoiHocVuot: 3 }))).not.toBeNull();
  });

  it("[XL-15] baiMoiBuoiHocVuot không hợp lệ ⇒ ném (không im lặng chia cho 0)", () => {
    expect(maLoi(() => full(7, CH, 0))).toBe("DAU_VAO_KHONG_HOP_LE");
    expect(maLoi(() => full(7, CH, 1.5))).toBe("DAU_VAO_KHONG_HOP_LE");
    expect(full(7, CH, 1).catchupSessions).toHaveLength(6);
  });

  it("[XL-16] mua tiếp (truoc): giữ nguyên tinhPhamViHoc — nối vào bài cuối lần trước, bài lỡ học bù miễn phí", () => {
    const vao: DauVaoXepLop = { loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 20, truoc: { end: 12, graceUsed: 0 }, cauHinh: CH, baiMoiBuoiHocVuot: 3 };
    const goc = tinhPhamViHoc({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 20, truoc: { end: 12, graceUsed: 0 }, cauHinh: CH });
    const x = tinhBatDauKhiXepLop(vao);
    expect(x).toMatchObject({ startLesson: goc.start, endLesson: goc.end, catchupMode: "FREE_MAKEUP", requiredCatchupLessons: [], skippedLessons: [] });
    expect(x.freeMakeupLessons).toEqual(goc.baiCanBu);
    expect(tinhBatDauKhiXepLop({ ...vao, baiKeTiepCuaLop: 13 }).catchupMode).toBe("NONE");
  });

  it("[XL-17] thuần: cùng đầu vào ⇒ cùng kết quả, không đổi đầu vào", () => {
    const vao: DauVaoXepLop = { loai: "FULL", soBuoi: 48, baiKeTiepCuaLop: 8, cauHinh: CH, baiMoiBuoiHocVuot: 3 };
    const snap = JSON.stringify(vao);
    expect(tinhBatDauKhiXepLop(vao)).toEqual(tinhBatDauKhiXepLop(vao));
    expect(JSON.stringify(vao)).toBe(snap);
  });
});
