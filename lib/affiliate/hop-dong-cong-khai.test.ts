/**
 * [AHD-U-*] HỢP ĐỒNG CÔNG KHAI — phần THUẦN (không DB). Bản đối chiếu có Postgres: tests/lead-intake/affiliate-hop-dong.spec.ts.
 * Văn bản hợp đồng: docs/source-commission/closeout/quatang-hop-dong-intake.md — các con số dưới đây là THỨ ĐƯỢC GHI TRONG TÀI LIỆU ĐÓ;
 * đổi một hằng ở mã mà không sửa tài liệu (và đối tác đã tích hợp) là ca đỏ ở đây, không phải bất ngờ ở production.
 *
 *   [AHD-U-01] hằng số hợp đồng: trần thân · ngưỡng tần suất · độ dài token · tên cookie
 *   [AHD-U-02] lược đồ intake: tập khoá được phép là ĐÚNG 13 khoá (thêm/bớt = đổi hợp đồng); khoá lạ bị từ chối ở MỌI tầng
 *   [AHD-U-03] thứ tự cổng của lõi intake: thân quá lớn → JSON hỏng → lược đồ → honeypot → tần suất; honeypot KHÔNG tốn lượt tần suất và trả y câu thành công
 *   [AHD-U-04] tên trường Apps Script của quatang (QUATANG_FIELDS) khớp bảng trong tài liệu hợp đồng
 *   (Lưới ghim tài liệu ↔ mã `[AHD-U-05]` nằm ở `hop-dong-tai-lieu.test.ts` — đọc `docs/` nên chỉ chạy ở CI private.)
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: true })) }));

import { CAU_TRA_LOI_THANH_CONG, DO_DAI_THAN_INTAKE_TOI_DA, GIOI_HAN_INTAKE, xuLyIntakeGioiThieu, type PhuThuocIntake } from "./intake-cong-khai";
import { COOKIE_GIOI_THIEU, COOKIE_PHIEN, DO_DAI_THAN_BEACON_TOI_DA, GIOI_HAN_BAM_LINK, GIOI_HAN_BEACON, TUOI_COOKIE_PHIEN_GIAY } from "./theo-doi-cong-khai";
import { BANG_CHU_CROCKFORD, DO_DAI_TOKEN } from "./token";
import { AFFILIATE_HONEYPOT, affiliateIntakeSchema } from "@/lib/lead/intake/map-affiliate";
import { QUATANG_FIELDS } from "@/lib/lead/intake/map-quatang";

const HOP_LE = {
  v: 1,
  token: "K8F29XQ47M",
  clickId: "cm1abcdefghijklmnopqrstuv",
  idempotencyKey: "ahd-khoa-0001",
  parentName: "Phụ huynh",
  phone: "0906000777",
  email: "ph@example.com",
  children: [{ fullName: "Bé An", schoolName: "Trường A", gradeLevel: "Lớp 1" }],
  centerCode: "CS1",
  note: "ghi chú",
  consentMarketing: true,
  utm: { utm_source: "fb" },
  hp: "",
};

describe("[AHD-U-01] hằng số hợp đồng", () => {
  it("trần thân · ngưỡng tần suất · token · cookie giữ đúng giá trị đã công bố", () => {
    expect(DO_DAI_THAN_INTAKE_TOI_DA).toBe(16_384);
    expect(GIOI_HAN_INTAKE).toEqual({ max: 10, windowMs: 60_000 });
    expect(GIOI_HAN_BAM_LINK).toEqual({ max: 120, windowMs: 60_000 });
    expect(GIOI_HAN_BEACON).toEqual({ max: 120, windowMs: 60_000 });
    expect(DO_DAI_THAN_BEACON_TOI_DA).toBe(4096);
    expect(DO_DAI_TOKEN).toBe(10);
    expect(BANG_CHU_CROCKFORD).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    expect(BANG_CHU_CROCKFORD).not.toMatch(/[ILOU]/);
    expect(COOKIE_GIOI_THIEU).toBe("sr_aff");
    expect(COOKIE_PHIEN).toBe("sr_aff_s");
    expect(TUOI_COOKIE_PHIEN_GIAY).toBe(30 * 24 * 60 * 60);
  });
});

describe("[AHD-U-02] lược đồ intake", () => {
  it("đúng 13 khoá được phép; một thân dùng cả 13 khoá hợp lệ", () => {
    expect(Object.keys(affiliateIntakeSchema.shape).sort()).toEqual(
      ["children", "centerCode", "clickId", "consentMarketing", "email", "hp", "idempotencyKey", "note", "parentName", "phone", "token", "utm", "v"].sort(),
    );
    expect(AFFILIATE_HONEYPOT).toBe("hp");
    expect(affiliateIntakeSchema.safeParse(HOP_LE).success).toBe(true);
  });

  it("MỌI khoá lạ bị từ chối — gồm các khoá mà người viết biểu mẫu hay tưởng có tác dụng — ở cả tầng ngoài lẫn phần tử `children`", () => {
    for (const k of ["affiliateId", "partyId", "sourceGroupId", "source", "leadSource", "commissionRate", "rate", "employeeId", "employeeCode", "campaignId", "membershipId", "status", "assetId"]) {
      expect(affiliateIntakeSchema.safeParse({ ...HOP_LE, [k]: "x" }).success, k).toBe(false);
    }
    expect(affiliateIntakeSchema.safeParse({ ...HOP_LE, children: [{ fullName: "a", courseId: "x" }] }).success).toBe(false);
  });

  it("trần độ dài: token 40 · khoá chống lặp 8–64 ký tự [A-Za-z0-9_-] · tên 100 · email 120 · ghi chú 500 · tối đa 5 con · SĐT 20 · utm khoá 40/giá trị 200", () => {
    const sai = (over: Record<string, unknown>) => affiliateIntakeSchema.safeParse({ ...HOP_LE, ...over }).success;
    expect(sai({ token: "A".repeat(40) })).toBe(true);
    expect(sai({ token: "A".repeat(41) })).toBe(false);
    expect(sai({ token: "" })).toBe(false);
    expect(sai({ idempotencyKey: "a".repeat(7) })).toBe(false);
    expect(sai({ idempotencyKey: "a".repeat(8) })).toBe(true);
    expect(sai({ idempotencyKey: "a".repeat(64) })).toBe(true);
    expect(sai({ idempotencyKey: "a".repeat(65) })).toBe(false);
    expect(sai({ idempotencyKey: "có dấu cách" })).toBe(false);
    expect(sai({ parentName: "n".repeat(100) })).toBe(true);
    expect(sai({ parentName: "n".repeat(101) })).toBe(false);
    expect(sai({ email: `${"e".repeat(108)}@x.vn` })).toBe(true);
    expect(sai({ email: `${"e".repeat(116)}@x.vn` })).toBe(false);
    expect(sai({ note: "n".repeat(500) })).toBe(true);
    expect(sai({ note: "n".repeat(501) })).toBe(false);
    expect(sai({ children: new Array(5).fill({ fullName: "a" }) })).toBe(true);
    expect(sai({ children: new Array(6).fill({ fullName: "a" }) })).toBe(false);
    expect(sai({ phone: "0".repeat(21) })).toBe(false);
    expect(sai({ phone: "" })).toBe(false);
    expect(sai({ utm: { ["k".repeat(41)]: "v" } })).toBe(false);
    expect(sai({ utm: { k: "v".repeat(201) } })).toBe(false);
    expect(sai({ v: 2 })).toBe(false);
  });
});

describe("[AHD-U-03] thứ tự cổng của lõi intake (trước mọi truy cập DB)", () => {
  const dem = () => {
    const goi: string[] = [];
    const pt: PhuThuocIntake = {
      now: () => new Date("2026-10-13T03:00:00.000Z"),
      choPhepTanSuat: async (khoa) => {
        goi.push(khoa);
        return goi.length <= 10;
      },
      cho: async () => {},
      nhieuMs: () => 0,
    };
    return { goi, pt };
  };
  const chay = (thanTho: string, pt: PhuThuocIntake, ip = "203.0.113.5") => xuLyIntakeGioiThieu({ thanTho, origin: null, ip, userAgent: null }, pt);

  it("thân dài hơn 16 384 ký tự ⇒ 413 NGAY, không tốn lượt tần suất; đúng 16 384 thì đi tiếp (rồi hỏng ở JSON ⇒ 400)", async () => {
    const { goi, pt } = dem();
    expect((await chay("x".repeat(16_385), pt)).status).toBe(413);
    expect((await chay("x".repeat(16_384), pt)).status).toBe(400);
    expect(goi).toEqual([]);
  });

  it("JSON hỏng / sai lược đồ ⇒ 400 câu chung, không tốn lượt tần suất", async () => {
    const { goi, pt } = dem();
    const a = await chay("{hỏng", pt);
    const b = await chay(JSON.stringify({ ...HOP_LE, affiliateId: "x" }), pt);
    expect(a).toEqual({ status: 400, body: { ok: false, message: "Dữ liệu không hợp lệ." }, acao: null });
    expect(b).toEqual(a);
    expect(goi).toEqual([]);
  });

  it("honeypot có giá trị ⇒ 200 với ĐÚNG câu thành công, không ACAO, KHÔNG tốn lượt tần suất (bot không dò ra là đã bị chặn)", async () => {
    const { goi, pt } = dem();
    const kq = await chay(JSON.stringify({ ...HOP_LE, hp: "http://spam.example" }), pt);
    expect(kq).toEqual({ status: 200, body: { ok: true, message: CAU_TRA_LOI_THANH_CONG }, acao: null });
    expect(goi).toEqual([]);
  });

  it("tần suất khoá theo `aff-intake:<ip>`: lượt vượt ngưỡng ⇒ 429 câu cố định; SĐT hỏng được xét SAU tần suất (nên kẻ spam SĐT hỏng cũng bị chặn)", async () => {
    const { goi, pt } = dem();
    const thanSdtHong = JSON.stringify({ ...HOP_LE, phone: "abc" });
    for (let i = 0; i < 10; i += 1) expect((await chay(thanSdtHong, pt, "198.51.100.9")).status).toBe(400);
    const qua = await chay(thanSdtHong, pt, "198.51.100.9");
    expect(qua).toEqual({ status: 429, body: { ok: false, message: "Bạn gửi hơi nhanh. Đợi một phút rồi thử lại nhé." }, acao: null });
    expect(new Set(goi)).toEqual(new Set(["aff-intake:198.51.100.9"]));
  });
});

describe("[AHD-U-04] hợp đồng trường của quatang (Apps Script `doPost` v2.5)", () => {
  it("đúng 20 tên trường; thêm/đổi tên là đổi hợp đồng với Apps Script", () => {
    expect(Object.values(QUATANG_FIELDS).sort()).toEqual(
      [
        "ho_ten_con", "ho_ten", "sdt", "email", "truong", "lop", "co_so", "tinh", "source", "ip", "user_agent",
        "aff_ma_link_cuoi", "aff_ma_link_dau", "aff_ma_nv", "aff_ten_nv", "aff_click_id", "aff_thoi_diem_click", "aff_utm",
        "misa_status", "event_id",
      ].sort(),
    );
  });
});
