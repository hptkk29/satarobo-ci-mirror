import { describe, expect, it, vi } from "vitest";
import { bam } from "./luu";
import { dungBaoCao, dungBaoCaoHtml, taiBaoCao, type BanTai, type TaiStore } from "./tai-bao-cao";

// Dữ liệu GIẢ. Mốc thời gian tuyệt đối (luật 19).
const NOW = new Date("2026-11-01T03:00:00Z");
const TOKEN = "token-gia-0123456789abcdef";
const diem = { D: 40, I: 30, S: 20, C: 10 };
const ban = (o: Partial<BanTai> = {}): BanTai => ({
  downloadTokenHash: bam(TOKEN),
  downloadTokenExpires: new Date(NOW.getTime() + 60_000),
  claimStatus: "PENDING_CLAIM",
  deletedAt: null,
  createdAt: new Date("2026-11-01T02:40:00Z"),
  engineVersion: "engine-GIA-1",
  subjects: [
    { role: "PARENT", fullName: "Mai Giả", birthYear: 1988, grade: null, observedByAdult: false, result: { diem, maBoDe: "PH-GIA", phienBanBoDe: "g1" } },
    { role: "STUDENT", fullName: "Minh Giả", birthYear: 2016, grade: "4", observedByAdult: false, result: { diem, maBoDe: "HS-GIA", phienBanBoDe: "g1" } },
  ],
  ...o,
});
const kho = (b: BanTai | null) => {
  const tim = vi.fn(async (_hash: string) => b);
  const store: TaiStore = { timTheoHashToken: tim };
  return { store, tim };
};

describe("[DISC-TAI-01] taiBaoCao", () => {
  it("token đúng, còn hạn ⇒ báo cáo dựng từ snapshot; tra bằng HASH (không plaintext)", async () => {
    const { store, tim } = kho(ban());
    const r = await taiBaoCao({ token: TOKEN, store, now: NOW });
    expect(r.ok && r.baoCao.nguoi.map((n) => n.vaiTro)).toEqual(["PHU_HUYNH", "HOC_SINH"]);
    expect(r.ok && r.baoCao.nguoi[1]).toMatchObject({ hoTen: "Minh Giả", bacHoc: "4", diem });
    expect(tim).toHaveBeenCalledWith(bam(TOKEN));
    expect(JSON.stringify(tim.mock.calls)).not.toContain(TOKEN);
  });
  it.each([
    ["không có token", undefined],
    ["token rỗng", ""],
    ["token quá ngắn", "abc"],
    ["token quá dài", "x".repeat(129)],
    ["không phải chuỗi", 12345],
  ])("%s ⇒ TOKEN_KHONG_HOP_LE, không chạm store", async (_t, token) => {
    const { store, tim } = kho(ban());
    expect(await taiBaoCao({ token, store, now: NOW })).toEqual({ ok: false, loi: "TOKEN_KHONG_HOP_LE" });
    expect(tim).not.toHaveBeenCalled();
  });
  it("mọi lý do từ chối đều cùng một mã lỗi (không oracle)", async () => {
    const loi = { ok: false, loi: "TOKEN_KHONG_HOP_LE" };
    const truong: Array<[string, BanTai | null]> = [
      ["không tìm thấy", null],
      ["hết hạn", ban({ downloadTokenExpires: new Date(NOW.getTime() - 1) })],
      ["đúng mốc hết hạn", ban({ downloadTokenExpires: NOW })],
      ["đã xoá", ban({ deletedAt: NOW })],
      ["EXPIRED", ban({ claimStatus: "EXPIRED" })],
      ["REVOKED", ban({ claimStatus: "REVOKED" })],
      ["thiếu hash", ban({ downloadTokenHash: null })],
      ["thiếu hạn", ban({ downloadTokenExpires: null })],
      ["store trả bài của token khác (hash lệch)", ban({ downloadTokenHash: bam("token-khac-0123456789abcdef") })],
      ["kết quả đã bị xoá nội dung (result rỗng)", ban({ subjects: [{ role: "PARENT", fullName: "A", birthYear: 1988, grade: null, observedByAdult: false, result: {} }, { role: "STUDENT", fullName: "B", birthYear: 2016, grade: "4", observedByAdult: false, result: {} }] })],
      ["thiếu hồ sơ người", ban({ subjects: [] })],
    ];
    for (const [ten, b] of truong) expect(await taiBaoCao({ token: TOKEN, store: kho(b).store, now: NOW }), ten).toEqual(loi);
  });
  it("[F-11] bài đã CLAIMED ⇒ token CHẾT dù còn hạn (bearer cũ không đọc được bài đã thuộc tài khoản chủ); PENDING_CLAIM vẫn tải được", async () => {
    expect(await taiBaoCao({ token: TOKEN, store: kho(ban({ claimStatus: "CLAIMED" })).store, now: NOW })).toEqual({ ok: false, loi: "TOKEN_KHONG_HOP_LE" });
    expect((await taiBaoCao({ token: TOKEN, store: kho(ban({ claimStatus: "PENDING_CLAIM" })).store, now: NOW })).ok).toBe(true);
  });
});

describe("[DISC-TAI-02] HTML in được", () => {
  it("thoát mọi chuỗi từ người dùng (không XSS qua tên)", () => {
    const b = dungBaoCao(
      ban({
        subjects: [
          { role: "PARENT", fullName: '<script>alert("x")</script>', birthYear: 1988, grade: null, observedByAdult: false, result: { diem, maBoDe: "PH-GIA", phienBanBoDe: "g1" } },
          { role: "STUDENT", fullName: "A & B <img src=x onerror=1>", birthYear: 2016, grade: "4", observedByAdult: true, result: { diem, maBoDe: "HS-GIA", phienBanBoDe: "g1" } },
        ],
      }),
    )!;
    const html = dungBaoCaoHtml(b);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("Người lớn quan sát");
  });
  it("có điểm D/I/S/C và không nhúng tài nguyên ngoài", () => {
    const html = dungBaoCaoHtml(dungBaoCao(ban())!);
    expect(html).toContain("<td>40</td><td>30</td><td>20</td><td>10</td>");
    expect(html).not.toMatch(/(src|href)=/);
    expect(html).toContain('lang="vi"');
  });
});
