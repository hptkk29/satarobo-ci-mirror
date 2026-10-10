// lib/finance/dung-hoc.test.ts — PHÉP QUYẾT TOÁN khi một con dừng học. THUẦN, không DB.
//
// ⚠️ Mọi mốc thời gian ở đây là NGÀY TUYỆT ĐỐI và mọi hàm đều nhận mốc qua THAM SỐ —
// không ca nào đọc `new Date()`. Luật 19 (`docs/luat-doc-so-va-ket-luan.md`): ca test đọc
// đồng hồ thật là ca hẹn giờ nổ, mã không đổi mà tờ lịch đổi thì đỏ.
import { describe, expect, it } from "vitest";
import {
  BUOC_LAM_TRON_DON_GIA,
  buoiDaDung,
  kiemPhanDu,
  tinhQuyetToan,
  type BuoiCuaLop,
} from "./dung-hoc";

const ok = (r: ReturnType<typeof tinhQuyetToan>) => {
  if ("khongTinhDuoc" in r) throw new Error(`Không tính được: ${r.loi}`);
  return r;
};

describe("tinhQuyetToan — giá trị con đã dùng", () => {
  it("[DH-01] ca thật của chủ dự án: 12.000.000đ / 48 buổi, dừng sau buổi 20 → 5.000.000đ", () => {
    const r = ok(
      tinhQuyetToan({
        hocPhiThuc: 12_000_000,
        soBuoiCamKet: 48,
        soBuoiDaDung: 20,
        lyDo: "PH_CHU_DONG",
      }),
    );
    expect(r.donGiaBuoi).toBe(250_000);
    expect(r.giaTriDaDung).toBe(5_000_000);
    expect(r.canhBao).toEqual([]);
  });

  it("[DH-01b] học lố tới buổi 26 trên cùng đơn giá → 6.500.000đ (đã thu 6.000.000 ⇒ còn nợ 500.000)", () => {
    const r = ok(
      tinhQuyetToan({
        hocPhiThuc: 12_000_000,
        soBuoiCamKet: 48,
        soBuoiDaDung: 26,
        lyDo: "PH_CHU_DONG",
      }),
    );
    expect(r.giaTriDaDung).toBe(6_500_000);
    expect(6_000_000 - r.giaTriDaDung).toBe(-500_000);
  });

  it("[DH-02] PHẦN LẺ DỒN BUỔI CUỐI: 10.000.000đ / 48 buổi, dùng HẾT 48 → ĐÚNG 10.000.000đ", () => {
    const r = ok(
      tinhQuyetToan({
        hocPhiThuc: 10_000_000,
        soBuoiCamKet: 48,
        soBuoiDaDung: 48,
        lyDo: "PH_CHU_DONG",
      }),
    );
    // Đơn giá làm tròn XUỐNG tới 1.000đ: 208.333,3 → 208.000.
    expect(r.donGiaBuoi).toBe(208_000);
    // ⚠️ `đơn giá × số buổi` = 9.984.000, HỤT 16.000đ. Luật "dồn buổi cuối" trả lại đúng
    // phần lẻ ấy — đây là ca chủ dự án chỉ đích danh, và nó là lý do luật tồn tại.
    expect(r.donGiaBuoi * 48).toBe(9_984_000);
    expect(r.giaTriDaDung).toBe(10_000_000);
  });

  it("[DH-03] làm tròn XUỐNG, không phải Math.round — đơn giá × số buổi không bao giờ vượt học phí", () => {
    for (const [hocPhi, camKet] of [
      [10_000_000, 48],
      [12_000_000, 7],
      [8_976_000, 24],
      [1_999_999, 3],
    ] as const) {
      const r = ok(
        tinhQuyetToan({
          hocPhiThuc: hocPhi,
          soBuoiCamKet: camKet,
          soBuoiDaDung: camKet - 1,
          lyDo: "PH_CHU_DONG",
        }),
      );
      expect(r.donGiaBuoi % BUOC_LAM_TRON_DON_GIA).toBe(0);
      expect(r.donGiaBuoi * camKet).toBeLessThanOrEqual(hocPhi);
      expect(r.giaTriDaDung).toBeLessThan(hocPhi);
    }
  });

  it("[DH-04] học LỐ số buổi cam kết → chặn ở đúng học phí thực + cảnh báo cho sale", () => {
    const r = ok(
      tinhQuyetToan({
        hocPhiThuc: 12_000_000,
        soBuoiCamKet: 48,
        soBuoiDaDung: 50,
        lyDo: "PH_CHU_DONG",
      }),
    );
    expect(r.giaTriDaDung).toBe(12_000_000);
    expect(r.canhBao).toHaveLength(1);
    expect(r.canhBao[0]).toContain("50 buổi");
    expect(r.canhBao[0]).toContain("48 buổi cam kết");
  });

  it("[DH-05] TRUNG_TAM_HUY → phí 0 dù đã học 20 buổi", () => {
    const r = ok(
      tinhQuyetToan({
        hocPhiThuc: 12_000_000,
        soBuoiCamKet: 48,
        soBuoiDaDung: 20,
        lyDo: "TRUNG_TAM_HUY",
      }),
    );
    expect(r.giaTriDaDung).toBe(0);
    expect(r.donGiaBuoi).toBe(0);
  });

  it("[DH-05b] TRUNG_TAM_HUY vẫn tính được khi khoá CHƯA khai số buổi — cổng phí-0 đứng TRƯỚC", () => {
    const r = tinhQuyetToan({
      hocPhiThuc: 12_000_000,
      soBuoiCamKet: null,
      soBuoiDaDung: 20,
      lyDo: "TRUNG_TAM_HUY",
    });
    expect("khongTinhDuoc" in r).toBe(false);
    expect(ok(r).giaTriDaDung).toBe(0);
  });

  it("[DH-06] khoá CHƯA khai totalSessions + đã học ≥1 buổi → TỪ CHỐI, câu lỗi chỉ đúng việc phải làm", () => {
    const r = tinhQuyetToan({
      hocPhiThuc: 12_000_000,
      soBuoiCamKet: null,
      soBuoiDaDung: 1,
      lyDo: "PH_CHU_DONG",
      tenKhoa: "Sata 3",
    });
    expect(r).toEqual({
      khongTinhDuoc: true,
      loi: 'Khoá "Sata 3" chưa khai số buổi cam kết — admin điền "Tổng số buổi" của khoá rồi thử lại.',
    });
    // `0` cũng là "chưa khai" — Course.totalSessions là Int? nên cả hai giá trị đều gặp.
    expect(
      tinhQuyetToan({
        hocPhiThuc: 1,
        soBuoiCamKet: 0,
        soBuoiDaDung: 1,
        lyDo: "KHAC",
      }),
    ).toHaveProperty("khongTinhDuoc", true);
  });

  it("[DH-07] chưa học buổi nào → 0đ và KHÔNG cần mẫu số (dòng đơn chưa gắn ghi danh)", () => {
    const r = ok(
      tinhQuyetToan({
        hocPhiThuc: 12_000_000,
        soBuoiCamKet: null,
        soBuoiDaDung: 0,
        lyDo: "PH_CHU_DONG",
      }),
    );
    expect(r.giaTriDaDung).toBe(0);
    expect(r.canhBao).toEqual([]);
  });
});

describe("buoiDaDung — đếm theo NGÀY, không theo status", () => {
  const b = (id: string, iso: string, status = "SCHEDULED"): BuoiCuaLop => ({
    id,
    date: new Date(iso),
    status,
  });

  // Lịch cố ý "bẩn" như dữ liệu thật: buổi quá khứ còn SCHEDULED, có buổi CANCELLED, và
  // `date` MANG GIỜ THẬT (ClassSession.date là Timestamptz(6), không phải @db.Date).
  const lich: BuoiCuaLop[] = [
    b("s1", "2026-08-03T12:30:00.000Z"),
    b("s2", "2026-08-05T12:30:00.000Z", "COMPLETED"),
    b("s3", "2026-08-10T12:30:00.000Z", "CANCELLED"),
    b("s4", "2026-08-12T12:30:00.000Z"),
    b("s5", "2026-08-17T12:30:00.000Z"),
  ];

  it("[BDD-01] buổi quá khứ còn SCHEDULED VẪN tính — đây là toàn bộ điểm của luật này", () => {
    const ds = buoiDaDung(lich, new Date("2026-08-12T12:30:00.000Z"));
    expect(ds.map((x) => x.id)).toEqual(["s1", "s2", "s4"]);
    // Nếu ai đó "sửa" hàm này thành đếm COMPLETED thì con số rơi từ 3 xuống 1, quyết toán
    // tụt 2 buổi tiền, và phần dư phình ra đúng bằng đó. Ca này ghim lại.
    expect(ds.filter((x) => x.status === "COMPLETED")).toHaveLength(1);
  });

  it("[BDD-02] buổi CANCELLED KHÔNG tính dù ngày đã qua", () => {
    const ds = buoiDaDung(lich, new Date("2026-08-17T12:30:00.000Z"));
    expect(ds.map((x) => x.id)).toEqual(["s1", "s2", "s4", "s5"]);
    expect(ds.some((x) => x.id === "s3")).toBe(false);
  });

  it("[BDD-03] BUỔI CUỐI mà sale chọn luôn nằm TRONG tập — bẫy Timestamptz mang giờ thật", () => {
    // Buổi lúc 19:30 giờ VN. So với 00:00 của chính ngày ấy thì nó RỤNG — và bé bị tính
    // thiếu một buổi tiền. Hàm phải so với CUỐI NGÀY.
    const ngay = new Date("2026-08-12T12:30:00.000Z");
    expect(buoiDaDung(lich, ngay).some((x) => x.id === "s4")).toBe(true);
    // Chứng minh bằng phản chứng: cắt ở đúng 00:00 thì s4 biến mất.
    const nuaDem = new Date(ngay.getTime());
    nuaDem.setHours(0, 0, 0, 0);
    expect(lich.filter((x) => x.date.getTime() <= nuaDem.getTime()).map((x) => x.id)).not.toContain(
      "s4",
    );
  });

  it("[BDD-04] buổi SAU ngày buổi cuối không tính; kết quả sắp theo thời gian", () => {
    const ds = buoiDaDung(lich, new Date("2026-08-05T12:30:00.000Z"));
    expect(ds.map((x) => x.id)).toEqual(["s1", "s2"]);
  });
});

describe("kiemPhanDu — phải phân HẾT khoản dư", () => {
  const conLai = [
    { orderItemId: "oi-B", ten: "Bé B", conNo: 4_000_000 },
    { orderItemId: "oi-C", ten: "Bé C", conNo: 1_000_000 },
  ];

  it("[PD-01] ca thật: dư 1.000.000 chuyển hết sang bé còn lại", () => {
    const r = kiemPhanDu({
      du: 1_000_000,
      phan: [{ kieu: "CHUYEN", orderItemId: "oi-B", soTien: 1_000_000 }],
      tranNhan: conLai,
    });
    expect(r).toMatchObject({ ok: true, tongChuyen: 1_000_000, tongHoan: 0 });
  });

  it("[PD-02] chia đôi chuyển + hoàn, Σ đúng bằng → cho qua", () => {
    const r = kiemPhanDu({
      du: 3_000_000,
      phan: [
        { kieu: "CHUYEN", orderItemId: "oi-B", soTien: 2_000_000 },
        { kieu: "HOAN", soTien: 1_000_000 },
      ],
      tranNhan: conLai,
    });
    expect(r).toMatchObject({ ok: true, tongChuyen: 2_000_000, tongHoan: 1_000_000 });
  });

  it("[PD-03] Σ ≠ chênh → CHẶN, và câu lỗi nói còn thiếu/vượt bao nhiêu", () => {
    const thieu = kiemPhanDu({
      du: 1_000_000,
      phan: [{ kieu: "CHUYEN", orderItemId: "oi-B", soTien: 600_000 }],
      tranNhan: conLai,
    });
    expect(thieu).toMatchObject({ ok: false });
    expect((thieu as { loi: string }).loi).toContain("Còn 400.000đ chưa phân");

    const thua = kiemPhanDu({
      du: 1_000_000,
      phan: [{ kieu: "HOAN", soTien: 1_400_000 }],
      tranNhan: conLai,
    });
    expect((thua as { loi: string }).loi).toContain("Phân vượt 400.000đ");
  });

  it("[PD-04] không phân gì → CHẶN, và nói thẳng là không có lựa chọn 'để đó'", () => {
    const r = kiemPhanDu({ du: 1_000_000, phan: [], tranNhan: conLai });
    expect(r).toMatchObject({ ok: false });
    expect((r as { loi: string }).loi).toContain('Không có lựa chọn "để đó"');
  });

  it("[PD-05] chuyển VƯỢT phần còn nợ của bé nhận → CHẶN, nêu trần của đúng bé đó", () => {
    const r = kiemPhanDu({
      du: 2_000_000,
      phan: [{ kieu: "CHUYEN", orderItemId: "oi-C", soTien: 2_000_000 }],
      tranNhan: conLai,
    });
    expect((r as { loi: string }).loi).toContain("Bé C chỉ nhận thêm được tối đa 1.000.000đ");
  });

  it("[PD-06] HAI phần cho CÙNG một bé cộng dồn mới vượt trần → vẫn CHẶN", () => {
    // Từng phần đều ≤ trần (600k + 600k ≤ 1tr là sai ở tổng, không ở từng phần). Không
    // cộng luỹ kế thì đây là đường lách trần, và nó trông hoàn toàn hợp lệ trên màn hình.
    const r = kiemPhanDu({
      du: 1_200_000,
      phan: [
        { kieu: "CHUYEN", orderItemId: "oi-C", soTien: 600_000 },
        { kieu: "CHUYEN", orderItemId: "oi-C", soTien: 600_000 },
      ],
      tranNhan: conLai,
    });
    expect(r).toMatchObject({ ok: false });
    expect((r as { loi: string }).loi).toContain("Bé C");
  });

  it("[PD-07] chuyển cho bé KHÔNG thuộc danh sách còn lại (bé vừa dừng / đơn khác) → CHẶN", () => {
    const r = kiemPhanDu({
      du: 500_000,
      phan: [{ kieu: "CHUYEN", orderItemId: "oi-A", soTien: 500_000 }],
      tranNhan: conLai,
    });
    expect((r as { loi: string }).loi).toContain("một bé KHÁC đang còn học trên cùng đơn");
  });

  it("[PD-08] phần ≤ 0 hoặc không phải số → CHẶN trước khi cộng tổng", () => {
    for (const soTien of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = kiemPhanDu({
        du: 1_000,
        phan: [{ kieu: "HOAN", soTien }],
        tranNhan: conLai,
      });
      expect(r).toMatchObject({ ok: false, loi: "Mỗi phần phải lớn hơn 0đ" });
    }
  });

  it("[PD-09] không có dư (≤ 0) → không gọi được phép phân", () => {
    expect(kiemPhanDu({ du: 0, phan: [], tranNhan: conLai })).toMatchObject({ ok: false });
    expect(kiemPhanDu({ du: -5, phan: [], tranNhan: conLai })).toMatchObject({ ok: false });
  });

  it("[PD-10] bé nhận đang ĐÓNG THỪA (conNo âm) → trần là 0, không nhận thêm đồng nào", () => {
    const r = kiemPhanDu({
      du: 100_000,
      phan: [{ kieu: "CHUYEN", orderItemId: "oi-D", soTien: 100_000 }],
      tranNhan: [{ orderItemId: "oi-D", ten: "Bé D", conNo: -200_000 }],
    });
    expect((r as { loi: string }).loi).toContain("tối đa 0đ");
  });
});
