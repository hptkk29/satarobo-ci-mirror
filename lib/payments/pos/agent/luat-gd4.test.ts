// Ca [POS4-CHON-01] · [POS4-SK-01] · [POS4-NP-01] · [POS4-TG-01] · [POS4-CB-01] · [POS4-DC-01] · [POS4-QD-01] ·
// [POS4-TD-01] — LUẬT THUẦN của đầu nhận POS Agent (GĐ4). Thiết kế: docs/pos-gd4-thiet-ke.md §6, §8, §9.
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi mốc là hằng tuyệt đối.
import { describe, it, expect } from "vitest";
import { chonAgentChoPhieu, chonCheDoNguonPos, sucKhoeAgent, thoiGianSongPhien } from "./suc-khoe";
import { tinhNextPollMs } from "./nhip";
import { canBaoSang, khoaChuongAgent, trongGioHoatDong } from "./canh-bao-luat";
import { doiChieuNguon, type DongNguonDoiChieu } from "./doi-chieu";
import { quyetPhieuPos, type DauVaoQuyetPos } from "../phieu-pos-luat";
import { thongDiepPos } from "../thong-diep-pos";

const GIAY = 1_000;
const PHUT = 60 * GIAY;
/** 2026-10-07 (thứ Tư) 10:20:00 giờ VN. */
const NOW = new Date("2026-10-07T03:20:00Z");
const truoc = (ms: number) => new Date(NOW.getTime() - ms);

describe("[POS4-CHON-01] chọn agent + chế độ nguồn — THEO DỮ LIỆU, một hàm (T15)", () => {
  const A = { id: "a1", merchantCode: "NCCPH6KE", active: true };
  const B = { id: "a2", merchantCode: "NCCZZZ99", active: true };

  it("merchant của máy phiếu khớp một agent ⇒ agent đó (kể cả khi cơ sở có hai agent)", () => {
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [A, B], maNhaCungCapCuaMay: "NCCPH6KE" })?.id).toBe("a1");
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [A, B], maNhaCungCapCuaMay: " ncczzz99 " })?.id).toBe("a2");
  });
  it("máy CHƯA khai merchant ⇒ agent đang bật DUY NHẤT của cơ sở", () => {
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [A], maNhaCungCapCuaMay: null })?.id).toBe("a1");
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [A], maNhaCungCapCuaMay: "  " })?.id).toBe("a1");
  });
  // [Rà đối kháng GĐ4 — RV-08] Mã TRƯỚC: máy khai merchant X mà cơ sở chỉ có agent merchant Y ⇒ vẫn chọn Y (đoán) ⇒
  // job cho Y, Y không bao giờ thấy giao dịch merchant X ⇒ NOT_FOUND / FAILED cũ được coi là "tươi".
  it("[POS4-RV-08] máy ĐÃ khai merchant mà không agent nào khớp ⇒ null ⇒ chế độ FILE (không đoán)", () => {
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [A], maNhaCungCapCuaMay: "KHONGCO" })).toBeNull();
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [{ id: "ag-y", merchantCode: "MERCHANTY", active: true }], maNhaCungCapCuaMay: "MERCHANTX" })).toBeNull();
  });
  it("0 agent / ≥ 2 mà máy không chỉ rõ / agent tắt ⇒ null ⇒ chế độ FILE", () => {
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [], maNhaCungCapCuaMay: "NCCPH6KE" })).toBeNull();
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [A, B], maNhaCungCapCuaMay: null })).toBeNull();
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [{ ...A, active: false }], maNhaCungCapCuaMay: "NCCPH6KE" })).toBeNull();
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [{ ...A, active: false }, B], maNhaCungCapCuaMay: null })?.id).toBe("a2");
  });
  it("chonCheDoNguonPos: agent đang bật ⇒ AGENT; null / tắt ⇒ FILE (y GĐ1)", () => {
    expect(chonCheDoNguonPos({ active: true })).toBe("AGENT");
    expect(chonCheDoNguonPos({ active: false })).toBe("FILE");
    expect(chonCheDoNguonPos(null)).toBe("FILE");
  });
});

describe("[POS4-SK-01] sucKhoeAgent — gác lượt SALE (D9)", () => {
  it.each([
    ["EXPIRED (kể cả vừa gọi)", { sessionState: "EXPIRED", lastHeartbeatAt: truoc(GIAY) }, "HET_PHIEN"],
    ["chưa gọi lần nào", { sessionState: "READY", lastHeartbeatAt: null }, "CHUA_KET_NOI"],
    ["đúng 180 000 ms ⇒ vẫn sẵn sàng", { sessionState: "READY", lastHeartbeatAt: truoc(180_000) }, "SAN_SANG"],
    ["180 001 ms ⇒ mất kết nối", { sessionState: "READY", lastHeartbeatAt: truoc(180_001) }, "MAT_KET_NOI"],
    ["UNKNOWN ⇒ chưa sẵn sàng", { sessionState: "UNKNOWN", lastHeartbeatAt: truoc(GIAY) }, "CHUA_SAN_SANG"],
    ["READY + vừa gọi ⇒ sẵn sàng", { sessionState: "READY", lastHeartbeatAt: truoc(GIAY) }, "SAN_SANG"],
  ] as const)("%s", (_t, a, mong) => {
    expect(sucKhoeAgent(a, NOW)).toBe(mong);
  });
});

describe("[POS4-NP-01] tinhNextPollMs (T17)", () => {
  const base = { now: NOW, centerIdAgent: "cs1", jobPending: [] as { createdAt: Date }[], phieu: [] as never[] };
  it("rảnh ⇒ 60000", () => expect(tinhNextPollMs(base)).toBe(60_000));
  it("job trẻ ⇒ 2000; đúng 2′ vẫn trẻ; 2′+1ms ⇒ 60000", () => {
    expect(tinhNextPollMs({ ...base, jobPending: [{ createdAt: truoc(30 * GIAY) }] })).toBe(2_000);
    expect(tinhNextPollMs({ ...base, jobPending: [{ createdAt: truoc(2 * PHUT) }] })).toBe(2_000);
    expect(tinhNextPollMs({ ...base, jobPending: [{ createdAt: truoc(2 * PHUT + 1) }] })).toBe(60_000);
  });
  it("phiếu MỞ cùng cơ sở tạo 9′59″ ⇒ 2000; đúng 10′ ⇒ 60000; cơ sở KHÁC ⇒ 60000; phiếu đóng ⇒ 60000", () => {
    const p = (ms: number, o: { centerId?: string; status?: "CHO_QUET" | "THAT_BAI" | "DA_THU" } = {}) => ({
      createdAt: truoc(ms),
      centerId: o.centerId ?? "cs1",
      status: o.status ?? "CHO_QUET",
    });
    expect(tinhNextPollMs({ ...base, phieu: [p(10 * PHUT - GIAY)] })).toBe(2_000);
    expect(tinhNextPollMs({ ...base, phieu: [p(10 * PHUT)] })).toBe(60_000);
    expect(tinhNextPollMs({ ...base, phieu: [p(PHUT, { centerId: "cs2" })] })).toBe(60_000);
    expect(tinhNextPollMs({ ...base, phieu: [p(PHUT, { status: "DA_THU" })] })).toBe(60_000);
    expect(tinhNextPollMs({ ...base, phieu: [p(PHUT, { status: "THAT_BAI" })] })).toBe(2_000);
  });
});

describe("[POS4-TG-01] thoiGianSongPhien — từ cặp SESSION_READY → SESSION_EXPIRED", () => {
  const ev = (type: "SESSION_READY" | "SESSION_EXPIRED" | "HEARTBEAT", gio: number) => ({
    type,
    createdAt: new Date(NOW.getTime() - gio * 60 * PHUT),
  });
  it("hai phiên trọn (20 giờ, 24 giờ) ⇒ TB 22 giờ; phiên đang sống KHÔNG tính", () => {
    const r = thoiGianSongPhien([
      ev("SESSION_READY", 72),
      ev("HEARTBEAT", 70),
      ev("SESSION_EXPIRED", 52),
      ev("SESSION_READY", 50),
      ev("SESSION_EXPIRED", 26),
      ev("SESSION_READY", 2),
    ]);
    expect(r.soPhien).toBe(2);
    expect(r.tbMs).toBe(22 * 60 * PHUT);
  });
  it("không cặp nào ⇒ soPhien 0, tbMs null; EXPIRED không có READY trước ⇒ bỏ", () => {
    expect(thoiGianSongPhien([])).toEqual({ soPhien: 0, tbMs: null });
    expect(thoiGianSongPhien([ev("SESSION_EXPIRED", 5), ev("SESSION_READY", 3)])).toEqual({ soPhien: 0, tbMs: null });
  });
  it("không phụ thuộc thứ tự đầu vào", () => {
    const r = thoiGianSongPhien([ev("SESSION_EXPIRED", 10), ev("SESSION_READY", 20)]);
    expect(r).toEqual({ soPhien: 1, tbMs: 10 * 60 * PHUT });
  });
});

describe("[POS4-CB-01] luật chuông: giờ hoạt động · 07:30 · khoá cơ sở + ngày VN", () => {
  const vn = (s: string) => new Date(`${s}+07:00`);
  it.each([
    ["thứ Hai 10:00 ⇒ ngoài", "2026-10-05T10:00:00", false],
    ["thứ Ba 07:59 ⇒ ngoài", "2026-10-06T07:59:59", false],
    ["thứ Ba 08:00 ⇒ trong", "2026-10-06T08:00:00", true],
    ["thứ Ba 20:59 ⇒ trong", "2026-10-06T20:59:59", true],
    ["thứ Ba 21:00 ⇒ ngoài", "2026-10-06T21:00:00", false],
    ["Chủ nhật 15:00 ⇒ trong", "2026-10-11T15:00:00", true],
  ])("%s", (_t, s, mong) => {
    expect(trongGioHoatDong(vn(s))).toBe(mong);
  });

  it("canBaoSang: hết hạn 20:59 hôm nay ⇒ báo; đúng 21:00 ⇒ không; ngày mai ⇒ không; null ⇒ không", () => {
    const sang = vn("2026-10-07T07:30:00");
    expect(canBaoSang(vn("2026-10-07T20:59:59"), sang)).toBe(true);
    expect(canBaoSang(vn("2026-10-07T21:00:00"), sang)).toBe(false);
    expect(canBaoSang(vn("2026-10-08T08:15:00"), sang)).toBe(false);
    expect(canBaoSang(null, sang)).toBe(false);
  });

  it("khoá chuông theo cơ sở + NGÀY VN: 16:59:59Z và 17:00Z là HAI ngày", () => {
    expect(khoaChuongAgent("het-phien", "cs1", new Date("2026-10-07T16:59:59Z"))).toBe("pos.agent-het-phien:cs1:2026-10-07");
    expect(khoaChuongAgent("het-phien", "cs1", new Date("2026-10-07T17:00:00Z"))).toBe("pos.agent-het-phien:cs1:2026-10-08");
    expect(khoaChuongAgent("mat-ket-noi", "cs2", NOW)).toBe("pos.agent-mat-ket-noi:cs2:2026-10-07");
  });
});

describe("[POS4-DC-01] doiChieuNguon — agent ↔ file theo ngày (GĐ6)", () => {
  const T0 = new Date("2026-10-07T03:18:42Z");
  const r = (o: Partial<DongNguonDoiChieu> & { maGiaoDich: string; nguon: "FILE" | "AGENT" }): DongNguonDoiChieu => ({
    tuChoi: null,
    soTien: 6_732_000,
    trangThai: "Thành công",
    loaiGiaoDich: "Thanh toán",
    thoiGianGiaoDich: T0,
    bamDienGiai: "a".repeat(64),
    lanDauThay: new Date(T0.getTime() + 30 * GIAY),
    ...o,
  });

  it("đủ năm nhóm, đếm đúng; bảng chỉ dòng KHÔNG khớp", () => {
    const kq = doiChieuNguon([
      r({ maGiaoDich: "KHOP0001", nguon: "AGENT" }),
      r({ maGiaoDich: "KHOP0001", nguon: "FILE" }),
      r({ maGiaoDich: "CHIAGENT1", nguon: "AGENT" }),
      r({ maGiaoDich: "CHIFILE01", nguon: "FILE" }),
      r({ maGiaoDich: "TUCHOI001", nguon: "AGENT", tuChoi: "AMOUNT_MISMATCH" }),
      r({ maGiaoDich: "TUCHOI001", nguon: "FILE" }),
      r({ maGiaoDich: "LECHTIEN1", nguon: "AGENT", soTien: 6_000_000 }),
      r({ maGiaoDich: "LECHTIEN1", nguon: "FILE" }),
    ]);
    expect(kq.tong).toEqual({ CHI_AGENT: 1, CHI_FILE: 1, AGENT_TU_CHOI: 1, LECH: 1, KHOP: 1 });
    expect(kq.dong.map((d) => [d.maGiaoDich, d.nhom]).sort()).toEqual(
      [
        ["CHIAGENT1", "CHI_AGENT"],
        ["CHIFILE01", "CHI_FILE"],
        ["LECHTIEN1", "LECH"],
        ["TUCHOI001", "AGENT_TU_CHOI"],
      ].sort(),
    );
    expect(kq.dong.find((d) => d.maGiaoDich === "LECHTIEN1")?.lech).toEqual(["soTien"]);
  });

  it("trạng thái: 'Thành công' hai bên KHỚP; 'Thất bại' file vs treo agent LỆCH; loại khác ⇒ LỆCH", () => {
    expect(doiChieuNguon([r({ maGiaoDich: "M1", nguon: "AGENT" }), r({ maGiaoDich: "M1", nguon: "FILE", trangThai: "Thành công " })]).tong.KHOP).toBe(1);
    const lech = doiChieuNguon([r({ maGiaoDich: "M2", nguon: "AGENT", trangThai: "PENDING" }), r({ maGiaoDich: "M2", nguon: "FILE", trangThai: "Thất bại" })]);
    expect(lech.dong[0]?.lech).toEqual(["trangThai"]);
    const loai = doiChieuNguon([r({ maGiaoDich: "M3", nguon: "AGENT", loaiGiaoDich: "Hủy" }), r({ maGiaoDich: "M3", nguon: "FILE" })]);
    expect(loai.dong[0]?.lech).toEqual(["loaiGiaoDich"]);
  });

  it("giờ lệch 60″ ⇒ khớp; 61″ ⇒ LỆCH; ghi chú (băm) khác ⇒ LỆCH", () => {
    const gio = (s: number) =>
      doiChieuNguon([r({ maGiaoDich: "G1", nguon: "AGENT" }), r({ maGiaoDich: "G1", nguon: "FILE", thoiGianGiaoDich: new Date(T0.getTime() + s * GIAY) })]);
    expect(gio(60).tong.KHOP).toBe(1);
    expect(gio(61).dong[0]?.lech).toEqual(["thoiGianGiaoDich"]);
    const gc = doiChieuNguon([r({ maGiaoDich: "G2", nguon: "AGENT" }), r({ maGiaoDich: "G2", nguon: "FILE", bamDienGiai: "b".repeat(64) })]);
    expect(gc.dong[0]?.lech).toEqual(["bamDienGiai"]);
  });

  it("đồng bộ trễ: lanDauThay(AGENT) − giờ giao dịch; > 10′ ⇒ nhãn 'được bù'", () => {
    const tre = doiChieuNguon([r({ maGiaoDich: "B1", nguon: "AGENT", lanDauThay: new Date(T0.getTime() + 11 * PHUT) })]);
    expect(tre.dong[0]).toMatchObject({ nhom: "CHI_AGENT", treMs: 11 * PHUT, duocBu: true });
    const kip = doiChieuNguon([r({ maGiaoDich: "B2", nguon: "AGENT", lanDauThay: new Date(T0.getTime() + 10 * PHUT) })]);
    expect(kip.dong[0]).toMatchObject({ duocBu: false });
  });
});

function vao(o: Partial<DauVaoQuyetPos> & Pick<DauVaoQuyetPos, "kq">): DauVaoQuyetPos {
  return {
    hienTai: "CHO_QUET",
    tien: { loai: "KHONG_DOI_TIEN" },
    bt: null,
    coMaDuyNhat: false,
    btCuaPhieuKhac: false,
    code5: "K7M2N",
    taoLuc: new Date("2026-10-07T03:00:00Z"),
    soTienMay: null,
    gioQuet: null,
    ...o,
  };
}

describe("[POS4-QD-01] quyetPhieuPos — D9 (AGENT_*) và job chưa xong", () => {
  it("AGENT_HET_PHIEN trên phiếu MỞ ⇒ GIỮ trạng thái, ghi câu D9 hết phiên, baoAdmin AGENT", () => {
    const q = quyetPhieuPos(vao({ kq: { kind: "PROVIDER_ERROR", reasonCode: "AGENT_HET_PHIEN", coSo: "CS1" } }));
    expect(q).toEqual({
      status: "CHO_QUET",
      ghiKetQua: true,
      nhanBt: false,
      baoAdmin: "AGENT",
      ketLuan: { loai: "TCB_TAM_MAT_KET_NOI", coSo: "CS1", lyDo: "HET_PHIEN", maLoi: "AGENT_HET_PHIEN" },
    });
    const thatBai = quyetPhieuPos(vao({ hienTai: "THAT_BAI", kq: { kind: "PROVIDER_ERROR", reasonCode: "AGENT_MAT_KET_NOI", coSo: "CS1" } }));
    expect(thatBai.status).toBe("THAT_BAI");
    expect(thatBai.ketLuan).toMatchObject({ loai: "TCB_TAM_MAT_KET_NOI", lyDo: "KHAC" });
  });

  it("AGENT_* trên phiếu ĐÓNG (DA_THU) ⇒ giữ trạng thái + câu cũ (ketLuan null, không ghi kết quả)", () => {
    const q = quyetPhieuPos(vao({ hienTai: "DA_THU", kq: { kind: "PROVIDER_ERROR", reasonCode: "AGENT_HET_PHIEN", coSo: "CS1" } }));
    expect(q).toMatchObject({ status: "DA_THU", ghiKetQua: false, ketLuan: null, baoAdmin: "AGENT" });
  });

  it("PROVIDER_ERROR KHÔNG phải AGENT_* ⇒ vẫn đường LOI_KET_NOI cũ (đối chứng)", () => {
    const q = quyetPhieuPos(vao({ kq: { kind: "PROVIDER_ERROR", reasonCode: "TCB_FILE_DB" } }));
    expect(q).toMatchObject({ baoAdmin: "LOI_KET_NOI", ketLuan: { loai: "LOI_KET_NOI", maLoi: "TCB_FILE_DB" } });
  });

  it("NOT_FOUND + dongBoChuaXong ⇒ DANG_DONG_BO, phiếu giữ MỞ; đóng ⇒ không đè", () => {
    expect(quyetPhieuPos(vao({ kq: { kind: "NOT_FOUND", dongBoChuaXong: true } }))).toMatchObject({
      status: "CHO_QUET",
      ghiKetQua: true,
      ketLuan: { loai: "DANG_DONG_BO", code5: "K7M2N" },
      baoAdmin: null,
    });
    expect(quyetPhieuPos(vao({ hienTai: "DA_THU", kq: { kind: "NOT_FOUND", dongBoChuaXong: true } }))).toMatchObject({
      status: "DA_THU",
      ketLuan: null,
    });
  });

  it("NOT_FOUND chế độ AGENT ⇒ CHUA_THAY mang cheDo AGENT", () => {
    const q = quyetPhieuPos(vao({ kq: { kind: "NOT_FOUND", cheDoNguon: "AGENT", duLieuCapNhatLuc: "2026-10-07T10:19:58+07:00" } }));
    expect(q.ketLuan).toMatchObject({ loai: "CHUA_THAY", cheDo: "AGENT" });
  });
});

describe("[POS4-TD-01] thongDiepPos — ba câu mới NGUYÊN VĂN + chế độ AGENT", () => {
  it("D9 hết phiên", () => {
    expect(thongDiepPos({ loai: "TCB_TAM_MAT_KET_NOI", coSo: "CS1", lyDo: "HET_PHIEN", maLoi: "AGENT_HET_PHIEN" })).toEqual({
      cau: "Tạm mất kết nối Techcombank CS1, đã báo admin đăng nhập lại. Biên lai máy đã báo THÀNH CÔNG thì ĐỪNG cho quẹt lại — bấm Kiểm tra lại sau.",
      mucDo: "loi",
    });
  });
  it("D9 mất kết nối / chưa sẵn sàng", () => {
    expect(thongDiepPos({ loai: "TCB_TAM_MAT_KET_NOI", coSo: "CS1", lyDo: "KHAC", maLoi: "AGENT_MAT_KET_NOI" }).cau).toBe(
      "Tạm mất kết nối Techcombank CS1 (máy đồng bộ không phản hồi), đã báo admin. Biên lai máy đã báo THÀNH CÔNG thì ĐỪNG cho quẹt lại — bấm Kiểm tra lại sau.",
    );
  });
  it("job chưa xong", () => {
    expect(thongDiepPos({ loai: "DANG_DONG_BO", code5: "K7M2N" })).toEqual({
      cau: "Máy đồng bộ Techcombank chưa trả lời kịp — bấm Kiểm tra lại sau vài giây. Biên lai máy đã báo THÀNH CÔNG thì ĐỪNG cho quẹt lại.",
      mucDo: "thong_tin",
    });
  });
  it("CHUA_THAY chế độ AGENT: nói 'máy đồng bộ' + giờ có GIÂY, không nói 'nhập'", () => {
    const tao = new Date("2026-10-07T03:00:00Z");
    const cau = thongDiepPos({
      loai: "CHUA_THAY",
      code5: "K7M2N",
      duLieuLuc: new Date("2026-10-07T03:19:58Z"),
      gdMoiNhatLuc: new Date("2026-10-07T03:10:00Z"),
      taoLuc: tao,
      baoAdminTuLuc: new Date(tao.getTime() + 10 * PHUT),
      cheDo: "AGENT",
    }).cau;
    expect(cau).toContain("Dữ liệu Techcombank (máy đồng bộ) cập nhật lần cuối 10:19:58");
    expect(cau).not.toContain("nhập");
  });
  it("CHUA_THAY không khai chế độ ⇒ câu GĐ1 nguyên văn (đối chứng: FILE không đổi)", () => {
    const tao = new Date("2026-10-07T03:00:00Z");
    const cau = thongDiepPos({
      loai: "CHUA_THAY",
      code5: "K7M2N",
      duLieuLuc: null,
      gdMoiNhatLuc: null,
      taoLuc: tao,
      baoAdminTuLuc: new Date(tao.getTime() + 10 * PHUT),
    }).cau;
    expect(cau).toContain("Chưa có dữ liệu Techcombank nào được nhập.");
  });
  it("DANG_CHO_NGAN_HANG chế độ AGENT: không bảo chờ kế toán nhập dữ liệu", () => {
    const cau = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: "K7M2N", maTrangThai: "PENDING", cheDo: "AGENT" }).cau;
    expect(cau).toContain("ĐỪNG cho quẹt lại");
    expect(cau).not.toContain("kế toán nhập");
  });
});
