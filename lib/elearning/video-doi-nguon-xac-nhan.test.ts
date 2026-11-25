// @vitest-environment node
/**
 * [XND] Xác nhận đổi nguồn video — chuỗi ký gắn NỘI DUNG + TẬP NGƯỜI HỌC (chống TOCTOU).
 *
 * Mỗi mã từ chối có MỘT ca riêng và ca đối chứng dương (cùng đầu vào, chỉ khác đúng một trường ⇒ đổi đúng mã đó). Không có
 * đối chứng thì "bị từ chối" đúng cả khi chuỗi hỏng hoàn toàn.
 */
import { describe, it, expect, vi } from "vitest";

// Tự đủ: không dựa vào NEXTAUTH_SECRET của máy chạy (máy dev thiếu/yếu secret là bẫy đã ghi ở prisma-db.md). Khoá thử cố định ≥ 32 ký tự.
vi.mock("@/lib/security/signing-key", () => ({ getSigningSecret: () => "secret-test-xnd-khong-dung-that-0123456789" }));

import {
  bamNguonMoi,
  bamTapTacDong,
  kiemXacNhan,
  kyXacNhan,
  XAC_NHAN_TTL_MS,
  type DongTacDong,
  type NoiDungXacNhan,
} from "@/lib/elearning/video-doi-nguon-xac-nhan";

const T0 = 1_800_000_000_000;
const DONG: DongTacDong[] = [
  { enrollmentId: "e1", lop: "H", tienDo: "I" },
  { enrollmentId: "e2", lop: "B", tienDo: "D" },
];
const ND: NoiDungXacNhan = {
  lessonId: "les1",
  userId: "u1",
  rev: 3,
  nguon: bamNguonMoi({ youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 300 }),
  dau: bamTapTacDong(DONG, 2),
};

describe("[XND-01] vòng ký – kiểm", () => {
  it("chuỗi vừa ký, kiểm với CHÍNH nội dung đó ⇒ ok", () => {
    expect(kiemXacNhan(kyXacNhan(ND, T0), ND, T0 + 1000)).toEqual({ ok: true });
  });
  it("còn hạn tới sát mốc, hết hạn ngay sau mốc (biên)", () => {
    const t = kyXacNhan(ND, T0);
    expect(kiemXacNhan(t, ND, T0 + XAC_NHAN_TTL_MS)).toEqual({ ok: true });
    expect(kiemXacNhan(t, ND, T0 + XAC_NHAN_TTL_MS + 1)).toEqual({ ok: false, ly: "HET_HAN" });
  });
});

describe("[XND-02] mỗi trường gắn trong chuỗi — đổi ĐÚNG một trường ⇒ đúng một mã", () => {
  const t = kyXacNhan(ND, T0);
  const cho = (sua: Partial<NoiDungXacNhan>) => kiemXacNhan(t, { ...ND, ...sua }, T0 + 1);
  it("người khác ⇒ KHAC_NGUOI", () => expect(cho({ userId: "u2" })).toEqual({ ok: false, ly: "KHAC_NGUOI" }));
  it("bài khác ⇒ KHAC_BAI", () => expect(cho({ lessonId: "les2" })).toEqual({ ok: false, ly: "KHAC_BAI" }));
  it("phiên bản nội dung đã đổi ⇒ KHAC_PHIEN_BAN", () => expect(cho({ rev: 4 })).toEqual({ ok: false, ly: "KHAC_PHIEN_BAN" }));
  it("xem trước video A rồi lưu video B ⇒ KHAC_NGUON", () => {
    const b = bamNguonMoi({ youtubeId: "ZzZzZzZzZz9", videoKey: null, durationSec: 300 });
    expect(cho({ nguon: b })).toEqual({ ok: false, ly: "KHAC_NGUON" });
  });
  it("cùng video nhưng thời lượng khác ⇒ KHAC_NGUON (mẫu số của mọi phần trăm)", () => {
    expect(cho({ nguon: bamNguonMoi({ youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 301 }) })).toEqual({
      ok: false,
      ly: "KHAC_NGUON",
    });
  });
  it("🔴 tập người học bị ảnh hưởng đã khác ⇒ TAC_DONG_DA_DOI (mọi thứ khác đúng)", () => {
    const them = bamTapTacDong([...DONG, { enrollmentId: "e3", lop: "H", tienDo: "N" }], 2);
    expect(cho({ dau: them })).toEqual({ ok: false, ly: "TAC_DONG_DA_DOI" });
  });
});

describe("[XND-03] chuỗi giả / hỏng / vắng", () => {
  const t = kyXacNhan(ND, T0);
  it("vắng ⇒ THIEU", () => {
    for (const x of [null, undefined, ""]) expect(kiemXacNhan(x, ND, T0), String(x)).toEqual({ ok: false, ly: "THIEU" });
  });
  it("thiếu dấu chấm / rỗng thân hoặc chữ ký ⇒ HONG", () => {
    for (const x of ["khongcodauchum", ".chuky", "than."]) expect(kiemXacNhan(x, ND, T0), x).toEqual({ ok: false, ly: "HONG" });
  });
  it("🔴 sửa thân (đổi userId trong payload) mà giữ chữ ký ⇒ HONG, không lọt thành người khác", () => {
    const [than, chuKy] = t.split(".");
    const p = JSON.parse(Buffer.from(than!, "base64url").toString("utf8")) as Record<string, unknown>;
    p.userId = "u-ke-tan-cong";
    const gia = `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${chuKy}`;
    expect(kiemXacNhan(gia, { ...ND, userId: "u-ke-tan-cong" }, T0 + 1)).toEqual({ ok: false, ly: "HONG" });
  });
  it("🔴 kéo dài hạn trong payload mà giữ chữ ký ⇒ HONG", () => {
    const [than, chuKy] = t.split(".");
    const p = JSON.parse(Buffer.from(than!, "base64url").toString("utf8")) as { exp: number };
    p.exp += 10 * XAC_NHAN_TTL_MS;
    const gia = `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${chuKy}`;
    expect(kiemXacNhan(gia, ND, T0 + XAC_NHAN_TTL_MS + 5)).toEqual({ ok: false, ly: "HONG" });
  });
  it("chữ ký lệch một ký tự ⇒ HONG", () => {
    const [than, chuKy] = t.split(".");
    const lech = chuKy!.slice(0, -1) + (chuKy!.endsWith("A") ? "B" : "A");
    expect(kiemXacNhan(`${than}.${lech}`, ND, T0 + 1)).toEqual({ ok: false, ly: "HONG" });
  });
  it("🔴 chuỗi ký cho mục đích KHÁC (vé media cùng khoá ký, khác tiền tố) không dùng làm xác nhận", async () => {
    const { kyVeMedia } = await import("@/lib/elearning/media-ticket");
    const ve = kyVeMedia({ lessonId: "les1", userId: "u1", rev: 3 });
    expect(kiemXacNhan(ve, ND, Date.now())).toEqual({ ok: false, ly: "HONG" });
  });
});

describe("[XND-04] dấu tập tác động", () => {
  it("không phụ thuộc thứ tự dòng", () => {
    expect(bamTapTacDong([...DONG].reverse(), 2)).toBe(bamTapTacDong(DONG, 2));
  });
  it("🔴 đổi bất kỳ yếu tố nào ⇒ dấu đổi: thêm người, người xong bài, người chuyển lớp, số câu hỏi chèn", () => {
    const goc = bamTapTacDong(DONG, 2);
    expect(bamTapTacDong([...DONG, { enrollmentId: "e3", lop: "H", tienDo: "N" }], 2)).not.toBe(goc);
    expect(bamTapTacDong([{ enrollmentId: "e1", lop: "H", tienDo: "D" }, DONG[1]!], 2)).not.toBe(goc);
    expect(bamTapTacDong([{ enrollmentId: "e1", lop: "B", tienDo: "I" }, DONG[1]!], 2)).not.toBe(goc);
    expect(bamTapTacDong(DONG, 3)).not.toBe(goc);
  });
  it("tập rỗng có dấu ổn định (khoá đã xuất bản, chưa ai học vẫn xác nhận được)", () => {
    expect(bamTapTacDong([], 0)).toBe(bamTapTacDong([], 0));
    expect(bamTapTacDong([], 0)).not.toBe(bamTapTacDong([], 1));
  });
  it("băm nguồn: YouTube và tệp cùng mã khác loại không trùng; không lộ nguồn trong chuỗi ký", () => {
    const yt = bamNguonMoi({ youtubeId: "abc", videoKey: null, durationSec: 60 });
    const tep = bamNguonMoi({ youtubeId: null, videoKey: "abc", durationSec: 60 });
    expect(yt).not.toBe(tep);
    const t = kyXacNhan({ ...ND, nguon: yt }, T0);
    const thanGiaiMa = Buffer.from(t.split(".")[0]!, "base64url").toString("utf8");
    expect(thanGiaiMa).not.toContain("aBcDeFg_H-1");
    expect(thanGiaiMa).not.toContain("elearning/master");
  });
});
