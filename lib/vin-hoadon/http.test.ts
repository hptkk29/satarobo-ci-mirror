import { beforeEach, describe, expect, it } from "vitest";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import type { CauHinhVin } from "./cau-hinh";
import { _xoaBoNhoTokenVinChoTest, hanTokenMs, taoCongVin, type FetchLike } from "./http";
import { TAI_KHOAN_VIN_GIA, taoMayChuVinGia } from "./may-chu-vin-gia";

const CAU_HINH: CauHinhVin = {
  cheDo: "sandbox",
  baseUrl: "https://vin-thu.example.test",
  username: TAI_KHOAN_VIN_GIA.username,
  password: TAI_KHOAN_VIN_GIA.password,
};
const MST = "0402145678";

function phieu(refId: string): PhieuPhatHanh {
  return {
    refId,
    kyHieu: "1C26TSR",
    mstNguoiBan: MST,
    ngayHoaDon: new Date("2026-09-30T00:00:00.000Z"),
    nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: null, email: null },
    hinhThucThanhToan: "Chuyển khoản",
    dong: [{ stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 5_000_000, thanhTien: 5_000_000, thueSuat: "KCT", tienThue: 0 }],
    tongTruocThue: 5_000_000,
    tongThue: 0,
    tongThanhToan: 5_000_000,
    soTienBangChu: "Năm triệu đồng.",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function dung(fetchImpl: FetchLike, nhatKy: string[] = [], now?: () => number) {
  return taoCongVin({ cauHinh: CAU_HINH, fetchImpl, log: (s) => nhatKy.push(s), now });
}

beforeEach(() => _xoaBoNhoTokenVinChoTest());

describe("[VIN-HTTP] cổng VIN-HOADON — đường dẫn, xác thực, ba kết quả", () => {
  it("[VIN-HTTP-01] phát hành: gọi GetToken rồi GuiVaKyHoadonGocHSM đúng URL (gốc + /api/services/hddtws), Bearer, body bọc trong 'hoadon'", async () => {
    const may = taoMayChuVinGia();
    const kq = await dung(may.fetchImpl).phatHanh(phieu("vin-http-01"));
    expect(kq.loai).toBe("DA_PHAT_HANH");
    expect(may.cuocGoi.map((c) => c.duong)).toEqual(["/Authentication/GetToken", "/QuanLyHoaDon/GuiVaKyHoadonGocHSM"]);
    expect(may.cuocGoi[0]!.body).toEqual({ doanhnghiep_mst: MST, username: TAI_KHOAN_VIN_GIA.username, password: TAI_KHOAN_VIN_GIA.password });
    expect(may.cuocGoi[0]!.auth).toBeNull();
    expect(may.cuocGoi[1]!.auth).toBe(`Bearer ${TAI_KHOAN_VIN_GIA.token}`);
    // BODY PHẲNG: trường hoá đơn ở cấp ngoài cùng, KHÔNG có lớp `hoadon` (đo máy chủ demo 03/11/2026).
    const hoadon = may.cuocGoi[1]!.body as Record<string, unknown>;
    expect(hoadon).not.toHaveProperty("hoadon");
    expect(hoadon).toMatchObject({ doanhnghiep_mst: MST, mauso: "1", kyhieu: "C26TSR", ma_hoadon: "vin-http-01" });
  });

  it("[VIN-HTTP-02] URL thật: chỉ ghép gốc env + /api/services/hddtws + đường dẫn hàm (không URL nào khác)", async () => {
    const urls: string[] = [];
    const may = taoMayChuVinGia();
    const cong = dung(async (url, init) => {
      urls.push(url);
      return may.fetchImpl(url, init);
    });
    const kq = await cong.phatHanh(phieu("vin-http-02"));
    if (kq.loai !== "DA_PHAT_HANH") throw new Error("kỳ vọng DA_PHAT_HANH");
    await cong.traCuu("vin-http-02", MST);
    await cong.taiTep(kq.maTraCuu, "pdf", MST);
    await cong.taiTep(kq.maTraCuu, "xml", MST);
    expect(urls).toEqual(
      [
        "/Authentication/GetToken",
        "/QuanLyHoaDon/GuiVaKyHoadonGocHSM",
        "/TraCuuHoaDon/TraThongTinHoaDon",
        "/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet",
        "/TraCuuHoaDon/TaiXmlDaKy",
      ].map((d) => `https://vin-thu.example.test/api/services/hddtws${d}`),
    );
  });

  it("[VIN-HTTP-03] token được DÙNG LẠI giữa các lời gọi (một GetToken cho nhiều lời gọi), và hết hạn thì lấy lại", async () => {
    const may = taoMayChuVinGia();
    let t = 1_000;
    const cong = dung(may.fetchImpl, [], () => t);
    await cong.phatHanh(phieu("vin-http-03a"));
    await cong.traCuu("vin-http-03a", MST);
    expect(may.cuocGoi.filter((c) => c.duong === "/Authentication/GetToken")).toHaveLength(1);
    t += 31 * 60 * 1000; // quá trần 30 phút
    await cong.traCuu("vin-http-03a", MST);
    expect(may.cuocGoi.filter((c) => c.duong === "/Authentication/GetToken")).toHaveLength(2);
  });

  it("[VIN-HTTP-04] hanTokenMs: nhận cả giây lẫn mili-giây, luôn kẹp trần 30 phút; thiếu/xấu ⇒ 5 phút", () => {
    expect(hanTokenMs(86_400)).toBe(30 * 60 * 1000); // giá trị THẬT của VIN (đo 03/11/2026): 86400 = 1 ngày, GIÂY ⇒ kẹp trần
    expect(hanTokenMs(1_296_000)).toBe(30 * 60 * 1000); // 15 ngày tính bằng giây ⇒ kẹp trần
    expect(hanTokenMs(1_296_000_000)).toBe(30 * 60 * 1000); // cùng giá trị tính bằng ms
    expect(hanTokenMs(600)).toBe(480_000); // 600 giây × 0,8
    expect(hanTokenMs("600")).toBe(480_000);
    for (const xau of [undefined, null, 0, -5, "abc", NaN]) expect(hanTokenMs(xau), String(xau)).toBe(5 * 60 * 1000);
  });

  it("[VIN-HTTP-05] 401 ở lời gọi nghiệp vụ ⇒ làm mới token MỘT lần rồi gửi lại và thành công (GetToken gọi 2 lần, nghiệp vụ 2 lần)", async () => {
    const may = taoMayChuVinGia();
    may.epMotLan("/QuanLyHoaDon/GuiVaKyHoadonGocHSM", () => json({ error: "Unauthorized" }, 401));
    const kq = await dung(may.fetchImpl).phatHanh(phieu("vin-http-05"));
    expect(kq.loai).toBe("DA_PHAT_HANH");
    expect(may.cuocGoi.map((c) => c.duong)).toEqual([
      "/Authentication/GetToken",
      "/QuanLyHoaDon/GuiVaKyHoadonGocHSM",
      "/Authentication/GetToken",
      "/QuanLyHoaDon/GuiVaKyHoadonGocHSM",
    ]);
  });

  it("[VIN-HTTP-06] sai tài khoản ⇒ TU_CHOI VIN_DANG_NHAP, KHÔNG gửi hoá đơn (không có lời gọi nghiệp vụ nào)", async () => {
    const may = taoMayChuVinGia("LOI_XAC_THUC");
    const nhatKy: string[] = [];
    const kq = await dung(may.fetchImpl, nhatKy).phatHanh(phieu("vin-http-06"));
    expect(kq).toMatchObject({ loai: "TU_CHOI", ma: "VIN_DANG_NHAP" });
    expect(may.cuocGoi.map((c) => c.duong)).toEqual(["/Authentication/GetToken"]);
    expect(may.daGhi.size).toBe(0);
    for (const dong of [...nhatKy, JSON.stringify(kq)]) {
      expect(dong).not.toContain(TAI_KHOAN_VIN_GIA.password);
      expect(dong).not.toContain(TAI_KHOAN_VIN_GIA.token);
    }
  });

  it("[VIN-HTTP-07] vẫn 401 sau khi làm mới token ⇒ TU_CHOI VIN_DANG_NHAP (VIN từ chối xác thực trước khi xử lý)", async () => {
    const may = taoMayChuVinGia();
    // mọi lần gửi nghiệp vụ đều 401 (kể cả lần gửi lại sau làm mới token): ép bằng cách bọc fetch
    let lanNghiepVu = 0;
    const cong = dung(async (url, init) => {
      if (url.endsWith("/QuanLyHoaDon/GuiVaKyHoadonGocHSM")) {
        lanNghiepVu += 1;
        return json({}, 401);
      }
      return may.fetchImpl(url, init);
    });
    const kq = await cong.phatHanh(phieu("vin-http-07"));
    expect(kq).toMatchObject({ loai: "TU_CHOI", ma: "VIN_DANG_NHAP" });
    expect(lanNghiepVu).toBe(2); // đúng MỘT lần gửi lại, không hơn
  });

  it("[VIN-HTTP-08] HTTP 400 ⇒ TU_CHOI VIN_400; HTTP 500/502 ⇒ KHONG_RO và KHÔNG gửi lại (phát hành đúng một lần)", async () => {
    for (const [status, loai] of [[400, "TU_CHOI"], [500, "KHONG_RO"], [502, "KHONG_RO"], [503, "KHONG_RO"]] as const) {
      _xoaBoNhoTokenVinChoTest();
      const may = taoMayChuVinGia();
      may.epMotLan("/QuanLyHoaDon/GuiVaKyHoadonGocHSM", () => json({ error: "x" }, status));
      const kq = await dung(may.fetchImpl).phatHanh(phieu(`vin-http-08-${status}`));
      expect(kq.loai, String(status)).toBe(loai);
      if (kq.loai === "TU_CHOI") expect(kq.ma).toBe("VIN_400");
      expect(may.cuocGoi.filter((c) => c.duong === "/QuanLyHoaDon/GuiVaKyHoadonGocHSM"), String(status)).toHaveLength(1);
    }
  });

  it("[VIN-HTTP-09] phản hồi 200 không phải JSON / rỗng ⇒ KHONG_RO (VIN có thể đã lưu), không TU_CHOI", async () => {
    for (const noiDung of ["", "<html>oops</html>", "{hong"]) {
      _xoaBoNhoTokenVinChoTest();
      const may = taoMayChuVinGia();
      may.epMotLan("/QuanLyHoaDon/GuiVaKyHoadonGocHSM", () => new Response(noiDung, { status: 200 }));
      const kq = await dung(may.fetchImpl).phatHanh(phieu("vin-http-09"));
      expect(kq.loai, noiDung).toBe("KHONG_RO");
    }
  });

  it("[VIN-HTTP-10] gửi TRÙNG: VIN báo 03 ⇒ cổng tự tra cứu theo ma_hoadon và trả DA_PHAT_HANH cũ; tra cứu không ra ⇒ KHONG_RO", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const a = await cong.phatHanh(phieu("vin-http-10"));
    const b = await cong.phatHanh(phieu("vin-http-10"));
    expect(b).toEqual(a);
    expect(may.daGhi.size).toBe(1);

    // báo trùng nhưng tra cứu không thấy (mã 11) ⇒ KHONG_RO, không bao giờ bịa số hoá đơn
    const may2 = taoMayChuVinGia();
    may2.epMotLan("/QuanLyHoaDon/GuiVaKyHoadonGocHSM", () => json({ maketqua: "03" }));
    const kq = await dung(may2.fetchImpl).phatHanh(phieu("vin-http-10b"));
    expect(kq.loai).toBe("KHONG_RO");
  });

  it("[VIN-HTTP-10c] chứng thư (13): cổng TỰ TRA CỨU — 11 ⇒ TU_CHOI VIN_13 (đo thật 03/11: không để lại gì); thấy hoá đơn ⇒ trả hoá đơn; tra cứu hỏng ⇒ KHONG_RO", async () => {
    // (1) VIN báo 13 và không lưu gì ⇒ TU_CHOI cấu hình, đúng MỘT lần gửi + MỘT lần tra cứu, không gửi lại
    const may = taoMayChuVinGia();
    may.epMotLan("/QuanLyHoaDon/GuiVaKyHoadonGocHSM", () => json({ result: { maketqua: "13", motaketqua: "Không tìm thấy thông tin chứng thư", magiaodich: null } }));
    const nhatKy: string[] = [];
    const kq = await dung(may.fetchImpl, nhatKy).phatHanh(phieu("vin-http-10c"));
    expect(kq).toMatchObject({ loai: "TU_CHOI", ma: "VIN_13" });
    expect(may.cuocGoi.filter((c) => c.duong === "/QuanLyHoaDon/GuiVaKyHoadonGocHSM")).toHaveLength(1);
    expect(may.cuocGoi.filter((c) => c.duong === "/TraCuuHoaDon/TraThongTinHoaDon")).toHaveLength(1);
    expect(nhatKy.join("\n")).not.toContain(TAI_KHOAN_VIN_GIA.password);

    // (2) VIN báo 13 NHƯNG hoá đơn mang khoá này đã tồn tại và đã ký ⇒ KHÔNG được báo từ chối: trả hoá đơn thật
    const may2 = taoMayChuVinGia();
    const cong2 = dung(may2.fetchImpl);
    const a = await cong2.phatHanh(phieu("vin-http-10d"));
    expect(a.loai).toBe("DA_PHAT_HANH");
    may2.epMotLan("/QuanLyHoaDon/GuiVaKyHoadonGocHSM", () => json({ result: { maketqua: "13", motaketqua: "Không tìm thấy thông tin chứng thư" } }));
    expect(await cong2.phatHanh(phieu("vin-http-10d"))).toEqual(a);

    // (3) VIN báo 27 và tra cứu hỏng (HTTP 500) ⇒ không chắc ⇒ KHONG_RO (không bao giờ TU_CHOI khi chưa biết)
    const may3 = taoMayChuVinGia();
    may3.epMotLan("/QuanLyHoaDon/GuiVaKyHoadonGocHSM", () => json({ result: { maketqua: "27" } }));
    const kq3 = await dung(async (url, init) => (url.endsWith("/TraCuuHoaDon/TraThongTinHoaDon") ? json({ error: "x" }, 500) : may3.fetchImpl(url, init))).phatHanh(phieu("vin-http-10e"));
    expect(kq3.loai).toBe("KHONG_RO");
  });

  it("[VIN-HTTP-11] phiếu sai bị tự chặn TRƯỚC khi gọi mạng: TU_CHOI DU_LIEU_PHIEU_KHONG_HOP_LE, không một lời gọi nào", async () => {
    const may = taoMayChuVinGia();
    const kq = await dung(may.fetchImpl).phatHanh({ ...phieu("vin-http-11"), kyHieu: "SAI" });
    expect(kq).toMatchObject({ loai: "TU_CHOI", ma: "DU_LIEU_PHIEU_KHONG_HOP_LE" });
    expect(may.cuocGoi).toHaveLength(0);
  });

  it("[VIN-HTTP-12] timeout / lỗi mạng ở phát hành ⇒ KHONG_RO, KHÔNG gửi lại; traCuu lỗi mạng ⇒ KHONG_RO", async () => {
    let lanGui = 0;
    const may = taoMayChuVinGia();
    const cong = dung(async (url, init) => {
      if (url.endsWith("/QuanLyHoaDon/GuiVaKyHoadonGocHSM")) {
        lanGui += 1;
        throw new TypeError("fetch failed");
      }
      if (url.endsWith("/TraCuuHoaDon/TraThongTinHoaDon")) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return may.fetchImpl(url, init);
    });
    const kq = await cong.phatHanh(phieu("vin-http-12"));
    expect(kq.loai).toBe("KHONG_RO");
    expect(lanGui).toBe(1);
    expect((await cong.traCuu("vin-http-12", MST)).loai).toBe("KHONG_RO");
  });

  it("[VIN-HTTP-13] tải tệp: PDF/XML hợp lệ; lỗi (mã lạ, HTTP 500, tệp hỏng) ⇒ NÉM, không trả tệp hỏng", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const kq = await cong.phatHanh(phieu("vin-http-13"));
    if (kq.loai !== "DA_PHAT_HANH") throw new Error("kỳ vọng DA_PHAT_HANH");
    expect(Buffer.from(await cong.taiTep(kq.maTraCuu, "pdf", MST)).toString("latin1").startsWith("%PDF")).toBe(true);
    expect(Buffer.from(await cong.taiTep(kq.maTraCuu, "xml", MST)).toString("utf8").trimStart().startsWith("<")).toBe(true);
    await expect(cong.taiTep("MA-LA", "pdf", MST)).rejects.toThrow(/không tìm thấy|từ chối/i);

    may.epMotLan("/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet", () => json({}, 500));
    await expect(cong.taiTep(kq.maTraCuu, "pdf", MST)).rejects.toThrow(/HTTP 500/);
    may.epMotLan("/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet", () =>
      json({ maketqua: "01", base64pdf: Buffer.from("khong-phai-pdf").toString("base64") }),
    );
    await expect(cong.taiTep(kq.maTraCuu, "pdf", MST)).rejects.toThrow(/PDF/);
  });

  it("[VIN-HTTP-14] tải tệp gửi magiaodich (không gửi ma_hoadon) cùng MST người bán; tra cứu gửi ma_hoadon (không có magiaodich)", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const kq = await cong.phatHanh(phieu("vin-http-14"));
    if (kq.loai !== "DA_PHAT_HANH") throw new Error("kỳ vọng DA_PHAT_HANH");
    await cong.traCuu("vin-http-14", ` ${MST} `);
    await cong.taiTep(kq.maTraCuu, "pdf", MST);
    const tra = may.cuocGoi.find((c) => c.duong === "/TraCuuHoaDon/TraThongTinHoaDon")!;
    expect(tra.body).toEqual({ doanhnghiep_mst: MST, ma_hoadon: "vin-http-14" });
    const tai = may.cuocGoi.find((c) => c.duong === "/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet")!;
    expect(tai.body).toEqual({ doanhnghiep_mst: MST, magiaodich: kq.maTraCuu });
  });

  it("[VIN-HTTP-16] PHẢN HỒI THẬT bọc kiểu ABP ({ result: {…}, success, … }) — token và kết quả phát hành đều đọc được qua lớp `result` (đo từ máy chủ demo 03/11/2026)", async () => {
    const may = taoMayChuVinGia();
    const bocAbp = (body: unknown) => json({ result: body, targetUrl: null, success: true, error: null, unAuthorizedRequest: false, __abp: true });
    const cong = dung(async (url, init) => {
      const res = await may.fetchImpl(url, init);
      if (!res.ok) return res;
      return bocAbp(await res.json());
    });
    // GetToken thật trả expire_in_seconds = 86400 (GIÂY) và token_type "Bearer" — mô phỏng đúng hình dạng đó
    const kq = await cong.phatHanh(phieu("vin-http-16"));
    expect(kq.loai).toBe("DA_PHAT_HANH");
    const tc = await cong.traCuu("vin-http-16", MST);
    expect(tc).toEqual(kq);
    expect(await cong.traCuu("khong-co", MST)).toEqual({ loai: "CHUA_CO" });
  });

  it("[VIN-HTTP-15] cổng báo đúng môi trường (sandbox/production) và chế độ HSM", () => {
    const may = taoMayChuVinGia();
    expect(dung(may.fetchImpl).moiTruong).toBe("sandbox");
    expect(dung(may.fetchImpl).cheDo).toBe("HSM");
    const that = taoCongVin({ cauHinh: { ...CAU_HINH, cheDo: "production" }, fetchImpl: may.fetchImpl });
    expect(that.moiTruong).toBe("production");
  });
});
