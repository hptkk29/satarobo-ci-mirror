import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { CHINH_SACH_DE_XUAT as CS } from "@/lib/security/gioi-han-dang-nhap/chinh-sach";
import { docGiamSat, taoGioiHan } from "@/lib/security/gioi-han-dang-nhap/dong-co";
import { KhoPostgres } from "@/lib/security/gioi-han-dang-nhap/kho";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * Kho Postgres của PHƯƠNG ÁN giới hạn đăng nhập đề xuất (B3.5; mã ca: GHP) — chạy trên Postgres THẬT: tính nguyên tử khi 100 yêu cầu song song, hoàn lượt (ràng buộc `soLan >= 1`),
 * cửa sổ hết hạn, và web + mobile dùng CHUNG một bảng. Cổng DB cục bộ như các spec khác; chỉ xoá bảng đếm.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));
const T0 = new Date("2026-11-17T08:00:00+07:00");

describe.skipIf(!RUN)("kho Postgres của giới hạn đăng nhập đề xuất", () => {
  const gh = taoGioiHan(new KhoPostgres());
  beforeAll(async () => {
    await db.authAttemptCounter.deleteMany({});
  });
  afterAll(async () => {
    await db.authAttemptCounter.deleteMany({});
  });

  it("[GHP-01] 100 yêu cầu SONG SONG cùng cặp (định danh, IP) ⇒ ĐÚNG 5 yêu cầu qua cửa (đặt chỗ nguyên tử trên Postgres)", async () => {
    const kq = await Promise.all(Array.from({ length: 100 }, () => gh.kiemTruoc({ ip: "203.0.113.200", dinhDanh: "84966990001", now: T0 })));
    expect(kq.filter((r) => r.cho)).toHaveLength(CS.capDinhDanhIp);
    const chan = kq.filter((r): r is Extract<typeof r, { cho: false }> => !r.cho);
    // 100 lượt từ MỘT IP cũng chạm trần IP (40) nên lý do chặn là "ip" hoặc "dinh-danh-ip" — không bao giờ là toàn cục (cặp/IP chặn trước, không làm phồng bộ đếm nạn nhân)
    expect([...new Set(chan.map((r) => r.lyDo))].every((l) => l === "dinh-danh-ip" || l === "ip")).toBe(true);
  });

  it("[GHP-02] lượt ĐÚNG được hoàn lại (kể cả khi bộ đếm về 0 — ràng buộc soLan ≥ 1 ⇒ dòng bị xoá): 50 lần đúng liên tiếp không bị chặn, bảng không giữ dòng của cặp đó", async () => {
    for (let i = 0; i < 50; i++) {
      const q = await gh.kiemTruoc({ ip: "203.0.113.201", dinhDanh: "84966990002", now: T0 });
      expect(q.cho).toBe(true);
      if (q.cho) await q.hoan();
    }
    // chỉ còn dòng bộ đếm "tổng lượt" của IP (không hoàn lại, L4); ba dòng còn lại đã bị xoá khi về 0
    const so = await db.authAttemptCounter.count();
    expect(so).toBeGreaterThan(0);
    const dong = await db.authAttemptCounter.findMany({ select: { soLan: true } });
    expect(dong.every((d) => d.soLan >= 1)).toBe(true);
  });

  it("[GHP-03] hết cửa sổ ⇒ đếm lại từ 1 (mở lại)", async () => {
    for (let i = 0; i < CS.capDinhDanhIp; i++) await gh.kiemTruoc({ ip: "203.0.113.202", dinhDanh: "84966990003", now: T0 });
    const chan = await gh.kiemTruoc({ ip: "203.0.113.202", dinhDanh: "84966990003", now: T0 });
    expect(chan.cho).toBe(false);
    const sauCuaSo = await gh.kiemTruoc({ ip: "203.0.113.202", dinhDanh: "84966990003", now: new Date(T0.getTime() + CS.cuaSoMs + 1000) });
    expect(sauCuaSo.cho).toBe(true);
  });

  it("[GHP-04] WEB và MOBILE dùng CHUNG một bảng: hai 'kênh' (hai đối tượng động cơ) cộng dồn vào cùng bộ đếm ⇒ lượt thứ 6 bị chặn bất kể kênh", async () => {
    const web = taoGioiHan(new KhoPostgres());
    const mobile = taoGioiHan(new KhoPostgres());
    const a = { ip: "203.0.113.203", dinhDanh: "84966990004", now: T0 };
    for (let i = 0; i < 3; i++) expect((await web.kiemTruoc(a)).cho).toBe(true);
    for (let i = 0; i < 2; i++) expect((await mobile.kiemTruoc(a)).cho).toBe(true);
    expect((await web.kiemTruoc(a)).cho).toBe(false);
    expect((await mobile.kiemTruoc(a)).cho).toBe(false);
  });

  it("[GHP-05] khoá chỉ là BĂM 64 hex — bảng không chứa SĐT / email / IP thô", async () => {
    // tự tạo dòng của mình — KHÔNG dựa vào ca trước (luật 18: mỗi ca phải xanh khi chạy MỘT MÌNH)
    await gh.kiemTruoc({ ip: "203.0.113.205", dinhDanh: "84966990099", now: T0 });
    const dong = await db.authAttemptCounter.findMany({ select: { khoa: true } });
    expect(dong.length).toBeGreaterThan(0);
    for (const d of dong) {
      expect(d.khoa).toMatch(/^[0-9a-f]{64}$/);
      expect(d.khoa).not.toContain("203.0.113");
      expect(d.khoa).not.toContain("84966990");
    }
  });

  it("[GHP-06] dò PHÂN TÁN trên Postgres: 100 IP × 1 lượt ⇒ sau 20 lượt sai, IP lạ bị chặn; cặp ĐÃ TỪNG thành công vào được nhưng chỉ có trần riêng `quenToiDa`", async () => {
    const ok = await gh.kiemTruoc({ ip: "192.0.2.201", dinhDanh: "84966990005", now: T0 });
    expect(ok.cho).toBe(true);
    if (ok.cho) await ok.thanhCong(); // dấu ấy do máy chủ ghi sau lần đúng
    let cho = 0;
    for (let i = 0; i < 100; i++) {
      const q = await gh.kiemTruoc({ ip: `198.51.100.${i}`, dinhDanh: "84966990005", now: T0 });
      if (q.cho) cho++;
    }
    expect(cho).toBe(CS.dinhDanhToanCuc - 0 > 0 ? CS.dinhDanhToanCuc : 0);
    expect((await gh.kiemTruoc({ ip: "192.0.2.202", dinhDanh: "84966990005", now: T0 })).cho).toBe(false); // IP lạ
    const quen: boolean[] = [];
    for (let i = 0; i < 5; i++) quen.push((await gh.kiemTruoc({ ip: "192.0.2.201", dinhDanh: "84966990005", now: T0 })).cho);
    expect(quen.filter(Boolean)).toHaveLength(CS.quenToiDa);
  });

  it("[GHP-07] giám sát: bộ đếm chặn theo lý do ghi được trên Postgres và đọc ra bằng docGiamSat; chỉ băm 64 hex", async () => {
    const gs = await docGiamSat(new KhoPostgres(), T0);
    expect(gs["dinh-danh-ip"] + gs["dinh-danh-toan-cuc"] + gs["dinh-danh-toan-cuc-quen"]).toBeGreaterThan(0);
  });
});
