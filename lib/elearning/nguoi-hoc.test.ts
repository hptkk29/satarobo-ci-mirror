// @vitest-environment node
/**
 * [NH-*] P7 "Người học" — luật THUẦN (không DB). Ca có DB (cách ly cơ sở, số liệu từ lượt học thật): `tests/elearning/nguoi-hoc-db.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import { chuDangTre, chuVietTat, COT_XUAT_NGUOI_HOC, dangTre, dongXuatNguoiHoc, giaTriRiengBiet, gomTheoNguoi, locNguoiHoc, tomTatMotNguoi, trangThaiLuot, type DongNguoiHoc } from "./nguoi-hoc";
import { khoaNhacTrongNgay, ngayVn, soanLoiNhac, tomTatKetQuaNhac } from "./nhac-hoc-pure";

const NOW = new Date("2026-11-20T05:00:00.000Z");
const ngay = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

function dong(p: Partial<DongNguoiHoc> = {}): DongNguoiHoc {
  return {
    enrollmentId: "e1", userId: "u1", fullName: "Phạm Thu Trang", employeeCode: "SR-0198", departmentName: "Đào tạo", managerName: null,
    status: "NOT_STARTED", source: "ASSIGNMENT", progressPercent: 0, dueAtOriginal: ngay(10), completedAt: null, pausedAt: null, startedAt: null,
    courseId: "c1", courseTitle: "An toàn điện", assignmentId: "a1", assignmentTitle: "ATLĐ", isMandatory: true, jobTitle: "Giáo viên", centerId: "cs2", coSoMa: "CS2", dueAt: ngay(10),
    ...p,
  };
}

describe("[NH-T] ĐANG TRỄ ≠ HOÀN THÀNH TRỄ", () => {
  it("[NH-T-01] 🔴 chưa xong + hạn gốc đã qua ⇒ đang trễ; đã xong TRỄ (COMPLETED_LATE) KHÔNG phải đang trễ; chưa tới hạn ⇒ không", () => {
    expect(dangTre(dong({ dueAtOriginal: ngay(-3) }), NOW)).toBe(true);
    expect(dangTre(dong({ status: "IN_PROGRESS", progressPercent: 40, startedAt: ngay(-9), dueAtOriginal: ngay(-1) }), NOW)).toBe(true);
    expect(dangTre(dong({ status: "COMPLETED_LATE", completedAt: ngay(-1), dueAtOriginal: ngay(-3) }), NOW)).toBe(false);
    expect(dangTre(dong({ status: "COMPLETED", completedAt: ngay(-5), dueAtOriginal: ngay(-3) }), NOW)).toBe(false);
    expect(dangTre(dong({ dueAtOriginal: ngay(2) }), NOW)).toBe(false);
    expect(dangTre(dong({ dueAtOriginal: null }), NOW)).toBe(false);
  });

  it("[NH-T-02] 🔴 thu hồi / tạm dừng đồng hồ / công nhận tương đương KHÔNG bao giờ là đang trễ (dù hạn đã qua)", () => {
    const qua = { dueAtOriginal: ngay(-30) };
    expect(dangTre(dong({ ...qua, status: "REVOKED" }), NOW)).toBe(false);
    expect(dangTre(dong({ ...qua, pausedAt: ngay(-10) }), NOW)).toBe(false);
    expect(dangTre(dong({ ...qua, source: "EQUIVALENCE", status: "COMPLETED" }), NOW)).toBe(false);
  });

  it("[NH-T-03] nhãn một lượt: dùng ĐÚNG nhóm của báo cáo R1 + đang trễ; tám nhãn không chồng nhau", () => {
    expect(trangThaiLuot(dong({ status: "COMPLETED", completedAt: ngay(-4) }), NOW)).toBe("DAT_DUNG_HAN");
    expect(trangThaiLuot(dong({ status: "COMPLETED_LATE", completedAt: ngay(-1), dueAtOriginal: ngay(-3) }), NOW)).toBe("DAT_TRE");
    expect(trangThaiLuot(dong({ source: "EQUIVALENCE", status: "COMPLETED" }), NOW)).toBe("TUONG_DUONG");
    expect(trangThaiLuot(dong({ status: "IN_PROGRESS", progressPercent: 10, startedAt: ngay(-2) }), NOW)).toBe("DANG_HOC");
    expect(trangThaiLuot(dong(), NOW)).toBe("CHUA_BAT_DAU");
    expect(trangThaiLuot(dong({ dueAtOriginal: ngay(-2) }), NOW)).toBe("DANG_TRE");
    expect(trangThaiLuot(dong({ pausedAt: ngay(-1) }), NOW)).toBe("TAM_DUNG");
    expect(trangThaiLuot(dong({ status: "REVOKED" }), NOW)).toBe("THU_HOI");
  });
});

describe("[NH-G] gom theo người", () => {
  it("[NH-G-01] 🔴 'Bắt buộc đã đạt x/y': chỉ lượt BẮT BUỘC còn hiệu lực; đạt = xong đúng hạn / xong trễ / tương đương; thu hồi + tạm dừng KHÔNG vào mẫu số", () => {
    const t = tomTatMotNguoi(
      [
        dong({ enrollmentId: "1", status: "COMPLETED", completedAt: ngay(-4) }), // đạt
        dong({ enrollmentId: "2", status: "COMPLETED_LATE", completedAt: ngay(-1), dueAtOriginal: ngay(-3) }), // đạt (trễ)
        dong({ enrollmentId: "3", source: "EQUIVALENCE", status: "COMPLETED" }), // đạt (tương đương)
        dong({ enrollmentId: "4", status: "IN_PROGRESS", progressPercent: 20, startedAt: ngay(-2) }), // chưa đạt
        dong({ enrollmentId: "5", status: "REVOKED" }), // ngoài mẫu số
        dong({ enrollmentId: "6", pausedAt: ngay(-1) }), // ngoài mẫu số
        dong({ enrollmentId: "7", isMandatory: false, status: "COMPLETED", completedAt: ngay(-4) }), // không bắt buộc ⇒ không tính
      ],
      NOW,
    );
    expect(t).toMatchObject({ batBuoc: 4, batBuocDat: 3, soLuot: 7 });
  });

  it("[NH-G-02] 🔴 đang trễ đếm đúng + số ngày trễ NHIỀU NHẤT (so với hạn GỐC); cần chú ý ⇔ có lượt đang trễ", () => {
    const t = tomTatMotNguoi([dong({ enrollmentId: "1", dueAtOriginal: ngay(-2.5) }), dong({ enrollmentId: "2", dueAtOriginal: ngay(-6.5) }), dong({ enrollmentId: "3", dueAtOriginal: ngay(5) })], NOW);
    expect(t).toMatchObject({ dangTre: 2, treNhieuNhat: 7, canChuY: true, chuaBatDau: 3 });
    expect(tomTatMotNguoi([dong({ dueAtOriginal: ngay(5) })], NOW).canChuY).toBe(false);
  });

  it("[NH-G-03] sắp xếp: CẦN CHÚ Ý trước (trễ nhiều ngày nhất trước), rồi theo tên tiếng Việt", () => {
    const ds = [
      dong({ userId: "b", fullName: "Bình", dueAtOriginal: ngay(5) }),
      dong({ userId: "a", fullName: "An", dueAtOriginal: ngay(5) }),
      dong({ userId: "x", fullName: "Xuân", dueAtOriginal: ngay(-2.5) }),
      dong({ userId: "y", fullName: "Yến", dueAtOriginal: ngay(-9.5) }),
    ];
    expect(gomTheoNguoi(ds, NOW).map((t) => t.userId)).toEqual(["y", "x", "a", "b"]);
  });

  it("[NH-G-04] một người nhiều lượt ⇒ MỘT dòng; vai trò/phòng lấy từ lượt MỚI NHẤT (đầu danh sách)", () => {
    const t = gomTheoNguoi([dong({ enrollmentId: "m", jobTitle: "Trưởng nhóm" }), dong({ enrollmentId: "c", jobTitle: "Giáo viên" })], NOW);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ vaiTro: "Trưởng nhóm", soLuot: 2 });
  });
});

describe("[NH-L] lọc", () => {
  const tom = gomTheoNguoi(
    [dong({ userId: "1", fullName: "Đặng Quốc Bảo", employeeCode: "SR-0201", dueAtOriginal: ngay(-3) }), dong({ userId: "2", fullName: "Lê Văn Hùng", employeeCode: "SR-0150", dueAtOriginal: ngay(5) })],
    NOW,
  );
  it("[NH-L-01] tìm không phân biệt hoa/thường/dấu, theo tên HOẶC mã; chỉ-cần-chú-ý lọc đúng; rỗng ⇒ giữ nguyên", () => {
    expect(locNguoiHoc(tom, { q: "dang quoc" }).map((x) => x.userId)).toEqual(["1"]);
    expect(locNguoiHoc(tom, { q: "SR-0150" }).map((x) => x.userId)).toEqual(["2"]);
    expect(locNguoiHoc(tom, { q: "  " })).toHaveLength(2);
    expect(locNguoiHoc(tom, { chiCanChuY: true }).map((x) => x.userId)).toEqual(["1"]);
    expect(locNguoiHoc(tom, { q: "khong ai ten vay" })).toEqual([]);
  });
});

describe("[NH-C] cột của bảng (thiết kế QtNguoiHoc / QtNguoiHocTatCa)", () => {
  it("[NH-C-01] 🔴 khoá trễ NẶNG NHẤT + số ngày; nhiều khoá trễ ⇒ nêu thêm; chuỗi chấm đếm lượt đang học dở", () => {
    const t = tomTatMotNguoi(
      [
        dong({ enrollmentId: "1", courseTitle: "An toàn điện", dueAtOriginal: ngay(-4.5) }),
        dong({ enrollmentId: "2", courseTitle: "Dạy trial", dueAtOriginal: ngay(-1.5), status: "IN_PROGRESS", progressPercent: 10, startedAt: ngay(-3) }),
        dong({ enrollmentId: "3", courseTitle: "Văn hoá", status: "COMPLETED", completedAt: ngay(-9) }),
      ],
      NOW,
    );
    expect(t.treNhat).toEqual({ khoa: "An toàn điện", ngay: 5 });
    expect(t).toMatchObject({ coSo: "CS2", batBuoc: 3, batBuocDat: 1, batBuocDangHoc: 1, dangTre: 2 });
    expect(chuDangTre(t)).toEqual({ chu: "An toàn điện · 5 ngày (+1 khoá)", sac: "danger" });
  });

  it("[NH-C-02] 'Chưa bắt đầu' CHỈ khi MỌI lượt chưa mở; có lượt đã xong/đang học ⇒ '—' (không bịa nhãn 'Mới vào làm' — chưa có định nghĩa)", () => {
    const chua = tomTatMotNguoi([dong({ dueAtOriginal: ngay(9) })], NOW);
    expect(chuDangTre(chua)).toEqual({ chu: "Chưa bắt đầu", sac: "warning" });
    const mot = tomTatMotNguoi([dong({ dueAtOriginal: ngay(9) }), dong({ enrollmentId: "2", status: "COMPLETED", completedAt: ngay(-1) })], NOW);
    expect(chuDangTre(mot)).toEqual({ chu: "—", sac: "muted" });
  });

  it("[NH-C-03] avatar = chữ đầu của HAI TỪ CUỐI (đúng thiết kế: Phạm Thu Trang ⇒ TT, Lý Ngọc Hân ⇒ NH); tên một từ / rỗng không ném lỗi", () => {
    expect(chuVietTat("Phạm Thu Trang")).toBe("TT");
    expect(chuVietTat("Lý Ngọc Hân")).toBe("NH");
    expect(chuVietTat("Đặng Quốc Bảo")).toBe("QB");
    expect(chuVietTat("An")).toBe("AN");
    expect(chuVietTat("  ")).toBe("?");
  });

  it("[NH-C-04] lọc theo cơ sở + vai trò (khớp CHÍNH XÁC) và giá trị riêng biệt cho ô chọn", () => {
    const tom = gomTheoNguoi(
      [dong({ userId: "1", coSoMa: "CS1", jobTitle: "Giáo viên" }), dong({ userId: "2", coSoMa: "CS2", jobTitle: "Tư vấn viên" }), dong({ userId: "3", coSoMa: "CS2", jobTitle: "Giáo viên" })],
      NOW,
    );
    expect(locNguoiHoc(tom, { coSo: "CS2" }).map((x) => x.userId).sort()).toEqual(["2", "3"]);
    expect(locNguoiHoc(tom, { coSo: "CS2", vaiTro: "Giáo viên" }).map((x) => x.userId)).toEqual(["3"]);
    expect(giaTriRiengBiet(tom, "coSo")).toEqual(["CS1", "CS2"]);
    expect(giaTriRiengBiet(tom, "vaiTro")).toEqual(["Giáo viên", "Tư vấn viên"]);
  });

  it("[NH-C-05] 🔴 dòng xuất Excel: đủ cột theo thứ tự, KHÔNG có trường nhạy cảm (không SĐT/email) và số cột khớp tiêu đề", () => {
    const t = tomTatMotNguoi([dong({ dueAtOriginal: ngay(-2.5), courseTitle: "ATLĐ" })], NOW);
    const d = dongXuatNguoiHoc(t);
    expect(d).toHaveLength(COT_XUAT_NGUOI_HOC.length);
    expect(d.slice(0, 5)).toEqual(["SR-0198", "Phạm Thu Trang", "Giáo viên", "Đào tạo", "CS2"]);
    expect(d[10]).toBe("ATLĐ");
    expect(COT_XUAT_NGUOI_HOC.join("|")).not.toMatch(/điện thoại|SĐT|email|sinh/i);
  });
});

describe("[NH-R] nhắc học: lời nhắc + khoá chống trùng (thuần)", () => {
  it("[NH-R-01] 🔴 người còn nợ khoá TRỄ ⇒ lời nhắc nêu khoá trễ nhất + số ngày; một khoá trễ ⇒ tiêu đề nêu thẳng khoá", () => {
    const l = soanLoiNhac([dong({ courseTitle: "An toàn điện", dueAtOriginal: ngay(-4.5) })], NOW)!;
    expect(l.title).toBe('Khoá "An toàn điện" đã trễ hạn 5 ngày');
    const hai = soanLoiNhac([dong({ enrollmentId: "1", courseTitle: "A", dueAtOriginal: ngay(-1.5) }), dong({ enrollmentId: "2", courseTitle: "B", dueAtOriginal: ngay(-6.5) })], NOW)!;
    expect(hai.title).toBe("Bạn có 2 khoá đang trễ hạn");
    expect(hai.body).toContain('"B" (7 ngày)');
  });

  it("[NH-R-02] 🔴 không còn nợ gì (xong hết / thu hồi / tạm dừng) ⇒ null — KHÔNG gửi lời nhắc rỗng nghĩa", () => {
    expect(soanLoiNhac([dong({ status: "COMPLETED", completedAt: ngay(-1) }), dong({ enrollmentId: "2", status: "REVOKED" }), dong({ enrollmentId: "3", pausedAt: ngay(-1) })], NOW)).toBeNull();
    expect(soanLoiNhac([], NOW)).toBeNull();
  });

  it("[NH-R-03] còn nợ nhưng CHƯA trễ ⇒ nhắc nhẹ, không nói 'trễ'", () => {
    const l = soanLoiNhac([dong({ courseTitle: "Văn hoá", dueAtOriginal: ngay(8) })], NOW)!;
    expect(l.title).toBe('Nhắc học: "Văn hoá"');
    expect(`${l.title} ${l.body}`).not.toMatch(/trễ/);
    expect(soanLoiNhac([dong({ enrollmentId: "1", dueAtOriginal: ngay(8) }), dong({ enrollmentId: "2", dueAtOriginal: ngay(9) })], NOW)!.title).toBe("Nhắc học: còn 2 khoá cần hoàn thành");
  });

  it("[NH-R-04] 🔴 khoá chống trùng theo NGÀY GIỜ VN: cùng người cùng ngày ⇒ cùng khoá; sang ngày VN khác ⇒ khoá khác (17:30 UTC đã là sáng hôm sau ở VN)", () => {
    const a = new Date("2026-11-20T10:00:00Z");
    const b = new Date("2026-11-20T16:59:00Z");
    const c = new Date("2026-11-20T17:30:00Z");
    expect(khoaNhacTrongNgay("u1", a)).toBe(khoaNhacTrongNgay("u1", b));
    expect(khoaNhacTrongNgay("u1", c)).not.toBe(khoaNhacTrongNgay("u1", b));
    expect(khoaNhacTrongNgay("u1", a)).toBe("nhac-hoc:u1:20261120");
    expect(ngayVn(c)).toBe("20261121");
    expect(khoaNhacTrongNgay("u2", a)).not.toBe(khoaNhacTrongNgay("u1", a));
  });

  it("[NH-R-05] câu báo kết quả đếm đủ mọi nhóm; có người chưa gửi được/ngoài phạm vi ⇒ mức 'warning' (không báo xanh oan)", () => {
    expect(tomTatKetQuaNhac({ daNhac: ["a", "b"], daNhacHomNay: [], khongCanNhac: [], khongThay: [], chuaGuiDuoc: [] })).toEqual({ sac: "success", chu: "Đã nhắc 2 người" });
    const t = tomTatKetQuaNhac({ daNhac: ["a"], daNhacHomNay: ["b"], khongCanNhac: ["c"], khongThay: ["d"], chuaGuiDuoc: ["e"] });
    expect(t.sac).toBe("warning");
    expect(t.chu).toBe("Đã nhắc 1 người · 1 người đã được nhắc hôm nay · 1 người không còn khoá nào phải học · 1 người chưa gửi được thông báo · 1 người ngoài phạm vi của bạn — đã bỏ qua");
    expect(tomTatKetQuaNhac({ daNhac: [], daNhacHomNay: ["b"], khongCanNhac: [], khongThay: [], chuaGuiDuoc: [] }).sac).toBe("info");
    expect(tomTatKetQuaNhac({ daNhac: [], daNhacHomNay: [], khongCanNhac: [], khongThay: [], chuaGuiDuoc: [] }).chu).toBe("Không có ai để nhắc");
  });
});
