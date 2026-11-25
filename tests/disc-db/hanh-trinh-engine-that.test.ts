// @vitest-environment node
/**
 * [HT-ET-*] HÀNH TRÌNH ĐẦU-CUỐI bằng ENGINE THẬT (`ensureDiscEngine`) + HÀM XỬ LÝ route thật + Postgres thật. Không engine giả.
 *   [HT-ET-00] đối chứng dương: engine đang dùng là engine THẬT
 *   [HT-ET-01] bộ đề thật theo bậc học/tuổi (MN · lớp 1–2 · TH · THCS · PH); trẻ <8 tuổi ⇒ bộ quan sát (người lớn trả lời hộ)
 *   [HT-ET-02] hành trình PH+HS ⇒ 200; server CHẤM LẠI (bằng engine, không bằng điểm client); điểm lưu = engine.cham(câu trả lời)
 *   [HT-ET-03] gửi ĐIỂM GIẢ của client (kể cả cùng với bài thật) ⇒ bị bỏ qua; chỉ gửi điểm ⇒ 400, KHÔNG ghi gì
 *   [HT-ET-04] idempotent: cùng khoá+cùng nội dung ⇒ cùng submission (token xoay); cùng khoá khác nội dung ⇒ lỗi CHUNG, không đổi gì
 *   [HT-ET-05] PENDING_CLAIM; phoneKey = HMAC (không có SĐT thô trong bất kỳ cột Disc* nào)
 *   [HT-ET-06] KHÔNG lưu câu trả lời thô (id câu/giá trị) trong DiscSubmission/DiscSubject
 *   [HT-ET-07] Lead: đúng MỘT lần; lưu lặp (khoá khác) không thêm lead; không điểm/tên con/năm sinh trong Lead·Attribution·Touchpoint·Activity
 *   [HT-ET-07b] lead CÓ SẴN (nguồn khác) không bị đổi nguồn
 *   [HT-ET-08] phản hồi TRUNG TÍNH: SĐT mới và SĐT đã là lead cho cùng hình dạng, không lộ "đã tồn tại"
 *   [HT-ET-09] TRA_LOI_PHANG có thông điệp RIÊNG (không rơi về thông điệp chung) và không ghi gì
 *   [HT-ET-10] bộ đề không khớp hồ sơ (trẻ <8 tuổi gửi bộ TH tự đánh giá) ⇒ từ chối
 *   [HT-ET-11] email: có email ⇒ VERIFICATION_REQUIRED, thư xác minh xếp hàng (PENDING, KHÔNG phải đã gửi); chưa có thư báo cáo
 *   [HT-ET-12] giá trị ngoài thang của bộ (4 trên bộ 3 mức), id lạ, thiếu câu ⇒ 400, không ghi gì
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { ensureDiscEngine } from "../../lib/disc/engine-dang-ky";
import { layEngine } from "../../lib/disc/engine";
import { layKhoaDisc, phoneKeyTuSdtChuan } from "../../lib/disc/phone-key";
import { P, RUN, assertCiTest, don, khoaIdem, sdtChuan, sdtMoi } from "./_fx";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { clearSettingsCache } from "../../lib/settings/service";
import { TEN_HS, batMoiTruongThu, dungYeuCauLuu, goiLuu, layBoDe, namNay, traLoiBienThien, traLoiPhang } from "./_hanh-trinh";

const describeDb = RUN ? describe : describe.skip;
batMoiTruongThu();

const docBai = (key: string) => db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key }, include: { subjects: true } });
const demBai = (key: string) => db.discSubmission.count({ where: { idempotencyKey: key } });
const donThu = () => db.emailQueue.deleteMany({ where: { contextType: { in: ["DISC_EMAIL_VERIFY", "DISC_REPORT"] }, toEmail: { endsWith: "@example.test" } } });
type TraLoi = Record<string, number>;

describeDb("[HT-ET] hành trình đầu-cuối với engine THẬT", () => {
  beforeAll(async () => {
    await assertCiTest();
    ensureDiscEngine();
    await donThu();
    await don();
    // Tiền đề quy nguồn do CHÍNH bộ này dựng (như crm.test.ts): ở CI, các bộ chạy trước để lại cấu hình nguồn khác với DB dev ⇒ lead không có attribution.
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU, {});
    clearSettingsCache();
  });
  afterAll(async () => {
    await donThu();
    await don();
    await db.$disconnect();
  });

  it("[HT-ET-00] đối chứng dương: engine THẬT đang được dùng (không phải engine giả)", () => {
    const e = layEngine();
    expect(e).not.toBeNull();
    expect(e!.phienBan).toMatch(/^sr-disc\//);
  });

  it("[HT-ET-01] bộ đề thật theo bậc học/tuổi; trẻ <8 tuổi ⇒ bộ quan sát do người lớn trả lời hộ", async () => {
    const n = namNay();
    const mn = await layBoDe("HS", n - 5, "MN");
    expect(mn.doiTuong).toBe("MN");
    expect(mn.nguoiLonTraLoiHo).toBe(true);
    const l1 = await layBoDe("HS", n - 7, "1");
    expect(l1.nguoiLonTraLoiHo).toBe(true);
    const l2 = await layBoDe("HS", n - 8, "2");
    expect(l2.nguoiLonTraLoiHo).toBe(true);
    const th = await layBoDe("HS", n - 10, "4");
    expect(th.doiTuong).toBe("TH");
    expect(th.nguoiLonTraLoiHo).toBe(false);
    const lech = await layBoDe("HS", n - 6, "4"); // khai lớp 4 nhưng 6 tuổi ⇒ vẫn bộ quan sát
    expect(lech.nguoiLonTraLoiHo).toBe(true);
    const thcs = await layBoDe("HS", n - 13, "7");
    expect(thcs.doiTuong).toBe("THCS");
    const ph = await layBoDe("PH", n - 38);
    expect(ph.doiTuong).toBe("PH");
    for (const b of [mn, l1, th, thcs, ph]) {
      expect(b.thang?.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(b)).not.toMatch(/"(truc|dao|soiGuong|trong|weight)"/);
      for (const c of b.cauHoi) expect(Object.keys(c).sort()).toEqual(["id", "noiDung"]);
    }
    expect(th.thang!.map((m) => m.gia)).toEqual([1, 2, 3]); // bộ Tiểu học 3 mức — giao diện KHÔNG được giả định 1–5
  });

  it("[HT-ET-02] hành trình PH+HS: server CHẤM LẠI; điểm lưu == engine.cham(câu trả lời)", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("ht");
    const { body, boPh, boHs } = await dungYeuCauLuu(sdt, { key });
    const r = await goiLuu(body);
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(typeof r.json.tokenTai).toBe("string");
    expect(typeof r.json.maNhan).toBe("string");
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    const bai = await docBai(key);
    expect(bai.subjects).toHaveLength(2);
    const e = layEngine()!;
    const kqPh = e.cham(boPh.ma, body.bai.phuHuynh.traLoi);
    const kqHs = e.cham(boHs.ma, body.bai.hocSinh.traLoi);
    expect(kqPh.ok && kqHs.ok).toBe(true);
    const ph = bai.subjects.find((s) => s.role === "PARENT")!;
    const hs = bai.subjects.find((s) => s.role === "STUDENT")!;
    expect((ph.result as { diem: unknown }).diem).toEqual(kqPh.ok ? kqPh.ketQua.diem : null);
    expect((hs.result as { diem: unknown }).diem).toEqual(kqHs.ok ? kqHs.ketQua.diem : null);
    expect(bai.engineVersion).toBe(e.phienBan);
    expect(hs.observedByAdult).toBe(false);
  });

  it("[HT-ET-03] điểm GIẢ của client bị bỏ qua; chỉ điểm (không bài) ⇒ 400 và KHÔNG ghi", async () => {
    const diemGia = { D: 100, I: 100, S: 100, C: 100 };
    const ketQuaGia = {
      engineVersion: "gia",
      phuHuynh: { diem: diemGia, maBoDe: "PH", phienBanBoDe: "x" },
      hocSinh: { diem: diemGia, maBoDe: "TH", phienBanBoDe: "x" },
    };
    const key = khoaIdem("ht");
    const { body } = await dungYeuCauLuu(sdtMoi(), { key });
    expect((await goiLuu({ ...body, ketQua: ketQuaGia })).status).toBe(200);
    const bai = await docBai(key);
    for (const s of bai.subjects) expect((s.result as { diem: unknown }).diem).not.toEqual(diemGia);
    expect(bai.engineVersion).not.toBe("gia");

    const key2 = khoaIdem("ht");
    const { body: b2 } = await dungYeuCauLuu(sdtMoi(), { key: key2 });
    const { bai: _bo, ...khongBai } = b2;
    void _bo;
    const r2 = await goiLuu({ ...khongBai, ketQua: ketQuaGia });
    expect(r2.status).toBe(400);
    expect(r2.json.loi).toBe("DU_LIEU_KHONG_HOP_LE");
    expect(await demBai(key2)).toBe(0);
  });

  it("[HT-ET-04] idempotent: cùng khoá+nội dung ⇒ cùng submission; khác nội dung ⇒ lỗi chung, không đổi gì", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("ht");
    const { body } = await dungYeuCauLuu(sdt, { key });
    const a = await goiLuu(body);
    const b = await goiLuu(body);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.json.submissionId).toBe(a.json.submissionId);
    expect(b.json.tokenTai).not.toBe(a.json.tokenTai);
    expect(await demBai(key)).toBe(1);
    expect((await docBai(key)).subjects).toHaveLength(2);
    expect(await db.lead.count({ where: { phone: { in: [sdt, sdtChuan(sdt)] }, deletedAt: null } })).toBe(1);

    const truoc = await docBai(key);
    const c = await goiLuu({ ...body, hocSinh: { ...body.hocSinh, hoTen: "Tên Khác Hẳn" } });
    expect(c.status).toBe(503);
    expect(c.json.loi).toBe("LUU_THAT_BAI");
    const sau = await docBai(key);
    expect(sau.subjects.map((s) => s.fullName).sort()).toEqual(truoc.subjects.map((s) => s.fullName).sort());
    expect(sau.downloadTokenHash).toBe(truoc.downloadTokenHash);
    const { body: b3 } = await dungYeuCauLuu(sdt, { key, lech: 2 }); // cùng khoá, khác câu trả lời
    expect((await goiLuu(b3)).json.loi).toBe("LUU_THAT_BAI");
  });

  it("[HT-ET-05] PENDING_CLAIM; phoneKey là HMAC; không có SĐT thô trong cột Disc*", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("ht");
    const { body } = await dungYeuCauLuu(sdt, { key });
    expect((await goiLuu(body)).status).toBe(200);
    const bai = await docBai(key);
    expect(bai.claimStatus).toBe("PENDING_CLAIM");
    expect(bai.claimedUserId).toBeNull();
    expect(bai.phoneKey).toBe(phoneKeyTuSdtChuan(sdtChuan(sdt), layKhoaDisc()));
    const raw = JSON.stringify(await db.$queryRaw`select * from "DiscSubmission" where id = ${bai.id}`) + JSON.stringify(await db.$queryRaw`select * from "DiscSubject" where "submissionId" = ${bai.id}`);
    expect(raw).not.toContain(sdt);
    expect(raw).not.toContain(sdt.slice(1));
    expect(bai.claimCodeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[HT-ET-06] KHÔNG lưu câu trả lời thô", async () => {
    const key = khoaIdem("ht");
    const { body, boPh, boHs } = await dungYeuCauLuu(sdtMoi(), { key });
    expect((await goiLuu(body)).status).toBe(200);
    const bai = await docBai(key);
    const nhat = JSON.stringify(bai);
    for (const c of [...boPh.cauHoi, ...boHs.cauHoi]) expect(nhat, c.id).not.toContain(`"${c.id}"`);
    expect(nhat).not.toContain("traLoi");
    for (const s of bai.subjects) expect(Object.keys(s.result as object).sort()).toEqual(["diem", "maBoDe", "phienBanBoDe"]);
  });

  it("[HT-ET-07] Lead đúng một lần; không đổi nguồn lead cũ; không dữ liệu trẻ trong CRM", async () => {
    const sdt = sdtMoi();
    const a = khoaIdem("ht");
    const { body } = await dungYeuCauLuu(sdt, { key: a, tiepThi: true, email: "khach-gia@example.test" });
    expect((await goiLuu(body)).status).toBe(200);
    const whereLead = { phone: { in: [sdt, sdtChuan(sdt)] }, deletedAt: null };
    const leads = await db.lead.findMany({ where: whereLead, include: { attribution: { include: { group: { select: { code: true } } } } } });
    expect(leads).toHaveLength(1);
    const lead = leads[0]!;
    expect(lead.consentMarketing).toBe(false);
    expect(lead.email).toBeNull();
    const nguonLanDau = lead.attribution?.group.code;
    expect(nguonLanDau).toBeTruthy();

    const b = khoaIdem("ht");
    const { body: b2 } = await dungYeuCauLuu(sdt, { key: b, lech: 1 });
    expect((await goiLuu(b2)).status).toBe(200);
    expect(await db.lead.count({ where: whereLead })).toBe(1);
    const sau = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { attribution: { include: { group: { select: { code: true } } } } } });
    expect(sau.attribution?.group.code).toBe(nguonLanDau);
    expect(sau.eventId).toBe(lead.eventId);
    expect((await docBai(b)).leadId).toBe(lead.id);

    const [l, at, ac, tp] = await Promise.all([
      db.$queryRaw<unknown[]>`select * from "Lead" where id = ${lead.id}`,
      db.$queryRaw<unknown[]>`select * from "LeadAttribution" where "leadId" = ${lead.id}`,
      db.$queryRaw<unknown[]>`select * from "LeadActivity" where "leadId" = ${lead.id}`,
      db.$queryRaw<unknown[]>`select * from "LeadTouchpoint" where "leadId" = ${lead.id}`,
    ]);
    expect(l).toHaveLength(1);
    expect(tp.length).toBeGreaterThanOrEqual(1);
    const nhat = JSON.stringify({ l, at, ac, tp });
    expect(nhat).not.toContain(TEN_HS);
    expect(nhat).not.toContain("Kiểm-Thử");
    expect(nhat).not.toContain(String(namNay() - 10));
    for (const cam of ["birthYear", "bacHoc", "traLoi", "engineVersion", "sr-disc", '"D":']) expect(nhat, cam).not.toContain(cam);
    expect(nhat).toContain(P);
  });

  it("[HT-ET-07b] lead CÓ SẴN mang nguồn khác không bị DISC đổi nguồn", async () => {
    const sdt = sdtMoi();
    const nhomKhac = await db.leadSourceGroup.findFirst({ where: { code: { not: "WALK_IN" }, status: "ACTIVE" }, select: { id: true } });
    expect(nhomKhac).not.toBeNull();
    // Lần 1 tạo lead qua DISC; rồi gán lead đó sang nguồn KHÁC như thể đã được Sale/nguồn khác nhận trước.
    const a = khoaIdem("ht");
    expect((await goiLuu((await dungYeuCauLuu(sdt, { key: a })).body)).status).toBe(200);
    const leadId = (await docBai(a)).leadId!;
    await db.leadAttribution.update({ where: { leadId }, data: { groupId: nhomKhac!.id } });
    await db.lead.update({ where: { id: leadId }, data: { source: "facebook" } });
    // Lần 2 (khoá khác, cùng SĐT)
    const b = khoaIdem("ht");
    expect((await goiLuu((await dungYeuCauLuu(sdt, { key: b, lech: 1 })).body)).status).toBe(200);
    expect(await db.lead.count({ where: { phone: { in: [sdt, sdtChuan(sdt)] }, deletedAt: null } })).toBe(1);
    expect((await docBai(b)).leadId).toBe(leadId);
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId } })).groupId).toBe(nhomKhac!.id);
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).source).toBe("facebook");
  });

  it("[HT-ET-08] phản hồi trung tính: SĐT mới và SĐT đã là lead cùng hình dạng", async () => {
    const moi = sdtMoi();
    const cu = sdtMoi();
    await db.lead.create({ data: { parentName: `${P} Đã có`, phone: sdtChuan(cu), source: "web", status: "MOI", eventId: `ht-cu2-${Date.now()}` } });
    const ra = await goiLuu((await dungYeuCauLuu(moi, { key: khoaIdem("ht") })).body);
    const rb = await goiLuu((await dungYeuCauLuu(cu, { key: khoaIdem("ht") })).body);
    expect(ra.status).toBe(rb.status);
    expect(Object.keys(ra.json).sort()).toEqual(Object.keys(rb.json).sort());
    expect(ra.json.thongBao).toEqual(rb.json.thongBao);
    const chuoi = JSON.stringify(rb.json);
    expect(chuoi).not.toMatch(/đã (tồn tại|có tài khoản|đăng ký)/i);
    expect(chuoi).not.toContain(sdtChuan(cu));
  });

  it("[HT-ET-09] TRA_LOI_PHANG có thông điệp RIÊNG và không ghi gì", async () => {
    const key = khoaIdem("ht");
    const { body, boPh } = await dungYeuCauLuu(sdtMoi(), { key });
    const r = await goiLuu({ ...body, bai: { phuHuynh: { maBoDe: boPh.ma, traLoi: traLoiPhang(boPh) }, hocSinh: body.bai.hocSinh } });
    expect(r.status).toBe(400);
    const ct = r.json.chiTiet as Array<{ truong: string; thongBao: string }>;
    expect(ct).toHaveLength(1);
    expect(ct[0]!.truong).toBe("bai.phuHuynh.traLoi");
    expect(ct[0]!.thongBao).not.toBe("Câu trả lời không hợp lệ");
    expect(ct[0]!.thongBao).toMatch(/cùng một mức/);
    expect(await demBai(key)).toBe(0);
  });

  it("[HT-ET-10] bộ đề không khớp hồ sơ ⇒ từ chối (trẻ <8 tuổi không được nộp bộ tự đánh giá)", async () => {
    const sdt = sdtMoi();
    const key = khoaIdem("ht");
    const nam = namNay() - 6;
    const th = await layBoDe("HS", namNay() - 10, "4");
    const { body } = await dungYeuCauLuu(sdt, { key, namHs: nam, bacHoc: "4" });
    const r = await goiLuu({ ...body, bai: { ...body.bai, hocSinh: { maBoDe: th.ma, traLoi: traLoiBienThien(th) } } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json.chiTiet)).toContain("bai.hocSinh.maBoDe");
    expect(await demBai(key)).toBe(0);
    expect((await goiLuu(body)).status).toBe(200); // đối chứng dương: đúng bộ quan sát thì được
    expect((await docBai(key)).subjects.find((s) => s.role === "STUDENT")!.observedByAdult).toBe(true);
  });

  it("[HT-ET-11] email: VERIFICATION_REQUIRED; thư xác minh PENDING (không phải đã gửi); chưa có thư báo cáo", async () => {
    const key = khoaIdem("ht");
    const email = `xm-${Date.now().toString(36)}@example.test`;
    const { body } = await dungYeuCauLuu(sdtMoi(), { key, email });
    const r = await goiLuu(body);
    expect(r.status).toBe(200);
    const bai = await docBai(key);
    expect(bai.emailStatus).toBe("VERIFICATION_REQUIRED");
    expect(bai.emailVerifiedAt).toBeNull();
    const thu = await db.emailQueue.findMany({ where: { contextId: bai.id } });
    expect(thu.map((t) => t.contextType)).toEqual(["DISC_EMAIL_VERIFY"]);
    expect(thu[0]!.status).toBe("PENDING");
    expect(JSON.stringify(thu)).not.toContain(TEN_HS);
    expect(JSON.stringify(r.json.thongBao)).not.toMatch(/đã gửi (báo cáo|kết quả)/i);
  });

  it("[HT-ET-12] giá trị ngoài thang · id lạ · thiếu câu ⇒ 400, không ghi", async () => {
    const key = khoaIdem("ht");
    const { body, boHs } = await dungYeuCauLuu(sdtMoi(), { key });
    const goc: TraLoi = body.bai.hocSinh.traLoi;
    const thuLai = (traLoi: TraLoi) => goiLuu({ ...body, bai: { ...body.bai, hocSinh: { maBoDe: boHs.ma, traLoi } } });
    const max = Math.max(...boHs.thang!.map((m) => m.gia));
    const r1 = await thuLai({ ...goc, [boHs.cauHoi[0]!.id]: max + 1 });
    expect(r1.status).toBe(400);
    expect((await thuLai({ ...goc, "ID-LA": 1 })).status).toBe(400);
    const thieu = { ...goc };
    delete thieu[boHs.cauHoi[1]!.id];
    const r3 = await thuLai(thieu);
    expect(r3.status).toBe(400);
    expect(JSON.stringify(r3.json.chiTiet)).toContain("Còn thiếu câu trả lời");
    expect(await demBai(key)).toBe(0);
  });
});
