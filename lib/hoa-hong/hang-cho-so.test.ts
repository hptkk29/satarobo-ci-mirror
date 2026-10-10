// @vitest-environment node
/**
 * [NHH-SO-HC-*] — HÀNG CHỜ TRƯỚC SỔ: gom mã hàng chờ → nhóm hiển thị, lý do bằng chữ, bước kế tiếp. THUẦN.
 *
 * Luận đề 06 §2.2: tab Sổ mở ở hàng chờ. Màn KHÔNG phát minh trạng thái mới — nó chỉ NHÌN lại enum `CommissionHoldCode` đã có
 * của engine, nên ca đầu tiên khoá việc "mã nào cũng có nhóm" (thêm mã mới vào enum mà quên phân nhóm ⇒ đỏ ở đây, không rơi
 * vô hình khỏi màn).
 */
import { CommissionHoldCode } from "@prisma/client";
import { describe, it, expect } from "vitest";

import { MO_TA_MA_HANG_CHO, hanhDongTiep, laDonChuaNoiLead, lyDoHienThi, type QuyenLienKet } from "./hang-cho-so";
import { LOAI_HANG_CHO_SO, MO_TA_LOAI, NHAN_LOAI, NHAN_MA_HANG_CHO, docLoaiHangCho, loaiChungCuaCacMa, loaiCuaMa, maCuaLoai } from "./hang-cho-so-nhom";
import { hangChoChanKy, type MaHold } from "./hang-cho";

const TAT_CA_MA = Object.values(CommissionHoldCode) as MaHold[];

const TAT_CA_QUYEN: QuyenLienKet = { don: true, lead: true, chinhSach: true, nguoiPhuTrach: true, nguon: true };
const KHONG_QUYEN: QuyenLienKet = { don: false, lead: false, chinhSach: false, nguoiPhuTrach: false, nguon: false };

describe("[NHH-SO-HC] hàng chờ sổ — LOẠI hiển thị (một nguồn với hang-cho-so-nhom.ts)", () => {
  it("[NHH-SO-HC-01] MỌI mã của enum có loại, nhãn và mô tả (thêm mã mới mà quên ⇒ đỏ ở đây, không rơi vô hình khỏi màn)", () => {
    const moi = [...TAT_CA_MA].sort();
    expect(Object.keys(NHAN_MA_HANG_CHO).sort()).toEqual(moi);
    for (const ma of TAT_CA_MA) expect(LOAI_HANG_CHO_SO, ma).toContain(loaiCuaMa(ma));
    for (const loai of LOAI_HANG_CHO_SO) {
      expect(NHAN_LOAI[loai].length).toBeGreaterThan(0);
      expect(MO_TA_LOAI[loai].length).toBeGreaterThan(10);
    }
    // mỗi mã nằm trong ĐÚNG MỘT loại: hợp các loại = enum, không giao nhau
    const gop = LOAI_HANG_CHO_SO.flatMap((l) => maCuaLoai(l, TAT_CA_MA));
    expect([...gop].sort()).toEqual(moi);
  });

  it("[NHH-SO-HC-02] sáu loại theo đúng thứ tự hiển thị của chip (việc chặn người hưởng đứng đầu, số dư âm cuối)", () => {
    expect([...LOAI_HANG_CHO_SO]).toEqual(["CHUA_PHAN_GIAI_NGUOI_HUONG", "CHO_CHINH_SACH", "VUOT_TRAN", "THIEU_DU_LIEU_THANH_TOAN", "CHO_DIEU_CHINH", "SO_DU_AM"]);
    // đặc tả chọn riêng ba mã mà người rà soát hay nhầm: đơn không lead ≠ chờ chính sách ≠ thiếu dữ liệu thanh toán
    expect(loaiCuaMa("UNRESOLVED_BENEFICIARY")).toBe("CHUA_PHAN_GIAI_NGUOI_HUONG");
    expect(loaiCuaMa("POLICY_OVERLAP")).toBe("CHO_CHINH_SACH");
    expect(loaiCuaMa("CHUA_GAN_CON")).toBe("THIEU_DU_LIEU_THANH_TOAN");
  });

  it("[NHH-SO-HC-03] nhãn + mô tả loại đọc được bằng tiếng Việt, không lộ tên mã", () => {
    for (const loai of LOAI_HANG_CHO_SO) {
      expect(NHAN_LOAI[loai]).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
      expect(MO_TA_LOAI[loai]).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    }
    for (const ma of TAT_CA_MA) expect(NHAN_MA_HANG_CHO[ma], ma).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
  });

  it("[NHH-SO-HC-04] docLoaiHangCho: giá trị lạ trên URL ⇒ null (không ném, không đoán)", () => {
    expect(docLoaiHangCho("CHO_DIEU_CHINH")).toBe("CHO_DIEU_CHINH");
    expect(docLoaiHangCho("DIEU_CHINH")).toBeNull(); // tên nhóm việc cũ (đã bỏ) không còn hợp lệ
    expect(docLoaiHangCho("khong-co")).toBeNull();
    expect(docLoaiHangCho("")).toBeNull();
    expect(docLoaiHangCho(null)).toBeNull();
  });
});

describe("[NHH-SO-HC] lý do bằng chữ", () => {
  it("[NHH-SO-HC-05] ĐƠN KHÔNG LEAD hiện đúng chữ 'Đơn chưa nối lead' và không lộ mã kỹ thuật", () => {
    const detail = { vai: "SALE", lyDo: "KHONG_CO_LEAD", canCu: "LEAD_CONVERTED_BY: đơn không có lead", tienVai: 160_000 };
    expect(laDonChuaNoiLead("UNRESOLVED_BENEFICIARY", detail)).toBe(true);
    const lyDo = lyDoHienThi("UNRESOLVED_BENEFICIARY", detail, "Sale");
    expect(lyDo).toMatch(/không có lead/i); // pill đã nói "Đơn chưa nối lead"; câu lý do nói NGUYÊN NHÂN, không lặp lại nhãn
    expect(lyDo).toContain("Sale");
    expect(lyDo).not.toContain("KHONG_CO_LEAD");
    expect(lyDo).not.toContain("LEAD_CONVERTED_BY");
  });

  it("[NHH-SO-HC-06] đối chứng: các lý do treo KHÁC không bị gọi nhầm là 'Đơn chưa nối lead'", () => {
    const khac = ["LEAD_THIEU_NGUOI", "CHUA_KHAI_NGUOI_PHU_TRACH", "KHONG_QUY_VE_CO_SO", "NGUOI_HUONG_NGHI", "RESOLVER_CHUA_HO_TRO", "RESOLVER_KHONG_BIET"];
    for (const lyDo of khac) {
      const d = { vai: "SALE", lyDo };
      expect(laDonChuaNoiLead("UNRESOLVED_BENEFICIARY", d), lyDo).toBe(false);
      const chu = lyDoHienThi("UNRESOLVED_BENEFICIARY", d, "Sale");
      expect(chu, lyDo).not.toContain("Đơn chưa nối lead");
      expect(chu, lyDo).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    }
    // và mã khác UNRESOLVED với cùng `lyDo` thì cũng không phải ca này
    expect(laDonChuaNoiLead("MANUAL_REVIEW_REQUIRED", { lyDo: "KHONG_CO_LEAD" })).toBe(false);
  });

  it("[NHH-SO-HC-06b] mã treo LẠ (engine thêm mã mới mà màn chưa biết) ⇒ nhãn chung, KHÔNG in mã thô ra màn", () => {
    const chu = lyDoHienThi("UNRESOLVED_BENEFICIARY", { vai: "SALE", lyDo: "MA_LA_CHUA_BIET" }, "Sale");
    expect(chu).toBe(`Vai Sale: ${MO_TA_MA_HANG_CHO.UNRESOLVED_BENEFICIARY}`);
    expect(chu).not.toContain("MA_LA");
  });

  it("[NHH-SO-HC-07] mã khác: lấy câu `detail.lyDo` của engine; detail rác ⇒ nhãn mã, không ném", () => {
    expect(lyDoHienThi("CAP_EXCEEDED", { lyDo: "Tổng tỉ lệ vượt trần." }, null)).toBe("Tổng tỉ lệ vượt trần.");
    for (const rac of [null, undefined, 42, "x", [], { lyDo: 5 }, { lyDo: "" }]) {
      expect(lyDoHienThi("INPUT_DRIFT", rac, null)).toBe(MO_TA_MA_HANG_CHO.INPUT_DRIFT);
    }
  });

  it("[NHH-SO-HC-07b] thiếu câu của engine ⇒ lý do rơi về MÔ TẢ của mã, KHÔNG lặp đúng chữ trên pill (reviewer độc lập: hai dòng liền nhau cùng một câu); mọi mã đều có mô tả khác nhãn và không in mã kỹ thuật", () => {
    for (const ma of TAT_CA_MA) {
      expect(MO_TA_MA_HANG_CHO[ma], ma).toBeTruthy();
      expect(MO_TA_MA_HANG_CHO[ma], ma).not.toBe(NHAN_MA_HANG_CHO[ma]);
      expect(MO_TA_MA_HANG_CHO[ma], ma).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
      expect(lyDoHienThi(ma, {}, null), ma).toBe(MO_TA_MA_HANG_CHO[ma]);
    }
  });

  it("[NHH-SO-HC-08b] hold THIEU_SALE_PHU_HUYNH / NGUON_CHUA_CO_NGUOI_PHU_TRACH KHÔNG rơi vào nhánh mặc định «Mở chính sách» (nút dẫn sai chỗ — luật 12); mỗi hold nói việc RIÊNG của nó", () => {
    const buoc = (lyDo: string) => hanhDongTiep({ ma: "UNRESOLVED_BENEFICIARY", detail: { lyDo }, orderId: "o1", leadId: "l1", nguonCode: null }, TAT_CA_QUYEN);
    const macDinh = buoc("MA_LA_CHUA_BIET"); // nhánh mặc định = «Mở chính sách»
    expect(macDinh.lienKet?.href).toBe("/nguon-hoa-hong/chinh-sach");
    for (const lyDo of ["THIEU_SALE_PHU_HUYNH", "NGUON_CHUA_CO_NGUOI_PHU_TRACH"]) {
      const b = buoc(lyDo);
      expect(b.lienKet?.href, lyDo).toBe("/leads/l1");
      expect(b.buoc, lyDo).not.toBe(macDinh.buoc);
    }
    expect(buoc("THIEU_SALE_PHU_HUYNH").buoc).toMatch(/Sale/);
    expect(buoc("THIEU_SALE_PHU_HUYNH").buoc).not.toBe(buoc("NGUON_CHUA_CO_NGUOI_PHU_TRACH").buoc);
  });

  it("[NHH-SO-HC-08] không bịa nguồn cho đơn không lead: bước kế tiếp là MỞ ĐƠN, không phải 'gán nguồn' hay link lead", () => {
    const d = { vai: "SALE", lyDo: "KHONG_CO_LEAD" };
    const b = hanhDongTiep({ ma: "UNRESOLVED_BENEFICIARY", detail: d, orderId: "ord1", leadId: null, nguonCode: null }, TAT_CA_QUYEN);
    expect(b.buoc).toMatch(/nối/i);
    expect(b.lienKet?.href).toBe("/orders/ord1");
    expect(b.lienKet?.href).not.toMatch(/leads|nguon/);
  });
});

describe("[NHH-SO-HC] bước kế tiếp — nút VẼ khi người xem THẬT SỰ mở được (luật 12)", () => {
  const mau: { ma: MaHold; detail: unknown; orderId: string | null; leadId: string | null; quyen: keyof QuyenLienKet; href: string }[] = [
    { ma: "UNRESOLVED_BENEFICIARY", detail: { lyDo: "KHONG_CO_LEAD" }, orderId: "o1", leadId: null, quyen: "don", href: "/orders/o1" },
    { ma: "UNRESOLVED_BENEFICIARY", detail: { lyDo: "LEAD_THIEU_NGUOI" }, orderId: "o1", leadId: "l1", quyen: "lead", href: "/leads/l1" },
    { ma: "UNRESOLVED_BENEFICIARY", detail: { lyDo: "CHUA_KHAI_NGUOI_PHU_TRACH" }, orderId: "o1", leadId: "l1", quyen: "nguoiPhuTrach", href: "/crm/commission/nguoi-huong" },
    // Hai hold của nguồn động trỏ vào LEAD (chỗ sửa thật), không vào màn Chính sách (res3 MEDIUM-6)
    { ma: "UNRESOLVED_BENEFICIARY", detail: { lyDo: "THIEU_SALE_PHU_HUYNH" }, orderId: "o1", leadId: "l1", quyen: "lead", href: "/leads/l1" },
    { ma: "UNRESOLVED_BENEFICIARY", detail: { lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" }, orderId: "o1", leadId: "l1", quyen: "lead", href: "/leads/l1" },
    { ma: "POLICY_OVERLAP", detail: {}, orderId: "o1", leadId: null, quyen: "chinhSach", href: "/nguon-hoa-hong/chinh-sach?xem=tat-ca" },
    { ma: "PENDING_REGULATION", detail: {}, orderId: "o1", leadId: null, quyen: "chinhSach", href: "/nguon-hoa-hong/chinh-sach" },
    { ma: "CAP_EXCEEDED", detail: {}, orderId: "o1", leadId: null, quyen: "chinhSach", href: "/nguon-hoa-hong/chinh-sach?xem=tat-ca" },
    { ma: "CHUA_GAN_CON", detail: {}, orderId: "o1", leadId: null, quyen: "don", href: "/orders/o1" },
  ];
  for (const m of mau) {
    it(`[NHH-SO-HC-09] ${m.ma}/${JSON.stringify(m.detail)} → ${m.href}: có quyền thì có link; thiếu quyền thì KHÔNG có link nhưng vẫn nêu việc`, () => {
      const co = hanhDongTiep({ ma: m.ma, detail: m.detail, orderId: m.orderId, leadId: m.leadId, nguonCode: null }, TAT_CA_QUYEN);
      expect(co.lienKet?.href).toBe(m.href);
      expect(co.buoc.length).toBeGreaterThan(5);
      const khong = hanhDongTiep({ ma: m.ma, detail: m.detail, orderId: m.orderId, leadId: m.leadId, nguonCode: null }, { ...TAT_CA_QUYEN, [m.quyen]: false });
      expect(khong.lienKet).toBeNull();
      expect(khong.buoc).toBe(co.buoc);
    });
  }

  it("[NHH-SO-HC-10] không có đơn/lead để mở ⇒ không link (không dựng href rỗng)", () => {
    const b = hanhDongTiep({ ma: "CHUA_GAN_CON", detail: {}, orderId: null, leadId: null, nguonCode: null }, TAT_CA_QUYEN);
    expect(b.lienKet).toBeNull();
    const k = hanhDongTiep({ ma: "CHUA_GAN_CON", detail: {}, orderId: "o1", leadId: null, nguonCode: null }, KHONG_QUYEN);
    expect(k.lienKet).toBeNull();
  });

  it("[NHH-SO-HC-11] mọi mã đều có bước kế tiếp bằng chữ (không dòng nào cụt)", () => {
    for (const ma of Object.values(CommissionHoldCode)) {
      const b = hanhDongTiep({ ma, detail: {}, orderId: "o1", leadId: "l1", nguonCode: null }, KHONG_QUYEN);
      expect(b.buoc.length, ma).toBeGreaterThan(5);
    }
  });

  it("[NHH-SO-HC-12] chặn khoá kỳ lấy từ MỘT hàm của engine (không bảng thứ hai)", () => {
    expect(hangChoChanKy("UNRESOLVED_BENEFICIARY")).toBe(false);
    expect(hangChoChanKy("INPUT_DRIFT")).toBe(true);
  });
});

describe("[NHH-SO-HC] link từ tab Kỳ → chip của tab Sổ (một bảng mã→loại)", () => {
  it("[NHH-SO-HC-07] `loaiChungCuaCacMa`: cùng một loại ⇒ loại đó và `docLoaiHangCho` đọc lại được; lẫn loại / rỗng ⇒ null (mở cả hàng chờ, không đoán)", () => {
    expect(loaiChungCuaCacMa(["POLICY_OVERLAP", "PENDING_REGULATION"])).toBe("CHO_CHINH_SACH");
    expect(loaiChungCuaCacMa(["CHUA_GAN_CON", "CHO_HOC_VIEN", "NO_ORG_UNIT"])).toBe("THIEU_DU_LIEU_THANH_TOAN");
    expect(loaiChungCuaCacMa(["CAP_EXCEEDED", "INPUT_DRIFT"])).toBeNull();
    expect(loaiChungCuaCacMa([])).toBeNull();
    // vòng khứ hồi với bộ đọc URL của tab Sổ: mọi mã đều ra một loại mà `?nhom=` nhận
    for (const ma of TAT_CA_MA) expect(docLoaiHangCho(loaiChungCuaCacMa([ma])), ma).toBe(loaiCuaMa(ma));
  });
});

describe("[CLC-HC] hold của CHỦ NGUỒN dẫn về trang chi tiết nguồn (nơi chụp lại chủ nguồn) — luật 12", () => {
  const dich = (detail: unknown, q: QuyenLienKet, nguonCode: string | null = "FB_ADS", leadId: string | null = "l1") =>
    hanhDongTiep({ ma: "UNRESOLVED_BENEFICIARY", detail, orderId: "o1", leadId, nguonCode }, q);

  it("[CLC-HC-01] NGUON_CHUA_CO_NGUOI_PHU_TRACH + có quyền xem nguồn ⇒ link về «Đối tượng liên quan» của ĐÚNG nguồn; bước nói tới nút «Chụp lại chủ nguồn cho lead cũ»", () => {
    const b = dich({ vai: "SOURCE_OWNER", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" }, TAT_CA_QUYEN);
    expect(b.lienKet).toEqual({ nhan: "Mở nguồn", href: "/nguon-hoa-hong/nguon/FB_ADS#muc-doi-tuong" });
    expect(b.buoc).toMatch(/Chụp lại chủ nguồn cho lead cũ/);
    expect(b.buoc).not.toMatch(/chọn lại chính nguồn đó/); // lời khuyên cũ (đổi nguồn từng lead) không còn là đường chính
  });

  it("[CLC-HC-02] NGUOI_HUONG_NGHI của vai SOURCE_OWNER ⇒ cùng đích; NGUOI_HUONG_NGHI của vai KHÁC (Sale nghỉ) KHÔNG đổi hành vi cũ (nhánh mặc định «Mở chính sách»)", () => {
    const chu = dich({ vai: "SOURCE_OWNER", lyDo: "NGUOI_HUONG_NGHI" }, TAT_CA_QUYEN);
    expect(chu.lienKet?.href).toBe("/nguon-hoa-hong/nguon/FB_ADS#muc-doi-tuong");
    expect(chu.buoc).toMatch(/nghỉ/);
    // Không hứa một đường «an toàn» chưa có: «Đổi nguồn» sau thu TỰ GHI điều chỉnh thu hồi, không qua người duyệt — câu phải nói điều đó.
    expect(chu.buoc).toMatch(/TỰ GHI điều chỉnh thu hồi/);
    const sale = dich({ vai: "SALE", lyDo: "NGUOI_HUONG_NGHI" }, TAT_CA_QUYEN);
    expect(sale.lienKet?.href).toBe("/nguon-hoa-hong/chinh-sach");
    expect(sale.buoc).toBe("Kiểm tra cách xác định người nhận");
  });

  it("[CLC-HC-03] không mở được trang nguồn ⇒ KHÔNG link nguồn (rơi về lead nếu mở được lead), vẫn nêu việc; thiếu mã nguồn (lead chưa quy nguồn) cũng vậy", () => {
    const khongNguon = { ...TAT_CA_QUYEN, nguon: false };
    for (const lyDo of ["NGUON_CHUA_CO_NGUOI_PHU_TRACH", "NGUOI_HUONG_NGHI"]) {
      const b = dich({ vai: "SOURCE_OWNER", lyDo }, khongNguon);
      expect(b.lienKet, lyDo).toEqual({ nhan: "Mở lead", href: "/leads/l1" });
      const c = dich({ vai: "SOURCE_OWNER", lyDo }, TAT_CA_QUYEN, null);
      expect(c.lienKet?.href, `${lyDo} không có mã nguồn`).toBe("/leads/l1");
      const khong = dich({ vai: "SOURCE_OWNER", lyDo }, { ...KHONG_QUYEN }, "FB_ADS", null);
      expect(khong.lienKet, lyDo).toBeNull();
      expect(khong.buoc.length, lyDo).toBeGreaterThan(20);
    }
  });

  it("[CLC-HC-05] INPUT_DRIFT có chênh lệch ở vai SOURCE_OWNER ⇒ bước kế tiếp nói tới nhật ký của nguồn; INPUT_DRIFT của vai khác / detail rác GIỮ nguyên chữ cũ", () => {
    const drift = (detail: unknown) => hanhDongTiep({ ma: "INPUT_DRIFT", detail, orderId: "o1", leadId: "l1", nguonCode: "FB_ADS" }, TAT_CA_QUYEN);
    const chu = drift({ chenh: [{ key: "SOURCE_OWNER|USER|u1", chenh: -100000 }] });
    expect(chu.buoc).toMatch(/nhật ký của nguồn/);
    expect(chu.buoc).toMatch(/^Duyệt: áp dụng hoặc giữ nguyên/);
    expect(chu.lienKet).toEqual({ nhan: "Mở đơn", href: "/orders/o1" });
    // Phần ÂM = «Áp dụng» là THU HỒI tiền đã tính: nói thẳng SỐ ĐỒNG và lối «Giữ nguyên» (fin3 R5 M1 — hàng chờ không cảnh báo).
    expect(chu.buoc).toContain("THU HỒI 100.000 đ");
    expect(chu.buoc).toContain("Giữ nguyên");
    // Cộng các dòng ÂM của vai chủ nguồn (vế dương không bị trừ vào), bỏ qua dòng của vai khác.
    const hai = drift({ chenh: [{ key: "SOURCE_OWNER|USER|u1", chenh: -1250000 }, { key: "SOURCE_OWNER|USER|u2", chenh: 300000 }, { key: "SALE|USER|u3", chenh: -9 }] });
    expect(hai.buoc).toContain("THU HỒI 1.250.000 đ");
    // Chỉ có vế dương (người mới nhận thêm): KHÔNG nói «thu hồi».
    const duong = drift({ chenh: [{ key: "SOURCE_OWNER|USER|u2", chenh: 300000 }] });
    expect(duong.buoc).toMatch(/nhật ký của nguồn/);
    expect(duong.buoc).not.toMatch(/THU HỒI/);
    for (const detail of [{ chenh: [{ key: "SALE|USER|u1", chenh: -100000 }] }, { chenh: [] }, { chenh: "x" }, {}, null, "x", []]) {
      expect(drift(detail).buoc, JSON.stringify(detail)).toBe("Duyệt: áp dụng hoặc giữ nguyên");
    }
  });

  it("[CLC-HC-04] mã nguồn có ký tự đặc biệt được mã hoá trên URL (không vỡ đường dẫn)", () => {
    expect(dich({ vai: "SOURCE_OWNER", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" }, TAT_CA_QUYEN, "A B/C").lienKet?.href).toBe("/nguon-hoa-hong/nguon/A%20B%2FC#muc-doi-tuong");
  });
});
