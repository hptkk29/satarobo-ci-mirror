// Ca [TTH-*] — MỘT DÒNG trên màn hoá đơn vẽ nút gì, nút nào tắt, và TẮT VÌ SAO.
//
// Khuôn `lib/payments/qr-theo-dot.ts`: quyết định "dòng này vẽ gì" ở MỘT chỗ thuần, không viết lại
// điều kiện trong component. Luật 12: nút chắc chắn bị từ chối là lời hứa suông — nên mọi nút TẮT
// phải kèm câu lý do, và câu đó phải nói bằng ngôn ngữ của nguyên nhân.
//
// Luật "Điều chỉnh sau GĐ 0" (PLAN §12): đo prod 25/09 có 22/31 khoản chờ THIẾU ghi danh. Nên chốt
// hoá đơn KHÔNG được phụ thuộc vào việc xác nhận được khoản — khoản chưa xác nhận được chỉ là
// CẢNH BÁO, không chặn trả hoá đơn cho khách. Thiếu thông tin người mua trên hệ thống cũng chỉ là
// cảnh báo: tờ hoá đơn đã được xuất ở MISA rồi (chủ dự án 26/09).
import { describe, it, expect } from "vitest";
import { hanhDongChoDong, hanhDongGuiLai, nhanNutXacNhan, nutHuyHoaDon, TOI_THIEU_LY_DO_HOA_DON } from "./trang-thai-hoa-don";
import { CAU_HOAN_CHAN_XAC_NHAN, lyDoHoanChanXacNhan } from "./hoan-tien-don";

type Vao = Parameters<typeof hanhDongChoDong>[0];
const NHAP_DU = { coTepPdf: true, kyHieu: "1C26TSR", soHoaDon: "127", ngayPhatHanh: new Date("2026-09-04T00:00:00Z") };
const vao = (o: Partial<Vao> = {}): Vao => ({
  lanThu: { trangThai: "DU", thieu: 0, nhanDot: "Đợt 1", canhBao: [], nghiTrungVi: [] },
  hoaDonNhap: NHAP_DU,
  coQuyen: true,
  khoOk: true,
  emailNhan: "phuhuynh@gmail.com",
  guiEmailKhach: true,
  thieuNguoiMua: [],
  khoanChuaXacNhanDuoc: [],
  boQuaNghiTrung: false,
  xuatTheoSoDaThu: false,
  donDaHuy: false,
  hoanChan: null,
  ...o,
});

describe("[TTH-01] đường vui: đủ tệp + đủ số ⇒ Xác nhận sáng", () => {
  it("mọi nút bật, không lý do", () => {
    const r = hanhDongChoDong(vao());
    expect(r.xacNhan).toEqual({ bat: true, nhan: "Xác nhận & gửi tới ph******@gmail.com" });
    expect(r.taiPhieu).toBe(true);
    expect(r.taiLen.bat).toBe(true);
    expect(r.khongXuat).toBe(true);
  });
});

describe("[TTH-02] thứ tự lý do tắt nút — nguyên nhân GỐC nói trước", () => {
  it("không có quyền ⇒ mọi thứ tắt, nói thiếu quyền gì", () => {
    const r = hanhDongChoDong(vao({ coQuyen: false }));
    expect(r.taiPhieu).toBe(false);
    expect(r.taiLen).toEqual({ bat: false, lyDo: expect.stringContaining("payments:confirm") });
    expect(r.xacNhan.bat).toBe(false);
    expect(r.khongXuat).toBe(false);
  });

  it("đợt bị huỷ ⇒ không tải lên, không xác nhận; vẫn cho 'không xuất'", () => {
    const r = hanhDongChoDong(vao({ lanThu: { trangThai: "DOT_HUY", thieu: 0, nhanDot: "Đợt 1", canhBao: [], nghiTrungVi: [] } }));
    expect(r.taiLen.bat).toBe(false);
    expect(r.xacNhan).toMatchObject({ bat: false, lyDo: expect.stringMatching(/huỷ/) });
    expect(r.khongXuat).toBe(true);
  });

  it("kho tệp chưa cấu hình ⇒ không tải lên được — nói ra, không để PUT chết câm", () => {
    const r = hanhDongChoDong(vao({ khoOk: false, hoaDonNhap: null }));
    expect(r.taiLen).toEqual({ bat: false, lyDo: expect.stringMatching(/chưa cấu hình/) });
    expect(r.xacNhan.bat).toBe(false);
  });

  it("chưa tải tệp ⇒ Xác nhận tắt, lý do 'chưa tải tệp PDF'", () => {
    const r = hanhDongChoDong(vao({ hoaDonNhap: null }));
    expect(r.xacNhan).toMatchObject({ bat: false, lyDo: expect.stringMatching(/PDF/) });
  });

  it("có tệp mà thiếu số / ký hiệu / ngày ⇒ tắt, nói thiếu ô nào", () => {
    const r = hanhDongChoDong(vao({ hoaDonNhap: { ...NHAP_DU, soHoaDon: null, ngayPhatHanh: null } }));
    expect(r.xacNhan.bat).toBe(false);
    expect(r.xacNhan.lyDo).toMatch(/số hoá đơn/);
    expect(r.xacNhan.lyDo).toMatch(/ngày phát hành/);
  });
});

describe("[TTH-03] LỆCH SỐ và NGHI TRÙNG", () => {
  it("THIẾU ⇒ Xác nhận tắt kèm số tiền + tên đợt, và mở nút 'Gắn thêm cho đủ'", () => {
    const r = hanhDongChoDong(vao({ lanThu: { trangThai: "THIEU", thieu: 1_000_000, nhanDot: "Đợt 2", canhBao: [], nghiTrungVi: [] } }));
    expect(r.xacNhan.bat).toBe(false);
    expect(r.xacNhan.lyDo).toMatch(/1\.000\.000đ/);
    expect(r.xacNhan.lyDo).toMatch(/Đợt 2/);
    expect(r.ganThem).toBe(true);
  });

  it("THIẾU nhưng kế toán đã chọn 'xuất theo số đã thu' ⇒ Xác nhận sáng", () => {
    const r = hanhDongChoDong(
      vao({ lanThu: { trangThai: "THIEU", thieu: 1_000_000, nhanDot: "Đợt 2", canhBao: [], nghiTrungVi: [] }, xuatTheoSoDaThu: true }),
    );
    expect(r.xacNhan.bat).toBe(true);
  });

  it("dòng ĐỦ thì KHÔNG vẽ nút 'Gắn thêm' (lời hứa suông)", () => {
    expect(hanhDongChoDong(vao()).ganThem).toBe(false);
  });

  it("NGHI TRÙNG ⇒ tắt cho tới khi kế toán xác nhận 'không trùng'", () => {
    const nghi = { trangThai: "NGHI_TRUNG" as const, thieu: 0, nhanDot: null, canhBao: [], nghiTrungVi: ["DON_CO_CHUYEN_KHOAN" as const] };
    expect(hanhDongChoDong(vao({ lanThu: nghi })).xacNhan).toMatchObject({
      bat: false,
      lyDo: expect.stringMatching(/trùng/),
    });
    expect(hanhDongChoDong(vao({ lanThu: nghi, boQuaNghiTrung: true })).xacNhan.bat).toBe(true);
  });
});

describe("[TTH-04] CẢNH BÁO — hiện ra nhưng KHÔNG chặn trả hoá đơn cho khách", () => {
  it("khoản chưa xác nhận được (thiếu ghi danh / tự ghi) ⇒ cảnh báo, Xác nhận VẪN sáng", () => {
    const r = hanhDongChoDong(
      vao({ khoanChuaXacNhanDuoc: ["Khoản 3.000.000đ chưa gắn ghi danh — vẫn chờ kế toán xác nhận"] }),
    );
    expect(r.xacNhan.bat).toBe(true);
    expect(r.canhBao).toContain("Khoản 3.000.000đ chưa gắn ghi danh — vẫn chờ kế toán xác nhận");
  });

  it("thiếu thông tin người mua trên hệ thống ⇒ cảnh báo, không chặn (hoá đơn đã xuất ở MISA)", () => {
    const r = hanhDongChoDong(vao({ thieuNguoiMua: ["Địa chỉ người mua"] }));
    expect(r.xacNhan.bat).toBe(true);
    expect(r.canhBao.join(" ")).toMatch(/Địa chỉ người mua/);
  });

  it("cảnh báo của lần thu (vd mất giao dịch) được chuyển lên dòng", () => {
    const r = hanhDongChoDong(
      vao({ lanThu: { trangThai: "KHONG_DOI_CHIEU", thieu: 0, nhanDot: null, canhBao: ["Không tìm thấy giao dịch"], nghiTrungVi: [] } }),
    );
    expect(r.canhBao).toContain("Không tìm thấy giao dịch");
  });
});

describe("[TTH-05] nhãn nút nói ĐÚNG việc nút sẽ làm", () => {
  it("có email + bật gửi ⇒ nói gửi tới đâu (che bớt email)", () => {
    expect(nhanNutXacNhan({ emailNhan: "ab@x.vn", guiEmailKhach: true })).toBe("Xác nhận & gửi tới ab@x.vn");
  });

  it("không có email ⇒ nói rõ sẽ báo sale", () => {
    expect(nhanNutXacNhan({ emailNhan: null, guiEmailKhach: true })).toBe(
      "Xác nhận (khách không có email — báo sale gửi Zalo)",
    );
  });

  it("vừa bỏ tick gửi VỪA không có email ⇒ vẫn nói KHÔNG gửi (lựa chọn của kế toán thắng)", () => {
    // Phép cấy 26/09 (đảo hai `if` đầu của `nhanNutXacNhan`) để 176/176 XANH: không ca nào thử
    // tổ hợp này. Đảo thứ tự thì nút nói "báo sale gửi Zalo" trong khi kế toán đã chọn KHÔNG gửi
    // — và `guiEmailKhach = false` cũng tắt luôn thông báo cho sale ở tầng gửi.
    expect(nhanNutXacNhan({ emailNhan: null, guiEmailKhach: false })).toBe("Xác nhận (không gửi email)");
  });

  it("kế toán bỏ tick gửi (MISA đã gửi rồi) ⇒ nói KHÔNG gửi", () => {
    expect(nhanNutXacNhan({ emailNhan: "phuhuynh@gmail.com", guiEmailKhach: false })).toBe(
      "Xác nhận (không gửi email)",
    );
  });
});

describe("[TTH-11] nút Huỷ hoá đơn — chỉ bản đã xác nhận", () => {
  it("DA_XAC_NHAN + có quyền ⇒ bật", () => {
    expect(nutHuyHoaDon({ trangThaiHoaDon: "DA_XAC_NHAN", coQuyen: true })).toEqual({ bat: true });
  });

  it("DA_XAC_NHAN nhưng không quyền ⇒ tắt KÈM lý do nói đúng quyền cần", () => {
    const n = nutHuyHoaDon({ trangThaiHoaDon: "DA_XAC_NHAN", coQuyen: false });
    expect(n.bat).toBe(false);
    expect(n.lyDo).toMatch(/payments:confirm/);
  });

  it("nháp / không xuất / đã huỷ / chưa có hoá đơn ⇒ tắt, KHÔNG lý do (không vẽ nút)", () => {
    for (const trangThaiHoaDon of ["NHAP", "KHONG_XUAT", "THAY_THE", null]) {
      expect(nutHuyHoaDon({ trangThaiHoaDon, coQuyen: true }), String(trangThaiHoaDon)).toEqual({ bat: false });
    }
  });

  it("một hằng độ dài lý do cho cả ba thao tác GĐ 8", () => {
    expect(TOI_THIEU_LY_DO_HOA_DON).toBe(10);
  });
});

describe("[TTH-12..15] GĐ 8 — lối ra có chủ đích + đơn đã huỷ + câu nói thật", () => {
  const nghi = (vi: ("DON_CO_CHUYEN_KHOAN" | "CHUA_KHOP_CUNG_SO")[] = ["DON_CO_CHUYEN_KHOAN"]) =>
    ({ trangThai: "NGHI_TRUNG" as const, thieu: 0, nhanDot: null, canhBao: [], nghiTrungVi: vi });
  const thieu = { trangThai: "THIEU" as const, thieu: 1_000_000, nhanDot: "Đợt 2", canhBao: [], nghiTrungVi: [] };

  it("[TTH-12] ngoaiLe theo trạng thái", () => {
    expect(hanhDongChoDong(vao({ lanThu: nghi() })).ngoaiLe).toMatchObject({ loai: "KHONG_TRUNG", daChon: false });
    const bq = hanhDongChoDong(vao({ lanThu: nghi(), boQuaNghiTrung: true }));
    expect(bq.ngoaiLe).toMatchObject({ loai: "KHONG_TRUNG", daChon: true });
    expect(bq.xacNhan.bat).toBe(true);
    expect(hanhDongChoDong(vao({ lanThu: thieu })).ngoaiLe).toMatchObject({ loai: "THEO_SO_DA_THU", daChon: false });
    expect(hanhDongChoDong(vao()).ngoaiLe).toBeNull();
    expect(hanhDongChoDong(vao({ lanThu: { ...thieu, trangThai: "DOT_HUY" } })).ngoaiLe).toBeNull();
    expect(hanhDongChoDong(vao({ lanThu: nghi(), coQuyen: false })).ngoaiLe).toBeNull();
  });

  it("[TTH-13] đơn đã huỷ ⇒ chỉ còn 'Không xuất' — xét TRƯỚC đợt huỷ, kho, nghi trùng, thiếu", () => {
    for (const lanThu of [vao().lanThu, thieu, nghi()]) {
      const r = hanhDongChoDong(vao({ lanThu, donDaHuy: true, hoaDonNhap: null }));
      expect(r.xacNhan.lyDo, lanThu.trangThai).toMatch(/Đơn đã huỷ/);
      expect(r.xacNhan.lyDo, lanThu.trangThai).not.toMatch(/PDF|gắn thêm|theo số đã thu|Không trùng/);
      expect(r.taiLen.bat).toBe(false);
      expect(r.khongXuat).toBe(true);
      expect(r.ngoaiLe).toBeNull();
    }
    expect(hanhDongChoDong(vao({ donDaHuy: true, khoOk: false, hoaDonNhap: null })).xacNhan.lyDo).toMatch(/Đơn đã huỷ/);
    expect(hanhDongChoDong(vao({ donDaHuy: true })).xacNhan).toMatchObject({ bat: false, lyDo: expect.stringMatching(/gỡ bản nháp/) });
    // Không quyền vẫn đứng TRƯỚC.
    expect(hanhDongChoDong(vao({ donDaHuy: true, coQuyen: false })).xacNhan.lyDo).toMatch(/payments:confirm/);
    // Đối chứng: đơn còn sống, đủ tệp + số ⇒ sáng.
    expect(hanhDongChoDong(vao({ donDaHuy: false })).xacNhan.bat).toBe(true);
  });

  it("[TTH-14] câu nói thật: không còn 'gắn thêm'; nghi trùng nói theo có / chưa có bản nháp và đúng bằng chứng", () => {
    expect(hanhDongChoDong(vao({ lanThu: thieu })).xacNhan.lyDo).not.toMatch(/gắn thêm/);
    expect(hanhDongChoDong(vao({ lanThu: thieu })).xacNhan.lyDo).toMatch(/Xuất theo số đã thu/);
    const coNhap = hanhDongChoDong(vao({ lanThu: nghi() })).xacNhan.lyDo!;
    const chuaNhap = hanhDongChoDong(vao({ lanThu: nghi(), hoaDonNhap: null })).xacNhan.lyDo!;
    expect(coNhap).toMatch(/gỡ bản nháp/);
    expect(chuaNhap).toMatch(/tải hoá đơn lên rồi bấm "Không trùng — vẫn xuất"/);
    expect(coNhap).toMatch(/cùng đơn có khoản chuyển khoản/);
    expect(hanhDongChoDong(vao({ lanThu: nghi(["CHUA_KHOP_CUNG_SO"]) })).xacNhan.lyDo).toMatch(/giao dịch chưa khớp cùng số tiền/);
  });

  it("[TTH-15] câu lối ra nêu đúng độ dài lý do tối thiểu (một hằng)", () => {
    expect(hanhDongChoDong(vao({ lanThu: thieu })).ngoaiLe!.cau).toContain(`${TOI_THIEU_LY_DO_HOA_DON} ký tự`);
    expect(hanhDongChoDong(vao({ lanThu: nghi() })).ngoaiLe!.cau).toContain(`${TOI_THIEU_LY_DO_HOA_DON} ký tự`);
  });
});

describe("[TTH-16] GĐ 8 — nút Gửi lại email: thứ tự nguyên nhân + nhãn nói đúng việc", () => {
  const vao = (o: Partial<Parameters<typeof hanhDongGuiLai>[0]> = {}): Parameters<typeof hanhDongGuiLai>[0] => ({
    trangThaiHoaDon: "DA_XAC_NHAN",
    coQuyen: true,
    khoOk: true,
    dangChay: false,
    coLuot: true,
    emailNhan: "ph@example.com",
    emailDon: "ph@example.com",
    ...o,
  });

  it("đường vui: có lượt ⇒ 'Gửi lại email'; chưa lượt nào ⇒ 'Gửi email cho khách'", () => {
    expect(hanhDongGuiLai(vao())).toEqual({ bat: true, nhan: "Gửi lại email" });
    expect(hanhDongGuiLai(vao({ coLuot: false }))).toEqual({ bat: true, nhan: "Gửi email cho khách" });
  });

  it("từng nguyên nhân tắt nút, và nguyên nhân GỐC nói trước", () => {
    expect(hanhDongGuiLai(vao({ trangThaiHoaDon: "THAY_THE", coQuyen: false })).lyDo).toBe("Chỉ gửi được hoá đơn đã xác nhận");
    expect(hanhDongGuiLai(vao({ coQuyen: false, khoOk: false })).lyDo).toMatch(/Cần quyền payments:confirm/);
    expect(hanhDongGuiLai(vao({ khoOk: false, dangChay: true })).lyDo).toMatch(/Kho lưu hoá đơn chưa cấu hình/);
    expect(hanhDongGuiLai(vao({ dangChay: true, emailNhan: null, emailDon: null })).lyDo).toMatch(/đang chạy/);
    const khongEmail = hanhDongGuiLai(vao({ emailNhan: null, emailDon: "  " }));
    expect(khongEmail).toMatchObject({ bat: false, nhan: "Gửi lại email" });
    expect(khongEmail.lyDo).toMatch(/chưa có email/);
  });

  it("đối chứng: chỉ đơn có email (hoá đơn chụp rỗng) ⇒ vẫn sáng", () => {
    expect(hanhDongGuiLai(vao({ emailNhan: null })).bat).toBe(true);
  });
});

describe("[TTH-17] (Q1b 29/09) đơn có yêu cầu hoàn CHỜ / ĐÃ DUYỆT ⇒ Xác nhận tắt, đúng câu bước chốt ném", () => {
  const HOAN = lyDoHoanChanXacNhan([{ status: "PENDING", phamVi: { orderItemIds: [], enrollmentIds: [] } }], [])!;

  it("bản nháp ĐỦ mọi ô + có yêu cầu hoàn ⇒ tắt với câu chung; câu cũng nằm ở cảnh báo", () => {
    const r = hanhDongChoDong(vao({ hoanChan: HOAN }));
    expect(r.xacNhan).toEqual({ bat: false, lyDo: CAU_HOAN_CHAN_XAC_NHAN });
    expect(r.canhBao).toContain(CAU_HOAN_CHAN_XAC_NHAN);
    // Các nút khác không bị kéo theo — chỉ bật cờ, không khoá dòng.
    expect(r.taiLen.bat).toBe(true);
    expect(r.khongXuat).toBe(true);
  });

  it("đối chứng dương: không có yêu cầu hoàn ⇒ sáng, không cảnh báo hoàn", () => {
    const r = hanhDongChoDong(vao({ hoanChan: null }));
    expect(r.xacNhan.bat).toBe(true);
    expect(r.canhBao).not.toContain(CAU_HOAN_CHAN_XAC_NHAN);
  });

  it("bản nháp còn thiếu ô ⇒ nút nói ô còn thiếu trước (việc trước mắt), hoàn vẫn ở cảnh báo", () => {
    const r = hanhDongChoDong(vao({ hoanChan: HOAN, hoaDonNhap: { ...NHAP_DU, soHoaDon: null } }));
    expect(r.xacNhan).toEqual({ bat: false, lyDo: "Còn thiếu số hoá đơn" });
    expect(r.canhBao).toContain(CAU_HOAN_CHAN_XAC_NHAN);
  });
});
