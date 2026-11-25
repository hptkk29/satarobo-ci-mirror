import { describe, expect, it, vi } from "vitest";
import { bamMaNhan } from "./luu";
import {
  chuanHoaNamSinhCon,
  cheTen,
  nhanBaiDisc,
  TOI_DA_LAN_THU_NHAN,
  yeuCauOtpNhan,
  type NhanDeps,
  type PhienDangNhap,
  type TaiKhoanTimThay,
  type ThachDoStore,
} from "./nhan";

// Toàn bộ dữ liệu ở đây là GIẢ (bịa), không liên quan người thật.
const NOW = new Date("2026-11-01T00:00:00Z");
const KHOA = () => "khoa-thu-nghiem-gia-0123456789abcdef0123";
const SDT = "0905000111"; // → 84905000111
const SDT_CHUAN = "84905000111";
/** HMAC giả: khác hẳn SĐT thô để test bắt được việc đưa nhầm giá trị này vào OTP / đưa SĐT thô vào bảng Disc*. */
const khoaSdtGia = (s: string) => `hmac-gia:${s}`;
const PK = khoaSdtGia(SDT_CHUAN);
const MA = "ABCDE23456";
const MA_KHAC = "ZZZZZ99999";
const NAM = 2015;
const NAM_SAI = 2014;

type Hang = { id: string; phoneKey: string; status: "PENDING_CLAIM" | "CLAIMED"; hash: string; nam: number; thu: number; hetHan?: boolean; user?: string };

/**
 * Store giả giữ ĐÚNG ngữ nghĩa của `thachDoStore` thật: tăng bộ đếm TỪNG DÒNG có điều kiện `< toiDa` TRƯỚC khi so, chỉ so trong số dòng vừa tăng,
 * và `gan` là CAS trên PENDING_CLAIM. (Không chứng minh được an toàn đua ở Postgres — đã có lưới đọc mã cho phần đó.)
 */
function taoStore(rows: Hang[]) {
  const nhatKy: Array<{ phoneKey: string }> = [];
  const store: ThachDoStore = {
    thu: async ({ phoneKey, maHash, namSinhCon, toiDaLanThu }) => {
      nhatKy.push({ phoneKey });
      const cho = rows.filter((r) => r.phoneKey === phoneKey && r.status === "PENDING_CLAIM" && !r.hetHan);
      const daTang = cho.filter((r) => r.thu < toiDaLanThu);
      for (const r of daTang) r.thu++;
      const khop = daTang.find((r) => r.hash === maHash && r.nam === namSinhCon);
      return khop ? { submissionId: khop.id } : null;
    },
    gan: async ({ submissionId, phoneKey, userId }) => {
      const r = rows.find((x) => x.id === submissionId && x.phoneKey === phoneKey && x.status === "PENDING_CLAIM");
      if (!r) return false;
      r.status = "CLAIMED";
      r.user = userId;
      return true;
    },
  };
  return { store, nhatKy };
}

const hangMau = (): Hang[] => [
  { id: "s1", phoneKey: PK, status: "PENDING_CLAIM", hash: bamMaNhan(MA, KHOA()), nam: NAM, thu: 0 },
  { id: "s2", phoneKey: khoaSdtGia("84912000222"), status: "PENDING_CLAIM", hash: bamMaNhan(MA_KHAC, KHOA()), nam: 2012, thu: 0 },
];

function taoDeps(rows: Hang[], o: { tk?: TaiKhoanTimThay | null; otpOk?: boolean; coBai?: boolean; choPhep?: boolean; choThu?: boolean } = {}) {
  const goi = {
    taoPhuHuynh: vi.fn(async (_p: { phoneKey: string; matKhauHash: string; now: Date }) => ({ id: "u-moi" })),
    kichHoat: vi.fn(async (_p: { userId: string; matKhauHash: string; now: Date }) => {}),
    huyTaoMoi: vi.fn(async (_id: string) => {}),
    otpYeuCau: vi.fn(),
    otpXacMinh: vi.fn(),
    tim: vi.fn(async (_s: string) => o.tk ?? null),
    coBai: vi.fn(async (_k: string, _t: Date) => o.coBai ?? true),
    choPhep: vi.fn(async (_k: string) => o.choPhep ?? true),
    // Giả đúng ngữ nghĩa cổng thật: chỉ cho thử OTP khi CÓ dòng chờ của số này khớp mã băm (đọc, không đếm) ∧ chưa quá trần.
    choThu: vi.fn(async (p: { khoaSdt: string; maHash: string; now: Date }) =>
      (o.choThu ?? true) && rows.some((r) => r.phoneKey === p.khoaSdt && r.status === "PENDING_CLAIM" && !r.hetHan && r.hash === p.maHash && r.thu < TOI_DA_LAN_THU_NHAN)),
    sauKhiNhan: vi.fn(async (_p: { submissionId: string; sdtChuan: string }) => {}),
  };
  goi.otpYeuCau.mockResolvedValue({ ok: true, cooldownSec: 60 });
  goi.otpXacMinh.mockResolvedValue(o.otpOk === false ? { ok: false, error: "Mã không đúng. Còn 4 lần thử." } : { ok: true });
  const { store, nhatKy } = taoStore(rows);
  const deps: NhanDeps = {
    now: NOW,
    thachDoStore: store,
    khoaSdt: khoaSdtGia,
    coBaiDangCho: goi.coBai,
    choPhepGuiOtp: goi.choPhep,
    choPhepThuOtp: goi.choThu,
    otp: { yeuCau: goi.otpYeuCau, xacMinh: goi.otpXacMinh },
    taiKhoan: { tim: goi.tim, taoPhuHuynh: goi.taoPhuHuynh, kichHoat: goi.kichHoat, huyTaoMoi: goi.huyTaoMoi },
    bamMatKhau: async (m) => `hash(${m})`,
    khoaBam: KHOA,
    sauKhiNhan: goi.sauKhiNhan,
  };
  return { deps, goi, nhatKy };
}
const vao = (deps: NhanDeps, o: Partial<Parameters<typeof nhanBaiDisc>[0]> = {}) =>
  nhanBaiDisc({ soDienThoai: SDT, otp: "123456", maNhan: MA, namSinhCon: NAM, matKhau: "matkhau-gia-1", phien: null, deps, ...o });

describe("[DISC-NHAN-01] cần ĐỒNG THỜI OTP + mã nhận + năm sinh của con", () => {
  it("đủ cả ba, số chưa có User ⇒ tạo User PARENT rồi gắn bài", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows);
    const r = await vao(deps);
    expect(r).toEqual({ ok: true, submissionId: "s1", taoTaiKhoanMoi: true });
    // User.phone là SĐT thô chuẩn hoá — KHÔNG phải khoá HMAC của bảng Disc*.
    expect(goi.taoPhuHuynh).toHaveBeenCalledWith({ phoneKey: SDT_CHUAN, matKhauHash: "hash(matkhau-gia-1)", now: NOW });
    expect(rows[0]).toMatchObject({ status: "CLAIMED", user: "u-moi" });
    expect(rows[1]!.status).toBe("PENDING_CLAIM");
  });
  it("chỉ có OTP, KHÔNG có mã ⇒ không thấy/không nhận gì và KHÔNG tạo tài khoản", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows);
    for (const maNhan of [undefined, "", "   ", null, 123]) {
      const r = await vao(deps, { maNhan });
      expect(r).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    }
    expect(goi.taoPhuHuynh).not.toHaveBeenCalled();
    expect(goi.otpXacMinh).not.toHaveBeenCalled(); // sai dạng ⇒ chưa tiêu OTP
    expect(rows[0]!.status).toBe("PENDING_CLAIM");
  });
  it("OTP sai ⇒ thông điệp CHUNG (D3: không chuyển lỗi OTP nguyên văn), không đụng bài, không tạo tài khoản", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows, { otpOk: false });
    const r = await vao(deps);
    expect(r).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    expect(JSON.stringify(r)).not.toMatch(/lần thử|Còn \d|hết hạn|đã dùng/i);
    expect(r).toEqual(await vao(taoDeps(hangMau()).deps, { maNhan: MA_KHAC })); // y hệt sai mã
    expect(goi.taoPhuHuynh).not.toHaveBeenCalled();
    expect(rows[0]!.thu).toBe(0);
  });
  it("mã đúng nhưng của SỐ KHÁC (IDOR) ⇒ cùng lỗi, bài kia không đổi", async () => {
    const rows = hangMau();
    const { deps } = taoDeps(rows);
    const r = await vao(deps, { maNhan: MA_KHAC, namSinhCon: 2012 });
    expect(r).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    expect(rows[1]!.status).toBe("PENDING_CLAIM");
    expect(rows[1]!.thu).toBe(0); // bộ đếm của bài người khác không bị đụng
  });
  it("mã sai dạng ⇔ mã sai giá trị ⇔ năm sai ⇔ số không có bài: CÙNG thông điệp (không oracle)", async () => {
    const a = await vao(taoDeps(hangMau()).deps, { maNhan: "xx" });
    const b = await vao(taoDeps(hangMau()).deps, { maNhan: MA_KHAC });
    const c = await vao(taoDeps([]).deps);
    const d = await vao(taoDeps(hangMau()).deps, { namSinhCon: NAM_SAI });
    const e = await vao(taoDeps(hangMau()).deps, { namSinhCon: "abcd" });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(c).toEqual(d);
    expect(d).toEqual(e);
  });
  it("OTP đi với SĐT THÔ chuẩn hoá; bảng Disc* đi với khoá HMAC — không lẫn", async () => {
    const { deps, goi, nhatKy } = taoDeps(hangMau());
    await vao(deps);
    expect(goi.otpXacMinh).toHaveBeenCalledWith(SDT_CHUAN, "123456");
    expect(goi.tim).toHaveBeenCalledWith(SDT_CHUAN);
    expect(nhatKy.every((n) => n.phoneKey === PK)).toBe(true);
    expect(nhatKy.length).toBeGreaterThan(0);
  });
});

describe("[DISC-NHAN-02] đoán mã · khoá · hết hạn · đua", () => {
  it("sai quá ngưỡng ⇒ khoá: ngay cả mã + năm ĐÚNG cũng bị từ chối với cùng lỗi", async () => {
    const rows = hangMau();
    const { deps } = taoDeps(rows);
    // N3: mã sai bị cổng trước-OTP chặn trước bộ đếm (không đốt OTP) ⇒ muốn đếm phải có MÃ ĐÚNG + năm sai.
    for (let i = 0; i < TOI_DA_LAN_THU_NHAN; i++) await vao(deps, { namSinhCon: NAM_SAI });
    expect(rows[0]!.thu).toBe(TOI_DA_LAN_THU_NHAN);
    const r = await vao(deps, { maNhan: MA });
    expect(r).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    expect(rows[0]!.status).toBe("PENDING_CLAIM");
  });
  it("bài hết hạn ⇒ không nhận được dù mã + năm đúng", async () => {
    const rows = hangMau();
    rows[0]!.hetHan = true;
    expect(await vao(taoDeps(rows).deps)).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
  });
  it("hai phiên cùng nhận một bài ⇒ chỉ MỘT thắng", async () => {
    const rows = hangMau();
    const { deps } = taoDeps(rows);
    const a = await vao(deps);
    const b = await vao(deps);
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
  });
  it("hai phiên ĐỒNG THỜI cùng thắng thách đố ⇒ một gắn được, bên thua dọn tài khoản vừa tạo", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows);
    // Cả hai qua `thu` (cùng thấy PENDING_CLAIM) rồi mới tới `gan`: dựng bằng cách chặn gan của lượt đầu tới khi lượt hai đã qua thu.
    const ganGoc = deps.thachDoStore.gan;
    let moCua!: () => void;
    const cho = new Promise<void>((r) => (moCua = r));
    let soGan = 0;
    deps.thachDoStore = {
      thu: deps.thachDoStore.thu,
      gan: async (x) => {
        soGan++;
        if (soGan === 1) await cho;
        else moCua();
        return ganGoc(x);
      },
    };
    const [a, b] = await Promise.all([vao(deps), vao(deps)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const thua = a.ok ? b : a;
    expect(thua).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    expect(goi.huyTaoMoi).toHaveBeenCalledTimes(1);
  });
  it("thua ở bước GẮN (store.gan ném hoặc false) ⇒ dọn tài khoản vừa tạo, không báo thành công", async () => {
    for (const gan of [async () => false, async (): Promise<boolean> => { throw new Error("db down"); }]) {
      const { deps, goi } = taoDeps(hangMau());
      deps.thachDoStore = { ...deps.thachDoStore, gan };
      expect(await vao(deps)).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
      expect(goi.huyTaoMoi).toHaveBeenCalledWith("u-moi");
    }
  });
});

describe("[DISC-NHAN-03] tài khoản đã có / SĐT khác", () => {
  it("User ACTIVE + chưa đăng nhập ⇒ CAN_DANG_NHAP (lưới an toàn ca đua), không gắn, không đốt lượt thử, không đặt lại mật khẩu", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows, { tk: { id: "u1", trangThai: "ACTIVE", laPhuHuynh: true } });
    expect(await vao(deps)).toMatchObject({ ok: false, loi: "CAN_DANG_NHAP" });
    expect(goi.kichHoat).not.toHaveBeenCalled();
    expect(goi.taoPhuHuynh).not.toHaveBeenCalled();
    expect(rows[0]!.status).toBe("PENDING_CLAIM");
    expect(rows[0]!.thu).toBe(0);
  });
  it("User ACTIVE + đang đăng nhập ĐÚNG số + OTP ⇒ gắn vào chính tài khoản đó, không tạo trùng", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows, { tk: { id: "u1", trangThai: "ACTIVE", laPhuHuynh: true } });
    const r = await vao(deps, { phien: { userId: "u1", phoneKey: SDT_CHUAN }, matKhau: null });
    expect(r).toEqual({ ok: true, submissionId: "s1", taoTaiKhoanMoi: false });
    expect(rows[0]!.user).toBe("u1");
    expect(goi.taoPhuHuynh).not.toHaveBeenCalled();
  });
  it("đăng nhập tài khoản KHÁC số (hoặc không có SĐT) ⇒ từ chối TRƯỚC khi tiêu OTP", async () => {
    const { deps, goi } = taoDeps(hangMau());
    expect(await vao(deps, { phien: { userId: "u9", phoneKey: "84912999999" } })).toMatchObject({ ok: false, loi: "KHONG_HOP_LE" });
    expect(await vao(deps, { phien: { userId: "u9", phoneKey: null } })).toMatchObject({ ok: false, loi: "KHONG_HOP_LE" });
    expect(goi.otpXacMinh).not.toHaveBeenCalled();
  });
  it("User PENDING_ACTIVATION (vai PH) ⇒ kích hoạt rồi gắn; vai khác ⇒ từ chối", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows, { tk: { id: "u2", trangThai: "PENDING_ACTIVATION", laPhuHuynh: true } });
    expect(await vao(deps)).toEqual({ ok: true, submissionId: "s1", taoTaiKhoanMoi: false });
    expect(goi.kichHoat).toHaveBeenCalledWith({ userId: "u2", matKhauHash: "hash(matkhau-gia-1)", now: NOW });
    const { deps: d2, goi: g2 } = taoDeps(hangMau(), { tk: { id: "u3", trangThai: "PENDING_ACTIVATION", laPhuHuynh: false } });
    expect(await vao(d2)).toMatchObject({ ok: false, loi: "KHONG_HOP_LE" });
    expect(g2.kichHoat).not.toHaveBeenCalled();
  });
  it("chưa đăng nhập mà mật khẩu quá ngắn ⇒ lỗi dữ liệu, chưa tiêu OTP", async () => {
    const { deps, goi } = taoDeps(hangMau());
    expect(await vao(deps, { matKhau: "ngan" })).toMatchObject({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" });
    expect(goi.otpXacMinh).not.toHaveBeenCalled();
  });
  it("SĐT hoặc OTP sai định dạng ⇒ DU_LIEU_KHONG_HOP_LE", async () => {
    const { deps } = taoDeps(hangMau());
    expect(await vao(deps, { soDienThoai: "abc" })).toMatchObject({ loi: "DU_LIEU_KHONG_HOP_LE" });
    expect(await vao(deps, { otp: "12" })).toMatchObject({ loi: "DU_LIEU_KHONG_HOP_LE" });
  });
});

describe("[DISC-NHAN-04] xin OTP — đồng nhất, không đốt tiền cho số lạ", () => {
  const goi = (deps: NhanDeps, o: Partial<Parameters<typeof yeuCauOtpNhan>[0]> = {}) =>
    yeuCauOtpNhan({ soDienThoai: SDT, cooldownMacDinhSec: 60, phien: null, deps, ...o });

  it("số có bài ⇒ gửi OTP DISC_CLAIM tới SĐT THÔ; số không có bài ⇒ KHÔNG gửi; cả hai cùng phản hồi", async () => {
    const co = taoDeps(hangMau(), { coBai: true });
    const khong = taoDeps(hangMau(), { coBai: false });
    const a = await goi(co.deps);
    const b = await goi(khong.deps);
    expect(a).toEqual({ ok: true, cooldownSec: 60 });
    expect(b).toEqual(a);
    expect(co.goi.otpYeuCau).toHaveBeenCalledWith(SDT_CHUAN);
    expect(khong.goi.otpYeuCau).not.toHaveBeenCalled();
    // tra bài đi bằng khoá HMAC, không bằng SĐT thô
    expect(co.goi.coBai).toHaveBeenCalledWith(PK, NOW);
  });
  it("gửi hỏng / cooldown / quá hạn mức của riêng số ⇒ vẫn phản hồi chung", async () => {
    const { deps, goi: g } = taoDeps(hangMau());
    g.otpYeuCau.mockResolvedValue({ ok: false, error: "Vui lòng chờ 30s trước khi gửi lại." });
    expect(await goi(deps)).toEqual({ ok: true, cooldownSec: 60 });
  });
  it("hệ thống ngắt (trần ngày/kill-switch) không phụ thuộc số ⇒ nói thật", async () => {
    const { deps, goi: g } = taoDeps(hangMau());
    g.otpYeuCau.mockResolvedValue({ ok: false, error: "Hệ thống tạm ngừng gửi mã.", systemHalt: true });
    expect(await goi(deps)).toMatchObject({ ok: false, loi: "HE_THONG_NGUNG" });
  });
  it("tra bài lỗi hạ tầng ⇒ vẫn phản hồi chung (không lộ lỗi theo số)", async () => {
    const { deps } = taoDeps(hangMau());
    deps.coBaiDangCho = async () => {
      throw new Error("db down");
    };
    expect(await goi(deps)).toEqual({ ok: true, cooldownSec: 60 });
  });
  it("SĐT sai định dạng ⇒ nói thật (không phụ thuộc số nào)", async () => {
    const { deps } = taoDeps(hangMau());
    expect(await goi(deps, { soDienThoai: "12" })).toMatchObject({ ok: false, loi: "SDT_KHONG_HOP_LE" });
  });
});

describe("[DISC-NHAN-07] F-12: số có tài khoản ACTIVE mà chưa đăng nhập ⇒ KHÔNG tiêu OTP, phản hồi vẫn CHUNG", () => {
  const goi = (deps: NhanDeps, phien: PhienDangNhap | null = null) => yeuCauOtpNhan({ soDienThoai: SDT, cooldownMacDinhSec: 60, phien, deps });
  const CHUNG = { ok: true, cooldownSec: 60 };

  it("ACTIVE + chưa đăng nhập ⇒ không gửi OTP, phản hồi y hệt nhánh 'số lạ' (không oracle dò tài khoản)", async () => {
    const act = taoDeps(hangMau(), { tk: { id: "u1", trangThai: "ACTIVE", laPhuHuynh: true } });
    const la = taoDeps(hangMau(), { coBai: false });
    const a = await goi(act.deps);
    const b = await goi(la.deps);
    expect(a).toEqual(CHUNG);
    expect(a).toEqual(b);
    expect(act.goi.otpYeuCau).not.toHaveBeenCalled();
    expect(act.goi.choPhep).not.toHaveBeenCalled(); // không tiêu cả hạn mức theo số
  });
  it("ĐỐI CHỨNG DƯƠNG: ACTIVE + đang đăng nhập đúng số ⇒ GỬI OTP", async () => {
    const t = taoDeps(hangMau(), { tk: { id: "u1", trangThai: "ACTIVE", laPhuHuynh: true } });
    expect(await goi(t.deps, { userId: "u1", phoneKey: SDT_CHUAN })).toEqual(CHUNG);
    expect(t.goi.otpYeuCau).toHaveBeenCalledWith(SDT_CHUAN);
  });
  it("ĐỐI CHỨNG DƯƠNG: số chưa có tài khoản / đang chờ kích hoạt (vai PH) ⇒ GỬI OTP", async () => {
    const moi = taoDeps(hangMau(), { tk: null });
    await goi(moi.deps);
    expect(moi.goi.otpYeuCau).toHaveBeenCalledTimes(1);
    const cho = taoDeps(hangMau(), { tk: { id: "u2", trangThai: "PENDING_ACTIVATION", laPhuHuynh: true } });
    await goi(cho.deps);
    expect(cho.goi.otpYeuCau).toHaveBeenCalledTimes(1);
  });
  it("vai khác / trạng thái lạ / đang đăng nhập SỐ KHÁC / tra tài khoản lỗi ⇒ không gửi, vẫn phản hồi chung", async () => {
    for (const tk of [{ id: "u3", trangThai: "PENDING_ACTIVATION" as const, laPhuHuynh: false }, { id: "u4", trangThai: "KHAC" as const, laPhuHuynh: true }]) {
      const t = taoDeps(hangMau(), { tk });
      expect(await goi(t.deps)).toEqual(CHUNG);
      expect(t.goi.otpYeuCau).not.toHaveBeenCalled();
    }
    const khac = taoDeps(hangMau());
    expect(await goi(khac.deps, { userId: "u9", phoneKey: "84912999999" })).toEqual(CHUNG);
    expect(khac.goi.otpYeuCau).not.toHaveBeenCalled();
    const hong = taoDeps(hangMau());
    hong.deps.taiKhoan.tim = async () => {
      throw new Error("db down");
    };
    expect(await goi(hong.deps)).toEqual(CHUNG);
    expect(hong.goi.otpYeuCau).not.toHaveBeenCalled();
  });
});

describe("[DISC-NHAN-08] F-10: trần gửi OTP theo SỐ theo NGÀY — chỉ tiêu khi sắp gửi, phản hồi vẫn chung", () => {
  const goi = (deps: NhanDeps) => yeuCauOtpNhan({ soDienThoai: SDT, cooldownMacDinhSec: 60, phien: null, deps });
  it("hết hạn mức ⇒ không gửi, phản hồi y hệt; hạn mức hỏi bằng khoá HMAC", async () => {
    const het = taoDeps(hangMau(), { choPhep: false });
    expect(await goi(het.deps)).toEqual({ ok: true, cooldownSec: 60 });
    expect(het.goi.otpYeuCau).not.toHaveBeenCalled();
    expect(het.goi.choPhep).toHaveBeenCalledWith(PK);
  });
  it("còn hạn mức ⇒ gửi; hạn mức chỉ được hỏi MỘT lần", async () => {
    const t = taoDeps(hangMau());
    await goi(t.deps);
    expect(t.goi.choPhep).toHaveBeenCalledTimes(1);
    expect(t.goi.otpYeuCau).toHaveBeenCalledTimes(1);
  });
  it("số KHÔNG có bài ⇒ không hỏi, không tiêu hạn mức (kẻ bơm số lạ không đốt hạn mức của chủ số)", async () => {
    const t = taoDeps(hangMau(), { coBai: false });
    await goi(t.deps);
    expect(t.goi.choPhep).not.toHaveBeenCalled();
  });
  it("cổng hạn mức ném ⇒ fail-closed: không gửi, phản hồi vẫn chung", async () => {
    const t = taoDeps(hangMau());
    t.deps.choPhepGuiOtp = async () => {
      throw new Error("redis down");
    };
    expect(await goi(t.deps)).toEqual({ ok: true, cooldownSec: 60 });
    expect(t.goi.otpYeuCau).not.toHaveBeenCalled();
  });
});

describe("[DISC-NHAN-05] cheTen", () => {
  it("viết tắt", () => expect(cheTen("  đỗ  thị  hoa ")).toBe("Đ. T. H."));
});

describe("[DISC-NHAN-06] F-06 thách đố thứ hai: năm sinh của con", () => {
  it("năm SAI + mã đúng + OTP đúng ⇒ từ chối, KHÔNG tạo tài khoản, bộ đếm tăng, bài còn PENDING", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows);
    expect(await vao(deps, { namSinhCon: NAM_SAI })).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    expect(goi.taoPhuHuynh).not.toHaveBeenCalled();
    expect(goi.kichHoat).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "PENDING_CLAIM", thu: 1 });
  });
  it("năm SAI DẠNG ⇒ từ chối TRƯỚC khi tiêu OTP và trước khi đếm", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows);
    for (const namSinhCon of [undefined, null, "", "20x5", "201", "20155", 20.5, 1800, 2200, {}]) {
      expect(await vao(deps, { namSinhCon })).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    }
    expect(goi.otpXacMinh).not.toHaveBeenCalled();
    expect(rows[0]!.thu).toBe(0);
  });
  it("năm sinh nhận cả số lẫn chuỗi 4 chữ số (có dấu cách)", async () => {
    expect(chuanHoaNamSinhCon(2015)).toBe(2015);
    expect(chuanHoaNamSinhCon(" 2015 ")).toBe(2015);
    expect(chuanHoaNamSinhCon("2015")).toBe(2015);
    expect((await vao(taoDeps(hangMau()).deps, { namSinhCon: " 2015 " })).ok).toBe(true);
  });
  it("sai đúng TOI_DA_LAN_THU_NHAN lần ⇒ khoá: mã + năm đúng sau đó vẫn bị từ chối, cùng thông điệp", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows);
    const kq = [];
    for (let i = 0; i < TOI_DA_LAN_THU_NHAN; i++) kq.push(await vao(deps, { namSinhCon: NAM_SAI + i * 2 }));
    const sauKhoa = await vao(deps);
    expect(rows[0]).toMatchObject({ status: "PENDING_CLAIM", thu: TOI_DA_LAN_THU_NHAN });
    expect(sauKhoa).toEqual(kq[0]);
    expect(goi.taoPhuHuynh).not.toHaveBeenCalled();
  });
  it("ĐỐI CHỨNG DƯƠNG: sai (TOI_DA-1) lần rồi đúng ⇒ vẫn nhận được", async () => {
    const rows = hangMau();
    const { deps } = taoDeps(rows);
    for (let i = 0; i < TOI_DA_LAN_THU_NHAN - 1; i++) await vao(deps, { namSinhCon: NAM_SAI });
    expect((await vao(deps)).ok).toBe(true);
    expect(rows[0]!.status).toBe("CLAIMED");
  });
  it("brute-force song song: nhiều lượt đoán năm cùng lúc ⇒ chỉ TOI_DA lượt chạm tới bước so, năm đúng đến sau bị khoá", async () => {
    const rows = hangMau();
    const { deps } = taoDeps(rows);
    const nam = Array.from({ length: 12 }, (_, i) => 2000 + i); // 2015 KHÔNG nằm trong dải
    await Promise.all(nam.map((n) => vao(deps, { namSinhCon: n })));
    expect(rows[0]!.thu).toBe(TOI_DA_LAN_THU_NHAN);
    expect(await vao(deps)).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    expect(rows[0]!.status).toBe("PENDING_CLAIM");
  });
  it("kẻ giữ SIM tái cấp (đúng SĐT, qua OTP) nhưng không biết mã/năm ⇒ không nhận được gì dù thử cả hai", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows);
    expect(await vao(deps, { maNhan: MA_KHAC, namSinhCon: NAM })).toMatchObject({ ok: false });
    expect(await vao(deps, { maNhan: MA, namSinhCon: 2000 })).toMatchObject({ ok: false });
    expect(goi.taoPhuHuynh).not.toHaveBeenCalled();
    expect(rows[0]!.status).toBe("PENDING_CLAIM");
  });
  it("bộ đếm chỉ nhúc nhích SAU khi OTP đúng (người chỉ biết SĐT không đốt được lượt của chủ số)", async () => {
    const rows = hangMau();
    const { deps } = taoDeps(rows, { otpOk: false });
    for (let i = 0; i < 10; i++) await vao(deps, { namSinhCon: NAM_SAI });
    expect(rows[0]!.thu).toBe(0);
  });
});

describe("[DISC-NHAN-09] F-09: bật đồng ý tiếp thị CHỈ sau khi nhận thành công", () => {
  it("nhận thành công ⇒ gọi sauKhiNhan với SĐT chuẩn hoá (thô) và id bài", async () => {
    const { deps, goi } = taoDeps(hangMau());
    expect((await vao(deps)).ok).toBe(true);
    expect(goi.sauKhiNhan).toHaveBeenCalledTimes(1);
    expect(goi.sauKhiNhan).toHaveBeenCalledWith({ submissionId: "s1", sdtChuan: SDT_CHUAN, chuSoDongY: false });
  });
  it("N7: ô tích riêng của chủ số đi xuyên tới sauKhiNhan (true), mặc định false", async () => {
    const { deps, goi } = taoDeps(hangMau());
    expect((await vao(deps, { dongYTiepThi: true })).ok).toBe(true);
    expect(goi.sauKhiNhan).toHaveBeenCalledWith({ submissionId: "s1", sdtChuan: SDT_CHUAN, chuSoDongY: true });
  });
  it("ĐỐI CHỨNG: mọi nhánh THẤT BẠI ⇒ không gọi sauKhiNhan", async () => {
    const t = taoDeps(hangMau());
    await vao(t.deps, { namSinhCon: NAM_SAI });
    await vao(t.deps, { maNhan: MA_KHAC });
    const otpSai = taoDeps(hangMau(), { otpOk: false });
    await vao(otpSai.deps);
    const act = taoDeps(hangMau(), { tk: { id: "u1", trangThai: "ACTIVE", laPhuHuynh: true } });
    await vao(act.deps);
    for (const x of [t, otpSai, act]) expect(x.goi.sauKhiNhan).not.toHaveBeenCalled();
  });
  it("sauKhiNhan ném ⇒ việc nhận vẫn thành công", async () => {
    const { deps, goi } = taoDeps(hangMau());
    goi.sauKhiNhan.mockRejectedValue(new Error("lead down"));
    expect((await vao(deps)).ok).toBe(true);
  });
});

describe("[DISC-NHAN-10] N3: kẻ không có mã nhận KHÔNG đốt được lượt OTP của chủ số; lỗi OTP không lộ nguyên văn", () => {
  it("repro reviewer: otp '000000' + mã đoán bừa ⇒ KHÔNG gọi otp.xacMinh (không đốt 1/5 lượt), phản hồi chung", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows);
    for (let i = 0; i < 20; i++) {
      const r = await vao(deps, { otp: "000000", maNhan: "AAAAAAAAAA", namSinhCon: "2015" });
      expect(r).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    }
    expect(goi.otpXacMinh).not.toHaveBeenCalled();
    expect(rows[0]!.thu).toBe(0);
  });
  it("cổng trước OTP nhận HMAC-SĐT + băm mã (không SĐT thô, không mã thô)", async () => {
    const { deps, goi } = taoDeps(hangMau());
    await vao(deps);
    const p = goi.choThu.mock.calls[0]![0];
    expect(p.khoaSdt).toBe(PK);
    expect(p.maHash).toBe(bamMaNhan(MA, KHOA()));
    expect(p.khoaSdt).not.toBe(SDT_CHUAN); // HMAC giả, không phải SĐT thô
    expect(JSON.stringify(p)).not.toContain(MA);
  });
  it("vượt trần theo SĐT (cổng trả false) ⇒ dừng TRƯỚC otp.xacMinh dù mã đúng", async () => {
    const rows = hangMau();
    const { deps, goi } = taoDeps(rows, { choThu: false });
    expect(await vao(deps)).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    expect(goi.otpXacMinh).not.toHaveBeenCalled();
    expect(goi.taoPhuHuynh).not.toHaveBeenCalled();
  });
  it("cổng ném ⇒ fail-closed (không tiêu OTP)", async () => {
    const { deps, goi } = taoDeps(hangMau());
    goi.choThu.mockRejectedValue(new Error("redis down"));
    expect(await vao(deps)).toMatchObject({ ok: false, loi: "MA_KHONG_KHOP" });
    expect(goi.otpXacMinh).not.toHaveBeenCalled();
  });
  it("ĐỐI CHỨNG DƯƠNG: mã + năm đúng ⇒ cổng cho qua, OTP được tiêu đúng 1 lần, nhận thành công", async () => {
    const { deps, goi } = taoDeps(hangMau());
    expect((await vao(deps)).ok).toBe(true);
    expect(goi.otpXacMinh).toHaveBeenCalledTimes(1);
  });
  it("mọi lỗi OTP (sai · hết hạn · đã dùng) ⇒ MỘT thông điệp công khai, giống hệt sai mã", async () => {
    const goc = await vao(taoDeps(hangMau(), { otpOk: false }).deps);
    for (const error of ["Chưa có mã hoặc mã đã dùng", "Mã đã hết hạn", "Mã không đúng. Còn 2 lần thử."]) {
      const t = taoDeps(hangMau());
      t.goi.otpXacMinh.mockResolvedValue({ ok: false, error });
      const r = await vao(t.deps);
      expect(r).toEqual(goc);
      expect(JSON.stringify(r)).not.toContain(error);
    }
  });
});
