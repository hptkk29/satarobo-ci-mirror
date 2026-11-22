import { describe, expect, it, vi } from "vitest";
import {
  BANG_MA_NHAN,
  DO_DAI_MA_NHAN,
  bam,
  bamMaNhan,
  bamPayload,
  choPhepTinDiemClient,
  chuanHoaMaNhan,
  hienThiMaNhan,
  luuKetQuaDisc,
  sinhMaNhan,
  type BanGhi,
  type CongCrm,
  type DiscStore,
  type HanhDongMa,
  type KetQuaGuiEmail,
  type LuuDeps,
} from "./luu";
import type { DiscEngine } from "./engine";
import { ipKeyTuIp, phoneKeyTuSdtChuan } from "./phone-key";

// ⚠️ TOÀN BỘ dữ liệu dưới đây là GIẢ (bịa cho test): không phải bộ đề hay thuật toán chấm DISC thật.
const NOW = new Date("2026-11-01T03:00:00Z");
const KHOA = "k".repeat(32);
const nguoi = { diem: { D: 40, I: 30, S: 20, C: 10 }, maBoDe: "PH", phienBanBoDe: "v1" };
const hop = (o: Record<string, unknown> = {}) => ({
  idempotencyKey: "khoa-ngau-nhien-0123456789",  // gitleaks:allow
  soDienThoai: "0905 123 456",
  email: null,
  dongY: { xuLyHoSo: true, tiepThi: false },
  phuHuynh: { hoTen: "Nguyễn Thị Mai", vaiTro: "ME", namSinh: 1988 },
  hocSinh: { hoTen: "Trần Bảo Minh", namSinh: 2016, bacHoc: "4" },
  ketQua: { engineVersion: "e1", phuHuynh: nguoi, hocSinh: { ...nguoi, maBoDe: "TH" } },
  ...o,
});
/** Đường THẬT: câu trả lời thô, không có điểm. */
const baiTho = (o: Record<string, unknown> = {}) => {
  const { ketQua: _bo, ...goc } = hop();
  void _bo;
  return {
    ...goc,
    bai: { phuHuynh: { maBoDe: "PH-GIA", traLoi: { q1: 3, q2: 4 } }, hocSinh: { maBoDe: "HS-GIA", traLoi: { q1: 1, q2: 2, q3: 3 } } },
    ...o,
  };
};

function engineGia(ghiDe: Partial<DiscEngine> = {}): DiscEngine {
  return {
    phienBan: "engine-GIA-1",
    chonBoDe: ({ vai }) => ({ ma: vai === "PH" ? "PH-GIA" : "HS-GIA", phienBan: "gia-1", doiTuong: vai === "PH" ? "PH" : "TH", nguoiLonTraLoiHo: false, cauHoi: [] }),
    layBoDe: () => null,
    cham: (ma, traLoi) => {
      const v = Object.values(traLoi);
      if (!v.length) return { ok: false, lyDo: "THIEU_CAU_TRA_LOI" };
      const tong = v.reduce((a, b) => a + b, 0);
      return { ok: true, ketQua: { diem: { D: tong, I: 1, S: 2, C: 3 }, maBoDe: ma, phienBanBoDe: "gia-1" } };
    },
    ...ghiDe,
  };
}

type Dong = BanGhi & { tokenHash: string; claimCodeHash: string | null; idempotencyKey: string; consentAt: Date; ipKey: string };
function taoStore() {
  const dong = new Map<string, Dong>();
  let dem = 0;
  const store: DiscStore = {
    taoHoacLayTheoKhoa: vi.fn(async (d) => {
      const co = dong.get(d.idempotencyKey);
      if (co) return { ban: co, taoMoi: false };
      const ban: Dong = {
        id: `s${++dem}`,
        phoneKey: d.phoneKey,
        emailStatus: d.emailStatus,
        emailTo: d.emailTo,
        claimStatus: "PENDING_CLAIM",
        payloadHash: d.payloadHash,
        deletedAt: null,
        retainUntil: d.retainUntil,
        tokenHash: d.tokenHash,
        claimCodeHash: d.claimCodeHash,
        idempotencyKey: d.idempotencyKey,
        consentAt: d.consentAt,
        ipKey: d.ipKey,
      };
      dong.set(d.idempotencyKey, ban);
      return { ban, taoMoi: true };
    }),
    // Giống store thật: ghi CÓ ĐIỀU KIỆN, trả false khi không dòng nào đổi.
    xoayTokenTai: vi.fn(async (id, h, _han, ma, now) => {
      for (const b of dong.values()) {
        if (b.id !== id) continue;
        if (b.claimStatus !== "PENDING_CLAIM" || b.deletedAt !== null || b.retainUntil.getTime() <= now.getTime()) return false;
        b.tokenHash = h;
        b.claimCodeHash = ma;
        return true;
      }
      return false;
    }),
    demTheoPhone: vi.fn(async (phoneKey, ipKey, tu, boQuaKhoa) => {
      const cung = [...dong.values()].filter((b) => b.phoneKey === phoneKey && b.consentAt >= tu && b.idempotencyKey !== boQuaKhoa);
      return { theoCap: cung.filter((b) => b.ipKey === ipKey).length, theoPhone: cung.length };
    }),
  };
  return { store, dong };
}
const crmOk = (): CongCrm => vi.fn(async () => ({ leadId: "L1" }));
/** Mặc định: thư xác minh xếp hàng được. Mỗi ca khác truyền `guiEmail` riêng. */
const guiEmailOk = () => vi.fn(async (_id: string, _now: Date): Promise<KetQuaGuiEmail> => ({ ok: true }));
/** Mặc định: KHÔNG engine + cổng thử nghiệm MỞ (để các ca cũ dùng điểm client giả vẫn chạy). */
const dep = (store: DiscStore, crm: CongCrm = crmOk(), them: Partial<LuuDeps> = {}): LuuDeps => ({
  store,
  crm,
  guiEmail: guiEmailOk(),
  nguonIp: "203.0.113.1",
  now: () => NOW,
  sinhToken: () => "TOKEN-A",
  sinhMa: () => "ABCDEFGHJK",
  khoaBam: () => KHOA,
  engine: () => null,
  choPhepTinDiemClient: () => true,
  ...them,
});
const lanGoiDau = (store: DiscStore) => (store.taoHoacLayTheoKhoa as ReturnType<typeof vi.fn>).mock.calls[0]![0];

describe("[DISC-LUU-01] lưu hợp lệ", () => {
  it("ok, chuẩn hoá SĐT, lưu HASH token (không lưu plaintext), PENDING mặc định", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop(), dep(store));
    expect(r.ok).toBe(true);
    const goi = lanGoiDau(store);
    // D2: phoneKey là HMAC của SĐT chuẩn hoá — KHÔNG phải SĐT, không phải sha256 trần.
    expect(goi.phoneKey).toBe(phoneKeyTuSdtChuan("84905123456", KHOA));
    expect(goi.phoneKey).not.toContain("905123456");
    expect(goi.phoneKey).not.toBe(bam("84905123456"));
    expect(goi.tokenHash).toBe(bam("TOKEN-A"));
    expect(JSON.stringify(goi)).not.toContain('"TOKEN-A"');
    expect(r.ok && r.tokenTai).toBe("TOKEN-A");
    expect(goi.nguoi.map((n: { role: string }) => n.role)).toEqual(["PARENT", "STUDENT"]);
  });
  it("hạn token ngắn (30 phút) và hạn giữ bài có đặt", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop(), dep(store));
    const goi = lanGoiDau(store);
    expect(goi.tokenHetHan.getTime() - NOW.getTime()).toBe(30 * 60_000);
    expect(goi.retainUntil.getTime()).toBeGreaterThan(NOW.getTime());
  });
  it("tiếp thị mặc định KHÔNG và chỉ true khi khách tích", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop(), dep(store));
    expect(lanGoiDau(store).tiepThi).toBe(false);
  });
});

describe("[DISC-LUU-02] từ chối trước khi ghi", () => {
  it.each([
    ["thiếu phụ huynh", { phuHuynh: undefined }, "THIEU_HO_SO"],
    ["thiếu học sinh", { hocSinh: undefined }, "THIEU_HO_SO"],
    ["SĐT sai", { soDienThoai: "12345" }, "DU_LIEU_KHONG_HOP_LE"],
    ["email sai cú pháp", { email: "khong-phai-email" }, "DU_LIEU_KHONG_HOP_LE"],
    ["chưa đồng ý xử lý hồ sơ", { dongY: { xuLyHoSo: false, tiepThi: false } }, "DU_LIEU_KHONG_HOP_LE"],
    ["khoá idempotency quá ngắn", { idempotencyKey: "abc" }, "DU_LIEU_KHONG_HOP_LE"],
    ["khoá idempotency 21 ký tự (dưới 22)", { idempotencyKey: "a".repeat(21) }, "DU_LIEU_KHONG_HOP_LE"],
    ["khoá idempotency có ký tự ngoài base64url", { idempotencyKey: "khoa ngau nhien 0123456789" }, "DU_LIEU_KHONG_HOP_LE"],
    ["khoá idempotency 21 ký tự (dưới 22)", { idempotencyKey: "a".repeat(21) }, "DU_LIEU_KHONG_HOP_LE"],
    ["khoá idempotency có ký tự ngoài base64url", { idempotencyKey: "khoa ngau nhien 0123456789" }, "DU_LIEU_KHONG_HOP_LE"],
  ])("%s ⇒ không gọi store", async (_t, patch, loi) => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop(patch), dep(store));
    expect(r).toMatchObject({ ok: false, loi });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("điểm ngoài 0–100 bị chặn (không tin client)", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop({ ketQua: { engineVersion: "e1", phuHuynh: { ...nguoi, diem: { D: 400, I: 0, S: 0, C: 0 } }, hocSinh: nguoi } }), dep(store));
    expect(r.ok).toBe(false);
  });
});

describe("[DISC-LUU-03] idempotent: bấm lặp = MỘT dòng, MỘT lead", () => {
  it("lượt 2 cùng khoá không tạo mới, không gọi CRM lần nữa, vẫn cấp token mới", async () => {
    const { store } = taoStore();
    const crm = crmOk();
    const r1 = await luuKetQuaDisc(hop(), { ...dep(store, crm), sinhToken: () => "T1" });
    const r2 = await luuKetQuaDisc(hop(), { ...dep(store, crm), sinhToken: () => "T2" });
    expect(r1.ok && r2.ok).toBe(true);
    expect(r1.ok && r2.ok && r1.submissionId).toBe(r2.ok && r2.submissionId);
    expect(crm).toHaveBeenCalledTimes(1);
    expect(r2.ok && r2.tokenTai).toBe("T2");
  });
  it("cùng khoá nhưng SĐT KHÁC ⇒ không cấp token (khoá không mượn được cho số khác)", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop(), dep(store));
    const r = await luuKetQuaDisc(hop({ soDienThoai: "0912345678" }), dep(store));
    expect(r.ok).toBe(false);
  });
});

describe("[DISC-LUU-04] lỗi hạ tầng không được báo đã lưu", () => {
  it("store ném ⇒ ok:false LUU_THAT_BAI, không có token, không CRM", async () => {
    const { store } = taoStore();
    (store.taoHoacLayTheoKhoa as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
    const crm = crmOk();
    const r = await luuKetQuaDisc(hop(), dep(store, crm));
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(crm).not.toHaveBeenCalled();
  });
  it("CRM ném ⇒ vẫn ok (dữ liệu đã an toàn)", async () => {
    const { store } = taoStore();
    const crm: CongCrm = vi.fn(async () => {
      throw new Error("crm down");
    });
    expect((await luuKetQuaDisc(hop(), dep(store, crm))).ok).toBe(true);
  });
});

describe("[DISC-LUU-05] email", () => {
  it("không email ⇒ NONE và thông báo không nhắc email", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop(), dep(store));
    expect(r.ok && r.thongBao.email).toBeNull();
  });
  it("có email ⇒ VERIFICATION_REQUIRED (không bao giờ SENT/QUEUED ở bước lưu)", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop({ email: "an@gmail.com" }), dep(store));
    expect(lanGoiDau(store).emailStatus).toBe("VERIFICATION_REQUIRED");
    expect(r.ok && r.thongBao.email).toMatch(/xác minh/);
  });
});

describe("[DISC-EMAIL-01] gửi liên kết xác minh + thông báo TRUNG THỰC theo kết quả thật", () => {
  const AN = "an@gmail.com";
  const emailCua = (r: Awaited<ReturnType<typeof luuKetQuaDisc>>) => (r.ok ? r.thongBao.email : null);

  it("không email ⇒ KHÔNG gọi guiEmail (không có gì để xác minh)", async () => {
    const { store } = taoStore();
    const gui = guiEmailOk();
    const r = await luuKetQuaDisc(hop(), dep(store, crmOk(), { guiEmail: gui }));
    expect(r.ok).toBe(true);
    expect(gui).not.toHaveBeenCalled();
  });
  it("có email + xếp được ⇒ gọi guiEmail ĐÚNG MỘT lần với id bài vừa tạo và `now` tiêm vào; nói 'sẽ gửi liên kết xác minh'", async () => {
    const { store } = taoStore();
    const gui = guiEmailOk();
    const r = await luuKetQuaDisc(hop({ email: AN }), dep(store, crmOk(), { guiEmail: gui }));
    expect(gui).toHaveBeenCalledTimes(1);
    expect(gui).toHaveBeenCalledWith(r.ok && r.submissionId, NOW);
    expect(emailCua(r)).toMatch(/sẽ gửi liên kết xác minh/);
    expect(emailCua(r)).not.toMatch(/đã gửi/);
    expect(emailCua(r)).toContain("a***@gmail.com");
    expect(emailCua(r)).not.toContain(AN);
  });
  it.each([
    ["vượt hạn mức", { ok: false, loi: "QUA_HAN_MUC" }],
    ["xếp hàng thất bại", { ok: false, loi: "XEP_HANG_THAT_BAI" }],
    ["thiếu gốc URL ứng dụng", { ok: false, loi: "THIEU_GOC" }],
    ["trạng thái không cần xác minh (bất thường ngay sau khi tạo)", { ok: false, loi: "KHONG_CAN" }],
  ] as Array<[string, KetQuaGuiEmail]>)("có email + %s ⇒ nói thẳng 'chưa gửi được liên kết xác minh', vẫn ok:true, không hứa gửi", async (_t, kq) => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop({ email: AN }), dep(store, crmOk(), { guiEmail: vi.fn(async () => kq) }));
    expect(r.ok).toBe(true);
    const e = emailCua(r)!;
    expect(e).toMatch(/chưa gửi được liên kết xác minh/);
    expect(e).toMatch(/vẫn tải được kết quả/);
    expect(e).not.toMatch(/sẽ gửi/);
    expect(e).not.toMatch(/đã gửi/);
    expect(e).not.toContain(AN);
  });
  it("guiEmail NÉM ⇒ vẫn lưu xong (ok:true) và nói 'chưa gửi được' — lưu dữ liệu không phụ thuộc email", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(
      hop({ email: AN }),
      dep(store, crmOk(), {
        guiEmail: vi.fn(async () => {
          throw new Error("smtp boom an@gmail.com");
        }),
      }),
    );
    expect(r.ok).toBe(true);
    expect(emailCua(r)).toMatch(/chưa gửi được liên kết xác minh/);
    expect(JSON.stringify(r)).not.toContain("boom");
  });
  it("token còn hạn (DA_GUI) ⇒ coi là đã xếp trước đó: vẫn 'sẽ gửi liên kết', không hứa thêm thư", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop({ email: AN }), dep(store, crmOk(), { guiEmail: vi.fn(async (): Promise<KetQuaGuiEmail> => ({ ok: false, loi: "DA_GUI" })) }));
    expect(emailCua(r)).toMatch(/sẽ gửi liên kết xác minh/);
  });
  it("không câu nào, ở bất kỳ nhánh nào, khẳng định đã gửi BÁO CÁO", async () => {
    const nhanh: KetQuaGuiEmail[] = [{ ok: true }, { ok: false, loi: "QUA_HAN_MUC" }, { ok: false, loi: "THIEU_GOC" }, { ok: false, loi: "DA_GUI" }];
    for (const kq of nhanh) {
      const { store } = taoStore();
      const r = await luuKetQuaDisc(hop({ email: AN }), dep(store, crmOk(), { guiEmail: vi.fn(async () => kq) }));
      expect(emailCua(r)).not.toMatch(/đã gửi/);
    }
  });
  it("thư xếp hàng thất bại ⇒ dữ liệu bài KHÔNG bị đổi sang FAILED/QUEUED ở bước lưu (trạng thái vẫn VERIFICATION_REQUIRED để gửi lại được)", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop({ email: AN }), dep(store, crmOk(), { guiEmail: vi.fn(async (): Promise<KetQuaGuiEmail> => ({ ok: false, loi: "XEP_HANG_THAT_BAI" })) }));
    expect(lanGoiDau(store).emailStatus).toBe("VERIFICATION_REQUIRED");
  });
  it("phát lại hợp lệ: gọi lại guiEmail (chống trùng nằm ở guiLinkXacMinh) và lời thông báo theo kết quả của LƯỢT NÀY", async () => {
    const { store } = taoStore();
    const gui = vi.fn(async (): Promise<KetQuaGuiEmail> => ({ ok: true }));
    await luuKetQuaDisc(hop({ email: AN }), dep(store, crmOk(), { guiEmail: gui }));
    const r2 = await luuKetQuaDisc(hop({ email: AN }), dep(store, crmOk(), { guiEmail: vi.fn(async (): Promise<KetQuaGuiEmail> => ({ ok: false, loi: "QUA_HAN_MUC" })) }));
    expect(gui).toHaveBeenCalledTimes(1);
    expect(emailCua(r2)).toMatch(/chưa gửi được liên kết xác minh/);
  });
  it("phát lại BỊ TỪ CHỐI (nội dung khác) ⇒ KHÔNG gọi guiEmail", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop({ email: AN }), dep(store));
    const gui = guiEmailOk();
    const r = await luuKetQuaDisc(hop({ email: AN, hocSinh: { hoTen: "Trần Bảo Khác", namSinh: 2016, bacHoc: "4" } }), dep(store, crmOk(), { guiEmail: gui }));
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(gui).not.toHaveBeenCalled();
  });
  it("lưu thất bại / từ chối trước khi ghi ⇒ KHÔNG gọi guiEmail", async () => {
    const { store } = taoStore();
    const gui = guiEmailOk();
    expect((await luuKetQuaDisc(hop({ email: AN, soDienThoai: "123" }), dep(store, crmOk(), { guiEmail: gui }))).ok).toBe(false);
    (store.taoHoacLayTheoKhoa as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
    expect(await luuKetQuaDisc(hop({ email: AN }), dep(store, crmOk(), { guiEmail: gui }))).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(gui).not.toHaveBeenCalled();
  });
});

describe("[DISC-CRM-CONTRACT] hợp đồng CongCrm: không tên con / điểm / năm sinh (F-13)", () => {
  it("CRM nhận ĐÚNG tập trường liên hệ của người lớn + cờ + chiến dịch", async () => {
    const { store } = taoStore();
    const crm = crmOk();
    await luuKetQuaDisc(hop({ email: "an@gmail.com" }), dep(store, crm));
    const d = (crm as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(Object.keys(d).sort()).toEqual(["chienDich", "diaChi", "email", "soDienThoai", "submissionId", "tenPhuHuynh", "tiepThi"]);
    expect(JSON.stringify(d)).not.toMatch(/Bảo Minh|2016|"diem"|bacHoc/);
  });
});

describe("[DISC-DIACHI] địa chỉ nơi ở của phụ huynh (05/11/2026)", () => {
  const diaChi = { thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: "  12  Lê Duẩn ", coSoGanNha: "CS2" };
  it("hợp lệ ⇒ đến CRM đã làm sạch (một khoảng trắng, bỏ rìa); không khai (máy khách cũ) ⇒ null, vẫn LƯU ĐƯỢC", async () => {
    const a = taoStore();
    const crmA = crmOk();
    expect((await luuKetQuaDisc(hop({ diaChi }), dep(a.store, crmA))).ok).toBe(true);
    expect((crmA as ReturnType<typeof vi.fn>).mock.calls[0]![0].diaChi).toEqual({ thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: "12 Lê Duẩn", coSoGanNha: "CS2" });
    const b = taoStore();
    const crmB = crmOk();
    expect((await luuKetQuaDisc(hop(), dep(b.store, crmB))).ok).toBe(true);
    expect((crmB as ReturnType<typeof vi.fn>).mock.calls[0]![0].diaChi).toBeNull();
  });
  it.each([
    ["phường không có trong thành phố", { ...diaChi, phuong: "Phường Không Có" }],
    ["thành phố lạ", { ...diaChi, thanhPho: "Tp Không Có" }],
    ["phường để trống", { ...diaChi, phuong: "" }],
    ["cơ sở chọn tay không tồn tại", { ...diaChi, coSoGanNha: "CS99" }],
  ])("%s ⇒ từ chối TRƯỚC mọi phép ghi (không tạo bài, không gọi CRM)", async (_ten, sai) => {
    const { store } = taoStore();
    const crm = crmOk();
    const r = await luuKetQuaDisc(hop({ diaChi: sai }), dep(store, crm));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toBe("DU_LIEU_KHONG_HOP_LE");
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(crm).not.toHaveBeenCalled();
  });
});

describe("[DISC-LUU-06] không dò SĐT (P0.4)", () => {
  it("phản hồi cùng hình cho hai SĐT khác nhau (cùng câu chính)", async () => {
    const a = taoStore();
    const b = taoStore();
    const r1 = await luuKetQuaDisc(hop(), dep(a.store));
    const r2 = await luuKetQuaDisc(hop({ soDienThoai: "0912345678", idempotencyKey: "khoa-khac-0123456789ab" }), dep(b.store));  // gitleaks:allow
    expect(r1.ok && r2.ok && r1.thongBao.chinh).toBe(r2.ok && r2.thongBao.chinh);
  });
});

describe("[DISC-CHAM-01] chống tin điểm client", () => {
  it("chưa có engine + cổng thử nghiệm TẮT ⇒ ENGINE_CHUA_SAN_SANG, không gọi store/CRM (kể cả khi client gửi điểm)", async () => {
    const { store } = taoStore();
    const crm = crmOk();
    for (const payload of [hop(), baiTho()]) {
      const r = await luuKetQuaDisc(payload, dep(store, crm, { engine: () => null, choPhepTinDiemClient: () => false }));
      expect(r).toEqual({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" });
    }
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(crm).not.toHaveBeenCalled();
  });
  it("chưa có engine + cổng MỞ nhưng chỉ có câu trả lời thô (không có điểm) ⇒ vẫn ENGINE_CHUA_SAN_SANG", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(baiTho(), dep(store, crmOk(), { engine: () => null, choPhepTinDiemClient: () => true }));
    expect(r).toEqual({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("có engine ⇒ server TỰ CHẤM và BỎ QUA điểm client (kể cả khi cổng thử nghiệm mở)", async () => {
    const { store } = taoStore();
    const dienGian = hop({ ketQua: { engineVersion: "client-noi-bua", phuHuynh: { ...nguoi, diem: { D: 99, I: 99, S: 99, C: 99 } }, hocSinh: { ...nguoi, diem: { D: 99, I: 99, S: 99, C: 99 } } } });
    const r = await luuKetQuaDisc({ ...dienGian, bai: baiTho().bai }, dep(store, crmOk(), { engine: () => engineGia(), choPhepTinDiemClient: () => true }));
    expect(r.ok).toBe(true);
    const goi = lanGoiDau(store);
    expect(goi.engineVersion).toBe("engine-GIA-1");
    expect(goi.nguoi[0].ketQua.diem.D).toBe(7); // 3 + 4, do SERVER cộng
    expect(goi.nguoi[1].ketQua.diem.D).toBe(6); // 1 + 2 + 3
    expect(JSON.stringify(goi)).not.toContain("client-noi-bua");
    // Chỉ soi phần điểm (các trường băm hex có thể chứa "99" ngẫu nhiên).
    expect(JSON.stringify(goi.nguoi)).not.toContain("99");
  });
  it("có engine nhưng chỉ có điểm client, không có câu trả lời ⇒ từ chối, không ghi", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop(), dep(store, crmOk(), { engine: () => engineGia() }));
    expect(r).toMatchObject({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("mã bộ đề client gửi không khớp bộ đề server chọn theo hồ sơ ⇒ từ chối", async () => {
    const { store } = taoStore();
    const sai = baiTho({ bai: { phuHuynh: { maBoDe: "PH-GIA", traLoi: { q1: 1 } }, hocSinh: { maBoDe: "BO-DE-LA", traLoi: { q1: 1 } } } });
    const r = await luuKetQuaDisc(sai, dep(store, crmOk(), { engine: () => engineGia() }));
    expect(r).toMatchObject({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("engine từ chối câu trả lời (thiếu/không hợp lệ) ⇒ DU_LIEU_KHONG_HOP_LE, nêu đúng trường", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(baiTho(), dep(store, crmOk(), { engine: () => engineGia({ cham: () => ({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" }) }) }));
    expect(r).toMatchObject({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" });
    expect(!r.ok && r.chiTiet?.map((c) => c.truong)).toEqual(["bai.phuHuynh.traLoi", "bai.hocSinh.traLoi"]);
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("engine trả điểm ngoài 0–100 ⇒ lỗi phía server (LUU_THAT_BAI), không ghi", async () => {
    const { store } = taoStore();
    const hong = engineGia({ cham: (ma) => ({ ok: true, ketQua: { diem: { D: 500, I: 0, S: 0, C: 0 }, maBoDe: ma, phienBanBoDe: "x" } }) });
    const r = await luuKetQuaDisc(baiTho(), dep(store, crmOk(), { engine: () => hong }));
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("câu trả lời thô không hợp lệ (rỗng / không phải số / quá nhiều) bị chặn ở lược đồ", async () => {
    const { store } = taoStore();
    const nhieu = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`q${i}`, 1]));
    for (const traLoi of [{}, { q1: "3" }, { q1: Number.POSITIVE_INFINITY }, nhieu]) {
      const r = await luuKetQuaDisc(baiTho({ bai: { phuHuynh: { maBoDe: "PH-GIA", traLoi }, hocSinh: baiTho().bai.hocSinh } }), dep(store, crmOk(), { engine: () => engineGia() }));
      expect(r).toMatchObject({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" });
    }
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
});

describe("[DISC-CHAM-02] cổng thử nghiệm tin điểm client", () => {
  const bat = { DISC_TEST_TRUST_CLIENT_SCORES: "true", NODE_ENV: "test" };
  it("mặc định TẮT", () => {
    expect(choPhepTinDiemClient({})).toBe(false);
    expect(choPhepTinDiemClient({ NODE_ENV: "test" })).toBe(false);
  });
  it("chỉ mở khi đúng chuỗi 'true' ngoài production", () => {
    expect(choPhepTinDiemClient(bat)).toBe(true);
    for (const v of ["1", "TRUE", "yes", ""]) expect(choPhepTinDiemClient({ ...bat, DISC_TEST_TRUST_CLIENT_SCORES: v })).toBe(false);
  });
  it("production ⇒ TẮT dù biến bị đặt nhầm (NODE_ENV hoặc nền tảng production)", () => {
    expect(choPhepTinDiemClient({ ...bat, NODE_ENV: "production" })).toBe(false);
    expect(choPhepTinDiemClient({ ...bat, VERCEL_ENV: "production" })).toBe(false);
    // `laProductionThat` coi NODE_ENV=production + CI là KHÔNG phải prod thật — cổng này vẫn phải TẮT.
    expect(choPhepTinDiemClient({ ...bat, NODE_ENV: "production", CI: "true" })).toBe(false);
  });
  it("nhánh mặc định của dịch vụ đọc cổng thật: không truyền deps ⇒ điểm client bị từ chối", async () => {
    const { store } = taoStore();
    const d = dep(store);
    delete d.choPhepTinDiemClient;
    const truoc = process.env.DISC_TEST_TRUST_CLIENT_SCORES;
    delete process.env.DISC_TEST_TRUST_CLIENT_SCORES;
    try {
      expect(await luuKetQuaDisc(hop(), d)).toEqual({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" });
    } finally {
      if (truoc !== undefined) process.env.DISC_TEST_TRUST_CLIENT_SCORES = truoc;
    }
  });
});

describe("[DISC-MA-01] mã nhận (claim code)", () => {
  it("bảng 32 ký tự, KHÔNG có 0/O/1/I, đủ ≥ 50 bit (10 ký tự × 5 bit)", () => {
    expect(BANG_MA_NHAN).toHaveLength(32);
    expect(new Set(BANG_MA_NHAN).size).toBe(32);
    for (const c of "01OI") expect(BANG_MA_NHAN).not.toContain(c);
    expect(Math.log2(BANG_MA_NHAN.length) * DO_DAI_MA_NHAN).toBeGreaterThanOrEqual(50);
  });
  it("sinh đúng độ dài/bảng chữ; không lệch phân phối (byte & 31); hai lần sinh khác nhau", () => {
    const a = sinhMaNhan();
    expect(a).toMatch(/^[2-9A-HJ-NP-Z]{10}$/);
    expect(sinhMaNhan(() => Uint8Array.from([0, 1, 31, 32, 33, 255, 128, 64, 7, 8]))).toBe("23Z23Z229A"); // byte & 31: 0,1,31,0,1,31,0,0,7,8
    expect(new Set(Array.from({ length: 50 }, () => sinhMaNhan())).size).toBe(50);
  });
  it("chuẩn hoá: bỏ khoảng trắng/gạch, hoa thường; sai độ dài hoặc ký tự cấm ⇒ null", () => {
    expect(chuanHoaMaNhan("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(chuanHoaMaNhan(" ABCDE FGHJK ")).toBe("ABCDEFGHJK");
    expect(chuanHoaMaNhan("ABCDEFGHJ")).toBeNull();
    expect(chuanHoaMaNhan("ABCDEFGHJ0")).toBeNull();
    expect(chuanHoaMaNhan("ABCDEFGHJI")).toBeNull();
    expect(chuanHoaMaNhan(12345)).toBeNull();
    expect(hienThiMaNhan("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });
  it("HMAC phụ thuộc khoá và mã; tất định", () => {
    expect(bamMaNhan("ABCDEFGHJK", KHOA)).toBe(bamMaNhan("ABCDEFGHJK", KHOA));
    expect(bamMaNhan("ABCDEFGHJK", KHOA)).not.toBe(bamMaNhan("ABCDEFGHJL", KHOA));
    expect(bamMaNhan("ABCDEFGHJK", KHOA)).not.toBe(bamMaNhan("ABCDEFGHJK", "z".repeat(32)));
    expect(bamMaNhan("ABCDEFGHJK", KHOA)).not.toBe(bam("ABCDEFGHJK"));
  });
  it("lưu: trả mã plaintext MỘT lần, store chỉ nhận HASH", async () => {
    const { store } = taoStore();
    const r = await luuKetQuaDisc(hop(), dep(store));
    expect(r.ok && r.maNhan).toBe("ABCDEFGHJK");
    const goi = lanGoiDau(store);
    expect(goi.claimCodeHash).toBe(bamMaNhan("ABCDEFGHJK", KHOA));
    expect(JSON.stringify(goi)).not.toContain("ABCDEFGHJK");
  });
  it("phát lại cùng khoá khi còn chờ nhận ⇒ mã MỚI, hash mới được ghi", async () => {
    const { store } = taoStore();
    await luuKetQuaDisc(hop(), { ...dep(store), sinhMa: () => "AAAAAAAAAA" });
    const r2 = await luuKetQuaDisc(hop(), { ...dep(store), sinhMa: () => "BBBBBBBBBB" });
    expect(r2.ok && r2.maNhan).toBe("BBBBBBBBBB");
    expect((store.xoayTokenTai as ReturnType<typeof vi.fn>).mock.calls[0]![3]).toBe(bamMaNhan("BBBBBBBBBB", KHOA));
  });
  it("phát lại khi bài đã được NHẬN ⇒ từ chối chung, KHÔNG xoay token/mã (F-01)", async () => {
    const { store, dong } = taoStore();
    await luuKetQuaDisc(hop(), dep(store));
    dong.get("khoa-ngau-nhien-0123456789")!.claimStatus = "CLAIMED";
    expect(await luuKetQuaDisc(hop(), dep(store))).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(store.xoayTokenTai).not.toHaveBeenCalled();
  });
  it("phát lại khi bài đã hết hạn/bị xoá ⇒ từ chối, không cấp token", async () => {
    for (const st of ["EXPIRED", "REVOKED"] as const) {
      const { store, dong } = taoStore();
      await luuKetQuaDisc(hop(), dep(store));
      dong.get("khoa-ngau-nhien-0123456789")!.claimStatus = st;
      expect(await luuKetQuaDisc(hop(), dep(store))).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
      expect(store.xoayTokenTai).not.toHaveBeenCalled();
    }
  });
});

describe("[DISC-MA-02] đường nhận bằng MÃ TRẦN đã gỡ — nhận bài chỉ còn ở nhan.ts (có thách đố năm sinh)", () => {
  it("luu.ts không còn export nhanBaiBangMa; HanhDongMa chỉ còn XOA", async () => {
    const mod = (await import("./luu")) as Record<string, unknown>;
    expect(mod.nhanBaiBangMa).toBeUndefined();
    const hd: HanhDongMa = { loai: "XOA" };
    expect(hd.loai).toBe("XOA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Các cổng bảo mật bổ sung (rà soát độc lập F-01…F-16, quyết định D1/D2)
// ─────────────────────────────────────────────────────────────────────────────
const KEY = "khoa-ngau-nhien-0123456789";  // gitleaks:allow
const luu = (store: DiscStore, raw: unknown = baiTho(), them: Partial<LuuDeps> = {}, crm: CongCrm = crmOk()) =>
  luuKetQuaDisc(raw, dep(store, crm, { engine: () => engineGia(), choPhepTinDiemClient: () => false, ...them }));

describe("[DISC-REPLAY-01] phát lại chỉ hợp lệ khi bản ghi còn sống VÀ payload y hệt (F-01/F-02)", () => {
  it.each([
    ["đã nhận", (b: { claimStatus: string }) => (b.claimStatus = "CLAIMED")],
    ["đã hết hạn", (b: { claimStatus: string }) => (b.claimStatus = "EXPIRED")],
    ["đã thu hồi", (b: { claimStatus: string }) => (b.claimStatus = "REVOKED")],
    ["đã đánh dấu xoá", (b: { deletedAt: Date | null }) => (b.deletedAt = NOW)],
    ["quá retainUntil", (b: { retainUntil: Date }) => (b.retainUntil = new Date(NOW.getTime() - 1))],
  ])("bản ghi %s ⇒ LUU_THAT_BAI, không xoay token, không lộ token/mã mới", async (_t, hong) => {
    const { store, dong } = taoStore();
    await luu(store);
    hong(dong.get(KEY) as never);
    const r = await luu(store, baiTho(), { sinhToken: () => "TOKEN-MOI", sinhMa: () => "ZZZZZZZZZZ" });
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(JSON.stringify(r)).not.toContain("TOKEN-MOI");
    expect(store.xoayTokenTai).not.toHaveBeenCalled();
  });
  it("cùng khoá + cùng SĐT nhưng NỘI DUNG khác (tên con / câu trả lời / tiếp thị / email) ⇒ từ chối, không xoay", async () => {
    const khac: Array<Record<string, unknown>> = [
      { hocSinh: { hoTen: "Trần Bảo Khác", namSinh: 2016, bacHoc: "4" } },
      { bai: { phuHuynh: { maBoDe: "PH-GIA", traLoi: { q1: 3, q2: 5 } }, hocSinh: baiTho().bai.hocSinh } },
      { dongY: { xuLyHoSo: true, tiepThi: true } },
      { email: "an@gmail.com" },
    ];
    for (const patch of khac) {
      const { store } = taoStore();
      await luu(store);
      expect(await luu(store, baiTho(patch))).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
      expect(store.xoayTokenTai).not.toHaveBeenCalled();
    }
  });
  it("replay đúng nội dung nhưng khác THỨ TỰ khoá / khoảng trắng đầu-cuối tên ⇒ vẫn hợp lệ (hash chuẩn hoá)", async () => {
    const { store } = taoStore();
    await luu(store);
    const dao = baiTho({
      hocSinh: { bacHoc: "4", namSinh: 2016, hoTen: "  Trần Bảo Minh  " },
      bai: { hocSinh: { traLoi: { q3: 3, q2: 2, q1: 1 }, maBoDe: "HS-GIA" }, phuHuynh: { traLoi: { q2: 4, q1: 3 }, maBoDe: "PH-GIA" } },
    });
    const r = await luu(store, dao, { sinhToken: () => "T2", sinhMa: () => "BBBBBBBBBB" });
    expect(r.ok && r.tokenTai).toBe("T2");
    expect(store.xoayTokenTai).toHaveBeenCalledTimes(1);
  });
  it("đua: xoayTokenTai trả false (bài đổi trạng thái giữa hai bước) ⇒ LUU_THAT_BAI, không lộ token", async () => {
    const { store } = taoStore();
    await luu(store);
    (store.xoayTokenTai as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const r = await luu(store, baiTho(), { sinhToken: () => "TOKEN-MOI" });
    expect(r).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(JSON.stringify(r)).not.toContain("TOKEN-MOI");
  });
  it("replay hợp lệ KHÔNG gọi CRM lần nữa và hash mã mới được ghi", async () => {
    const { store, dong } = taoStore();
    const crm = crmOk();
    await luu(store, baiTho(), {}, crm);
    const r = await luu(store, baiTho(), { sinhMa: () => "CCCCCCCCCC", sinhToken: () => "T9" }, crm);
    expect(r.ok && r.maNhan).toBe("CCCCCCCCCC");
    expect(crm).toHaveBeenCalledTimes(1);
    expect(dong.get(KEY)!.claimCodeHash).toBe(bamMaNhan("CCCCCCCCCC", KHOA));
  });
  it("payloadHash có khoá (không phải sha256 trần) và không phụ thuộc thứ tự khoá", () => {
    const x = { a: 1 };
    expect(bamPayload(x, KHOA)).not.toBe(bamPayload(x, "z".repeat(32)));
    expect(bamPayload(x, KHOA)).not.toBe(bam(JSON.stringify(x)));
    expect(bamPayload({ a: 1, b: 2 }, KHOA)).toBe(bamPayload({ b: 2, a: 1 }, KHOA));
  });
});

describe("[DISC-RAW-01] câu trả lời thô KHÔNG nằm trong thứ store/CRM nhận (D1)", () => {
  it("id câu + giá trị đặc trưng chỉ tồn tại trong request, không lọt vào bất kỳ đối số store/CRM nào", async () => {
    const { store } = taoStore();
    const crm = crmOk();
    const raw = baiTho({
      bai: {
        phuHuynh: { maBoDe: "PH-GIA", traLoi: { "cau-GIA-zq7": 7.25, "cau-GIA-zq8": 2.5 } },
        hocSinh: { maBoDe: "HS-GIA", traLoi: { "cau-GIA-hs1": 0.75, "cau-GIA-hs2": 0.5 } },
      },
    });
    const r = await luu(store, raw, {}, crm);
    expect(r.ok).toBe(true);
    const moi = JSON.stringify([
      ...(store.taoHoacLayTheoKhoa as ReturnType<typeof vi.fn>).mock.calls,
      ...(store.xoayTokenTai as ReturnType<typeof vi.fn>).mock.calls,
      ...(store.demTheoPhone as ReturnType<typeof vi.fn>).mock.calls,
      ...(crm as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    for (const dau of ["cau-GIA-zq7", "cau-GIA-zq8", "cau-GIA-hs1", "7.25", "0.75", "traLoi"]) expect(moi).not.toContain(dau);
    expect(moi).toContain('"diem"'); // điểm đã chấm vẫn đi qua — để chắc ca không xanh vì mảng rỗng
  });
});

describe("[DISC-F05] không có văn bản tự do; một nguồn lưu kết quả", () => {
  it("`tomTat` do client gửi (đường thử nghiệm) bị bỏ, store không bao giờ nhận", async () => {
    const { store } = taoStore();
    const doc = hop({ ketQua: { engineVersion: "e1", phuHuynh: { ...nguoi, tomTat: "TOMTAT-LAT-A" }, hocSinh: { ...nguoi, tomTat: '{"traLoi":{"q1":3}}' } } });
    expect((await luuKetQuaDisc(doc, dep(store))).ok).toBe(true);
    const goi = JSON.stringify(lanGoiDau(store));
    expect(goi).not.toContain("TOMTAT-LAT-A");
    expect(goi).not.toContain("traLoi");
  });
  it("engine trả `tomTat` ⇒ cũng bị lược (chỉ điểm + mã/phiên bản bộ đề)", async () => {
    const { store } = taoStore();
    const engine = engineGia({ cham: (ma) => ({ ok: true, ketQua: { diem: { D: 1, I: 1, S: 1, C: 1 }, maBoDe: ma, phienBanBoDe: "g", tomTat: "DIEN-GIAI-LAT" } }) });
    await luu(store, baiTho(), { engine: () => engine });
    expect(JSON.stringify(lanGoiDau(store))).not.toContain("DIEN-GIAI-LAT");
  });
  it("store nhận KẾT QUẢ ở `nguoi[].ketQua` và KHÔNG có đối số `reportSnapshot`", async () => {
    const { store } = taoStore();
    await luu(store);
    const goi = lanGoiDau(store);
    expect(goi).not.toHaveProperty("reportSnapshot");
    expect(goi.nguoi[0].ketQua.diem.D).toBe(7);
  });
});

describe("[DISC-PK-01] phoneKey = HMAC; SĐT thô chỉ đi vào CRM trong bộ nhớ (D2)", () => {
  it("store không bao giờ thấy SĐT (thô hay chuẩn hoá); CRM nhận `soDienThoai` chuẩn hoá và KHÔNG có trường phoneKey", async () => {
    const { store } = taoStore();
    const crm = crmOk();
    await luu(store, baiTho(), {}, crm);
    const doStore = JSON.stringify((store.taoHoacLayTheoKhoa as ReturnType<typeof vi.fn>).mock.calls);
    expect(doStore).not.toContain("0905");
    expect(doStore).not.toContain("84905123456");
    const doCrm = (crm as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(doCrm.soDienThoai).toBe("84905123456");
    expect(doCrm).not.toHaveProperty("phoneKey");
  });
  it("hai SĐT khác nhau ⇒ phoneKey khác; cùng SĐT khác dạng gõ ⇒ CÙNG phoneKey", async () => {
    const a = taoStore();
    const b = taoStore();
    const c = taoStore();
    await luu(a.store, baiTho({ soDienThoai: "0905123456" }));
    await luu(b.store, baiTho({ soDienThoai: "+84 905 123 456" }));
    await luu(c.store, baiTho({ soDienThoai: "0912345678" }));
    expect(lanGoiDau(a.store).phoneKey).toBe(lanGoiDau(b.store).phoneKey);
    expect(lanGoiDau(a.store).phoneKey).not.toBe(lanGoiDau(c.store).phoneKey);
  });
});

describe("[DISC-CAP-01] trần bài mới ở tầng dịch vụ (F-03, N6: theo cặp SĐT+IP và trần cứng theo SĐT)", () => {
  const dem = (store: DiscStore) => store.demTheoPhone as ReturnType<typeof vi.fn>;
  it("cặp (SĐT, IP) đủ trần ⇒ QUA_NHIEU_YEU_CAU, KHÔNG tạo dòng, KHÔNG gọi CRM", async () => {
    const { store } = taoStore();
    dem(store).mockResolvedValueOnce({ theoCap: 5, theoPhone: 5 });
    const crm = crmOk();
    expect(await luu(store, baiTho(), {}, crm)).toEqual({ ok: false, loi: "QUA_NHIEU_YEU_CAU" });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(crm).not.toHaveBeenCalled();
  });
  it("[N6] trần CỨNG theo SĐT (30, mọi IP) ⇒ LUU_THAT_BAI — Y HỆT lỗi lưu chung, không phải QUA_NHIEU_YEU_CAU", async () => {
    const { store } = taoStore();
    dem(store).mockResolvedValueOnce({ theoCap: 0, theoPhone: 30 });
    const crm = crmOk();
    expect(await luu(store, baiTho(), {}, crm)).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
    expect(crm).not.toHaveBeenCalled();
    // biên: 29 bài ở nhiều IP vẫn lưu được
    dem(store).mockResolvedValueOnce({ theoCap: 0, theoPhone: 29 });
    expect((await luu(store)).ok).toBe(true);
  });
  it("dưới trần (cặp 4) ⇒ lưu bình thường; cửa sổ 24h tính từ `now` tiêm, loại chính khoá đang lưu, và đếm theo ipKey HMAC", async () => {
    const { store } = taoStore();
    dem(store).mockResolvedValueOnce({ theoCap: 4, theoPhone: 4 });
    expect((await luu(store)).ok).toBe(true);
    const [pk, ik, tu, boQua] = dem(store).mock.calls[0]!;
    expect(pk).toBe(phoneKeyTuSdtChuan("84905123456", KHOA));
    expect(ik).toBe(ipKeyTuIp("203.0.113.1", KHOA));
    expect(ik).not.toContain("203.0.113.1");
    expect((tu as Date).getTime()).toBe(NOW.getTime() - 24 * 3_600_000);
    expect(boQua).toBe(KEY);
  });
  it("đếm hỏng ⇒ LUU_THAT_BAI (fail-closed), không lưu mù", async () => {
    const { store } = taoStore();
    dem(store).mockRejectedValueOnce(new Error("db"));
    expect(await luu(store)).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(store.taoHoacLayTheoKhoa).not.toHaveBeenCalled();
  });
  it("ngữ nghĩa thật: 5 bài đầu từ IP-X qua, bài thứ 6 từ IP-X bị chặn, phát lại bài thứ 5 vẫn qua", async () => {
    const { store } = taoStore();
    const khoa = (i: number) => `khoa-so-${i}-0123456789abcdef`;
    for (let i = 1; i <= 5; i++) expect((await luu(store, baiTho({ idempotencyKey: khoa(i) }))).ok).toBe(true);
    expect(await luu(store, baiTho({ idempotencyKey: khoa(6) }))).toEqual({ ok: false, loi: "QUA_NHIEU_YEU_CAU" });
    expect((await luu(store, baiTho({ idempotencyKey: khoa(5) }))).ok).toBe(true);
  });
  it("[N6] đối chứng dương: sau khi IP-X đã đủ 5 bài, CHỦ SỐ từ IP-Y vẫn lưu được cùng SĐT", async () => {
    const { store } = taoStore();
    for (let i = 1; i <= 5; i++) expect((await luu(store, baiTho({ idempotencyKey: `khoa-xau-${i}-0123456789abcdef` }))).ok).toBe(true);
    expect((await luu(store, baiTho({ idempotencyKey: "khoa-xau-6-0123456789abcdef" }))).ok).toBe(false);  // gitleaks:allow
    const chuSo = await luu(store, baiTho({ idempotencyKey: "khoa-that-0123456789abcdefg" }), { nguonIp: "198.51.100.7" });  // gitleaks:allow
    expect(chuSo.ok).toBe(true);
  });
  it("[N6] cấy: nếu phép đếm cặp bỏ ipKey (lỗi cũ) thì chủ số từ IP-Y bị khoá — chứng minh ca đối chứng ở trên bắt được lỗi", async () => {
    const { store } = taoStore();
    dem(store).mockImplementation(async (pk: string, _ik: string, tu: Date, boQua: string) => {
      const n = [...(store.taoHoacLayTheoKhoa as ReturnType<typeof vi.fn>).mock.calls].filter((c) => c[0].phoneKey === pk && c[0].consentAt >= tu && c[0].idempotencyKey !== boQua).length;
      return { theoCap: n, theoPhone: n };
    });
    for (let i = 1; i <= 5; i++) await luu(store, baiTho({ idempotencyKey: `khoa-cu-${i}-0123456789abcdefgh` }));
    const chuSo = await luu(store, baiTho({ idempotencyKey: "khoa-that-cu-0123456789abcdefg" }), { nguonIp: "198.51.100.7" });  // gitleaks:allow
    expect(chuSo).toEqual({ ok: false, loi: "QUA_NHIEU_YEU_CAU" });
  });
  it("bài ngoài cửa sổ 24h không tính; SĐT khác không tính", async () => {
    const { store, dong } = taoStore();
    for (let i = 1; i <= 5; i++) await luu(store, baiTho({ idempotencyKey: `khoa-cu-${i}-0123456789abcdef` }));
    for (const b of dong.values()) b.consentAt = new Date(NOW.getTime() - 25 * 3_600_000);
    expect((await luu(store, baiTho({ idempotencyKey: "khoa-moi-0123456789abcdefgh" }))).ok).toBe(true);  // gitleaks:allow
    expect((await luu(store, baiTho({ idempotencyKey: "khoa-sdt-khac-0123456789ab", soDienThoai: "0912345678" }))).ok).toBe(true);  // gitleaks:allow
  });
});

describe("[DISC-PEPPER-01] khoá băm có phiên bản (N9)", () => {
  it("ghi pepperVersion do phienBanPepper tiêm; mặc định theo env (ns0 khi chưa đặt DISC_PEPPER)", async () => {
    const a = taoStore();
    await luu(a.store, baiTho(), { phienBanPepper: () => "v1" });
    expect(lanGoiDau(a.store).pepperVersion).toBe("v1");
    const b = taoStore();
    await luu(b.store);
    expect(lanGoiDau(b.store).pepperVersion).toBe("ns0");
  });
  it("ipKey khác nhau theo IP và theo khoá; không chứa IP thô", async () => {
    const a = taoStore();
    const b = taoStore();
    const c = taoStore();
    await luu(a.store, baiTho(), { nguonIp: "203.0.113.1" });
    await luu(b.store, baiTho(), { nguonIp: "203.0.113.2" });
    await luu(c.store, baiTho(), { nguonIp: "203.0.113.1", khoaBam: () => "khoa-khac-".repeat(5) });
    expect(lanGoiDau(a.store).ipKey).not.toBe(lanGoiDau(b.store).ipKey);
    expect(lanGoiDau(a.store).ipKey).not.toBe(lanGoiDau(c.store).ipKey);
    expect(lanGoiDau(a.store).ipKey).not.toContain("203.0.113");
  });
});

describe("[DISC-CONSENT-01] bằng chứng đồng ý (F-08)", () => {
  it("consentAt = now tiêm; consentMarketingAt chỉ khi tích; vai người đồng ý; hash văn bản (lời khai)", async () => {
    const { store } = taoStore();
    const hash = "a".repeat(64);
    await luu(store, baiTho({ dongY: { xuLyHoSo: true, tiepThi: true, vanBanHash: hash } }));
    expect(lanGoiDau(store)).toMatchObject({ consentAt: NOW, consentMarketingAt: NOW, consentSubjectRole: "ME", consentTextHash: hash });
    const k = taoStore();
    await luu(k.store);
    expect(lanGoiDau(k.store)).toMatchObject({ consentAt: NOW, consentMarketingAt: null, consentTextHash: null });
  });
  it("vanBanHash sai định dạng ⇒ từ chối", async () => {
    const { store } = taoStore();
    expect(await luu(store, baiTho({ dongY: { xuLyHoSo: true, tiepThi: false, vanBanHash: "xyz" } }))).toMatchObject({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" });
  });
});

describe("[DISC-CD-01] chiến dịch theo danh sách trắng (F-13)", () => {
  it("chiến dịch lạ ⇒ 'DISC' ở cả store lẫn CRM; chiến dịch hợp lệ giữ nguyên", async () => {
    const a = taoStore();
    const crmA = crmOk();
    await luu(a.store, baiTho({ chienDich: "DOI-TAC-GIA-MAO" }), {}, crmA);
    expect(lanGoiDau(a.store).campaign).toBe("DISC");
    expect((crmA as ReturnType<typeof vi.fn>).mock.calls[0]![0].chienDich).toBe("DISC");
    const b = taoStore();
    const crmB = crmOk();
    await luu(b.store, baiTho({ chienDich: "DISC_ZALO" }), {}, crmB);
    expect(lanGoiDau(b.store).campaign).toBe("DISC_ZALO");
    expect((crmB as ReturnType<typeof vi.fn>).mock.calls[0]![0].chienDich).toBe("DISC_ZALO");
  });
});

describe("[DISC-NAM-01] năm theo giờ VN, hồ sơ dùng dữ liệu đã parse (F-16)", () => {
  it("23:00 UTC 31/12 = 06:00 01/01 giờ VN ⇒ engine nhận namNay=2027 (máy chủ UTC vẫn đang ở 2026)", async () => {
    const { store } = taoStore();
    const chon = vi.fn(engineGia().chonBoDe);
    const lucDoi = new Date("2026-12-31T23:00:00Z");
    await luu(store, baiTho({ hocSinh: { hoTen: "Trần Bảo Minh", namSinh: 2017, bacHoc: "4" } }), { now: () => lucDoi, engine: () => engineGia({ chonBoDe: chon }) });
    expect(chon.mock.calls[0]![0].namNay).toBe(2027);
  });
  it("tên có khoảng trắng thừa được trim bởi lược đồ hồ sơ (store nhận bản đã chuẩn hoá)", async () => {
    const { store } = taoStore();
    await luu(store, baiTho({ phuHuynh: { hoTen: "   Nguyễn Thị Mai  ", vaiTro: "ME", namSinh: 1988 } }));
    expect(lanGoiDau(store).nguoi[0].hoTen).toBe("Nguyễn Thị Mai");
  });
});
