// @vitest-environment node
/**
 * [DDB-IDOR-*] cổng phụ huynh đọc bài DISC (lib/disc/portal-doc.ts) trên Postgres THẬT — chống IDOR.
 *   [DDB-IDOR-01] user B KHÔNG đọc được bài CLAIMED của user A (chi tiết = null, danh sách không có, lịch sử rỗng); A đọc được (đối chứng dương)
 *   [DDB-IDOR-02] CHỈ CLAIMED: PENDING_CLAIM (kể cả cùng SĐT của chủ) / EXPIRED / REVOKED / đã xoá mềm ⇒ null với cả chủ
 *   [DDB-IDOR-03] id lạ / rác / quá dài ⇒ null (cùng kết quả với "của người khác": không oracle)
 *   [DDB-IDOR-04] kết quả KHÔNG chứa phoneKey / claimCodeHash / claimAttempts / downloadTokenHash / emailTo / leadId
 *   [DDB-IDOR-05] phân trang: tổng đúng theo chủ, không lẫn bài của người khác
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { docChiTietLuot, docDanhSachLuot, docLichSuGiaDinh } from "../../lib/disc/portal-doc";
import { NOW, RUN, assertCiTest, crmKhong, dauVao, depLuu, don, khoaIdem, luu, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
let uSeq = 0;
const taoUser = (sdt: string) =>
  db.user.create({ data: { phone: `${sdtChuan(sdt)}${(uSeq += 1)}`, role: "PARENT", roles: ["PARENT"], password: "x-idor", accountStatus: "ACTIVE", isActive: true }, select: { id: true } });

async function luuBai(sdt: string, traLoi = 4) {
  const key = khoaIdem("idor");
  const r = await luu(dauVao(sdt, { key, traLoi }), depLuu(crmKhong));
  if (!r.ok) throw new Error(`fixture hỏng: ${r.loi}`);
  return db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
}
const nhanChoUser = (id: string, userId: string) =>
  db.discSubmission.update({ where: { id }, data: { claimStatus: "CLAIMED", claimedUserId: userId, claimedAt: NOW } });

describeDb("[DDB-IDOR] portal-doc trên Postgres thật", () => {
  beforeAll(async () => {
    await assertCiTest();
    await don();
  });
  afterAll(async () => {
    await don();
    await db.user.deleteMany({ where: { password: "x-idor" } });
    await db.$disconnect();
  });

  it("[DDB-IDOR-01] B không đọc được bài CLAIMED của A; A đọc được", async () => {
    const sdt = sdtMoi();
    const [a, b] = [await taoUser(sdt), await taoUser(sdtMoi())];
    const bai = await nhanChoUser((await luuBai(sdt)).id, a.id);
    // Đối chứng dương: chủ đọc được
    const cuaA = await docChiTietLuot(a.id, bai.id);
    expect(cuaA?.id).toBe(bai.id);
    expect(cuaA?.nguoi.map((n) => n.vaiTro).sort()).toEqual(["HOC_SINH", "PHU_HUYNH"]);
    // B: mọi đường đọc đều trống
    expect(await docChiTietLuot(b.id, bai.id)).toBeNull();
    const dsB = await docDanhSachLuot(b.id);
    expect(dsB.tong).toBe(0);
    expect(dsB.luot).toHaveLength(0);
    expect(await docLichSuGiaDinh(b.id)).toEqual([]);
    expect((await docDanhSachLuot(a.id)).luot.map((l) => l.id)).toContain(bai.id);
  });

  it("[DDB-IDOR-02] chỉ CLAIMED: PENDING / EXPIRED / REVOKED / xoá mềm đều null — kể cả với chủ", async () => {
    const sdt = sdtMoi();
    const a = await taoUser(sdt);
    const pending = await luuBai(sdt);
    const hetHan = await nhanChoUser((await luuBai(sdt)).id, a.id).then((x) => db.discSubmission.update({ where: { id: x.id }, data: { claimStatus: "EXPIRED" } }));
    const thuHoi = await nhanChoUser((await luuBai(sdt)).id, a.id).then((x) => db.discSubmission.update({ where: { id: x.id }, data: { claimStatus: "REVOKED" } }));
    const daXoa = await nhanChoUser((await luuBai(sdt)).id, a.id).then((x) => db.discSubmission.update({ where: { id: x.id }, data: { deletedAt: NOW } }));
    const hopLe = await nhanChoUser((await luuBai(sdt)).id, a.id);
    for (const x of [pending, hetHan, thuHoi, daXoa]) expect(await docChiTietLuot(a.id, x.id), x.claimStatus).toBeNull();
    expect((await docChiTietLuot(a.id, hopLe.id))?.id).toBe(hopLe.id); // đối chứng dương
    const ds = await docDanhSachLuot(a.id);
    expect(ds.tong).toBe(1);
    expect(ds.luot.map((l) => l.id)).toEqual([hopLe.id]);
  });

  it("[DDB-IDOR-03] id lạ / rác / quá dài ⇒ null", async () => {
    const a = await taoUser(sdtMoi());
    for (const id of ["khong-ton-tai", "", "x".repeat(200), 123, null, undefined, { $ne: null }]) expect(await docChiTietLuot(a.id, id)).toBeNull();
  });

  it("[DDB-IDOR-04] kết quả không chứa cột nhạy cảm", async () => {
    const sdt = sdtMoi();
    const a = await taoUser(sdt);
    const b = await luuBai(sdt);
    await nhanChoUser(b.id, a.id);
    const goc = await db.discSubmission.findUniqueOrThrow({ where: { id: b.id } });
    const ra = JSON.stringify({ ct: await docChiTietLuot(a.id, b.id), ds: await docDanhSachLuot(a.id), ls: await docLichSuGiaDinh(a.id) });
    for (const cot of ["phoneKey", "claimCodeHash", "claimAttempts", "downloadTokenHash", "emailTo", "leadId", "payloadHash", "consentTextHash"]) expect(ra, cot).not.toContain(`"${cot}"`);
    for (const giaTri of [goc.phoneKey, goc.claimCodeHash, goc.downloadTokenHash]) if (giaTri) expect(ra).not.toContain(giaTri);
    expect(ra).toContain("Kiểm-Thử"); // đối chứng dương: dữ liệu của chính chủ CÓ ra
  });

  it("[DDB-IDOR-05] phân trang đúng theo chủ, không lẫn bài người khác", async () => {
    const [a, b] = [await taoUser(sdtMoi()), await taoUser(sdtMoi())];
    for (let i = 0; i < 3; i++) await nhanChoUser((await luuBai(sdtMoi())).id, a.id);
    await nhanChoUser((await luuBai(sdtMoi())).id, b.id);
    const t1 = await docDanhSachLuot(a.id, { moiTrang: 2 });
    expect([t1.tong, t1.luot.length, t1.tongTrang]).toEqual([3, 2, 2]);
    const t2 = await docDanhSachLuot(a.id, { moiTrang: 2, trang: 2 });
    expect(t2.luot).toHaveLength(1);
    const ids = new Set([...t1.luot, ...t2.luot].map((l) => l.id));
    expect(ids.size).toBe(3);
    expect((await docDanhSachLuot(b.id)).tong).toBe(1);
  });
});
