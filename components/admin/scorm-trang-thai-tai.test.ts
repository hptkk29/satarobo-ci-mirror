// [STT-nn] Máy trạng thái tải bài giảng SCORM/PDF — luật nằm ở đây, không ở component.
import { describe, it, expect } from "vitest";
import {
  danhGiaTaiLieu,
  hanhDongThuLai,
  HEN_CHAM_MS,
  HEN_QUA_HAN_MS,
  lapTrangThaiTai,
  maLoiTuHttp,
  phanLoaiVanBanLoi,
  SO_LAN_TU_THU_LAI_TOI_DA,
  thongDiepLoi,
  trangThaiTaiBanDau,
  type MaLoi,
  type MoTaTaiLieu,
  type SuKien,
} from "./scorm-trang-thai-tai";

const chay = (...es: SuKien[]) => es.reduce(lapTrangThaiTai, trangThaiTaiBanDau());
const html = (over: Partial<MoTaTaiLieu> = {}): MoTaTaiLieu => ({
  href: "http://x/api/scorm/asset/cabc/res/index.html",
  contentType: "text/html",
  readyState: "complete",
  vanBan: "",
  ...over,
});

describe("[STT-1] mã HTTP của lần thăm dò → mã lỗi", () => {
  const bang: Array<[number, MaLoi | null]> = [
    [200, null],
    [206, null],
    [304, null],
    [416, null],
    [401, "ve-het-han"],
    [403, "ve-het-han"],
    [404, "khong-thay"],
    [410, "khong-thay"],
    [429, "may-chu"],
    [500, "may-chu"],
    [502, "may-chu"],
    [504, "may-chu"],
  ];
  for (const [st, ma] of bang) {
    it(`[STT-1] ${st} → ${ma}`, () => expect(maLoiTuHttp(st)).toBe(ma));
  }
});

describe("[STT-2] trang lỗi dạng chữ trong iframe", () => {
  it("[STT-2a] đúng ba câu của route asset", () => {
    expect(phanLoaiVanBanLoi("Forbidden")).toBe("ve-het-han");
    expect(phanLoaiVanBanLoi("Not found")).toBe("khong-thay");
    expect(phanLoaiVanBanLoi("Upstream error")).toBe("may-chu");
  });
  it("[STT-2b] văn bản dài / lạ KHÔNG bị coi là lỗi (đừng nuốt bài giảng có chữ 'forbidden')", () => {
    expect(phanLoaiVanBanLoi("Forbidden " + "x".repeat(100))).toBeNull();
    expect(phanLoaiVanBanLoi("Bài 1: Giới thiệu robot")).toBeNull();
    expect(phanLoaiVanBanLoi("")).toBeNull();
  });
  it("[STT-2c] tài liệu không phải HTML ⇒ lỗi, kể cả chữ lạ (mặc định may-chu)", () => {
    expect(danhGiaTaiLieu(html({ contentType: "text/plain", vanBan: "Forbidden" }))).toEqual({ kq: "loi", ma: "ve-het-han" });
    expect(danhGiaTaiLieu(html({ contentType: "text/plain", vanBan: "Not found" }))).toEqual({ kq: "loi", ma: "khong-thay" });
    expect(danhGiaTaiLieu(html({ contentType: "application/json", vanBan: '{"a":1}' }))).toEqual({ kq: "loi", ma: "may-chu" });
  });
  it("[STT-2d] HTML nhỏ chỉ có chữ lỗi cũng là lỗi", () => {
    expect(danhGiaTaiLieu(html({ vanBan: "Upstream error" }))).toEqual({ kq: "loi", ma: "may-chu" });
  });
  it("[STT-2e] about:blank/không đọc được/đang nạp/xong phân biệt đúng", () => {
    expect(danhGiaTaiLieu(html({ href: "about:blank" }))).toEqual({ kq: "chua-ro" });
    expect(danhGiaTaiLieu(null)).toEqual({ kq: "khong-doc" });
    expect(danhGiaTaiLieu(html({ readyState: "interactive" }))).toEqual({ kq: "dang-doc" });
    expect(danhGiaTaiLieu(html())).toEqual({ kq: "tot" });
    // Môi trường không khai contentType: coi như HTML, không báo lỗi oan.
    expect(danhGiaTaiLieu(html({ contentType: "" }))).toEqual({ kq: "tot" });
  });
});

describe("[STT-3] chuyển trạng thái", () => {
  it("[STT-3a] bắt đầu dang-tai, chưa chậm, chưa lỗi", () => {
    const s = trangThaiTaiBanDau();
    expect(s).toMatchObject({ loai: "dang-tai", ma: null, cham: false, lanThu: 0 });
  });

  it("[STT-3b] chậm là NHẮC, không phải lỗi: vẫn dang-tai và vẫn sẵn sàng được", () => {
    const cham = chay({ loai: "cham" });
    expect(cham).toMatchObject({ loai: "dang-tai", cham: true, ma: null });
    expect(lapTrangThaiTai(cham, { loai: "tai-lieu", ketQua: { kq: "tot" } }).loai).toBe("san-sang");
  });

  it("[STT-3c] thăm dò 403 ⇒ loi/ve-het-han; 404 ⇒ khong-thay; 502 ⇒ may-chu", () => {
    expect(chay({ loai: "tham-do", trangThaiHttp: 403 })).toMatchObject({ loai: "loi", ma: "ve-het-han" });
    expect(chay({ loai: "tham-do", trangThaiHttp: 404 })).toMatchObject({ loai: "loi", ma: "khong-thay" });
    expect(chay({ loai: "tham-do", trangThaiHttp: 502 })).toMatchObject({ loai: "loi", ma: "may-chu" });
  });

  it("[STT-3d] thăm dò 206 KHÔNG tự đưa tới sẵn sàng (chưa có nội dung thật)", () => {
    const s = chay({ loai: "tham-do", trangThaiHttp: 206 });
    expect(s).toMatchObject({ loai: "dang-tai", thamDo: "tot" });
  });

  it("[STT-3e] mất mạng ⇒ loi/mang; hạn chót ⇒ loi/qua-han", () => {
    expect(chay({ loai: "tham-do-mang" })).toMatchObject({ loai: "loi", ma: "mang" });
    expect(chay({ loai: "qua-han" })).toMatchObject({ loai: "loi", ma: "qua-han" });
  });

  it("[STT-3f] iframe nạp trang lỗi dạng chữ ⇒ loi (đúng mã), dù onLoad 'thành công'", () => {
    const k = danhGiaTaiLieu(html({ contentType: "text/plain", vanBan: "Forbidden" }));
    expect(chay({ loai: "tai-lieu", ketQua: k })).toMatchObject({ loai: "loi", ma: "ve-het-han" });
  });

  it("[STT-3g] nội dung thật thắng lỗi mềm: quá hạn/mất mạng rồi iframe vẫn nạp xong ⇒ san-sang", () => {
    const tot = { loai: "tai-lieu", ketQua: { kq: "tot" } } as const;
    expect(chay({ loai: "qua-han" }, tot).loai).toBe("san-sang");
    expect(chay({ loai: "tham-do-mang" }, tot).loai).toBe("san-sang");
    expect(chay({ loai: "tham-do", trangThaiHttp: 502 }, tot).loai).toBe("san-sang");
  });

  it("[STT-3h] san-sang là chốt: sự kiện muộn không kéo về lỗi", () => {
    const xong = chay({ loai: "tai-lieu", ketQua: { kq: "tot" } });
    for (const e of [
      { loai: "tham-do", trangThaiHttp: 403 },
      { loai: "tham-do-mang" },
      { loai: "qua-han" },
      { loai: "cham" },
      { loai: "tai-lieu", ketQua: { kq: "loi", ma: "khong-thay" } },
    ] as SuKien[]) {
      expect(lapTrangThaiTai(xong, e)).toBe(xong);
    }
  });

  it("[STT-3i] lỗi cứng không bị lỗi mềm đè; lỗi mềm bị mã HTTP thật đè", () => {
    const cung = chay({ loai: "tham-do", trangThaiHttp: 403 });
    expect(lapTrangThaiTai(cung, { loai: "qua-han" })).toBe(cung);
    expect(lapTrangThaiTai(cung, { loai: "tham-do-mang" })).toBe(cung);
    expect(chay({ loai: "qua-han" }, { loai: "tham-do", trangThaiHttp: 404 })).toMatchObject({ ma: "khong-thay" });
  });

  it("[STT-3j] không đọc được iframe: chờ thăm dò rồi mới kết luận (fail-open khi thăm dò báo tốt)", () => {
    const khongDoc = { loai: "tai-lieu", ketQua: { kq: "khong-doc" } } as const;
    // Thăm dò chưa về: ghi nhớ, còn dang-tai.
    expect(chay(khongDoc)).toMatchObject({ loai: "dang-tai", iframeKhongDoc: true });
    // Thăm dò về tốt SAU: san-sang. Thăm dò tốt TRƯỚC rồi iframe không đọc được: san-sang.
    expect(chay(khongDoc, { loai: "tham-do", trangThaiHttp: 206 }).loai).toBe("san-sang");
    expect(chay({ loai: "tham-do", trangThaiHttp: 206 }, khongDoc).loai).toBe("san-sang");
    // Thăm dò báo mất mạng: lỗi mạng (đây là trang lỗi của trình duyệt).
    expect(chay(khongDoc, { loai: "tham-do-mang" })).toMatchObject({ loai: "loi", ma: "mang" });
  });

  it("[STT-3k] tài liệu chưa rõ/đang đọc không đổi gì", () => {
    const s0 = trangThaiTaiBanDau();
    expect(lapTrangThaiTai(s0, { loai: "tai-lieu", ketQua: { kq: "chua-ro" } })).toBe(s0);
    expect(lapTrangThaiTai(s0, { loai: "tai-lieu", ketQua: { kq: "dang-doc" } })).toBe(s0);
  });

  it("[STT-3l] ẩn nhắc: chỉ khi đã chậm; sau đó hạn chót KHÔNG bật lại lớp phủ", () => {
    const s0 = trangThaiTaiBanDau();
    expect(lapTrangThaiTai(s0, { loai: "an-nhac" })).toBe(s0); // chưa chậm: không có gì để ẩn
    const an = chay({ loai: "cham" }, { loai: "an-nhac" });
    expect(an).toMatchObject({ loai: "dang-tai", anNhac: true });
    expect(lapTrangThaiTai(an, { loai: "qua-han" })).toBe(an);
    // Nhưng lỗi cứng vẫn hiện (bằng chứng thật).
    expect(lapTrangThaiTai(an, { loai: "tham-do", trangThaiHttp: 403 })).toMatchObject({ loai: "loi", anNhac: false });
  });
});

describe("[STT-4] thử lại: chỉ do người dùng, không có đường tự thử", () => {
  it("[STT-4a] hằng số tự thử lại = 0", () => {
    expect(SO_LAN_TU_THU_LAI_TOI_DA).toBe(0);
  });

  it("[STT-4b] chỉ sự kiện thu-lai tăng lanThu; mọi sự kiện khác giữ nguyên lanThu", () => {
    const sk: SuKien[] = [
      { loai: "cham" },
      { loai: "qua-han" },
      { loai: "tham-do", trangThaiHttp: 500 },
      { loai: "tham-do-mang" },
      { loai: "tai-lieu", ketQua: { kq: "loi", ma: "may-chu" } },
      { loai: "an-nhac" },
      { loai: "san-sang" },
    ];
    let s = trangThaiTaiBanDau(3);
    for (const e of sk) {
      s = lapTrangThaiTai(s, e);
      expect(s.lanThu).toBe(3);
    }
    expect(lapTrangThaiTai(s, { loai: "thu-lai" })).toMatchObject({ loai: "dang-tai", lanThu: 4, ma: null, thamDo: "chua" });
  });

  it("[STT-4c] 403 ⇒ tải lại CẢ TRANG (cấp vé mới); các lỗi khác ⇒ nạp lại khung", () => {
    expect(hanhDongThuLai("ve-het-han")).toBe("tai-lai-trang");
    for (const ma of ["khong-thay", "may-chu", "mang", "qua-han"] as const) expect(hanhDongThuLai(ma)).toBe("nap-lai-khung");
  });

  it("[STT-4d] mỗi mã lỗi có thông điệp tiếng Việt riêng (không trùng tiêu đề)", () => {
    const ds = (["ve-het-han", "khong-thay", "may-chu", "mang", "qua-han"] as const).map((m) => thongDiepLoi(m));
    expect(new Set(ds.map((d) => d.tieuDe)).size).toBe(5);
    for (const d of ds) expect(d.noiDung.length).toBeGreaterThan(20);
  });

  it("[STT-4e] hạn chót lớn hơn mốc nhắc", () => {
    expect(HEN_QUA_HAN_MS).toBeGreaterThan(HEN_CHAM_MS);
  });
});
