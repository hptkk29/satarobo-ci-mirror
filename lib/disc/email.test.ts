import { describe, expect, it } from "vitest";
import {
  anhXaTrangThaiHangDoi,
  bamToken,
  dongBoTrangThaiEmail,
  guiLinkXacMinh,
  HAN_LINK_XAC_MINH_PHUT,
  khoaDiaChiEmail,
  TRAN_THU_XAC_MINH_MOI_BAI_MOI_NGAY,
  TRAN_THU_XAC_MINH_MOI_DIA_CHI_MOI_NGAY,
  type GioiHanEmail,
  mauThuBaoCao,
  mauThuXacMinh,
  phanTichToken,
  taoTokenXacMinh,
  xacMinhEmail,
  type BaiEmail,
  type EmailStore,
  type XepThu,
} from "./email";

// Dữ liệu GIẢ.
const NOW = new Date("2026-11-01T00:00:00Z");
const GOC = "https://satarobo.example.invalid";

type Bai = BaiEmail & { tokenHash: string | null; hangDoi: string | null; tenCon?: string; tenPhuHuynh?: string };
function taoStore(b: Partial<Bai> = {}) {
  const bai: Bai = { id: "s1", emailTo: "gia@example.invalid", emailStatus: "VERIFICATION_REQUIRED", emailVerifiedAt: null, emailVerifyExpiresAt: null, claimStatus: "PENDING_CLAIM", deletedAt: null, tokenHash: null, hangDoi: null, ...b };
  const store: EmailStore = {
    layBai: async (id) => (id === bai.id ? { ...bai } : null),
    datTokenLanDau: async (id, h, hetHan, now) => {
      if (id !== bai.id || bai.emailStatus !== "VERIFICATION_REQUIRED" || !bai.emailTo) return false;
      const conSong = bai.tokenHash !== null && !(bai.emailVerifyExpiresAt && bai.emailVerifyExpiresAt.getTime() <= now.getTime());
      if (conSong) return false;
      bai.tokenHash = h;
      bai.emailVerifyExpiresAt = hetHan;
      return true;
    },
    goTokenNeuKhop: async (_id, h) => {
      if (bai.tokenHash === h) {
        bai.tokenHash = null;
        bai.emailVerifyExpiresAt = null;
      }
    },
    xacMinhNeuKhop: async (id, h, now) => {
      if (id !== bai.id || bai.emailStatus !== "VERIFICATION_REQUIRED" || bai.tokenHash !== h) return false;
      if (!bai.emailVerifyExpiresAt || bai.emailVerifyExpiresAt.getTime() <= now.getTime()) return false; // hạn theo CỘT
      bai.emailStatus = "QUEUED";
      bai.emailVerifiedAt = now;
      bai.tokenHash = null;
      bai.emailVerifyExpiresAt = null;
      return true;
    },
    doiTrangThai: async (_id, tu, den) => {
      if (bai.emailStatus !== tu) return false;
      bai.emailStatus = den;
      return true;
    },
    trangThaiHangDoi: async () => bai.hangDoi,
  };
  return { store, bai };
}
const taoXep = (ok = true) => {
  const thu: Array<Parameters<XepThu>[0]> = [];
  const xep: XepThu = async (e) => (thu.push(e), { ok });
  return { xep, thu };
};
/** Cổng giới hạn mở rộng — các ca không bàn về trần dùng cái này. */
const MO: GioiHanEmail = { theoDiaChi: async () => true, theoBai: async () => true };
const gui = (o: Omit<Parameters<typeof guiLinkXacMinh>[0], "gioiHan"> & { gioiHan?: GioiHanEmail }) => guiLinkXacMinh({ gioiHan: MO, ...o });
const layToken = (link: string) => decodeURIComponent(new URL(link).searchParams.get("t")!);
const linkTrongThu = (t: Parameters<XepThu>[0]) => /https:\/\/[^\s"]+xac-minh-email\?t=[^\s"<]+/.exec(t.bodyText)![0];

describe("[DISC-EML-01] token xác minh", () => {
  it("hạn nằm trong chuỗi được băm: sửa hạn ⇒ hash lệch", () => {
    const t = taoTokenXacMinh("s1", NOW, () => "rand");
    const p = phanTichToken(t.token)!;
    expect(p.hash).toBe(t.hash);
    expect(p.hetHanMs).toBe(NOW.getTime() + HAN_LINK_XAC_MINH_PHUT * 60_000);
    const sua = t.token.replace(/\.[a-z0-9]+\.rand$/, `.${(NOW.getTime() + 10 ** 12).toString(36)}.rand`);
    expect(phanTichToken(sua)!.hash).not.toBe(t.hash);
  });
  it("chuỗi lạ ⇒ null", () => {
    for (const x of [null, 1, "", "v2.a.b.c", "v1.a.b", "v1..zz.r", "v1.a.ZZ.r", "x".repeat(300)]) expect(phanTichToken(x)).toBeNull();
  });
});

describe("[DISC-EML-02] gửi link xác minh — một lần, không lộ dữ liệu trẻ", () => {
  it("gửi 1 thư tới emailTo, lưu HASH (không lưu token), thân thư không có tên/điểm", async () => {
    const { store, bai } = taoStore();
    const { xep, thu } = taoXep();
    expect(await gui({ submissionId: "s1", goc: GOC, store, xepThu: xep, now: NOW })).toEqual({ ok: true });
    expect(thu).toHaveLength(1);
    expect(thu[0]!.to).toBe("gia@example.invalid");
    expect(thu[0]!.context).toEqual({ type: "DISC_EMAIL_VERIFY", id: "s1" });
    const token = layToken(linkTrongThu(thu[0]!));
    expect(bai.tokenHash).toBe(bamToken(token));
    expect(JSON.stringify(thu[0])).not.toContain(bai.tokenHash!);
    expect(bai.emailStatus).toBe("VERIFICATION_REQUIRED"); // chưa xác minh ⇒ chưa có báo cáo
  });
  it("gọi lặp (hoặc hai lượt đua) ⇒ chỉ MỘT thư", async () => {
    const { store } = taoStore();
    const { xep, thu } = taoXep();
    const kq = await Promise.all([1, 2, 3].map(() => gui({ submissionId: "s1", goc: GOC, store, xepThu: xep, now: NOW })));
    expect(thu).toHaveLength(1);
    expect(kq.filter((k) => k.ok)).toHaveLength(1);
    expect(kq.filter((k) => !k.ok && k.loi === "DA_GUI")).toHaveLength(2);
  });
  it("không có email / đã xác minh / bài bị thu hồi / không tồn tại ⇒ KHONG_CAN, không thư", async () => {
    const { xep, thu } = taoXep();
    for (const b of [{ emailTo: null }, { emailStatus: "NONE" as const }, { emailVerifiedAt: NOW }, { claimStatus: "REVOKED" as const }, { deletedAt: NOW }]) {
      expect(await gui({ submissionId: "s1", goc: GOC, store: taoStore(b).store, xepThu: xep, now: NOW })).toEqual({ ok: false, loi: "KHONG_CAN" });
    }
    expect(await gui({ submissionId: "khac", goc: GOC, store: taoStore().store, xepThu: xep, now: NOW })).toEqual({ ok: false, loi: "KHONG_CAN" });
    expect(thu).toHaveLength(0);
  });
  it("xếp hàng thất bại ⇒ gỡ token để gửi lại được", async () => {
    const { store, bai } = taoStore();
    expect(await gui({ submissionId: "s1", goc: GOC, store, xepThu: taoXep(false).xep, now: NOW })).toEqual({ ok: false, loi: "XEP_HANG_THAT_BAI" });
    expect(bai.tokenHash).toBeNull();
    expect(await gui({ submissionId: "s1", goc: GOC, store, xepThu: taoXep().xep, now: NOW })).toEqual({ ok: true });
  });
  it("xepThu ném ⇒ coi như thất bại, không ném ra ngoài", async () => {
    const { store } = taoStore();
    const xep: XepThu = async () => {
      throw new Error("queue down");
    };
    expect(await gui({ submissionId: "s1", goc: GOC, store, xepThu: xep, now: NOW })).toEqual({ ok: false, loi: "XEP_HANG_THAT_BAI" });
  });
});

describe("[DISC-EML-03] xác minh rồi mới xếp báo cáo", () => {
  async function daGui() {
    const t = taoStore();
    const x = taoXep();
    await gui({ submissionId: "s1", goc: GOC, store: t.store, xepThu: x.xep, now: NOW });
    return { ...t, token: layToken(linkTrongThu(x.thu[0]!)) };
  }
  it("token đúng ⇒ QUEUED + đúng MỘT thư báo cáo, không kèm nội dung trẻ", async () => {
    const { store, bai, token } = await daGui();
    const { xep, thu } = taoXep();
    expect(await xacMinhEmail({ token, goc: GOC, store, xepThu: xep, now: NOW })).toEqual({ ok: true, xepBaoCao: true });
    expect(bai.emailStatus).toBe("QUEUED");
    expect(bai.emailVerifiedAt).toEqual(NOW);
    expect(thu).toHaveLength(1);
    expect(thu[0]!.context).toEqual({ type: "DISC_REPORT", id: "s1" });
    expect(thu[0]!.bodyText).toContain(`${GOC}/kich-hoat?disc=1`);
    expect(thu[0]!.bodyText).toContain("không kèm nội dung kết quả");
  });
  it("bấm đúp / hai tab / bot quét ⇒ chỉ lượt thắng xếp thư (chống gửi trùng theo bài)", async () => {
    const { store, token } = await daGui();
    const { xep, thu } = taoXep();
    const kq = await Promise.all([1, 2, 3, 4].map(() => xacMinhEmail({ token, goc: GOC, store, xepThu: xep, now: NOW })));
    expect(thu).toHaveLength(1);
    expect(kq.filter((k) => k.ok)).toHaveLength(1);
    expect(kq.filter((k) => !k.ok)).toHaveLength(3);
  });
  it("hết hạn ⇒ không xác minh, không thư; lỗi cùng một mã với token lạ", async () => {
    const { store, bai, token } = await daGui();
    const { xep, thu } = taoXep();
    const muon = new Date(NOW.getTime() + (HAN_LINK_XAC_MINH_PHUT + 1) * 60_000);
    const het = await xacMinhEmail({ token, goc: GOC, store, xepThu: xep, now: muon });
    const la = await xacMinhEmail({ token: "rac", goc: GOC, store, xepThu: xep, now: NOW });
    expect(het).toEqual(la);
    expect(het).toEqual({ ok: false, loi: "LINK_KHONG_HOP_LE" });
    expect(bai.emailStatus).toBe("VERIFICATION_REQUIRED");
    expect(thu).toHaveLength(0);
  });
  it("token của bài khác / token đúng định dạng nhưng không phải token đã cấp ⇒ từ chối", async () => {
    const { store, bai } = await daGui();
    const gia = taoTokenXacMinh("s1", NOW).token; // đúng định dạng, chưa từng được cấp
    const { xep, thu } = taoXep();
    expect(await xacMinhEmail({ token: gia, goc: GOC, store, xepThu: xep, now: NOW })).toEqual({ ok: false, loi: "LINK_KHONG_HOP_LE" });
    expect(bai.emailStatus).toBe("VERIFICATION_REQUIRED");
    expect(thu).toHaveLength(0);
  });
  it("xác minh xong nhưng xếp báo cáo thất bại ⇒ FAILED (nói thật), không kẹt QUEUED", async () => {
    const { store, bai, token } = await daGui();
    expect(await xacMinhEmail({ token, goc: GOC, store, xepThu: taoXep(false).xep, now: NOW })).toEqual({ ok: true, xepBaoCao: false });
    expect(bai.emailStatus).toBe("FAILED");
  });
});

describe("[DISC-EML-04] trạng thái trung thực: QUEUED ≠ SENT", () => {
  it("ánh xạ", () => {
    expect(anhXaTrangThaiHangDoi("SENT")).toBe("SENT");
    expect(anhXaTrangThaiHangDoi("FAILED")).toBe("FAILED");
    for (const x of ["PENDING", "PROCESSING", "", null, "gì-đó"]) expect(anhXaTrangThaiHangDoi(x)).toBeNull();
  });
  it("hàng đợi còn PENDING ⇒ giữ QUEUED (không tự nhận là đã gửi)", async () => {
    const { store, bai } = taoStore({ emailStatus: "QUEUED", hangDoi: "PENDING" });
    expect(await dongBoTrangThaiEmail({ submissionId: "s1", store })).toBe("GIU_NGUYEN");
    expect(bai.emailStatus).toBe("QUEUED");
  });
  it("hàng đợi đã SENT / FAILED ⇒ cập nhật đúng; chạy lại không đổi", async () => {
    const a = taoStore({ emailStatus: "QUEUED", hangDoi: "SENT" });
    expect(await dongBoTrangThaiEmail({ submissionId: "s1", store: a.store })).toBe("SENT");
    expect(await dongBoTrangThaiEmail({ submissionId: "s1", store: a.store })).toBe("GIU_NGUYEN");
    const b = taoStore({ emailStatus: "QUEUED", hangDoi: "FAILED" });
    expect(await dongBoTrangThaiEmail({ submissionId: "s1", store: b.store })).toBe("FAILED");
  });
  it("chưa xác minh (VERIFICATION_REQUIRED) thì không bao giờ thành SENT dù hàng đợi nói gì", async () => {
    const { store, bai } = taoStore({ emailStatus: "VERIFICATION_REQUIRED", hangDoi: "SENT" });
    expect(await dongBoTrangThaiEmail({ submissionId: "s1", store })).toBe("GIU_NGUYEN");
    expect(bai.emailStatus).toBe("VERIFICATION_REQUIRED");
  });
});

describe("[DISC-EML-05] mẫu thư", () => {
  it("tiếng Việt có dấu, thoát HTML trong liên kết, không có trường thông tin trẻ", () => {
    const x = mauThuXacMinh('https://a.invalid/x?t=1&u="2"');
    expect(x.bodyHtml).toContain("&amp;");
    expect(x.bodyHtml).not.toContain('"2"');
    expect(x.subject).toMatch(/Xác nhận email/);
    const b = mauThuBaoCao(`${GOC}/kich-hoat?disc=1`);
    expect(`${b.subject}${b.bodyText}${b.bodyHtml}`).not.toMatch(/điểm|năm sinh|lớp \d|Tên bé/i);
  });
});

describe("[DISC-EML-06] hạn theo CỘT emailVerifyExpiresAt (nguồn sự thật)", () => {
  it("gửi link ⇒ cột hạn = now + HAN_LINK_XAC_MINH_PHUT", async () => {
    const { store, bai } = taoStore();
    await gui({ submissionId: "s1", goc: GOC, store, xepThu: taoXep().xep, now: NOW });
    expect(bai.emailVerifyExpiresAt).toEqual(new Date(NOW.getTime() + HAN_LINK_XAC_MINH_PHUT * 60_000));
  });
  it("token còn hạn theo chuỗi nhưng CỘT đã quá hạn ⇒ không xác minh, không thư (cùng lỗi với token lạ)", async () => {
    const t = taoStore();
    const x = taoXep();
    await gui({ submissionId: "s1", goc: GOC, store: t.store, xepThu: x.xep, now: NOW });
    const token = layToken(linkTrongThu(x.thu[0]!));
    t.bai.emailVerifyExpiresAt = new Date(NOW.getTime() - 1); // cột bị rút ngắn / hết hạn, chuỗi token vẫn còn hạn
    const { xep, thu } = taoXep();
    expect(await xacMinhEmail({ token, goc: GOC, store: t.store, xepThu: xep, now: NOW })).toEqual({ ok: false, loi: "LINK_KHONG_HOP_LE" });
    expect(t.bai.emailStatus).toBe("VERIFICATION_REQUIRED");
    expect(thu).toHaveLength(0);
  });
  it("LỚP HAI: dù CAS của store lỏng (bỏ qua hạn cột), service vẫn từ chối link đã quá hạn theo cột", async () => {
    const t = taoStore();
    const x = taoXep();
    await gui({ submissionId: "s1", goc: GOC, store: t.store, xepThu: x.xep, now: NOW });
    const token = layToken(linkTrongThu(x.thu[0]!));
    t.bai.emailVerifyExpiresAt = new Date(NOW.getTime() - 1);
    const lỏng: EmailStore = { ...t.store, xacMinhNeuKhop: async () => true };
    const { xep, thu } = taoXep();
    expect(await xacMinhEmail({ token, goc: GOC, store: lỏng, xepThu: xep, now: NOW })).toEqual({ ok: false, loi: "LINK_KHONG_HOP_LE" });
    expect(thu).toHaveLength(0);
  });
  it("thiếu cột hạn (dữ liệu lạ) ⇒ fail-closed", async () => {
    const t = taoStore();
    const x = taoXep();
    await gui({ submissionId: "s1", goc: GOC, store: t.store, xepThu: x.xep, now: NOW });
    const token = layToken(linkTrongThu(x.thu[0]!));
    t.bai.emailVerifyExpiresAt = null;
    expect(await xacMinhEmail({ token, goc: GOC, store: t.store, xepThu: taoXep().xep, now: NOW })).toEqual({ ok: false, loi: "LINK_KHONG_HOP_LE" });
  });
  it("gửi lại: token còn hạn ⇒ DA_GUI; token đã hết hạn ⇒ gửi được thư MỚI và thư cũ vô hiệu", async () => {
    const t = taoStore();
    const x1 = taoXep();
    await gui({ submissionId: "s1", goc: GOC, store: t.store, xepThu: x1.xep, now: NOW });
    const tokenCu = layToken(linkTrongThu(x1.thu[0]!));
    const x2 = taoXep();
    expect(await gui({ submissionId: "s1", goc: GOC, store: t.store, xepThu: x2.xep, now: new Date(NOW.getTime() + 60_000) })).toEqual({ ok: false, loi: "DA_GUI" });
    expect(x2.thu).toHaveLength(0);
    const muon = new Date(NOW.getTime() + (HAN_LINK_XAC_MINH_PHUT + 1) * 60_000);
    expect(await gui({ submissionId: "s1", goc: GOC, store: t.store, xepThu: x2.xep, now: muon })).toEqual({ ok: true });
    expect(x2.thu).toHaveLength(1);
    expect(await xacMinhEmail({ token: tokenCu, goc: GOC, store: t.store, xepThu: taoXep().xep, now: muon })).toEqual({ ok: false, loi: "LINK_KHONG_HOP_LE" });
    const tokenMoi = layToken(linkTrongThu(x2.thu[0]!));
    expect(await xacMinhEmail({ token: tokenMoi, goc: GOC, store: t.store, xepThu: taoXep().xep, now: muon })).toMatchObject({ ok: true });
  });
});

describe("[DISC-EML-07] trần số thư: theo địa chỉ và theo bài", () => {
  const dem = () => {
    const goi = { diaChi: [] as string[], bai: [] as string[] };
    const gioiHan = (o: { diaChi?: boolean; bai?: boolean } = {}): GioiHanEmail => ({
      theoDiaChi: async (k) => (goi.diaChi.push(k), o.diaChi ?? true),
      theoBai: async (id) => (goi.bai.push(id), o.bai ?? true),
    });
    return { goi, gioiHan };
  };
  it("hết hạn mức theo ĐỊA CHỈ ⇒ không thư, token vừa đặt bị GỠ (không kẹt DA_GUI)", async () => {
    const { store, bai } = taoStore();
    const { xep, thu } = taoXep();
    const d = dem();
    expect(await gui({ submissionId: "s1", goc: GOC, store, xepThu: xep, now: NOW, gioiHan: d.gioiHan({ diaChi: false }) })).toEqual({ ok: false, loi: "QUA_HAN_MUC" });
    expect(thu).toHaveLength(0);
    expect(bai.tokenHash).toBeNull();
    expect(bai.emailVerifyExpiresAt).toBeNull();
  });
  it("hết hạn mức theo BÀI ⇒ không thư; trần địa chỉ KHÔNG bị tiêu thêm", async () => {
    const { store } = taoStore();
    const { xep, thu } = taoXep();
    const d = dem();
    expect(await gui({ submissionId: "s1", goc: GOC, store, xepThu: xep, now: NOW, gioiHan: d.gioiHan({ bai: false }) })).toEqual({ ok: false, loi: "QUA_HAN_MUC" });
    expect(thu).toHaveLength(0);
    expect(d.goi.diaChi).toHaveLength(0);
  });
  it("cổng hạn mức ném ⇒ fail-closed (không thư)", async () => {
    const { store } = taoStore();
    const { xep, thu } = taoXep();
    const gioiHan: GioiHanEmail = {
      theoDiaChi: async () => {
        throw new Error("redis down");
      },
      theoBai: async () => true,
    };
    expect(await gui({ submissionId: "s1", goc: GOC, store, xepThu: xep, now: NOW, gioiHan })).toEqual({ ok: false, loi: "QUA_HAN_MUC" });
    expect(thu).toHaveLength(0);
  });
  it("ĐỐI CHỨNG DƯƠNG: còn hạn mức ⇒ gửi, khoá địa chỉ là BĂM (không có email thô), chuẩn hoá hoa/thường", async () => {
    const { store } = taoStore({ emailTo: "Gia@Example.INVALID" });
    const { xep, thu } = taoXep();
    const d = dem();
    expect(await gui({ submissionId: "s1", goc: GOC, store, xepThu: xep, now: NOW, gioiHan: d.gioiHan() })).toEqual({ ok: true });
    expect(thu).toHaveLength(1);
    expect(d.goi.diaChi).toEqual([khoaDiaChiEmail("gia@example.invalid")]);
    expect(d.goi.diaChi[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(d.goi)).not.toMatch(/example/i);
    expect(d.goi.bai).toEqual(["s1"]);
    expect(khoaDiaChiEmail(" A@X.vn ")).toBe(khoaDiaChiEmail("a@x.vn"));
  });
  it("gọi lặp/đua khi token còn hạn ⇒ DA_GUI và KHÔNG tiêu hạn mức", async () => {
    const { store } = taoStore();
    const d = dem();
    const xep = taoXep().xep;
    await Promise.all([1, 2, 3, 4].map(() => gui({ submissionId: "s1", goc: GOC, store, xepThu: xep, now: NOW, gioiHan: d.gioiHan() })));
    expect(d.goi.bai).toHaveLength(1);
    expect(d.goi.diaChi).toHaveLength(1);
  });
  it("hằng trần hợp lý (>0, ≤ 10)", () => {
    for (const n of [TRAN_THU_XAC_MINH_MOI_BAI_MOI_NGAY, TRAN_THU_XAC_MINH_MOI_DIA_CHI_MOI_NGAY]) {
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(10);
    }
  });
});

describe("[DISC-EML-08] thư KHÔNG chứa tên trẻ/phụ huynh/điểm, kể cả khi bản ghi có chúng", () => {
  const TEN_BE = "Bé Giả Tên Con";
  const TEN_PH = "Phụ Huynh Giả";
  it("thư xác minh + thư báo cáo: toàn bộ payload không chứa tên; chỉ có liên kết", async () => {
    const t = taoStore({ tenCon: TEN_BE, tenPhuHuynh: TEN_PH });
    const x1 = taoXep();
    await gui({ submissionId: "s1", goc: GOC, store: t.store, xepThu: x1.xep, now: NOW });
    const token = layToken(linkTrongThu(x1.thu[0]!));
    const x2 = taoXep();
    await xacMinhEmail({ token, goc: GOC, store: t.store, xepThu: x2.xep, now: NOW });
    const tatCa = JSON.stringify([...x1.thu, ...x2.thu]);
    for (const v of [TEN_BE, TEN_PH, "Tên Con", "Phụ Huynh"]) expect(tatCa).not.toContain(v);
    expect(tatCa).not.toMatch(/điểm|năm sinh/i); // (không dò số 4 chữ số: token ngẫu nhiên có thể tình cờ chứa)
    expect(x2.thu[0]!.bodyText).toContain("không kèm nội dung kết quả");
  });
});
