/**
 * [DISC-QA-CORE-*] Test biên/âm cho ba cổng PII: hồ sơ (ho-so), thông báo (thong-bao), lưu (luu).
 * Viết ĐỘC LẬP với lib/disc/*.test.ts để hai bộ cùng canh một luật từ hai hướng; phần việc của bộ này
 * là lấp các khe mà phép cấy lỗi (tests/disc/cay-loi/) tìm ra. DỮ LIỆU HOÀN TOÀN GIẢ — nhãn "Giả".
 * Đồng hồ: mọi ngày/năm truyền tường minh (CLAUDE.md luật 19).
 *
 * Quy ước import: đường dẫn TƯƠNG ĐỐI `../../lib/disc/<x>` — harness cấy lỗi viết lại thành `./<x>`.
 */
import { describe, expect, it, vi } from "vitest";
import { kiemTraHoSo, nguoiLonQuanSat, namSinhDuKien } from "../../lib/disc/ho-so";
import { chePhone, cheEmail, thongBaoSauLuu, THONG_BAO_LUU_CHINH } from "../../lib/disc/thong-bao";
import {
  luuKetQuaDisc,
  bam,
  bamMaNhan,
  choPhepTinDiemClient,
  type DiscStore,
  type BanGhi,
  type CongCrm,
  type LuuDeps,
  NGAY_GIU_BAI_CHUA_NHAN,
  HAN_TOKEN_TAI_PHUT,
  TOI_DA_LAN_THU_MA,
  replayHopLe,
  jsonOnDinh,
  bamPayload,
} from "../../lib/disc/luu";
import { CUA_SO_DEM_BAI_THEO_SDT_MS, TOI_DA_BAI_MOI_THEO_CAP, TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG } from "../../lib/disc/chinh-sach";
import { phoneKeyTuSdtChuan } from "../../lib/disc/phone-key";
import { chuanHoaNamSinhCon, nhanBaiDisc, TOI_DA_LAN_THU_NHAN, type NhanDeps } from "../../lib/disc/nhan";
import type { DiscEngine } from "../../lib/disc/engine";

const NAM = 2026;
const NOW = new Date("2026-11-01T03:00:00Z");

const ph = (o: Record<string, unknown> = {}) => ({ hoTen: "Phụ Huynh Giả", vaiTro: "ME", namSinh: 1988, ...o });
const hs = (o: Record<string, unknown> = {}) => ({ hoTen: "Học Sinh Giả", namSinh: 2016, bacHoc: "4", ...o });

/* ───────────────────────────── ho-so ───────────────────────────── */

describe("[DISC-QA-CORE-HOSO] biên năm sinh và cờ người lớn quan sát", () => {
  it("năm sinh PH: biên dưới (NAM-90) hợp lệ, NAM-91 bị loại; biên trên (NAM-16) hợp lệ, NAM-15 bị loại", () => {
    // Con sinh 2016 ⇒ PH sinh muộn nhất 2004 mới qua luật chênh 12 năm; dùng con 2016 + PH 1936 (biên dưới) để cô lập biên.
    expect(kiemTraHoSo({ phuHuynh: ph({ namSinh: NAM - 90 }), hocSinh: hs() }, NAM).ok).toBe(true);
    const duoi = kiemTraHoSo({ phuHuynh: ph({ namSinh: NAM - 91 }), hocSinh: hs() }, NAM);
    expect(duoi.ok).toBe(false);
    expect(!duoi.ok && duoi.loi.map((l) => l.truong)).toContain("phuHuynh.namSinh");
    // biên trên: PH 2010 (NAM-16) với con 2022 (NAM-4) đủ 12 năm; PH 2011 bị loại bởi biên.
    const tren = kiemTraHoSo({ phuHuynh: ph({ namSinh: NAM - 15 }), hocSinh: hs({ namSinh: NAM - 4, bacHoc: "MN" }) }, NAM);
    expect(tren.ok).toBe(false);
    // NAM-16 đúng biên trên: hợp lệ (con NAM-4 để qua luật chênh 12 năm).
    expect(kiemTraHoSo({ phuHuynh: ph({ namSinh: NAM - 16 }), hocSinh: hs({ namSinh: NAM - 4, bacHoc: "MN" }) }, NAM).ok).toBe(true);
  });
  it("năm sinh HS: NAM-20 hợp lệ, NAM-21 loại; NAM-2 hợp lệ, NAM-1 loại", () => {
    expect(kiemTraHoSo({ phuHuynh: ph({ namSinh: 1970 }), hocSinh: hs({ namSinh: NAM - 20, bacHoc: "12" }) }, NAM).ok).toBe(true);
    expect(kiemTraHoSo({ phuHuynh: ph({ namSinh: 1970 }), hocSinh: hs({ namSinh: NAM - 21, bacHoc: "12" }) }, NAM).ok).toBe(false);
    expect(kiemTraHoSo({ phuHuynh: ph({ namSinh: 1970 }), hocSinh: hs({ namSinh: NAM - 2, bacHoc: "MN" }) }, NAM).ok).toBe(true);
    expect(kiemTraHoSo({ phuHuynh: ph({ namSinh: 1970 }), hocSinh: hs({ namSinh: NAM - 1, bacHoc: "MN" }) }, NAM).ok).toBe(false);
  });
  it("PH hơn con đúng 12 năm: qua; 11 năm: loại (gõ nhầm năm)", () => {
    expect(kiemTraHoSo({ phuHuynh: ph({ namSinh: 2004 }), hocSinh: hs({ namSinh: 2016 }) }, NAM).ok).toBe(true);
    const r = kiemTraHoSo({ phuHuynh: ph({ namSinh: 2005 }), hocSinh: hs({ namSinh: 2016 }) }, NAM);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi.some((l) => l.truong === "phuHuynh.namSinh")).toBe(true);
  });
  it("năm sinh không nguyên (1988.5) bị loại", () => {
    expect(kiemTraHoSo({ phuHuynh: ph({ namSinh: 1988.5 }), hocSinh: hs() }, NAM).ok).toBe(false);
  });
  it("tên chỉ toàn khoảng trắng bị loại (trim); tên 1 ký tự bị loại; tên 2 ký tự qua", () => {
    expect(kiemTraHoSo({ phuHuynh: ph({ hoTen: "   " }), hocSinh: hs() }, NAM).ok).toBe(false);
    expect(kiemTraHoSo({ phuHuynh: ph({ hoTen: "A" }), hocSinh: hs() }, NAM).ok).toBe(false);
    expect(kiemTraHoSo({ phuHuynh: ph({ hoTen: " An " }), hocSinh: hs() }, NAM).ok).toBe(true);
    expect(kiemTraHoSo({ phuHuynh: ph({ hoTen: "A".repeat(81) }), hocSinh: hs() }, NAM).ok).toBe(false);
  });
  it("vai trò lạ và bậc học lạ bị loại", () => {
    expect(kiemTraHoSo({ phuHuynh: ph({ vaiTro: "ANH" }), hocSinh: hs() }, NAM).ok).toBe(false);
    expect(kiemTraHoSo({ phuHuynh: ph(), hocSinh: hs({ bacHoc: "13" }) }, NAM).ok).toBe(false);
  });
  it("thiếu từng phía được báo đúng phía (cả hai ⇒ hai mã)", () => {
    const a = kiemTraHoSo({ hocSinh: hs() }, NAM);
    expect(!a.ok && a.thieu).toEqual(["PHU_HUYNH"]);
    const b = kiemTraHoSo({ phuHuynh: ph() }, NAM);
    expect(!b.ok && b.thieu).toEqual(["HOC_SINH"]);
    const c = kiemTraHoSo({}, NAM);
    expect(!c.ok && c.thieu).toEqual(["PHU_HUYNH", "HOC_SINH"]);
    // null cũng là thiếu (không chỉ undefined)
    const d = kiemTraHoSo({ phuHuynh: null, hocSinh: null }, NAM);
    expect(!d.ok && d.thieu).toEqual(["PHU_HUYNH", "HOC_SINH"]);
  });
  it("người lớn quan sát: MN ⇒ có; lớp 1,2 ⇒ có; lớp 3 sinh đủ 8 tuổi ⇒ không; lớp 3 mới 7 tuổi ⇒ có", () => {
    expect(nguoiLonQuanSat({ bacHoc: "MN", namSinh: 2000 }, NAM)).toBe(true); // MN thắng dù năm sinh "lớn"
    expect(nguoiLonQuanSat({ bacHoc: "1", namSinh: 2000 }, NAM)).toBe(true);
    expect(nguoiLonQuanSat({ bacHoc: "2", namSinh: 2000 }, NAM)).toBe(true); // biên lớp 2
    expect(nguoiLonQuanSat({ bacHoc: "3", namSinh: NAM - 8 }, NAM)).toBe(false); // đúng 8 tuổi
    expect(nguoiLonQuanSat({ bacHoc: "3", namSinh: NAM - 7 }, NAM)).toBe(true); // 7 tuổi
    expect(nguoiLonQuanSat({ bacHoc: "5", namSinh: NAM - 10 }, NAM)).toBe(false);
  });
  it("kết quả kiemTraHoSo mang đúng cờ quan sát theo lớp", () => {
    const nho = kiemTraHoSo({ phuHuynh: ph(), hocSinh: hs({ bacHoc: "2", namSinh: 2019 }) }, NAM);
    expect(nho.ok && nho.nguoiLonQuanSatHocSinh).toBe(true);
    const lon = kiemTraHoSo({ phuHuynh: ph(), hocSinh: hs({ bacHoc: "7", namSinh: 2013 }) }, NAM);
    expect(lon.ok && lon.nguoiLonQuanSatHocSinh).toBe(false);
  });
  it("cảnh báo năm sinh ↔ lớp: lệch 1 năm KHÔNG cảnh báo, lệch 2 năm CÓ; lớp 4 sinh 2016 không cảnh báo", () => {
    const du = namSinhDuKien("4", NAM); // 2026-9 = 2017
    expect(du).toBe(2017);
    expect(namSinhDuKien("MN", NAM)).toBe(NAM - 4);
    const lech1 = kiemTraHoSo({ phuHuynh: ph(), hocSinh: hs({ bacHoc: "4", namSinh: du - 1 }) }, NAM);
    expect(lech1.ok && lech1.canhBao).toEqual([]);
    const lech2 = kiemTraHoSo({ phuHuynh: ph(), hocSinh: hs({ bacHoc: "4", namSinh: du - 2 }) }, NAM);
    expect(lech2.ok && lech2.canhBao.map((c) => c.ma)).toEqual(["NAM_SINH_LECH_LOP"]);
    const lech2Tren = kiemTraHoSo({ phuHuynh: ph(), hocSinh: hs({ bacHoc: "4", namSinh: du + 2 }) }, NAM);
    expect(lech2Tren.ok && lech2Tren.canhBao).toHaveLength(1);
    // cảnh báo KHÔNG chặn: vẫn ok:true để người dùng xác nhận
    expect(lech2.ok).toBe(true);
  });
  it("kết quả phụ thuộc năm truyền vào (không đọc năm hệ thống): cùng hồ sơ, năm khác ⇒ lệch khác", () => {
    const hsLop4 = hs({ bacHoc: "4", namSinh: 2016 });
    const a = kiemTraHoSo({ phuHuynh: ph(), hocSinh: hsLop4 }, 2026);
    const b = kiemTraHoSo({ phuHuynh: ph(), hocSinh: hsLop4 }, 2030);
    expect(a.ok && a.canhBao).toEqual([]);
    expect(b.ok && b.canhBao).toHaveLength(1);
  });
});

/* ───────────────────────────── thong-bao ───────────────────────────── */

describe("[DISC-QA-CORE-TB] che SĐT/email và câu chữ theo trạng thái email", () => {
  it("chePhone: 9 chữ số đủ (biên) vẫn che đúng dạng; 8 chữ số ⇒ '***'; không lộ giữa số", () => {
    expect(chePhone("0905123456")).toBe("0905 *** 456");
    expect(chePhone("84905123456")).toBe("0905 *** 456");
    expect(chePhone("+84 905 123 456")).toBe("0905 *** 456");
    expect(chePhone("905123456")).toBe("9051 *** 456"); // 9 chữ số: biên của luật "đủ 9"
    expect(chePhone("90512345")).toBe("***"); // 8 chữ số
    expect(chePhone("")).toBe("***");
    expect(chePhone("0905123456")).not.toContain("123");
    expect(chePhone("0905123456")).not.toMatch(/\d{5}/);
  });
  it("cheEmail: giữ 1 ký tự đầu + miền; thiếu '@' hoặc rỗng ⇒ '***'", () => {
    expect(cheEmail("an.gia@example.test")).toBe("a***@example.test");
    expect(cheEmail("  b@x.test ")).toBe("b***@x.test");
    expect(cheEmail("khong-co-a-cong")).toBe("***");
    expect(cheEmail("@x.test")).toBe("***");
    expect(cheEmail("a@")).toBe("***");
    expect(cheEmail("an.gia@example.test")).not.toContain("gia");
  });
  it("mọi trạng thái: câu chính giống hệt nhau và không nhắc tài khoản đã có/chưa có (trung tính)", () => {
    for (const tt of ["NONE", "VERIFICATION_REQUIRED", "QUEUED", "SENT", "FAILED"] as const) {
      const r = thongBaoSauLuu({ email: "an.gia@example.test", trangThaiEmail: tt });
      expect(r.chinh).toBe(THONG_BAO_LUU_CHINH);
      expect(r.chinh).not.toMatch(/đã có tài khoản|chưa có tài khoản|đã tồn tại|chưa tồn tại/i);
    }
  });
  it("NONE hoặc không có email ⇒ không có dòng email; KHÔNG ném lỗi khi trạng thái có email nhưng email rỗng", () => {
    expect(thongBaoSauLuu({ email: null, trangThaiEmail: "NONE" }).email).toBeNull();
    expect(thongBaoSauLuu({ email: "an.gia@example.test", trangThaiEmail: "NONE" }).email).toBeNull();
    for (const tt of ["VERIFICATION_REQUIRED", "QUEUED", "SENT", "FAILED"] as const) {
      expect(() => thongBaoSauLuu({ email: null, trangThaiEmail: tt })).not.toThrow();
      expect(thongBaoSauLuu({ email: null, trangThaiEmail: tt }).email).toBeNull();
      expect(thongBaoSauLuu({ email: "", trangThaiEmail: tt }).email).toBeNull();
    }
  });
  it("chỉ SENT được nói 'đã gửi'; QUEUED chỉ 'sẽ gửi'; FAILED nói chưa gửi được; xác minh nói rõ", () => {
    const e = "an.gia@example.test";
    const dong = (tt: "SENT" | "QUEUED" | "FAILED" | "VERIFICATION_REQUIRED") => thongBaoSauLuu({ email: e, trangThaiEmail: tt }).email!;
    expect(dong("SENT")).toMatch(/đã gửi/);
    expect(dong("QUEUED")).toMatch(/sẽ gửi/);
    expect(dong("QUEUED")).not.toMatch(/đã gửi/);
    expect(dong("FAILED")).toMatch(/chưa gửi được/);
    expect(dong("FAILED")).not.toMatch(/đã gửi/);
    expect(dong("VERIFICATION_REQUIRED")).toMatch(/xác minh/);
    expect(dong("VERIFICATION_REQUIRED")).not.toMatch(/đã gửi thông tin kết quả/);
  });
  it("không bao giờ lộ email đầy đủ trong bất kỳ dòng nào", () => {
    for (const tt of ["VERIFICATION_REQUIRED", "QUEUED", "SENT", "FAILED"] as const) {
      const r = thongBaoSauLuu({ email: "an.gia@example.test", trangThaiEmail: tt });
      expect(JSON.stringify(r)).not.toContain("an.gia");
      expect(r.email).toContain("a***@example.test");
    }
  });
  it("câu chính dẫn đúng đường kích hoạt", () => {
    expect(THONG_BAO_LUU_CHINH).toContain("https://satarobo.vn/kich-hoat");
  });
});

/* ───────────────────────────── luu ───────────────────────────── */

const nguoiKq = { diem: { D: 40, I: 30, S: 20, C: 10 }, maBoDe: "PH", phienBanBoDe: "v-gia" };
const hop = (o: Record<string, unknown> = {}) => ({
  idempotencyKey: "khoa-gia-0123456789-abcdef",  // gitleaks:allow
  soDienThoai: "0905 123 456",
  email: null as string | null,
  dongY: { xuLyHoSo: true, tiepThi: false },
  phuHuynh: ph(),
  hocSinh: hs(),
  ketQua: { engineVersion: "engine-gia", phuHuynh: nguoiKq, hocSinh: { ...nguoiKq, maBoDe: "TH" } },
  ...o,
});

/**
 * Store giả theo hợp đồng MỚI (vòng 2): `BanGhi` đủ payloadHash/deletedAt/retainUntil, `xoayTokenTai` trả boolean
 * (false = không dòng nào đổi), `demTheoPhone` (N6) trả {theoCap, theoPhone} — số bài đã có của cặp (SĐT, IP) và của SĐT (mặc định 0, chỉnh qua `soDaCo` = số của cặp).
 */
function taoStore(opts: { soDaCo?: number | (() => Promise<number>) } = {}) {
  const dong = new Map<string, BanGhi & { tokenHash: string }>();
  let dem = 0;
  const store: DiscStore = {
    taoHoacLayTheoKhoa: vi.fn(async (d) => {
      const co = dong.get(d.idempotencyKey);
      if (co) return { ban: co, taoMoi: false };
      const ban = {
        id: `s${++dem}`,
        phoneKey: d.phoneKey,
        emailStatus: d.emailStatus,
        emailTo: d.emailTo,
        tokenHash: d.tokenHash,
        claimStatus: "PENDING_CLAIM" as const,
        payloadHash: d.payloadHash,
        deletedAt: null,
        retainUntil: d.retainUntil,
      };
      dong.set(d.idempotencyKey, ban);
      return { ban, taoMoi: true };
    }),
    xoayTokenTai: vi.fn(async (id, h) => {
      for (const b of dong.values()) {
        if (b.id === id) {
          b.tokenHash = h;
          return true;
        }
      }
      return false;
    }),
    demTheoPhone: vi.fn(async () => {
      const n = typeof opts.soDaCo === "function" ? await opts.soDaCo() : (opts.soDaCo ?? 0);
      return { theoCap: n, theoPhone: n };
    }),
  };
  return { store, dong };
}
const goiGhi = (store: DiscStore) => (store.taoHoacLayTheoKhoa as ReturnType<typeof vi.fn>).mock.calls[0]![0];
const KHOA = "k".repeat(32);
const MA_GIA = "ABCDEFGHJK";
/** Đường THỬ NGHIỆM (dữ liệu giả): không engine + cổng tin-điểm-client mở. Mọi thứ khác tiêm tường minh. */
const dep = (store: DiscStore, crm: CongCrm = vi.fn(async () => ({ leadId: "L1" })), token = "TOKEN-GIA", guiEmail: LuuDeps["guiEmail"] = vi.fn(async () => ({ ok: true as const }))): LuuDeps => ({
  store,
  crm,
  guiEmail,
  nguonIp: "203.0.113.1",
  now: () => NOW,
  sinhToken: () => token,
  sinhMa: () => MA_GIA,
  khoaBam: () => KHOA,
  engine: () => null,
  choPhepTinDiemClient: () => true,
});

describe("[DISC-QA-CORE-LUU] lưu: bất biến PII, idempotency, hạn", () => {
  it("lưu HASH, KHÔNG lưu plaintext token ở bất kỳ trường nào của lệnh ghi", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop(), dep(store));
    const g = goiGhi(store);
    expect(g.tokenHash).toBe(bam("TOKEN-GIA"));
    expect(g.tokenHash).not.toBe("TOKEN-GIA");
    expect(JSON.stringify(g)).not.toContain("TOKEN-GIA");
  });
  it("hạn token = đúng HAN_TOKEN_TAI_PHUT phút; hạn giữ bài = đúng NGAY_GIU_BAI_CHUA_NHAN ngày (tính từ `now` tiêm vào)", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop(), dep(store));
    const g = goiGhi(store);
    expect(g.tokenHetHan.getTime() - NOW.getTime()).toBe(HAN_TOKEN_TAI_PHUT * 60_000);
    expect(g.retainUntil.getTime() - NOW.getTime()).toBe(NGAY_GIU_BAI_CHUA_NHAN * 86_400_000);
    expect(HAN_TOKEN_TAI_PHUT).toBeLessThanOrEqual(60); // "hạn ngắn"
  });
  it("tên được trim trước khi lưu; PARENT không bao giờ là người-lớn-quan-sát; STUDENT mang cờ từ luật hồ sơ", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop({ phuHuynh: ph({ hoTen: "  Phụ Huynh Giả  " }), hocSinh: hs({ hoTen: " Học Sinh Giả ", bacHoc: "1", namSinh: 2020 }) }), dep(store));
    const [p, s] = goiGhi(store).nguoi;
    expect(p.hoTen).toBe("Phụ Huynh Giả");
    expect(s.hoTen).toBe("Học Sinh Giả");
    expect(p.nguoiLonQuanSat).toBe(false);
    expect(s.nguoiLonQuanSat).toBe(true);
  });
  it("email hợp lệ ⇒ VERIFICATION_REQUIRED (chưa xác minh thì chưa gửi báo cáo); không email ⇒ NONE", async () => {
    const a = taoStore();
    const ra = await luuKetQuaDisc(hop({ email: "an.gia@example.test" }), dep(a.store));
    expect(goiGhi(a.store).emailStatus).toBe("VERIFICATION_REQUIRED");
    expect(ra.ok && ra.thongBao.email).toMatch(/xác minh/);
    const b = taoStore();
    const rb = await luuKetQuaDisc(hop({ email: "" }), dep(b.store));
    expect(goiGhi(b.store).emailStatus).toBe("NONE");
    expect(goiGhi(b.store).emailTo).toBeNull();
    expect(rb.ok && rb.thongBao.email).toBeNull();
  });
  it("email sai định dạng ⇒ lỗi, KHÔNG ghi gì, KHÔNG gọi CRM", async () => {
    const { store } = taoStore();
    const crm = vi.fn(async () => ({ leadId: null }));
    const r = await luuKetQuaDisc(hop({ email: "khong-phai-email" }), dep(store, crm));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toBe("DU_LIEU_KHONG_HOP_LE");
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(crm).not.toHaveBeenCalled();
  });
  it("đồng ý xử lý hồ sơ là BẮT BUỘC: false hoặc thiếu ⇒ lỗi, không ghi", async () => {
    for (const dongY of [{ xuLyHoSo: false, tiepThi: false }, { tiepThi: true }, undefined]) {
      const { store } = taoStore();
      const r = await luuKetQuaDisc(hop({ dongY }), dep(store));
      expect(r.ok).toBe(false);
      expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    }
  });
  it("tiếp thị mặc định theo ô tích thật: tiepThi=false ⇒ ghi false; true ⇒ true", async () => {
    const a = taoStore();
    await luuKetQuaDisc(hop({ dongY: { xuLyHoSo: true, tiepThi: false } }), dep(a.store));
    expect(goiGhi(a.store).tiepThi).toBe(false);
    const b = taoStore();
    await luuKetQuaDisc(hop({ dongY: { xuLyHoSo: true, tiepThi: true } }), dep(b.store));
    expect(goiGhi(b.store).tiepThi).toBe(true);
  });
  it("điểm ngoài 0–100 bị loại; khoá idempotency quá ngắn bị loại", async () => {
    const { store } = taoStore();
    const xau = { ...nguoiKq, diem: { D: 101, I: 0, S: 0, C: 0 } };
    expect((await luuKetQuaDisc(hop({ ketQua: { engineVersion: "e", phuHuynh: xau, hocSinh: nguoiKq } }), dep(store))).ok).toBe(false);
    expect((await luuKetQuaDisc(hop({ idempotencyKey: "ngan" }), dep(store))).ok).toBe(false);
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("hồ sơ thiếu ⇒ THIEU_HO_SO (mã riêng), hồ sơ sai ⇒ DU_LIEU_KHONG_HOP_LE; cả hai không ghi", async () => {
    const a = taoStore();
    const ra = await luuKetQuaDisc(hop({ phuHuynh: undefined }), dep(a.store));
    expect(!ra.ok && ra.loi).toBe("THIEU_HO_SO");
    const b = taoStore();
    const rb = await luuKetQuaDisc(hop({ hocSinh: hs({ namSinh: 1900 }) }), dep(b.store));
    expect(!rb.ok && rb.loi).toBe("DU_LIEU_KHONG_HOP_LE");
    expect(a.store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(b.store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("năm của hồ sơ lấy từ `now` tiêm vào: cùng dữ liệu, `now` năm 2040 ⇒ con 2016 quá tuổi hồ sơ ⇒ lỗi", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop(), { ...dep(store), now: () => new Date("2040-01-01T00:00:00Z") });
    expect(r.ok).toBe(false);
  });
  it("lỗi ghi ⇒ ok:false/LUU_THAT_BAI, KHÔNG gọi CRM, KHÔNG lộ nội dung lỗi", async () => {
    const store: DiscStore = {
      taoHoacLayTheoKhoa: vi.fn(async () => {
        throw new Error("prisma: unique violation phone=84905123456 Học Sinh Giả");
      }),
      xoayTokenTai: vi.fn(async () => true),
      demTheoPhone: vi.fn(async () => ({ theoCap: 0, theoPhone: 0 })),
    };
    const crm = vi.fn(async () => ({ leadId: null }));
    const r = await luuKetQuaDisc(hop(), dep(store, crm));
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(JSON.stringify(r)).not.toMatch(/84905|Giả|prisma/);
    expect(crm).not.toHaveBeenCalled();
  });
  it("CRM ném lỗi ⇒ VẪN ok:true (dữ liệu đã an toàn), không nổ ra ngoài", async () => {
    const { store } = taoStore();
    const crm = vi.fn(async () => {
      throw new Error("crm sập");
    });
    const r = await luuKetQuaDisc(hop(), dep(store, crm));
    expect(r.ok).toBe(true);
    expect(crm).toHaveBeenCalledTimes(1);
  });
  it("CRM nhận tên/SĐT đã chuẩn hoá và chiến dịch mặc định 'DISC'; chiến dịch khai ⇒ giữ", async () => {
    const a = taoStore();
    const crm = vi.fn(async () => ({ leadId: "L" }));
    await luuKetQuaDisc(hop(), dep(a.store, crm));
    expect(crm).toHaveBeenCalledWith(expect.objectContaining({ soDienThoai: "84905123456", chienDich: "DISC", tenPhuHuynh: "Phụ Huynh Giả", tiepThi: false }));
    // F-13: CRM KHÔNG nhận tên con / điểm / năm sinh (minh bạch dữ liệu trẻ)
    expect(JSON.stringify(crm.mock.calls)).not.toMatch(/Học Sinh Giả|tenCon|2016|diem/);
    const b = taoStore();
    const crm2 = vi.fn(async () => ({ leadId: "L" }));
    await luuKetQuaDisc(hop({ chienDich: "DISC_QR" }), dep(b.store, crm2));
    expect(crm2).toHaveBeenCalledWith(expect.objectContaining({ chienDich: "DISC_QR" }));
    // chiến dịch NGOÀI danh sách trắng ⇒ rơi về 'DISC' (client không tự đặt nhãn)
    const c = taoStore();
    const crm3 = vi.fn(async () => ({ leadId: "L" }));
    await luuKetQuaDisc(hop({ chienDich: "NV-GIA" }), dep(c.store, crm3));
    expect(crm3).toHaveBeenCalledWith(expect.objectContaining({ chienDich: "DISC" }));
    expect(goiGhi(c.store).campaign).toBe("DISC");
  });
  it("bấm lưu nhiều lần cùng khoá: MỘT dòng, MỘT lần CRM; lần sau cấp token MỚI và xoay hash", async () => {
    const { store, dong } = taoStore();
    const crm = vi.fn(async () => ({ leadId: "L" }));
    const r1 = await luuKetQuaDisc(hop(), dep(store, crm, "TOKEN-1"));
    const r2 = await luuKetQuaDisc(hop(), dep(store, crm, "TOKEN-2"));
    const r3 = await luuKetQuaDisc(hop(), dep(store, crm, "TOKEN-3"));
    expect(dong.size).toBe(1);
    expect(crm).toHaveBeenCalledTimes(1);
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    expect(r1.ok && r1.submissionId).toBe(r2.ok && r2.submissionId);
    expect(store.xoayTokenTai).toHaveBeenCalledTimes(2);
    expect([...dong.values()][0]!.tokenHash).toBe(bam("TOKEN-3"));
    // lần phát lại không đổi thông điệp email của bản gốc
    const e = taoStore();
    await luuKetQuaDisc(hop({ email: "an.gia@example.test" }), dep(e.store, crm, "A"));
    const lai = await luuKetQuaDisc(hop({ email: "an.gia@example.test" }), dep(e.store, crm, "B"));
    expect(lai.ok && lai.thongBao.email).toMatch(/a\*\*\*@example\.test/);
  });
  it("hai phiên: khoá TRÙNG nhưng SĐT KHÁC ⇒ từ chối, KHÔNG cấp token, KHÔNG xoay hash (chiếm khoá của người khác)", async () => {
    const { store } = taoStore();
    const crm = vi.fn(async () => ({ leadId: "L" }));
    await luuKetQuaDisc(hop(), dep(store, crm, "TOKEN-CHU"));
    const ke = await luuKetQuaDisc(hop({ soDienThoai: "0912 000 111" }), dep(store, crm, "TOKEN-KE-GIAN"));
    expect(ke).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(store.xoayTokenTai).not.toHaveBeenCalled();
    expect(crm).toHaveBeenCalledTimes(1);
  });
  it("SĐT không hợp lệ ⇒ lỗi trường soDienThoai, không ghi", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop({ soDienThoai: "12345" }), dep(store));
    expect(!r.ok && r.chiTiet?.map((c) => c.truong)).toEqual(["soDienThoai"]);
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("phản hồi KHÔNG phụ thuộc SĐT mới/cũ (không oracle): hai SĐT khác nhau ⇒ phản hồi cùng hình và cùng câu chữ", async () => {
    const a = taoStore();
    const b = taoStore();
    const ra = await luuKetQuaDisc(hop({ soDienThoai: "0905 123 456" }), dep(a.store, undefined, "T"));
    const rb = await luuKetQuaDisc(hop({ soDienThoai: "0912 000 111", idempotencyKey: "khoa-khac-0123456789-xyz" }), dep(b.store, undefined, "T"));  // gitleaks:allow
    expect(ra.ok && rb.ok).toBe(true);
    if (ra.ok && rb.ok) {
      expect(Object.keys(ra).sort()).toEqual(Object.keys(rb).sort());
      expect(ra.thongBao).toEqual(rb.thongBao);
    }
  });
  it("snapshot báo cáo chỉ chứa điểm + mã bộ đề, KHÔNG chứa câu trả lời từng câu, tên hay SĐT", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop({ ketQua: { engineVersion: "e", phuHuynh: { ...nguoiKq, cauTraLoi: [1, 2, 3] }, hocSinh: nguoiKq } }), dep(store));
    const snap = JSON.stringify((goiGhi(store).nguoi as Array<{ ketQua: unknown }>).map((n) => n.ketQua));
    expect(snap).not.toContain("cauTraLoi");
    expect(snap).not.toMatch(/Giả|84905/);
  });
});

describe("[DISC-QA-CORE-ENGINE] điểm do server chấm; cổng tin-điểm-client đóng ở production", () => {
  const engineGia = (): DiscEngine => ({
    phienBan: "engine-gia",
    chonBoDe: ({ vai }) => ({ ma: vai === "PH" ? "PH-GIA" : "HS-GIA", phienBan: "g1", doiTuong: vai === "PH" ? "PH" : "TH", nguoiLonTraLoiHo: false, cauHoi: [] }),
    layBoDe: () => null,
    cham: (ma, tl) => ({ ok: true, ketQua: { diem: { D: Object.keys(tl).length, I: 1, S: 2, C: 3 }, maBoDe: ma, phienBanBoDe: "g1" } }),
  });
  const bai = { phuHuynh: { maBoDe: "PH-GIA", traLoi: { q1: 1, q2: 2 } }, hocSinh: { maBoDe: "HS-GIA", traLoi: { q1: 1 } } };

  it("không engine + cổng đóng ⇒ ENGINE_CHUA_SAN_SANG, KHÔNG ghi, KHÔNG CRM (điểm client không được nhận)", async () => {
    const { store } = taoStore();
    const crm = vi.fn(async () => ({ leadId: null }));
    const r = await luuKetQuaDisc(hop(), { ...dep(store, crm), choPhepTinDiemClient: () => false });
    expect(r).toEqual({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(crm).not.toHaveBeenCalled();
  });
  it("có engine: điểm client bịa BỊ BỎ QUA, snapshot mang điểm do engine chấm", async () => {
    const { store } = taoStore();
    const bia = { ...nguoiKq, diem: { D: 99, I: 99, S: 99, C: 99 } };
    const r = await luuKetQuaDisc(hop({ bai, ketQua: { engineVersion: "bia", phuHuynh: bia, hocSinh: bia } }), { ...dep(store), engine: () => engineGia() });
    expect(r.ok).toBe(true);
    const g = goiGhi(store);
    expect(g.engineVersion).toBe("engine-gia");
    expect(JSON.stringify(g.nguoi.map((n: { ketQua: unknown }) => n.ketQua))).not.toContain("99");
    expect(g.nguoi[0].ketQua.diem.D).toBe(2);
  });
  it("có engine mà thiếu câu trả lời thô ⇒ lỗi, KHÔNG rơi về điểm client", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop(), { ...dep(store), engine: () => engineGia() });
    expect(r.ok).toBe(false);
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("mã bộ đề client khai sai so với hồ sơ ⇒ lỗi (server chọn bộ đề, không tin client)", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop({ bai: { ...bai, phuHuynh: { ...bai.phuHuynh, maBoDe: "BO-DE-LA" } } }), { ...dep(store), engine: () => engineGia() });
    expect(!r.ok && r.loi).toBe("DU_LIEU_KHONG_HOP_LE");
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("choPhepTinDiemClient: chỉ đúng chuỗi 'true' VÀ không production; production luôn đóng", () => {
    expect(choPhepTinDiemClient({ DISC_TEST_TRUST_CLIENT_SCORES: "true", NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(choPhepTinDiemClient({ DISC_TEST_TRUST_CLIENT_SCORES: "true", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    for (const v of [undefined, "", "1", "TRUE", "yes"]) {
      expect(choPhepTinDiemClient({ DISC_TEST_TRUST_CLIENT_SCORES: v, NODE_ENV: "development" } as NodeJS.ProcessEnv), String(v)).toBe(false);
    }
  });
  it("production-thật-hay-không KHÔNG chỉ dựa vào VERCEL_ENV: NODE_ENV=production + VERCEL_ENV khác (bản dựng test/preview) vẫn đóng", () => {
    const e = (o: Record<string, string>) => ({ DISC_TEST_TRUST_CLIENT_SCORES: "true", ...o }) as unknown as NodeJS.ProcessEnv;
    expect(choPhepTinDiemClient(e({ NODE_ENV: "production", VERCEL_ENV: "preview" }))).toBe(false);
    expect(choPhepTinDiemClient(e({ NODE_ENV: "production", VERCEL_ENV: "test" }))).toBe(false);
    expect(choPhepTinDiemClient(e({ NODE_ENV: "production", CI: "true" }))).toBe(false);
    expect(choPhepTinDiemClient(e({ NODE_ENV: "production", VERCEL_ENV: "production" }))).toBe(false);
    // VERCEL_ENV=production thắng NODE_ENV: máy chủ thật mà NODE_ENV bị đặt lệch cũng ĐÓNG (laProductionThat)
    expect(choPhepTinDiemClient(e({ NODE_ENV: "development", VERCEL_ENV: "production" }))).toBe(false);
    expect(choPhepTinDiemClient(e({ NODE_ENV: "test", VERCEL_ENV: "production" }))).toBe(false);
    // đối chứng dương: dev thuần mới mở
    expect(choPhepTinDiemClient(e({ NODE_ENV: "development" }))).toBe(true);
    expect(choPhepTinDiemClient(e({ NODE_ENV: "test" }))).toBe(true);
  });
  it("trần thử sai mã nhận là SỐ NHỎ (ghim giá trị, không chỉ so với chính hằng số)", () => {
    expect(TOI_DA_LAN_THU_MA).toBeGreaterThanOrEqual(3);
    expect(TOI_DA_LAN_THU_MA).toBeLessThanOrEqual(10); // 50 bit entropy: 10 lần thử ≈ 1e-14 xác suất đoán trúng
  });
  it("mã nhận: store chỉ nhận HMAC, không bao giờ nhận plaintext; phản hồi trả plaintext đúng một lần", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop(), dep(store));
    const g = goiGhi(store);
    expect(g.claimCodeHash).toBe(bamMaNhan(MA_GIA, KHOA));
    expect(JSON.stringify(g)).not.toContain(MA_GIA);
    expect(r.ok && r.maNhan).toBe(MA_GIA);
  });
});

/* ───────────────────────────── vòng 2: replay · phoneKey · trần · câu trả lời thô · thách đố ───────────────────────────── */

describe("[DISC-QA-CORE-REPLAY] phát lại cùng khoá chỉ xoay token khi MỌI điều kiện đúng (payloadHash, trạng thái, hạn)", () => {
  it("cùng khoá + cùng nội dung: xoay token (kể cả khi thứ tự khoá JSON của client khác); không CRM lần hai", async () => {
    const { store } = taoStore();
    const crm = vi.fn(async () => ({ leadId: "L" }));
    const r1 = await luuKetQuaDisc(hop(), dep(store, crm, "T1"));
    const r2 = await luuKetQuaDisc(hop({ hocSinh: { bacHoc: "4", namSinh: 2016, hoTen: "Học Sinh Giả" } }), dep(store, crm, "T2"));
    expect(r1.ok && r2.ok).toBe(true);
    expect(store.xoayTokenTai).toHaveBeenCalledTimes(1);
    expect(crm).toHaveBeenCalledTimes(1);
  });
  it("cùng khoá + NỘI DUNG KHÁC (tên con / email / tiếp thị / chiến dịch / vai PH): từ chối, KHÔNG xoay token", async () => {
    const khac: Array<[string, Record<string, unknown>]> = [
      ["tên con", { hocSinh: hs({ hoTen: "Học Sinh Khác" }) }],
      ["email", { email: "an.gia@example.test" }],
      ["tiếp thị", { dongY: { xuLyHoSo: true, tiepThi: true } }],
      ["chiến dịch", { chienDich: "DISC_QR" }],
      ["vai PH", { phuHuynh: ph({ vaiTro: "BO" }) }],
    ];
    for (const [ten, doi] of khac) {
      const { store } = taoStore();
      await luuKetQuaDisc(hop(), dep(store, undefined, "GOC"));
      const r = await luuKetQuaDisc(hop(doi), dep(store, undefined, "KE-GIAN"));
      expect(r, ten).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
      expect(store.xoayTokenTai, ten).not.toHaveBeenCalled();
    }
  });
  it("cùng khoá + câu trả lời thô KHÁC (đường engine): từ chối, KHÔNG xoay token — câu trả lời nằm trong payloadHash", async () => {
    const eng = (): DiscEngine => ({
      phienBan: "engine-gia",
      chonBoDe: ({ vai }) => ({ ma: vai === "PH" ? "PH-GIA" : "HS-GIA", phienBan: "g1", doiTuong: vai === "PH" ? "PH" : "TH", nguoiLonTraLoiHo: false, cauHoi: [] }),
      layBoDe: () => null,
      cham: (ma, tl) => ({ ok: true, ketQua: { diem: { D: Object.keys(tl).length, I: 1, S: 2, C: 3 }, maBoDe: ma, phienBanBoDe: "g1" } }),
    });
    const bai = (v: number) => ({ phuHuynh: { maBoDe: "PH-GIA", traLoi: { q1: v } }, hocSinh: { maBoDe: "HS-GIA", traLoi: { q1: 1 } } });
    const { store } = taoStore();
    const d = { ...dep(store), engine: () => eng() };
    expect((await luuKetQuaDisc(hop({ bai: bai(1) }), d)).ok).toBe(true);
    // CÙNG số câu ⇒ cùng điểm do engine chấm; chỉ giá trị trả lời khác — vẫn phải bị từ chối.
    const r = await luuKetQuaDisc(hop({ bai: bai(2) }), d);
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(store.xoayTokenTai).not.toHaveBeenCalled();
  });
  it("bản ghi KHÔNG còn hợp lệ để phát lại (đã nhận/hết hạn/thu hồi/đã xoá/hết hạn giữ/không có payloadHash): từ chối, KHÔNG xoay", async () => {
    const hong: Array<[string, (b: BanGhi) => void]> = [
      ["CLAIMED", (b) => (b.claimStatus = "CLAIMED")],
      ["EXPIRED", (b) => (b.claimStatus = "EXPIRED")],
      ["REVOKED", (b) => (b.claimStatus = "REVOKED")],
      ["đã xoá", (b) => (b.deletedAt = new Date("2026-10-30T00:00:00Z"))],
      ["retainUntil = đúng bây giờ (biên)", (b) => (b.retainUntil = NOW)],
      ["retainUntil đã qua", (b) => (b.retainUntil = new Date(NOW.getTime() - 1000))],
      ["payloadHash null (bản ghi cũ)", (b) => (b.payloadHash = null)],
    ];
    for (const [ten, lamHong] of hong) {
      const { store, dong } = taoStore();
      await luuKetQuaDisc(hop(), dep(store, undefined, "GOC"));
      lamHong([...dong.values()][0]!);
      const r = await luuKetQuaDisc(hop(), dep(store, undefined, "MOI"));
      expect(r, ten).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
      expect(store.xoayTokenTai, ten).not.toHaveBeenCalled();
    }
  });
  it("replayHopLe thuần: đúng 1 điều kiện sai là false; đối chứng dương: tất cả đúng ⇒ true; retainUntil = now+1ms ⇒ true", () => {
    const ban: BanGhi = { id: "x", phoneKey: "pk", emailStatus: "NONE", emailTo: null, claimStatus: "PENDING_CLAIM", payloadHash: "h", deletedAt: null, retainUntil: new Date(NOW.getTime() + 1) };
    expect(replayHopLe(ban, "pk", "h", NOW)).toBe(true);
    expect(replayHopLe(ban, "pk-khac", "h", NOW)).toBe(false);
    expect(replayHopLe(ban, "pk", "h-khac", NOW)).toBe(false);
    expect(replayHopLe({ ...ban, retainUntil: NOW }, "pk", "h", NOW)).toBe(false);
    expect(replayHopLe({ ...ban, deletedAt: NOW }, "pk", "h", NOW)).toBe(false);
    expect(replayHopLe({ ...ban, claimStatus: "CLAIMED" }, "pk", "h", NOW)).toBe(false);
    expect(replayHopLe({ ...ban, payloadHash: null }, "pk", "", NOW)).toBe(false);
  });
  it("xoayTokenTai trả false (đua: dòng vừa bị nhận/xoá) hoặc ném ⇒ LUU_THAT_BAI, không lộ token", async () => {
    const hanhVi = [
      async () => false,
      async (): Promise<boolean> => {
        throw new Error("db sập phone=84905123456");
      },
    ];
    for (const h of hanhVi) {
      const { store } = taoStore();
      await luuKetQuaDisc(hop(), dep(store, undefined, "GOC"));
      (store.xoayTokenTai as ReturnType<typeof vi.fn>).mockImplementation(h);
      const r = await luuKetQuaDisc(hop(), dep(store, undefined, "TOKEN-RO-RI"));
      expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
      expect(JSON.stringify(r)).not.toMatch(/TOKEN-RO-RI|84905/);
    }
  });
  it("phát lại hợp lệ: xoay đúng (id, hash MỚI, hạn MỚI từ now, hash mã nhận MỚI, now) — token plaintext không vào store", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop(), dep(store, undefined, "T-CU"));
    const sau = new Date(NOW.getTime() + 5 * 60_000);
    await luuKetQuaDisc(hop(), { ...dep(store, undefined, "T-MOI"), now: () => sau, sinhMa: () => "MMMMMMMMMM" });
    const lenh = (store.xoayTokenTai as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const [id, h, han, mh, n] = lenh;
    expect(id).toBe("s1");
    expect(h).toBe(bam("T-MOI"));
    expect(han.getTime() - sau.getTime()).toBe(HAN_TOKEN_TAI_PHUT * 60_000);
    expect(mh).toBe(bamMaNhan("MMMMMMMMMM", KHOA));
    expect(n).toBe(sau);
    expect(JSON.stringify(lenh)).not.toMatch(/T-MOI|MMMMMMMMMM/);
  });
});

describe("[DISC-QA-CORE-PHONEKEY] phoneKey trong store là HMAC, SĐT thô chỉ đi vào CRM", () => {
  it("lệnh ghi và lệnh đếm nhận HMAC theo đúng công thức; không chứa SĐT thô dưới bất kỳ dạng nào", async () => {
    const { store } = taoStore();
    const crm = vi.fn(async () => ({ leadId: "L" }));
    await luuKetQuaDisc(hop({ soDienThoai: "0905 123 456" }), dep(store, crm));
    const g = goiGhi(store);
    expect(g.phoneKey).toBe(phoneKeyTuSdtChuan("84905123456", KHOA));
    expect(g.phoneKey).toMatch(/^[a-f0-9]{64}$/);
    const lenhStore = JSON.stringify([(store.taoHoacLayTheoKhoa as ReturnType<typeof vi.fn>).mock.calls, (store.demTheoPhone as ReturnType<typeof vi.fn>).mock.calls]);
    expect(lenhStore).not.toMatch(/84905123456|0905123456|905123456|0905 123 456/);
    expect(crm).toHaveBeenCalledWith(expect.objectContaining({ soDienThoai: "84905123456" }));
  });
  it("khoá HMAC khác ⇒ phoneKey khác (đổi secret ⇒ vô hiệu); cùng SĐT viết khác dạng (0905…/+84905…) ⇒ CÙNG phoneKey", async () => {
    const a = taoStore();
    const b = taoStore();
    const c = taoStore();
    await luuKetQuaDisc(hop({ soDienThoai: "0905123456" }), dep(a.store));
    await luuKetQuaDisc(hop({ soDienThoai: "+84 905 123 456" }), dep(b.store));
    await luuKetQuaDisc(hop({ soDienThoai: "0905123456" }), { ...dep(c.store), khoaBam: () => "x".repeat(32) });
    expect(goiGhi(a.store).phoneKey).toBe(goiGhi(b.store).phoneKey);
    expect(goiGhi(c.store).phoneKey).not.toBe(goiGhi(a.store).phoneKey);
  });
  it("demTheoPhone nhận (phoneKey HMAC, ipKey HMAC, now − cửa sổ, idempotencyKey để bỏ qua chính nó)", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop(), dep(store));
    const [pk, , tu, boQua] = (store.demTheoPhone as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(pk).toBe(phoneKeyTuSdtChuan("84905123456", KHOA));
    expect(tu.getTime()).toBe(NOW.getTime() - CUA_SO_DEM_BAI_THEO_SDT_MS);
    expect(boQua).toBe("khoa-gia-0123456789-abcdef");
  });
  // N6: hai trần. Trần theo cặp (SĐT, IP) trả QUA_NHIEU_YEU_CAU; trần CỨNG theo SĐT ở mọi IP trả LUU_THAT_BAI Y HỆT lỗi chung
  // (nếu trả mã riêng, IP sạch thăm dò được "SĐT này vừa bị dùng nhiều lần" — oracle). Cấy L39/L40 đo đúng hai cổng này.
  it("[N6] trần CỨNG theo SĐT (mọi IP): đủ TRẦN_CỨNG ⇒ LUU_THAT_BAI (KHÔNG mã riêng), không ghi, không CRM; TRẦN_CỨNG−1 ⇒ vẫn lưu", async () => {
    expect(TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG).toBeGreaterThan(TOI_DA_BAI_MOI_THEO_CAP); // trần cứng phải rộng hơn trần cặp, nếu không trần cặp vô nghĩa
    const chan = taoStore();
    (chan.store.demTheoPhone as ReturnType<typeof vi.fn>).mockResolvedValue({ theoCap: 0, theoPhone: TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG });
    const crm = vi.fn(async () => ({ leadId: "L" }));
    const r = await luuKetQuaDisc(hop(), dep(chan.store, crm));
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(chan.store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(crm).not.toHaveBeenCalled();
    const con = taoStore();
    (con.store.demTheoPhone as ReturnType<typeof vi.fn>).mockResolvedValue({ theoCap: 0, theoPhone: TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG - 1 });
    expect((await luuKetQuaDisc(hop(), dep(con.store))).ok).toBe(true);
  });
  it("[N6] trần cặp độc lập với trần cứng: theoCap đủ TRẦN dù theoPhone thấp ⇒ QUA_NHIEU_YEU_CAU", async () => {
    const { store } = taoStore();
    (store.demTheoPhone as ReturnType<typeof vi.fn>).mockResolvedValue({ theoCap: TOI_DA_BAI_MOI_THEO_CAP, theoPhone: TOI_DA_BAI_MOI_THEO_CAP });
    expect(await luuKetQuaDisc(hop(), dep(store))).toEqual({ ok: false, loi: "QUA_NHIEU_YEU_CAU" });
  });
});

describe("[DISC-QA-CORE-TRAN] trần bài mới theo SĐT (lưới DB thứ hai) — fail-closed", () => {
  it("ghim số: trần là số nhỏ (≤10) và cửa sổ ≤ 48 giờ", () => {
    expect(TOI_DA_BAI_MOI_THEO_CAP).toBeGreaterThanOrEqual(1);
    expect(TOI_DA_BAI_MOI_THEO_CAP).toBeLessThanOrEqual(10);
    expect(CUA_SO_DEM_BAI_THEO_SDT_MS).toBeLessThanOrEqual(48 * 3_600_000);
  });
  it("đã có đúng TRẦN bài ⇒ QUA_NHIEU_YEU_CAU, không ghi, không CRM; TRẦN−1 ⇒ vẫn lưu (đối chứng dương, biên)", async () => {
    const day = taoStore({ soDaCo: TOI_DA_BAI_MOI_THEO_CAP });
    const crm = vi.fn(async () => ({ leadId: "L" }));
    const r = await luuKetQuaDisc(hop(), dep(day.store, crm));
    expect(r).toEqual({ ok: false, loi: "QUA_NHIEU_YEU_CAU" });
    expect(day.store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(crm).not.toHaveBeenCalled();
    const con = taoStore({ soDaCo: TOI_DA_BAI_MOI_THEO_CAP - 1 });
    expect((await luuKetQuaDisc(hop(), dep(con.store))).ok).toBe(true);
  });
  it("lỗi đếm ⇒ LUU_THAT_BAI (từ chối, KHÔNG lưu mù), không ghi, không CRM", async () => {
    const { store } = taoStore({
      soDaCo: async () => {
        throw new Error("db sập");
      },
    });
    const crm = vi.fn(async () => ({ leadId: "L" }));
    const r = await luuKetQuaDisc(hop(), dep(store, crm));
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(crm).not.toHaveBeenCalled();
  });
  it("đếm theo phoneKey của CHÍNH số đang lưu (không dùng chung bộ đếm giữa các số)", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop({ soDienThoai: "0912 000 111", idempotencyKey: "khoa-khac-0123456789-xyz" }), dep(store));  // gitleaks:allow
    expect((store.demTheoPhone as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(phoneKeyTuSdtChuan("84912000111", KHOA));
  });
});

describe("[DISC-QA-CORE-THO] câu trả lời thô được chấm rồi BỎ: không lọt vào store, CRM, phản hồi", () => {
  const eng = (): DiscEngine => ({
    phienBan: "engine-gia",
    chonBoDe: ({ vai }) => ({ ma: vai === "PH" ? "PH-GIA" : "HS-GIA", phienBan: "g1", doiTuong: vai === "PH" ? "PH" : "TH", nguoiLonTraLoiHo: false, cauHoi: [] }),
    layBoDe: () => null,
    cham: (ma, tl) => ({ ok: true, ketQua: { diem: { D: Object.keys(tl).length, I: 1, S: 2, C: 3 }, maBoDe: ma, phienBanBoDe: "g1" } }),
  });
  const baiRieng = { phuHuynh: { maBoDe: "PH-GIA", traLoi: { "cau-rieng-ph": 742, "cau-rieng-ph-2": 843 } }, hocSinh: { maBoDe: "HS-GIA", traLoi: { "cau-rieng-hs": 951 } } };
  it("không có khoá câu hỏi, không có giá trị trả lời trong BẤT KỲ đối số store/CRM nào hay phản hồi", async () => {
    const { store } = taoStore();
    const crm = vi.fn(async () => ({ leadId: "L" }));
    const r = await luuKetQuaDisc(hop({ bai: baiRieng }), { ...dep(store, crm), engine: () => eng() });
    expect(r.ok).toBe(true);
    const moi = JSON.stringify([(store.taoHoacLayTheoKhoa as ReturnType<typeof vi.fn>).mock.calls, (store.demTheoPhone as ReturnType<typeof vi.fn>).mock.calls, crm.mock.calls, r]);
    expect(moi).not.toMatch(/cau-rieng|traLoi/);
  });
  it("payloadHash PHỤ THUỘC câu trả lời thô nhưng KHÔNG phụ thuộc thứ tự khoá; bamPayload dùng HMAC theo khoá", async () => {
    const a = taoStore();
    const b = taoStore();
    const c = taoStore();
    const baiDaoThuTu = { hocSinh: { traLoi: { "cau-rieng-hs": 951 }, maBoDe: "HS-GIA" }, phuHuynh: { traLoi: { "cau-rieng-ph-2": 843, "cau-rieng-ph": 742 }, maBoDe: "PH-GIA" } };
    const baiKhac = { ...baiRieng, phuHuynh: { ...baiRieng.phuHuynh, traLoi: { "cau-rieng-ph": 743, "cau-rieng-ph-2": 843 } } };
    await luuKetQuaDisc(hop({ bai: baiRieng }), { ...dep(a.store), engine: () => eng() });
    await luuKetQuaDisc(hop({ bai: baiDaoThuTu }), { ...dep(b.store), engine: () => eng() });
    await luuKetQuaDisc(hop({ bai: baiKhac }), { ...dep(c.store), engine: () => eng() });
    expect(goiGhi(a.store).payloadHash).toBe(goiGhi(b.store).payloadHash);
    expect(goiGhi(a.store).payloadHash).not.toBe(goiGhi(c.store).payloadHash);
    expect(jsonOnDinh({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
    expect(bamPayload({ x: 1 }, KHOA)).not.toBe(bamPayload({ x: 1 }, "y".repeat(32)));
    expect(bamPayload({ x: 1 }, KHOA)).not.toContain('"x"');
  });
  it("đường thử nghiệm (không engine) KHÔNG nhận `bai` thô: payloadHash không phụ thuộc `bai`, và bài thô bị bỏ", async () => {
    const a = taoStore();
    const b = taoStore();
    await luuKetQuaDisc(hop({ bai: baiRieng }), dep(a.store));
    await luuKetQuaDisc(hop(), dep(b.store));
    expect(goiGhi(a.store).payloadHash).toBe(goiGhi(b.store).payloadHash);
    expect(JSON.stringify(goiGhi(a.store))).not.toMatch(/cau-rieng/);
  });
});

describe("[DISC-QA-CORE-THACH-DO] nhận bài: mã nhận + NĂM SINH CON, một thông điệp cho mọi sai, không oracle", () => {
  const SDT_CHUAN_GIA = "84905000111";
  const khoaSdt = (s: string) => `hmac-gia:${s}`;
  type Thu = Parameters<NhanDeps["thachDoStore"]["thu"]>[0];
  function taoDeps(thuTraVe: { submissionId: string } | null, tuyChon: { otpOk?: boolean; ganDuoc?: boolean; tk?: { id: string; trangThai: "ACTIVE" | "PENDING_ACTIVATION" | "KHAC"; laPhuHuynh: boolean } } = {}) {
    const thu = vi.fn(async (_p: Thu) => thuTraVe);
    const gan = vi.fn(async () => tuyChon.ganDuoc ?? true);
    const taoPhuHuynh = vi.fn(async () => ({ id: "u-moi" }));
    const huyTaoMoi = vi.fn(async () => {});
    const kichHoat = vi.fn(async () => {});
    const xacMinh = vi.fn(async () => (tuyChon.otpOk === false ? ({ ok: false as const, error: "OTP sai" }) : ({ ok: true as const })));
    const deps: NhanDeps = {
      now: NOW,
      thachDoStore: { thu, gan },
      khoaSdt,
      coBaiDangCho: vi.fn(async () => true),
      choPhepGuiOtp: vi.fn(async () => true),
      choPhepThuOtp: vi.fn(async () => true),
      otp: { yeuCau: vi.fn(async () => ({ ok: true as const, cooldownSec: 60 })), xacMinh },
      taiKhoan: { tim: vi.fn(async () => tuyChon.tk ?? null), taoPhuHuynh, kichHoat, huyTaoMoi },
      bamMatKhau: vi.fn(async () => "hash-mk"),
      khoaBam: () => KHOA,
    };
    return { deps, thu, gan, taoPhuHuynh, xacMinh, huyTaoMoi, kichHoat };
  }
  const vao = (o: Record<string, unknown> = {}) => ({ soDienThoai: "0905000111", otp: "123456", maNhan: "ABCDE23456", namSinhCon: 2015 as unknown, matKhau: "matkhau-gia-1", phien: null, ...o });

  it("chuanHoaNamSinhCon: nhận '2015'/2015, loại rác, biên 1950 và 2100", () => {
    expect(chuanHoaNamSinhCon("2015")).toBe(2015);
    expect(chuanHoaNamSinhCon(" 2015 ")).toBe(2015);
    expect(chuanHoaNamSinhCon(2015)).toBe(2015);
    expect(chuanHoaNamSinhCon(1950)).toBe(1950);
    expect(chuanHoaNamSinhCon(1949)).toBeNull();
    expect(chuanHoaNamSinhCon(2100)).toBe(2100);
    expect(chuanHoaNamSinhCon(2101)).toBeNull();
    for (const x of ["", "20155", "abcd", 2015.5, null, undefined, "2015a", Number.NaN]) expect(chuanHoaNamSinhCon(x), String(x)).toBeNull();
  });
  it("năm sinh con thiếu/sai dạng ⇒ KHÔNG tiêu OTP, KHÔNG chạm store, thông điệp GIỐNG HỆT sai mã", async () => {
    const { deps, thu, xacMinh } = taoDeps({ submissionId: "s1" });
    const rSai = await nhanBaiDisc({ ...vao({ namSinhCon: "abcd" }), deps });
    const rThieu = await nhanBaiDisc({ ...vao({ namSinhCon: undefined }), deps });
    expect(rSai.ok || rThieu.ok).toBe(false);
    expect(thu).not.toHaveBeenCalled();
    expect(xacMinh).not.toHaveBeenCalled();
    const { deps: d2 } = taoDeps(null);
    const rKhongKhop = await nhanBaiDisc({ ...vao(), deps: d2 });
    expect(rSai).toEqual(rKhongKhop);
    expect(rThieu).toEqual(rKhongKhop);
  });
  it("thách đố trượt (sai mã HOẶC sai năm — store trả null): cùng một phản hồi, KHÔNG tạo tài khoản, KHÔNG gắn bài", async () => {
    const { deps, taoPhuHuynh, gan } = taoDeps(null);
    const a = await nhanBaiDisc({ ...vao({ maNhan: "ZZZZZ99999" }), deps });
    const b = await nhanBaiDisc({ ...vao({ namSinhCon: 2001 }), deps });
    expect(a).toEqual(b);
    expect(!a.ok && a.loi).toBe("MA_KHONG_KHOP");
    expect(taoPhuHuynh).not.toHaveBeenCalled();
    expect(gan).not.toHaveBeenCalled();
  });
  it("store nhận phoneKey = HMAC (không SĐT thô), maHash = HMAC mã (không plaintext), đúng năm sinh và trần thử", async () => {
    const { deps, thu } = taoDeps({ submissionId: "s1" });
    const r = await nhanBaiDisc({ ...vao({ maNhan: "abcde-23456" }), deps });
    expect(r.ok).toBe(true);
    const p = thu.mock.calls[0]![0];
    expect(p.phoneKey).toBe(khoaSdt(SDT_CHUAN_GIA));
    expect(p.maHash).toBe(bamMaNhan("ABCDE23456", KHOA));
    expect(p.namSinhCon).toBe(2015);
    expect(p.toiDaLanThu).toBe(TOI_DA_LAN_THU_NHAN);
    expect(JSON.stringify(p)).not.toContain("ABCDE23456");
  });
  it("trần thử nhận là SỐ NHỎ (ghim giá trị: 1..5)", () => {
    expect(TOI_DA_LAN_THU_NHAN).toBeGreaterThanOrEqual(1);
    expect(TOI_DA_LAN_THU_NHAN).toBeLessThanOrEqual(5);
  });
  it("hai phiên cùng thắng thách đố: bên thua gắn false ⇒ dọn tài khoản VỪA tạo, trả thông điệp chung", async () => {
    const { deps, taoPhuHuynh, huyTaoMoi } = taoDeps({ submissionId: "s1" }, { ganDuoc: false });
    const r = await nhanBaiDisc({ ...vao(), deps });
    expect(r.ok).toBe(false);
    expect(taoPhuHuynh).toHaveBeenCalledTimes(1);
    expect(huyTaoMoi).toHaveBeenCalledWith("u-moi");
  });
  it("đang đăng nhập bằng tài khoản của SỐ KHÁC ⇒ từ chối TRƯỚC khi tiêu OTP / chạm store (không nhận hộ)", async () => {
    const { deps, thu, xacMinh, gan } = taoDeps({ submissionId: "s1" });
    const r = await nhanBaiDisc({ ...vao({ phien: { userId: "u-khac", phoneKey: "84912000111" } }), deps });
    expect(!r.ok && r.loi).toBe("KHONG_HOP_LE");
    expect(xacMinh).not.toHaveBeenCalled();
    expect(thu).not.toHaveBeenCalled();
    expect(gan).not.toHaveBeenCalled();
    // đối chứng dương: đúng số của chính mình ⇒ đi tiếp và gắn vào userId của phiên
    const ok = taoDeps({ submissionId: "s1" });
    const r2 = await nhanBaiDisc({ ...vao({ phien: { userId: "u-minh", phoneKey: SDT_CHUAN_GIA }, matKhau: null }), deps: ok.deps });
    expect(r2.ok).toBe(true);
    expect(ok.gan).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-minh" }));
  });
  it("số ĐÃ có tài khoản ACTIVE (chưa đăng nhập) ⇒ CAN_DANG_NHAP, KHÔNG thách đố, KHÔNG tạo/ghi đè tài khoản", async () => {
    const { deps, thu, taoPhuHuynh, kichHoat, gan } = taoDeps({ submissionId: "s1" }, { tk: { id: "u1", trangThai: "ACTIVE", laPhuHuynh: true } });
    const r = await nhanBaiDisc({ ...vao(), deps });
    expect(!r.ok && r.loi).toBe("CAN_DANG_NHAP");
    expect(thu).not.toHaveBeenCalled();
    expect(taoPhuHuynh).not.toHaveBeenCalled();
    expect(kichHoat).not.toHaveBeenCalled();
    expect(gan).not.toHaveBeenCalled();
  });
  it("tài khoản KHÔNG phải phụ huynh chờ kích hoạt ⇒ KHONG_HOP_LE; phụ huynh chờ kích hoạt ⇒ kích hoạt tài khoản đó (đối chứng dương)", async () => {
    const a = taoDeps({ submissionId: "s1" }, { tk: { id: "u2", trangThai: "PENDING_ACTIVATION", laPhuHuynh: false } });
    const ra = await nhanBaiDisc({ ...vao(), deps: a.deps });
    expect(!ra.ok && ra.loi).toBe("KHONG_HOP_LE");
    expect(a.thu).not.toHaveBeenCalled();
    const b = taoDeps({ submissionId: "s1" }, { tk: { id: "u3", trangThai: "PENDING_ACTIVATION", laPhuHuynh: true } });
    const rb = await nhanBaiDisc({ ...vao(), deps: b.deps });
    expect(rb.ok).toBe(true);
    expect(b.kichHoat).toHaveBeenCalledWith(expect.objectContaining({ userId: "u3" }));
    expect(b.taoPhuHuynh).not.toHaveBeenCalled();
  });
  it("OTP sai ⇒ dừng TRƯỚC thách đố (store không bị chạm, không đốt lượt thử)", async () => {
    const { deps, thu } = taoDeps({ submissionId: "s1" }, { otpOk: false });
    const r = await nhanBaiDisc({ ...vao(), deps });
    expect(!r.ok && r.loi).toBe("MA_KHONG_KHOP"); // N3/D3: lỗi OTP không còn mã riêng, gộp về mã công khai chung
    expect(thu).not.toHaveBeenCalled();
  });
});

describe("[DISC-QA-CORE-EMAIL] xếp thư xác minh: chỉ khi CÓ email, chỉ lần tạo đầu, lời nói đúng kết quả THẬT", () => {
  it("không email ⇒ KHÔNG gọi guiEmail; có email ⇒ gọi đúng MỘT lần với submissionId và now tiêm vào", async () => {
    const khong = taoStore();
    const g0 = vi.fn(async () => ({ ok: true as const }));
    await luuKetQuaDisc(hop(), dep(khong.store, undefined, "T", g0));
    expect(g0).not.toHaveBeenCalled();
    const co = taoStore();
    const g1 = vi.fn(async () => ({ ok: true as const }));
    await luuKetQuaDisc(hop({ email: "an.gia@example.test" }), dep(co.store, undefined, "T", g1));
    expect(g1).toHaveBeenCalledTimes(1);
    expect(g1).toHaveBeenCalledWith("s1", NOW);
  });
  it("phát lại hợp lệ ĐƯỢC thử xếp thư lại (cứu lần đầu lỗi) và lời nói theo kết quả lần này; phát lại bị TỪ CHỐI thì KHÔNG đụng tới thư", async () => {
    const { store } = taoStore();
    const g = vi.fn<LuuDeps["guiEmail"]>();
    g.mockRejectedValueOnce(new Error("queue sập")); // lần lưu đầu: xếp hàng lỗi
    g.mockResolvedValueOnce({ ok: false, loi: "DA_GUI" }); // phát lại: dịch vụ email tự chống trùng
    const h = hop({ email: "an.gia@example.test" });
    const r1 = await luuKetQuaDisc(h, dep(store, undefined, "T1", g));
    expect(r1.ok && r1.thongBao.email).toMatch(/chưa gửi được/);
    const r2 = await luuKetQuaDisc(h, dep(store, undefined, "T2", g));
    expect(g).toHaveBeenCalledTimes(2);
    expect(r2.ok && r2.thongBao.email).toMatch(/xác minh/);
    expect(r2.ok && r2.thongBao.email).not.toMatch(/chưa gửi được/);
    // phát lại với NỘI DUNG KHÁC bị từ chối ⇒ không gọi guiEmail lần ba
    const r3 = await luuKetQuaDisc(hop({ email: "an.gia@example.test", hocSinh: hs({ hoTen: "Học Sinh Khác" }) }), dep(store, undefined, "T3", g));
    expect(r3.ok).toBe(false);
    expect(g).toHaveBeenCalledTimes(2);
  });
  it("xếp hàng lỗi (ném / XEP_HANG_THAT_BAI / QUA_HAN_MUC / THIEU_GOC) ⇒ VẪN ok:true nhưng nói thẳng 'chưa gửi được', không bao giờ 'đã gửi'", async () => {
    const hanhVi: Array<[string, LuuDeps["guiEmail"]]> = [
      ["ném", async () => { throw new Error("queue sập to=an.gia@example.test"); }],
      ["XEP_HANG_THAT_BAI", async () => ({ ok: false, loi: "XEP_HANG_THAT_BAI" })],
      ["QUA_HAN_MUC", async () => ({ ok: false, loi: "QUA_HAN_MUC" })],
      ["THIEU_GOC", async () => ({ ok: false, loi: "THIEU_GOC" })],
    ];
    for (const [ten, g] of hanhVi) {
      const { store } = taoStore();
      const r = await luuKetQuaDisc(hop({ email: "an.gia@example.test" }), dep(store, undefined, "T", g));
      expect(r.ok, ten).toBe(true);
      if (r.ok) {
        expect(r.thongBao.email, ten).toMatch(/chưa gửi được/);
        expect(r.thongBao.email, ten).not.toMatch(/đã gửi thông tin kết quả/);
        expect(JSON.stringify(r), ten).not.toContain("an.gia@");
      }
    }
  });
  it("xếp hàng thành công / DA_GUI ⇒ lời 'sẽ gửi liên kết xác minh'; vẫn KHÔNG khẳng định đã gửi báo cáo", async () => {
    for (const kq of [{ ok: true as const }, { ok: false as const, loi: "DA_GUI" as const }]) {
      const { store } = taoStore();
      const r = await luuKetQuaDisc(hop({ email: "an.gia@example.test" }), dep(store, undefined, "T", async () => kq));
      expect(r.ok && r.thongBao.email).toMatch(/xác minh/);
      expect(r.ok && r.thongBao.email).not.toMatch(/đã gửi thông tin kết quả|chưa gửi được/);
    }
  });
  it("queue email lỗi KHÔNG làm mất lead/CRM và không lộ nội dung lỗi (scenario 11)", async () => {
    const { store } = taoStore();
    const crm = vi.fn(async () => ({ leadId: "L" }));
    const r = await luuKetQuaDisc(hop({ email: "an.gia@example.test" }), dep(store, crm, "T", async () => { throw new Error("smtp 84905123456"); }));
    expect(r.ok).toBe(true);
    expect(crm).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toMatch(/smtp|84905/);
  });
});
