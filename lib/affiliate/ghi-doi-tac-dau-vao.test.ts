/**
 * [GDV-*] — LUẬT GHI ĐỐI TÁC, phần thuần (`ghi-doi-tac-dau-vao.ts`). Không DB.
 *
 *   [GDV-01] mã ?ref=: bỏ dấu / HOA / bỏ ký tự lạ; <3 và >32 bị TỪ CHỐI (không cắt); KHỚP `normalizeAffiliateCode` cũ trên mọi mã ≤ 32 (lưới chống lệch hai bản)
 *   [GDV-02] gợi ý mã từ tên
 *   [GDV-03] bảng chuyển trạng thái: từng cặp (tu, den); ENDED là cuối; DRAFT→ACTIVE chỉ khi loại không cần duyệt
 *   [GDV-04] lý do ≥ 10 ký tự (sau trim) khi SUSPENDED / ENDED, không đòi ở duyệt / kích hoạt lại
 *   [GDV-05] `laDangHoatDong` ⇔ ACTIVE; `trangThaiKhiTao`: loại không cần duyệt ⇒ ACTIVE, còn lại (kể cả chưa rõ) ⇒ PENDING
 *   [GDV-06] quan hệ tổ chức: tổ chức không cha, không nhân viên; cá nhân thì được
 *   [GDV-07] Zod tạo/sửa: ô bắt buộc, SĐT, email, tỉ lệ 0..100, nhãn trùng gộp, ô lạ bị từ chối
 */
import { describe, expect, it } from "vitest";
import { normalizeAffiliateCode } from "./index";
import {
  KIEU_DOI_TAC,
  LY_DO_TOI_THIEU_DOI_TAC,
  TRANG_THAI_DOI_TAC,
  chuanHoaMaDoiTac,
  goiYMaTuTen,
  kiemDoiTrangThaiDoiTac,
  kiemQuanHeToChuc,
  laDangHoatDong,
  suaDoiTacSchema,
  taoDoiTacSchema,
  thaoTacDoiTac,
  trangThaiKhiTao,
} from "./ghi-doi-tac-dau-vao";

const HOP_LE = { partyKind: "PERSON", name: "Chị An", typeId: "t1", tagIds: [], code: "ANNGUYEN", phone: null, email: null, note: null, centerId: null, commissionPercent: null, employeeId: null, parentPartyId: null } as const;

describe("[GDV-01] mã ?ref=", () => {
  it("bỏ dấu, HOA, bỏ ký tự lạ", () => {
    expect(chuanHoaMaDoiTac("an-nguyen")).toEqual({ ok: true, ma: "ANNGUYEN" });
    expect(chuanHoaMaDoiTac("  Đức Anh_2026! ")).toEqual({ ok: true, ma: "DUCANH2026" });
  });
  it("<3 ký tự (sau khi bỏ ký tự lạ) và rỗng bị từ chối", () => {
    for (const x of ["ab", "!!", "", "  ", null, undefined]) expect(chuanHoaMaDoiTac(x).ok, String(x)).toBe(false);
  });
  it("quá 32 ký tự bị TỪ CHỐI — không lặng lẽ cắt (khác bản cũ có chủ đích)", () => {
    const r = chuanHoaMaDoiTac("A".repeat(33));
    expect(r.ok).toBe(false);
    expect(chuanHoaMaDoiTac("A".repeat(32))).toEqual({ ok: true, ma: "A".repeat(32) });
    expect(normalizeAffiliateCode("A".repeat(33))).toBe("A".repeat(32)); // đối chứng: bản cũ CẮT — đó là điểm khác
  });
  it("KHỚP normalizeAffiliateCode cũ trên mọi mã ≤ 32 (chống hai bản lệch nhau: link ?ref= đang chạy dùng bản cũ)", () => {
    const corpus = ["an-nguyen", "AN NGUYEN", "  sata_2026!  ", "Đức Anh", "Ánh Dương 88", "ĐỖ-THỊ-LAN", "x1y2z3", "lop 1A", "Trường Tiểu Học Lê Quý Đôn", "a.b.c.d", "ǅ", "ﬁ ﬂ 123"];
    for (const c of corpus) {
      const cu = normalizeAffiliateCode(c);
      const moi = chuanHoaMaDoiTac(c);
      if (cu === null) expect(moi.ok, c).toBe(false);
      else expect(moi.ok && moi.ma, c).toBe(cu);
    }
  });
});

describe("[GDV-02] gợi ý mã từ tên", () => {
  it("rút gọn ≤ 16 ký tự, bỏ dấu; tên quá ngắn ⇒ rỗng", () => {
    expect(goiYMaTuTen("Chị An")).toBe("CHIAN");
    expect(goiYMaTuTen("Trường Tiểu Học Lê Quý Đôn")).toBe("TRUONGTIEUHOCLEQ");
    expect(goiYMaTuTen("An")).toBe("");
    expect(goiYMaTuTen("")).toBe("");
  });
  it("gợi ý (nếu có) luôn là mã hợp lệ", () => {
    for (const t of ["Chị An", "Đức Anh", "KOL Hà Nội 2026"]) {
      const g = goiYMaTuTen(t);
      expect(chuanHoaMaDoiTac(g).ok, t).toBe(true);
    }
  });
});

describe("[GDV-03] bảng chuyển trạng thái", () => {
  const CHO_PHEP: Record<string, string[]> = {
    "DRAFT:true": ["PENDING", "ENDED"],
    "DRAFT:false": ["PENDING", "ACTIVE", "ENDED"],
    "DRAFT:null": ["PENDING", "ENDED"],
    "PENDING:true": ["ACTIVE", "ENDED"],
    "ACTIVE:true": ["SUSPENDED", "ENDED"],
    "SUSPENDED:true": ["ACTIVE", "ENDED"],
    "ENDED:true": [],
  };
  it("danh sách thao tác đúng từng trạng thái (DRAFT→ACTIVE chỉ khi loại KHÔNG cần duyệt; loại chưa rõ = cần duyệt)", () => {
    for (const [khoa, dich] of Object.entries(CHO_PHEP)) {
      const [tu, canDuyet] = khoa.split(":") as [(typeof TRANG_THAI_DOI_TAC)[number], string];
      const loaiCanDuyet = canDuyet === "null" ? null : canDuyet === "true";
      expect(thaoTacDoiTac(tu, loaiCanDuyet).map((t) => t.den), khoa).toEqual(dich);
    }
  });
  it("kiemDoiTrangThai KHỚP bảng trên cho MỌI cặp (tu, den) — nút và cổng ghi không lệch nhau", () => {
    for (const tu of TRANG_THAI_DOI_TAC) {
      for (const den of TRANG_THAI_DOI_TAC) {
        for (const canDuyet of [true, false, null]) {
          const trongBang = thaoTacDoiTac(tu, canDuyet).some((t) => t.den === den);
          const kq = kiemDoiTrangThaiDoiTac({ tu, den, lyDo: "Lý do đủ dài để qua cổng", loaiCanDuyet: canDuyet });
          expect(kq.ok, `${tu}→${den} canDuyet=${String(canDuyet)}`).toBe(trongBang);
        }
      }
    }
  });
  it("ENDED là trạng thái cuối: không đi đâu được, kể cả về chính nó", () => {
    for (const den of TRANG_THAI_DOI_TAC) {
      const kq = kiemDoiTrangThaiDoiTac({ tu: "ENDED", den, lyDo: "Lý do đủ dài để qua cổng", loaiCanDuyet: false });
      expect(kq.ok).toBe(false);
    }
  });
  it("không chuyển sang chính trạng thái hiện tại", () => {
    for (const t of TRANG_THAI_DOI_TAC) expect(kiemDoiTrangThaiDoiTac({ tu: t, den: t, lyDo: "Lý do đủ dài để qua cổng", loaiCanDuyet: false }).ok, t).toBe(false);
  });
});

describe("[GDV-04] lý do", () => {
  it("SUSPENDED / ENDED đòi ≥ 10 ký tự SAU trim; thiếu ⇒ lỗi gắn vào ô lyDo", () => {
    for (const den of ["SUSPENDED", "ENDED"] as const) {
      const tu = den === "SUSPENDED" ? "ACTIVE" : "PENDING";
      for (const lyDo of [null, "", "ngắn", "123456789", "  123456789  "]) {
        const kq = kiemDoiTrangThaiDoiTac({ tu, den, lyDo, loaiCanDuyet: true });
        expect(kq.ok, `${den} "${String(lyDo)}"`).toBe(false);
        if (!kq.ok) expect(kq.truong).toBe("lyDo");
      }
      expect(kiemDoiTrangThaiDoiTac({ tu, den, lyDo: "  đúng mười ký tự  ", loaiCanDuyet: true }).ok).toBe(true);
    }
  });
  it("duyệt (PENDING→ACTIVE) và kích hoạt lại (SUSPENDED→ACTIVE) KHÔNG đòi lý do (đối chứng)", () => {
    expect(kiemDoiTrangThaiDoiTac({ tu: "PENDING", den: "ACTIVE", lyDo: null, loaiCanDuyet: true })).toEqual({ ok: true, canLyDo: false });
    expect(kiemDoiTrangThaiDoiTac({ tu: "SUSPENDED", den: "ACTIVE", lyDo: null, loaiCanDuyet: true })).toEqual({ ok: true, canLyDo: false });
  });
  it("mọi thao tác trong bảng có canLyDo ⇔ đích là SUSPENDED/ENDED", () => {
    for (const tu of TRANG_THAI_DOI_TAC) for (const t of thaoTacDoiTac(tu, false)) expect(t.canLyDo, `${tu}→${t.den}`).toBe(t.den === "SUSPENDED" || t.den === "ENDED");
  });
});

describe("[GDV-05] isActive ≡ ACTIVE; trạng thái lúc tạo", () => {
  it("laDangHoatDong chỉ đúng với ACTIVE", () => {
    for (const t of TRANG_THAI_DOI_TAC) expect(laDangHoatDong(t), t).toBe(t === "ACTIVE");
  });
  it("loại không cần duyệt ⇒ ACTIVE; cần duyệt hoặc chưa rõ ⇒ PENDING (đóng, không mở); không bao giờ DRAFT", () => {
    expect(trangThaiKhiTao(false)).toBe("ACTIVE");
    expect(trangThaiKhiTao(true)).toBe("PENDING");
    expect(trangThaiKhiTao(null)).toBe("PENDING");
  });
});

describe("[GDV-06] quan hệ tổ chức", () => {
  it("tổ chức không có cha và không là nhân viên; cá nhân có cả hai được", () => {
    expect(kiemQuanHeToChuc({ kieu: "ORGANIZATION", parentPartyId: "x", employeeId: null })?.truong).toBe("parentPartyId");
    expect(kiemQuanHeToChuc({ kieu: "ORGANIZATION", parentPartyId: null, employeeId: "e" })?.truong).toBe("employeeId");
    expect(kiemQuanHeToChuc({ kieu: "ORGANIZATION", parentPartyId: null, employeeId: null })).toBeNull();
    expect(kiemQuanHeToChuc({ kieu: "PERSON", parentPartyId: "x", employeeId: "e" })).toBeNull();
  });
});

describe("[GDV-07] Zod tạo/sửa", () => {
  it("hợp lệ: chuẩn hoá ô tuỳ chọn rỗng thành null, nhãn trùng gộp, email về chữ thường", () => {
    const r = taoDoiTacSchema.parse({ ...HOP_LE, phone: "  ", email: " An@Gmail.COM ", note: "", tagIds: ["a", "b", "a"] });
    expect(r.phone).toBeNull();
    expect(r.email).toBe("an@gmail.com");
    expect(r.note).toBeNull();
    expect(r.tagIds).toEqual(["a", "b"]);
  });
  it("bắt buộc: tên ≥ 2, loại, mã hợp lệ", () => {
    expect(taoDoiTacSchema.safeParse({ ...HOP_LE, name: "A" }).success).toBe(false);
    expect(taoDoiTacSchema.safeParse({ ...HOP_LE, typeId: "" }).success).toBe(false);
    const { typeId: _t, ...thieuLoai } = HOP_LE;
    expect(taoDoiTacSchema.safeParse(thieuLoai).success).toBe(false);
    expect(taoDoiTacSchema.safeParse({ ...HOP_LE, code: "ab" }).success).toBe(false);
    expect(taoDoiTacSchema.safeParse(HOP_LE).success).toBe(true); // đối chứng dương
  });
  it("lỗi mã gắn vào ô `code`", () => {
    const r = taoDoiTacSchema.safeParse({ ...HOP_LE, code: "A".repeat(40) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path[0]).toBe("code");
  });
  it("SĐT: chỉ chữ số/ký tự thường gặp, 8–15 chữ số", () => {
    for (const p of ["0905 123 456", "+84 905-123-456", "(0236) 3 888 999"]) expect(taoDoiTacSchema.safeParse({ ...HOP_LE, phone: p }).success, p).toBe(true);
    for (const p of ["abc", "123", "09051234567890123", "0905 123 456 ext"]) expect(taoDoiTacSchema.safeParse({ ...HOP_LE, phone: p }).success, p).toBe(false);
  });
  it("email sai bị từ chối", () => {
    expect(taoDoiTacSchema.safeParse({ ...HOP_LE, email: "khong-phai-email" }).success).toBe(false);
  });
  it("tỉ lệ tham chiếu 0..100 (biên 0 và 100 hợp lệ); ngoài khoảng hoặc không phải số bị từ chối", () => {
    for (const x of [0, 100, 12.5, null]) expect(taoDoiTacSchema.safeParse({ ...HOP_LE, commissionPercent: x }).success, String(x)).toBe(true);
    for (const x of [-1, 100.1, "5"]) expect(taoDoiTacSchema.safeParse({ ...HOP_LE, commissionPercent: x }).success, String(x)).toBe(false);
  });
  it("tổ chức có cha / có nhân viên bị chặn NGAY ở Zod, lỗi gắn đúng ô", () => {
    const a = taoDoiTacSchema.safeParse({ ...HOP_LE, partyKind: "ORGANIZATION", parentPartyId: "p" });
    expect(a.success).toBe(false);
    if (!a.success) expect(a.error.issues[0]?.path[0]).toBe("parentPartyId");
    const b = suaDoiTacSchema.safeParse({ ...HOP_LE, partyKind: "ORGANIZATION", employeeId: "e" });
    expect(b.success).toBe(false);
    if (!b.success) expect(b.error.issues[0]?.path[0]).toBe("employeeId");
  });
  it("ô lạ bị TỪ CHỐI (strict): không cho client nhét `status` / `isActive` / `approvedById` qua biểu mẫu", () => {
    for (const lạ of [{ status: "ACTIVE" }, { isActive: true }, { approvedById: "x" }, { createdById: "x" }]) {
      expect(taoDoiTacSchema.safeParse({ ...HOP_LE, ...lạ }).success, JSON.stringify(lạ)).toBe(false);
      expect(suaDoiTacSchema.safeParse({ ...HOP_LE, ...lạ }).success, JSON.stringify(lạ)).toBe(false);
    }
  });
  it("hằng được xuất đủ", () => {
    expect(KIEU_DOI_TAC).toEqual(["PERSON", "ORGANIZATION"]);
    expect(LY_DO_TOI_THIEU_DOI_TAC).toBe(10);
  });
});
