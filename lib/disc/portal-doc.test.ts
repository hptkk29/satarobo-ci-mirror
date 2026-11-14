/**
 * [PD-*] — cổng đọc DISC của phụ huynh. DỮ LIỆU GIẢ (tên/điểm bịa). db giả áp ĐÚNG `where` được truyền,
 * nên cổng IDOR (`claimedUserId`/`claimStatus`/`deletedAt`) bị thử thật: bỏ nó khỏi mã là ca đỏ.
 *   [PD-01] chỉ đọc bài CLAIMED của chính user; bài của user khác / PENDING / đã xoá không lọt
 *   [PD-02] chi tiết: id của user khác = id không tồn tại (cùng `null`); id rác ⇒ null
 *   [PD-03] không lộ trường cấm (select + kiểu trả về)
 *   [PD-04] phân trang, mới nhất trước, trang quá giới hạn bị kẹp
 *   [PD-05] lịch sử: cùng bộ đề + phiên bản ⇒ chênh lệch; khác ⇒ KHÔNG so; không tính lại điểm cũ
 *   [PD-06] báo cáo tải lại: thoát HTML, không lộ trường cấm
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Dong = Record<string, unknown> & { id: string };
const kho = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown> & { id: string }>, goi: [] as Array<{ ham: string; args: Record<string, unknown> }> }));

function khop(row: Dong, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

vi.mock("@/lib/db", () => ({
  db: {
    discSubmission: {
      count: async (args: { where: Record<string, unknown> }) => {
        kho.goi.push({ ham: "count", args });
        return kho.rows.filter((r) => khop(r, args.where)).length;
      },
      findMany: async (args: { where: Record<string, unknown>; skip?: number; take?: number }) => {
        kho.goi.push({ ham: "findMany", args });
        const ds = kho.rows
          .filter((r) => khop(r, args.where))
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return ds.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? ds.length));
      },
      findFirst: async (args: { where: Record<string, unknown> }) => {
        kho.goi.push({ ham: "findFirst", args });
        return kho.rows.find((r) => khop(r, args.where)) ?? null;
      },
    },
  },
}));

import { chuanHoaTen, docChiTietLuot, docDanhSachLuot, docLichSuGiaDinh, dungBaoCaoHtmlChoLuot, dungLichSu, type LuotDisc } from "./portal-doc";

const ME = "u-me";
const NGUOI_KHAC = "u-khac";

function subj(role: "PARENT" | "STUDENT", ten: string, diem: { D: number; I: number; S: number; C: number }, ma = "BD-GIA", pb = "v1") {
  return { role, fullName: ten, birthYear: role === "PARENT" ? 1985 : 2016, grade: role === "PARENT" ? null : "3", observedByAdult: false, result: { diem, maBoDe: ma, phienBanBoDe: pb } };
}
function bai(id: string, p: Partial<Dong> & { ngay?: string; subjects?: ReturnType<typeof subj>[] } = {}): Dong {
  return {
    id,
    claimedUserId: ME,
    claimStatus: "CLAIMED",
    deletedAt: null,
    createdAt: new Date(p.ngay ?? "2026-11-01T00:00:00Z"),
    engineVersion: "gia-1",
    // Trường CẤM — có trong "DB" để thử xem có lọt ra không.
    phoneKey: "84900000000",
    claimCodeHash: "HASH-BI-MAT",
    downloadTokenHash: "TOKEN-BI-MAT",
    emailTo: "gia@example.invalid",
    subjects: p.subjects ?? [subj("PARENT", "Phụ huynh Giả", { D: 40, I: 30, S: 20, C: 10 }), subj("STUDENT", "Bé Giả", { D: 10, I: 20, S: 30, C: 40 })],
    ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== "ngay" && k !== "subjects")),
  } as Dong;
}

beforeEach(() => {
  kho.rows = [];
  kho.goi = [];
});

describe("[PD-01] chỉ đọc bài CLAIMED của chính user", () => {
  it("lọc đúng; không lọt bài của user khác / PENDING / REVOKED / đã xoá", async () => {
    kho.rows = [
      bai("a", { ngay: "2026-11-01T00:00:00Z" }),
      bai("b", { ngay: "2026-11-02T00:00:00Z" }),
      bai("khac", { claimedUserId: NGUOI_KHAC }),
      bai("cho", { claimStatus: "PENDING_CLAIM" }),
      bai("thu-hoi", { claimStatus: "REVOKED" }),
      bai("xoa", { deletedAt: new Date("2026-11-03T00:00:00Z") }),
      bai("mo-coi", { claimedUserId: null }),
    ];
    const r = await docDanhSachLuot(ME);
    expect(r.luot.map((l) => l.id)).toEqual(["b", "a"]);
    expect(r.tong).toBe(2);
    // đối chứng dương: người kia thấy đúng bài của họ
    expect((await docDanhSachLuot(NGUOI_KHAC)).luot.map((l) => l.id)).toEqual(["khac"]);
    expect((await docLichSuGiaDinh(ME)).length).toBeGreaterThan(0);
    expect((await docLichSuGiaDinh("u-la")).length).toBe(0);
  });

  it("userId rỗng / lạ ⇒ rỗng, không ném lỗi", async () => {
    kho.rows = [bai("a")];
    expect((await docDanhSachLuot("")).luot).toEqual([]);
  });
});

describe("[PD-02] chi tiết: IDOR", () => {
  it("id của user khác ≡ id không tồn tại ≡ bài chưa nhận ≡ bài đã xoá ⇒ cùng null", async () => {
    kho.rows = [bai("cua-toi"), bai("cua-ho", { claimedUserId: NGUOI_KHAC }), bai("cho", { claimStatus: "PENDING_CLAIM" }), bai("xoa", { deletedAt: new Date("2026-10-30T00:00:00Z") })];
    expect((await docChiTietLuot(ME, "cua-toi"))?.id).toBe("cua-toi"); // đối chứng dương
    const khongDoc = await Promise.all(["cua-ho", "khong-co", "cho", "xoa"].map((i) => docChiTietLuot(ME, i)));
    expect(khongDoc).toEqual([null, null, null, null]);
  });

  it("id rác (không phải chuỗi / quá dài / rỗng) ⇒ null mà không chạm DB", async () => {
    kho.rows = [bai("a")];
    for (const x of [undefined, null, 123, {}, ["a"], "", "x".repeat(65)]) expect(await docChiTietLuot(ME, x)).toBeNull();
    expect(kho.goi).toEqual([]);
  });

  it("ép where: truy vấn chi tiết luôn mang claimedUserId = user", async () => {
    kho.rows = [bai("a")];
    await docChiTietLuot(ME, "a");
    expect(kho.goi[0]!.args.where).toMatchObject({ id: "a", claimedUserId: ME, claimStatus: "CLAIMED", deletedAt: null });
  });
});

describe("[PD-03] không lộ trường cấm", () => {
  const CAM = ["phoneKey", "claimCodeHash", "claimAttempts", "downloadTokenHash", "downloadTokenExpires", "emailTo", "emailVerifyTokenHash", "leadId", "reportSnapshot", "claimedUserId", "idempotencyKey"];

  it("select của MỌI truy vấn không chứa cột cấm; kết quả serialize không chứa giá trị cấm", async () => {
    kho.rows = [bai("a")];
    const ds = await docDanhSachLuot(ME);
    const ct = await docChiTietLuot(ME, "a");
    await docLichSuGiaDinh(ME);
    for (const g of kho.goi.filter((x) => x.ham !== "count")) {
      const sel = g.args.select as Record<string, unknown>;
      expect(sel, `${g.ham} phải có select tường minh`).toBeTruthy();
      for (const c of CAM) expect(Object.keys(sel), `${g.ham} select ${c}`).not.toContain(c);
    }
    const json = JSON.stringify({ ds, ct, html: dungBaoCaoHtmlChoLuot(ct!) });
    for (const v of ["84900000000", "HASH-BI-MAT", "TOKEN-BI-MAT", "gia@example.invalid"]) expect(json).not.toContain(v);
  });
});

describe("[PD-04] phân trang", () => {
  it("mới nhất trước; 25 bài / 10 mỗi trang = 3 trang; trang quá giới hạn bị kẹp", async () => {
    kho.rows = Array.from({ length: 25 }, (_, i) => bai(`b${i}`, { ngay: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));
    const t1 = await docDanhSachLuot(ME, { trang: 1 });
    expect(t1.luot).toHaveLength(10);
    expect(t1.luot[0]!.id).toBe("b24");
    expect(t1.tongTrang).toBe(3);
    const t3 = await docDanhSachLuot(ME, { trang: 3 });
    expect(t3.luot.map((l) => l.id)).toEqual(["b4", "b3", "b2", "b1", "b0"]);
    expect((await docDanhSachLuot(ME, { trang: 99 })).trang).toBe(3);
    for (const x of ["abc", -2, 0, 1.5, NaN, undefined]) expect((await docDanhSachLuot(ME, { trang: x })).trang).toBe(1);
  });
});

describe("[PD-05] lịch sử theo thành viên", () => {
  const luot = (id: string, ngay: string, ph: LuotDisc["nguoi"][number]["diem"], ma = "BD-GIA", pb = "v1", ten = "Bé Giả"): LuotDisc => ({
    id,
    taoLuc: new Date(ngay),
    engineVersion: "gia-1",
    nguoi: [{ vaiTro: "HOC_SINH", hoTen: ten, namSinh: 2016, bacHoc: "3", nguoiLonQuanSat: false, diem: ph, maBoDe: ma, phienBanBoDe: pb }],
  });

  it("cùng bộ đề + phiên bản ⇒ chênh lệch (mới − cũ), thứ tự cũ→mới dù đầu vào lộn xộn", () => {
    const ls = dungLichSu([luot("2", "2026-12-01T00:00:00Z", { D: 50, I: 20, S: 30, C: 5 }), luot("1", "2026-11-01T00:00:00Z", { D: 40, I: 25, S: 30, C: 10 })]);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.moc.map((m) => m.luotId)).toEqual(["1", "2"]);
    expect(ls[0]!.moc[0]!.lyDoKhongSoSanh).toBe("MOC_DAU");
    expect(ls[0]!.moc[1]!.chenhLech).toEqual({ D: 10, I: -5, S: 0, C: -5 });
  });

  it("khác phiên bản / khác bộ đề ⇒ KHÔNG so; điểm cũ giữ nguyên (không tính lại)", () => {
    const ls = dungLichSu([
      luot("1", "2026-11-01T00:00:00Z", { D: 40, I: 25, S: 30, C: 10 }),
      luot("2", "2027-03-01T00:00:00Z", { D: 90, I: 90, S: 90, C: 90 }, "BD-GIA", "v2"),
      luot("3", "2027-09-01T00:00:00Z", { D: 1, I: 2, S: 3, C: 4 }, "BD-KHAC", "v2"),
    ]);
    const m = ls[0]!.moc;
    expect(m[1]!.chenhLech).toBeNull();
    expect(m[1]!.lyDoKhongSoSanh).toBe("KHAC_PHIEN_BAN");
    expect(m[2]!.chenhLech).toBeNull();
    expect(m[2]!.lyDoKhongSoSanh).toBe("KHAC_BO_DE");
    expect(m[0]!.diem).toEqual({ D: 40, I: 25, S: 30, C: 10 });
  });

  it("gom theo vai + tên (bỏ dấu cách thừa, hoa/thường); hai trẻ khác tên là hai chuỗi; người không đọc được điểm bị bỏ", () => {
    const ls = dungLichSu([
      luot("1", "2026-11-01T00:00:00Z", { D: 1, I: 1, S: 1, C: 1 }, "BD-GIA", "v1", "Bé  Giả"),
      luot("2", "2026-12-01T00:00:00Z", { D: 2, I: 2, S: 2, C: 2 }, "BD-GIA", "v1", "bé giả"),
      luot("3", "2026-12-01T00:00:00Z", { D: 3, I: 3, S: 3, C: 3 }, "BD-GIA", "v1", "Bé Khác"),
      luot("4", "2026-12-02T00:00:00Z", null, "BD-GIA", "v1", "Bé Hỏng"),
    ]);
    expect(ls.map((x) => x.moc.length).sort()).toEqual([1, 2]);
    expect(ls.find((x) => x.moc.length === 2)!.hoTen).toBe("bé giả"); // viết theo lượt mới nhất
    expect(chuanHoaTen("  Bé   Giả ")).toBe("bé giả");
  });

  it("đọc từ DB: chuỗi theo user, không lẫn bài người khác", async () => {
    kho.rows = [
      bai("1", { ngay: "2026-11-01T00:00:00Z" }),
      bai("2", { ngay: "2026-12-01T00:00:00Z" }),
      bai("x", { claimedUserId: NGUOI_KHAC, ngay: "2026-12-05T00:00:00Z" }),
    ];
    const ls = await docLichSuGiaDinh(ME);
    expect(ls.map((x) => x.moc.length)).toEqual([2, 2]);
    expect(ls.flatMap((x) => x.moc.map((m) => m.luotId))).not.toContain("x");
  });
});

describe("[PD-06] báo cáo tải lại", () => {
  it("thoát HTML trong tên; không lộ trường cấm; thiếu điểm ⇒ bỏ người đó, không ai ⇒ null", async () => {
    kho.rows = [bai("a", { subjects: [subj("PARENT", "<script>alert(1)</script>", { D: 1, I: 2, S: 3, C: 4 }), { ...subj("STUDENT", "Bé", { D: 1, I: 1, S: 1, C: 1 }), result: { hong: true } as unknown as ReturnType<typeof subj>["result"] }] })];
    const l = (await docChiTietLuot(ME, "a"))!;
    const html = dungBaoCaoHtmlChoLuot(l)!;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("Bé<");
    expect(dungBaoCaoHtmlChoLuot({ ...l, nguoi: l.nguoi.map((n) => ({ ...n, diem: null })) })).toBeNull();
  });
});
