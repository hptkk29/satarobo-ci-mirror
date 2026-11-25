// @vitest-environment node
/**
 * EL-16 — TRANG XÁC MINH CÔNG KHAI: giới hạn tần suất + chống liệt kê + không rò dữ liệu (ADR-0002 §5).
 *
 * Trang này không đăng nhập; mọi thứ nó trả đều đi ra internet. Ba điều phải đứng vững, và test thuần trước
 * đây không canh điều nào (chỉ có test cờ OFF):
 *
 *  1. TẦN SUẤT — mỗi IP 30 lượt/phút, đếm cả lượt trượt, kiểm TRƯỚC mọi truy vấn.
 *  2. CHỐNG LIỆT KÊ — token sai định dạng, token đúng định dạng nhưng không tồn tại: cùng một kết quả `null`,
 *     cùng một trang; sai định dạng không chạm DB.
 *  3. KHÔNG RÒ — kết quả có ĐÚNG các khoá đã khai; câu `select` không kéo `revokeReason` / `pdfKey` / `userId`…
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  cn: vi.fn(async (_a: Record<string, unknown>) => null as Record<string, unknown> | null),
  khoa: vi.fn(async (_a: Record<string, unknown>) => ({ title: "An toàn lao động" }) as { title: string } | null),
  xff: "203.0.113.7",
}));

vi.mock("@/lib/db", () => ({
  db: { trnCertificate: { findUnique: h.cn }, trnCourse: { findUnique: h.khoa } },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": h.xff }),
}));

import { traChungNhan } from "@/lib/elearning/certificate-verify";
import { GIOI_HAN_XAC_THUC, choPhepTraChungNhan } from "@/lib/elearning/certificate-verify-limit";
import XacThucPage from "@/app/(elearning)/xac-thuc/[token]/page";

const TOKEN = "Abcdefghijklmnopqrstuvwxyz012345"; // 32 ký tự base64url
const CHUNG_NHAN = {
  certCode: "SR.CN.2026.00001",
  snapFullName: "Nguyễn Văn A",
  snapEmployeeCode: "NV0001",
  issuedAt: new Date("2026-03-01T00:00:00Z"),
  validUntil: null,
  revokedAt: null,
  status: "VALID",
  courseId: "k1",
};
const params = (token: string) => ({ params: Promise.resolve({ token }) });
const html = async (token: string) => renderToStaticMarkup(await XacThucPage(params(token)));

const envCu = process.env.ELEARNING_ENABLED;
// Bộ đếm tần suất dùng Upstash khi máy có biến `UPSTASH_*`/`KV_*` (máy dev có thể có trong .env) — khi đó số đếm nằm ở Redis
// dùng chung, sống qua các lượt chạy và làm test lúc xanh lúc đỏ. CI không có biến này. Test PHẢI hermetic: gỡ biến, dùng bộ đếm bộ nhớ.
const BIEN_REDIS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;
const redisCu = Object.fromEntries(BIEN_REDIS.map((k) => [k, process.env[k]]));
let ipThu = 0;
beforeEach(() => {
  for (const k of BIEN_REDIS) delete process.env[k];
  process.env.ELEARNING_ENABLED = "true";
  h.cn.mockClear();
  h.khoa.mockClear();
  // Mỗi ca một IP riêng: bộ đếm tần suất sống trong bộ nhớ tiến trình, ca này không được mượn số đếm của ca khác (luật 18).
  h.xff = `198.51.100.${++ipThu}`;
});
afterEach(() => {
  if (envCu === undefined) delete process.env.ELEARNING_ENABLED;
  else process.env.ELEARNING_ENABLED = envCu;
  for (const k of BIEN_REDIS) {
    if (redisCu[k] === undefined) delete process.env[k];
    else process.env[k] = redisCu[k];
  }
});

describe("🔴 giới hạn tần suất — hành vi", () => {
  it("ngưỡng ghim ở 30 lượt / 60 giây (ADR-0002 §6)", () => {
    expect(GIOI_HAN_XAC_THUC).toEqual({ max: 30, windowMs: 60_000 });
  });

  it("đúng 30 lượt đầu qua, lượt thứ 31 bị chặn", async () => {
    const ip = "192.0.2.1";
    for (let i = 1; i <= GIOI_HAN_XAC_THUC.max; i++) {
      expect(await choPhepTraChungNhan(ip), `lượt ${i}`).toBe(true);
    }
    expect(await choPhepTraChungNhan(ip)).toBe(false);
  });

  it("ĐỐI CHỨNG DƯƠNG: IP khác không bị chặn lây khi một IP đã vượt ngưỡng", async () => {
    const xau = "192.0.2.2";
    for (let i = 0; i <= GIOI_HAN_XAC_THUC.max; i++) await choPhepTraChungNhan(xau);
    expect(await choPhepTraChungNhan(xau)).toBe(false);
    expect(await choPhepTraChungNhan("192.0.2.3")).toBe(true);
  });
});

describe("🔴 giới hạn tần suất — trên TRANG", () => {
  it("vượt ngưỡng ⇒ KHÔNG tra DB, trang nói 'thử lại', không có dữ liệu chứng nhận", async () => {
    h.cn.mockResolvedValue(CHUNG_NHAN);
    for (let i = 0; i < GIOI_HAN_XAC_THUC.max; i++) await html(TOKEN);
    h.cn.mockClear();
    const trang = await html(TOKEN);
    expect(h.cn).not.toHaveBeenCalled();
    expect(trang).toContain("Tra cứu quá nhanh");
    expect(trang).not.toContain("Nguyễn Văn A");
    expect(trang).not.toContain("NV0001");
  });

  it("ĐỐI CHỨNG DƯƠNG: dưới ngưỡng ⇒ trang trả đúng chứng nhận", async () => {
    h.cn.mockResolvedValue(CHUNG_NHAN);
    const trang = await html(TOKEN);
    expect(h.cn).toHaveBeenCalledTimes(1);
    expect(trang).toContain("Nguyễn Văn A");
    expect(trang).not.toContain("Tra cứu quá nhanh");
  });

  it("lượt TRƯỢT cũng bị đếm: 30 lượt token lạ rồi lượt thứ 31 bị chặn (kẻ dò toàn lượt trượt)", async () => {
    h.cn.mockResolvedValue(null);
    for (let i = 0; i < GIOI_HAN_XAC_THUC.max; i++) await html(TOKEN);
    expect(await html(TOKEN)).toContain("Tra cứu quá nhanh");
  });

  it("cờ OFF ⇒ 404 và KHÔNG tốn một lượt trong bộ đếm của người hỏi", async () => {
    delete process.env.ELEARNING_ENABLED;
    await expect(XacThucPage(params(TOKEN))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    process.env.ELEARNING_ENABLED = "true";
    h.cn.mockResolvedValue(CHUNG_NHAN);
    for (let i = 0; i < GIOI_HAN_XAC_THUC.max; i++) expect(await html(TOKEN)).toContain("Nguyễn Văn A");
  });
});

describe("🔴 chống liệt kê — mọi kiểu 'không có' trông Y HỆT nhau", () => {
  it("token sai định dạng (ngắn · dài · ký tự lạ · rỗng) ⇒ null và KHÔNG chạm DB", async () => {
    for (const t of ["", "abc", "x".repeat(31), "x".repeat(33), "x".repeat(300), `${"x".repeat(31)}!`, `${"x".repeat(30)} /`]) {
      expect(await traChungNhan(t), JSON.stringify(t)).toBeNull();
    }
    expect(h.cn).not.toHaveBeenCalled();
  });

  it("token đúng định dạng nhưng không tồn tại ⇒ null (cùng giá trị với sai định dạng)", async () => {
    h.cn.mockResolvedValue(null);
    expect(await traChungNhan(TOKEN)).toBeNull();
    expect(h.cn).toHaveBeenCalledTimes(1);
  });

  it("trang: sai định dạng và không tồn tại cho CÙNG MỘT trang từng byte", async () => {
    h.cn.mockResolvedValue(null);
    const saiDinhDang = await html("abc");
    const khongTonTai = await html(TOKEN);
    expect(saiDinhDang).toBe(khongTonTai);
    expect(khongTonTai).toContain("Không tìm thấy chứng nhận");
  });

  it("ĐỐI CHỨNG DƯƠNG: token thật cho trang khác hẳn trang 'không tìm thấy'", async () => {
    h.cn.mockResolvedValue(null);
    const khong = await html(TOKEN);
    h.cn.mockResolvedValue(CHUNG_NHAN);
    expect(await html(TOKEN)).not.toBe(khong);
  });
});

describe("🔴 không rò dữ liệu — đúng các trường đã khai", () => {
  it("kết quả có ĐÚNG 7 khoá: 5 trường của đặc tả + câu trạng thái + số hiệu", async () => {
    h.cn.mockResolvedValue(CHUNG_NHAN);
    const kq = await traChungNhan(TOKEN);
    expect(kq).not.toBeNull();
    expect(Object.keys(kq!).sort()).toEqual(
      ["cauTrangThai", "hoTen", "maChungNhan", "maNhanVien", "ngayCap", "tenKhoa", "trangThai"].sort(),
    );
  });

  it("câu `select` KHÔNG kéo cột nhạy cảm (userId · lý do thu hồi · pdfKey · phiên bản · ghi danh)", async () => {
    h.cn.mockResolvedValue(CHUNG_NHAN);
    await traChungNhan(TOKEN);
    const select = (h.cn.mock.calls[0]![0] as { select: Record<string, boolean> }).select;
    for (const cam of ["userId", "revokeReason", "revokedByUserId", "pdfKey", "enrollmentId", "courseVersionId", "id", "verifyToken", "orgUnitId", "centerId"]) {
      expect(Object.keys(select), cam).not.toContain(cam);
    }
    expect((h.cn.mock.calls[0]![0] as { where: unknown }).where).toEqual({ verifyToken: TOKEN });
  });

  it("chứng nhận THU HỒI: nói 'thu hồi' nhưng KHÔNG lộ lý do (ở kết quả lẫn ở trang)", async () => {
    h.cn.mockResolvedValue({ ...CHUNG_NHAN, status: "REVOKED", revokedAt: new Date("2026-04-01T00:00:00Z"), revokeReason: "BÍ-MẬT-LÝ-DO-THU-HỒI" });
    const kq = await traChungNhan(TOKEN);
    expect(kq!.trangThai).toBe("REVOKED");
    expect(JSON.stringify(kq)).not.toContain("BÍ-MẬT-LÝ-DO-THU-HỒI");
    expect(await html(TOKEN)).not.toContain("BÍ-MẬT-LÝ-DO-THU-HỒI");
  });

  it("chứng nhận HẾT HẠN ⇒ trạng thái EXPIRED (suy từ validUntil, không đọc cột status)", async () => {
    h.cn.mockResolvedValue({ ...CHUNG_NHAN, validUntil: new Date("2000-01-01T00:00:00Z") });
    expect((await traChungNhan(TOKEN))!.trangThai).toBe("EXPIRED");
  });

  it("route xác minh chỉ nhận `[token]` — không có route công khai nào nhận `id`", async () => {
    const { readdirSync } = await import("node:fs");
    const xacThuc = readdirSync("app/(elearning)/xac-thuc");
    expect(xacThuc).toEqual(["[token]"]);
  });
});

