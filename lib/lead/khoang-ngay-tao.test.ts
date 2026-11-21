// @vitest-environment node
// [KNT] — «Từ ngày / Đến ngày» ở danh sách lead: ngày VN + đúng ngày cột «Ngày nhận lead» in. Hành vi trên Postgres thật: tests/lead-intake/khoang-ngay.spec.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { locNgayNhanLead } from "./khoang-ngay-tao";

const VN = (iso: string) => new Date(`${iso}+07:00`);
const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Ghép lại đúng ngữ nghĩa của mệnh đề để thử từng thời điểm mà không cần DB. */
function khop(w: ReturnType<typeof locNgayNhanLead>, createdAt: Date, lastInboundAt: Date | null): boolean {
  const so = (f: { gte?: Date; lte?: Date } | null | undefined, v: Date | null) => {
    if (f === null) return v === null;
    if (!f || !v) return false;
    return (f.gte ? v >= f.gte : true) && (f.lte ? v <= f.lte : true);
  };
  const dk = (c: Record<string, unknown>): boolean => {
    if ("OR" in c) return (c.OR as Record<string, unknown>[]).some(dk);
    if ("createdAt" in c) return so(c.createdAt as { gte?: Date; lte?: Date }, createdAt);
    if ("lastInboundAt" in c) return so(c.lastInboundAt as { gte?: Date; lte?: Date } | null, lastInboundAt);
    throw new Error("điều kiện lạ");
  };
  return ((w as { AND: Record<string, unknown>[] }).AND).every(dk);
}

describe("[KNT] khoảng ngày nhận lead theo giờ VN", () => {
  it("[KNT-00] không điền gì / sai định dạng ⇒ không lọc (không ném lỗi)", () => {
    expect(locNgayNhanLead(undefined, undefined)).toBeUndefined();
    expect(locNgayNhanLead("", "")).toBeUndefined();
    expect(locNgayNhanLead("abc", "13/11/2026")).toBeUndefined();
    expect(locNgayNhanLead("abc", "2026-11-13")).toBeDefined();
  });

  it("[KNT-01] «Từ ngày» 00:00 VN: lead 00:30 sáng ngày đó VÀO (bản cũ cắt ở 07:00 VN), 23:59 hôm trước KHÔNG", () => {
    const w = locNgayNhanLead("2026-11-13", undefined);
    expect(khop(w, VN("2026-11-13T00:30:00"), null)).toBe(true);
    expect(khop(w, VN("2026-11-12T23:59:59"), null)).toBe(false);
  });

  it("[KNT-02] «Đến ngày» hết 23:59:59.999 VN: lead 23:59 vào, lead 00:30 / 05:00 hôm sau KHÔNG (bản cũ cho lọt)", () => {
    const w = locNgayNhanLead(undefined, "2026-11-13");
    expect(khop(w, VN("2026-11-13T23:59:59.999"), null)).toBe(true);
    expect(khop(w, VN("2026-11-14T00:30:00"), null)).toBe(false);
    expect(khop(w, VN("2026-11-14T05:00:00"), null)).toBe(false);
  });

  it("[KNT-03] 🔴 lead CŨ vừa NHẬP LẠI hôm nay (createdAt ba tháng trước, lastInboundAt hôm nay) VÀO khi lọc hôm nay — cột in ngày hôm nay", () => {
    const w = locNgayNhanLead("2026-11-13", "2026-11-13");
    expect(khop(w, VN("2026-08-01T10:00:00"), VN("2026-11-13T10:59:00"))).toBe(true);
    // và KHÔNG còn nằm ở ngày tạo cũ vì cột không in ngày đó nữa
    expect(khop(locNgayNhanLead("2026-08-01", "2026-08-01"), VN("2026-08-01T10:00:00"), VN("2026-11-13T10:59:00"))).toBe(false);
  });

  it("[KNT-04] lead chưa từng nhập lại (lastInboundAt rỗng hoặc bằng createdAt) lọc theo createdAt như thường", () => {
    const w = locNgayNhanLead("2026-11-13", "2026-11-13");
    expect(khop(w, VN("2026-11-13T09:00:00"), null)).toBe(true);
    expect(khop(w, VN("2026-11-13T09:00:00"), VN("2026-11-13T09:00:00"))).toBe(true);
    expect(khop(w, VN("2026-11-10T09:00:00"), null)).toBe(false);
  });

  it("[KNT-W1] dây nối: trang /leads gọi hàm này và gộp vào AND (không đè điều kiện quyền sở hữu); không còn `new Date(dateFrom)`", () => {
    const s = doc("app/(admin)/admin/leads/page.tsx");
    expect(s.match(/locNgayNhanLead\(dateFrom, dateTo\)/g)).toHaveLength(1);
    expect(s).toMatch(/\.\.\.\(locNgay \? \[locNgay\] : \[\]\)/);
    expect(s).toMatch(/leadOwnershipWhere\(session\.user\.id\)/);
    expect(s).not.toMatch(/new Date\(dateFrom\)/);
    expect(s).not.toMatch(/T23:59:59/);
    expect(s).not.toMatch(/\.\.\.\(createdAt \?/);
  });

  it("[KNT-W2] thứ tự bảng có khoá phụ: `lastInboundAt` rỗng ở phần lớn phiếu nhập Excel ⇒ không có `createdAt`/`id` thì thứ tự giữa các trang không xác định (lặp/sót dòng)", () => {
    const s = doc("app/(admin)/admin/leads/page.tsx");
    const khoi = /const thuTuLead[^=]*=\s*\[([\s\S]*?)\]\s*\n/.exec(s)?.[1] ?? "";
    expect(khoi).toMatch(/lastInboundAt:\s*\{\s*sort:\s*'desc',\s*nulls:\s*'last'\s*\}/);
    expect(khoi).toMatch(/createdAt:\s*'desc'/);
    expect(khoi).toMatch(/id:\s*'desc'/);
  });
});
