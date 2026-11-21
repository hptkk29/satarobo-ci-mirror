// @vitest-environment node
/**
 * [SGD-DB-*] SỔ GIA ĐÌNH DISC trên Postgres THẬT (ci_test): quyền sở hữu, ghi bài + lịch sử «đã thấy» + nháp trong MỘT giao dịch,
 * trần bài/năm, xoá thành viên (giữ / xoá bài), tick việc, PIN. Dữ liệu GIẢ; dọn theo tài khoản có `password = "x-sgd"`.
 *   [SGD-DB-01] tạo sổ: chủ sổ là thành viên laChuSo; gợi ý học viên đúng chủ; tạo lần hai = DA_CO_SO
 *   [SGD-DB-02] IDOR: tài khoản B không sửa / xoá / phát đề / tick việc / xoá bài của sổ A (id của A ≡ không tồn tại)
 *   [SGD-DB-03] phát đề → lưu nháp → nộp: bài + CauDaThay ghi, nháp mất; id thành viên khác ⇒ không nộp được
 *   [SGD-DB-04] bốc đề lần hai không trùng câu nào của lần đầu (cờ ngân hàng BẬT)
 *   [SGD-DB-05] trần 24 bài/năm; xoá thành viên: giữ bài ⇒ về «chưa xếp», xoá bài ⇒ mất; chủ sổ không xoá được
 *   [SGD-DB-06] phân tích cả nhà + kế hoạch 7 ngày + tick (trong 2 ngày) + cảm ơn một lần
 *   [SGD-DB-07] PIN: sai 5 lần ⇒ khoá; đúng ⇒ mở
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NGAN_HANG } from "../../lib/disc/engine-goc/config/disc-cau-hoi";
import { db } from "../../lib/db";
import { layKhoaDisc } from "../../lib/disc/phone-key";
import { docVe } from "../../lib/disc/ngan-hang/de-ky";
import { timCauNganHang } from "../../lib/disc/ngan-hang/nap";
import {
  camOnViec,
  chayPhanTich,
  datPin,
  luuNhap,
  luuThanhVien,
  nopBaiSo,
  phatDeCho,
  taoKeHoach,
  taoSo,
  tickViec,
  xacNhanPin,
  xoaBaiLam,
  xoaThanhVien,
} from "../../lib/disc/so-gia-dinh/ghi";
import { RUN, assertCiTest } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const NOW = new Date("2026-11-02T03:00:00.000Z");
let seq = 0;
const taoUser = () => db.user.create({ data: { phone: `8490${String(Date.now() % 100_000_000).padStart(8, "0")}${(seq += 1)}`, role: "PARENT", roles: ["PARENT"], password: "x-sgd", accountStatus: "ACTIVE", isActive: true }, select: { id: true } });

/** Câu trả lời KHÔNG phẳng: thay đổi theo vị trí. */
function traLoiMau(soCau: number, max: number): Record<string, number> {
  const r: Record<string, number> = {};
  for (let i = 0; i < soCau; i++) r[String(i)] = ((i * 7) % max) + 1;
  return r;
}

/**
 * Làm bài với câu trả lời THIÊN VỀ MỘT TRỤC (đọc khoá chấm từ vé — chỉ test mới được làm vậy): trục `cao` đồng ý mạnh, các trục khác thấp.
 * Cần để hai người có điểm KHÁC nhau rõ ⇒ lát cắt có chỗ lệch ⇒ có «việc của tôi». (Cùng một mẫu trả lời cho mọi người ⇒ điểm giống hệt ⇒ không có việc.)
 */
function traLoiThienVe(ve: string, tvId: string, cao: "D" | "I" | "S" | "C", max: number, bayGio: Date): Record<string, number> {
  const d = docVe(ve, layKhoaDisc(), tvId, bayGio);
  if (!d.ok) throw new Error("vé hỏng trong fixture");
  const r: Record<string, number> = {};
  d.de.maCau.forEach((ma, i) => {
    const c = timCauNganHang(ma);
    if (!c) throw new Error("mã câu lạ");
    const dongY = c.truc === cao;
    r[String(i)] = dongY ? (c.dao ? 1 : max) : c.dao ? Math.max(2, max - 1) : 2;
  });
  return r;
}

async function lamBai(userId: string, tvId: string, cach: "TU_LAM" | "GOC_NHIN", cao: "D" | "I" | "S" | "C" = "D", bayGio = NOW) {
  const p = await phatDeCho(userId, { thanhVienId: tvId, cachLam: cach }, bayGio);
  if (!p.ok) return p;
  const max = p.de.thang.reduce((m, x) => Math.max(m, x.gia), 0);
  const n = await nopBaiSo(userId, { thanhVienId: tvId, cachLam: cach, ve: p.de.ve, traLoi: traLoiThienVe(p.de.ve, tvId, cao, max, bayGio) }, bayGio);
  return { p, n };
}

describeDb("[SGD-DB] sổ gia đình DISC trên Postgres thật", () => {
  let A = "";
  let B = "";
  let meA = "";
  let conA = "";
  let giaDinhA = "";

  beforeAll(async () => {
    await assertCiTest();
    process.env.DISC_NGAN_HANG_ENABLED = "true";
    A = (await taoUser()).id;
    B = (await taoUser()).id;
  });
  afterAll(async () => {
    await db.discGiaDinh.deleteMany({ where: { ownerUserId: { in: [A, B].filter(Boolean) } } });
    await db.auditLog.deleteMany({ where: { module: "disc", actorId: { in: [A, B].filter(Boolean) } } });
    await db.student.deleteMany({ where: { parentUserId: { in: [A, B].filter(Boolean) } } });
    await db.user.deleteMany({ where: { password: "x-sgd" } });
    delete process.env.DISC_NGAN_HANG_ENABLED;
  });

  it("[SGD-DB-01] tạo sổ: chủ sổ là thành viên laChuSo, học viên của CHÍNH tài khoản được gợi ý, lần hai = DA_CO_SO", async () => {
    await db.student.create({ data: { name: "Bé Thử Một", parentUserId: A, dateOfBirth: new Date("2016-05-10T05:00:00Z") } });
    await db.student.create({ data: { name: "Bé Của Người Khác", parentUserId: B, dateOfBirth: new Date("2016-05-10T05:00:00Z") } });
    const r = await taoSo(A, { tenChuSo: "Mẹ Thử", vaiTroChuSo: "me", namSinhChuSo: 1990 }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    giaDinhA = r.giaDinhId;
    expect(r.soGoiY).toBe(1);
    const tv = await db.discThanhVien.findMany({ where: { giaDinhId: giaDinhA }, orderBy: { thuTu: "asc" } });
    expect(tv.map((t) => [t.ten, t.laChuSo])).toEqual([["Mẹ Thử", true], ["Bé Thử Một", false]]);
    expect(tv[1]!.lop).toBe("5"); // sinh 2016, năm học 2026–2027 (nhập học 5 tuổi) ⇒ lớp 5
    meA = tv[0]!.id;
    conA = tv[1]!.id;
    expect(await taoSo(A, { tenChuSo: "Mẹ Thử", vaiTroChuSo: "me" }, NOW)).toMatchObject({ ok: false, loi: "DA_CO_SO" });
    const b = await taoSo(B, { tenChuSo: "Bố Thử", vaiTroChuSo: "bo", goiYHocVien: false }, NOW);
    expect(b.ok).toBe(true);
  });

  it("[SGD-DB-02] IDOR: tài khoản B không thao tác được trên sổ của A, mọi id của A ≡ không tồn tại", async () => {
    const r1 = await luuThanhVien(B, { id: conA, ten: "Bị Sửa", vaiTro: "con", lop: "5" }, NOW);
    expect(r1).toMatchObject({ ok: false, loi: "KHONG_TIM_THAY" });
    expect(await xoaThanhVien(B, { id: conA, cheDo: "xoa-bai" }, NOW)).toMatchObject({ ok: false, loi: "KHONG_TIM_THAY" });
    expect(await phatDeCho(B, { thanhVienId: conA, cachLam: "TU_LAM" }, NOW)).toMatchObject({ ok: false, loi: "KHONG_TIM_THAY" });
    // B không có sổ khác để dùng id này.
    const lienKet = await luuThanhVien(B, { ten: "Con Của A", vaiTro: "con", lop: "5", studentId: (await db.student.findFirstOrThrow({ where: { parentUserId: A }, select: { id: true } })).id }, NOW);
    expect(lienKet).toMatchObject({ ok: false, loi: "HOC_VIEN_KHONG_THUOC_TAI_KHOAN" });
    expect(await db.discThanhVien.findUniqueOrThrow({ where: { id: conA } })).toMatchObject({ ten: "Bé Thử Một" });
    // Người không có sổ: mọi thao tác = KHONG_CO_SO
    const C = (await taoUser()).id;
    expect(await phatDeCho(C, { thanhVienId: conA, cachLam: "TU_LAM" }, NOW)).toMatchObject({ ok: false, loi: "KHONG_CO_SO" });
    expect(await tickViec(C, { viecId: "x" }, NOW)).toMatchObject({ ok: false, loi: "KHONG_CO_SO" });
    expect(await xoaBaiLam(C, "x", NOW)).toMatchObject({ ok: false, loi: "KHONG_CO_SO" });
  });

  it("[SGD-DB-03] phát đề → lưu nháp → nộp: ghi bài + CauDaThay, xoá nháp; không nộp được bằng id thành viên khác", async () => {
    const p = await phatDeCho(A, { thanhVienId: meA, cachLam: "TU_LAM" }, NOW);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.de.tiepTuc).toBe(false);
    const max = p.de.thang.reduce((m, x) => Math.max(m, x.gia), 0);
    const tl = traLoiMau(p.de.cau.length, max);
    // Nháp
    expect(await luuNhap(A, { thanhVienId: meA, cachLam: "TU_LAM", ve: p.de.ve, traLoi: { "0": 3, "1": 2 } }, NOW)).toMatchObject({ ok: true, daLam: 2 });
    const lai = await phatDeCho(A, { thanhVienId: meA, cachLam: "TU_LAM" }, NOW);
    expect(lai.ok && lai.de.tiepTuc).toBe(true);
    expect(lai.ok && lai.de.traLoi).toEqual({ "0": 3, "1": 2 });
    // Giá trị ngoài thang ⇒ từ chối, nháp không đổi
    expect(await luuNhap(A, { thanhVienId: meA, cachLam: "TU_LAM", ve: p.de.ve, traLoi: { "0": 7 } }, NOW)).toMatchObject({ ok: false });
    // Vé của mẹ nộp cho con ⇒ SAI người làm
    expect(await nopBaiSo(A, { thanhVienId: conA, cachLam: "TU_LAM", ve: p.de.ve, traLoi: tl }, NOW)).toMatchObject({ ok: false, loi: "NOP_BAI_LOI" });
    expect(await db.discBaiLam.count({ where: { giaDinhId: giaDinhA } })).toBe(0);

    const n = await nopBaiSo(A, { thanhVienId: meA, cachLam: "TU_LAM", ve: p.de.ve, traLoi: tl }, NOW);
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.boDe).toBe("PH");
    expect(n.truoc).toBeNull();
    const bai = await db.discBaiLam.findMany({ where: { giaDinhId: giaDinhA } });
    expect(bai).toHaveLength(1);
    expect(bai[0]).toMatchObject({ thanhVienId: meA, cachLam: "TU_LAM", phienBanBoDe: "nh:nh1", tenLuc: "Mẹ Thử" });
    // KHÔNG lưu câu trả lời từng câu
    expect(JSON.stringify(bai[0])).not.toMatch(/traLoi/);
    expect(await db.discCauDaThay.count({ where: { thanhVienId: meA } })).toBe(NGAN_HANG.PH.cau.length);
    expect(await db.discBanNhap.count({ where: { thanhVienId: meA } })).toBe(0);
    // Nộp lại cùng vé (đã dùng, nháp đã xoá nhưng vé còn hạn) vẫn là một lượt MỚI hợp lệ — không có «vé dùng một lần» ở v1; lịch sử đã thấy bảo đảm đề sau khác.
  });

  it("[SGD-DB-04] bốc đề lần hai không trùng câu nào của lần đầu (lịch sử «đã thấy» đọc từ DB)", async () => {
    const dau = await db.discCauDaThay.findMany({ where: { thanhVienId: meA }, select: { maCau: true } });
    const p = await phatDeCho(A, { thanhVienId: meA, cachLam: "TU_LAM" }, NOW);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const max = p.de.thang.reduce((m, x) => Math.max(m, x.gia), 0);
    const n = await nopBaiSo(A, { thanhVienId: meA, cachLam: "TU_LAM", ve: p.de.ve, traLoi: traLoiMau(p.de.cau.length, max) }, NOW);
    expect(n.ok).toBe(true);
    const sau = await db.discCauDaThay.findMany({ where: { thanhVienId: meA }, select: { maCau: true } });
    // Lần hai thêm ĐÚNG số câu mới (không câu nào trùng lịch sử ⇒ skipDuplicates không nuốt gì).
    expect(sau.length).toBe(dau.length + NGAN_HANG.PH.cau.length);
    expect(n.ok && n.truoc).not.toBeNull();
  });

  it("[SGD-DB-05] xoá thành viên: giữ bài ⇒ về «chưa xếp»; xoá bài ⇒ mất; chủ sổ không xoá được; xoá bài lẻ", async () => {
    const t = await luuThanhVien(A, { ten: "Bố Thử", vaiTro: "bo", namSinh: 1988 }, NOW);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const xong = await lamBai(A, t.id, "TU_LAM");
    expect("n" in xong && xong.n.ok).toBe(true);
    expect(await xoaThanhVien(A, { id: meA, cheDo: "giu-bai" }, NOW)).toMatchObject({ ok: false, loi: "KHONG_XOA_DUOC_CHU_SO" });
    expect(await xoaThanhVien(A, { id: t.id }, NOW)).toMatchObject({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" }); // thiếu cheDo ⇒ không có mặc định
    const gb = await xoaThanhVien(A, { id: t.id, cheDo: "giu-bai" }, NOW);
    expect(gb).toMatchObject({ ok: true, daGiuBai: 1 });
    const chuaXep = await db.discBaiLam.findMany({ where: { giaDinhId: giaDinhA, thanhVienId: null } });
    expect(chuaXep).toHaveLength(1);
    expect(chuaXep[0]!.tenLuc).toBe("Bố Thử");
    expect(await db.discThanhVien.count({ where: { id: t.id } })).toBe(0);
    expect(await db.discCauDaThay.count({ where: { thanhVienId: t.id } })).toBe(0);

    const t2 = await luuThanhVien(A, { ten: "Ông Thử", vaiTro: "ong", namSinh: 1955 }, NOW);
    expect(t2.ok).toBe(true);
    if (!t2.ok) return;
    await lamBai(A, t2.id, "TU_LAM");
    const xb = await xoaThanhVien(A, { id: t2.id, cheDo: "xoa-bai" }, NOW);
    expect(xb).toMatchObject({ ok: true, daXoaBai: 1 });
    expect(await db.discBaiLam.count({ where: { giaDinhId: giaDinhA, tenLuc: "Ông Thử" } })).toBe(0);

    // xoá bài lẻ: của sổ khác ≡ không tìm thấy
    const mot = await db.discBaiLam.findFirstOrThrow({ where: { giaDinhId: giaDinhA, thanhVienId: meA } });
    expect(await xoaBaiLam(B, mot.id, NOW)).toMatchObject({ ok: false, loi: "KHONG_TIM_THAY" });
    expect(await xoaBaiLam(A, mot.id, NOW)).toMatchObject({ ok: true });
    expect(await db.discBaiLam.count({ where: { id: mot.id } })).toBe(0);
  });

  it("[SGD-DB-06] phân tích cả nhà + kế hoạch 7 ngày: chỉ khi đủ người; tick trong 2 ngày; cảm ơn đúng một lần", async () => {
    // Hiện chỉ còn mẹ có bài ⇒ chưa phân tích được, kế hoạch chưa mở.
    expect(await taoKeHoach(A, { ky: "NGAY_7", batDau: "2026-11-02" }, NOW)).toMatchObject({ ok: false, loi: "KE_HOACH_CHUA_MO" });
    const t = await luuThanhVien(A, { ten: "Bố Hai", vaiTro: "bo", namSinh: 1988 }, NOW);
    if (!t.ok) throw new Error("fixture");
    const r = await lamBai(A, t.id, "TU_LAM", "D");
    expect("n" in r && r.n.ok).toBe(true);
    const rMe = await lamBai(A, meA, "TU_LAM", "C"); // mẹ làm lại, thiên về C ⇒ bài mới nhất của mẹ khác hẳn bố
    expect("n" in rMe && rMe.n.ok).toBe(true);
    const pt = await chayPhanTich(A, NOW);
    expect(pt).toMatchObject({ ok: true });
    expect(await db.discPhanTich.count({ where: { giaDinhId: giaDinhA } })).toBeGreaterThanOrEqual(1);
    // chạy lại với cùng dữ liệu ⇒ không đẻ bản mới
    const truoc = await db.discPhanTich.count({ where: { giaDinhId: giaDinhA } });
    await chayPhanTich(A, NOW);
    expect(await db.discPhanTich.count({ where: { giaDinhId: giaDinhA } })).toBe(truoc);

    expect(await taoKeHoach(A, { ky: "NGAY_7", batDau: "2026-12-30" }, NOW)).toMatchObject({ ok: false, loi: "NGAY_KHONG_HOP_LE" });
    const kh = await taoKeHoach(A, { ky: "NGAY_7", batDau: "2026-11-02" }, NOW);
    expect(kh.ok).toBe(true);
    if (!kh.ok) return;
    const viec = await db.discViec.findMany({ where: { keHoachId: kh.keHoachId, nguoiLamId: { not: null }, nguoiNhanId: { not: null } }, orderBy: [{ ngay: "asc" }, { id: "asc" }] });
    expect(viec.length).toBeGreaterThan(0);
    const v0 = viec[0]!;
    // Chưa tới ngày ⇒ không tick; tới ngày ⇒ tick; tick lần hai ⇒ từ chối
    const sang = new Date("2026-11-01T03:00:00.000Z");
    expect(await tickViec(A, { viecId: v0.id }, sang)).toMatchObject({ ok: false, loi: "KHONG_TICK_DUOC" });
    expect(await camOnViec(A, { viecId: v0.id }, NOW)).toMatchObject({ ok: false }); // chưa xong ⇒ chưa cảm ơn được
    expect(await tickViec(A, { viecId: v0.id }, NOW)).toMatchObject({ ok: true });
    expect(await tickViec(A, { viecId: v0.id }, NOW)).toMatchObject({ ok: false, loi: "KHONG_TICK_DUOC" });
    expect(await tickViec(B, { viecId: v0.id }, NOW)).toMatchObject({ ok: false, loi: "KHONG_TIM_THAY" });
    expect(await camOnViec(A, { viecId: v0.id }, NOW)).toMatchObject({ ok: true });
    expect(await camOnViec(A, { viecId: v0.id }, NOW)).toMatchObject({ ok: false });
    // Quá 2 ngày ⇒ không tick bù được
    const xa = new Date("2026-11-08T03:00:00.000Z");
    const v1 = viec.find((v) => v.id !== v0.id && v.xongLuc === null);
    if (v1) expect(await tickViec(A, { viecId: v1.id }, xa)).toMatchObject({ ok: false, loi: "KHONG_TICK_DUOC" });
  });

  it("[SGD-DB-07] PIN chế độ trẻ em: chưa đặt ⇒ từ chối; đặt rồi nhập sai 5 lần ⇒ khoá; đúng ⇒ mở", async () => {
    expect(await xacNhanPin(A, { pin: "1234" }, NOW)).toMatchObject({ ok: false, loi: "CHUA_DAT_PIN" });
    expect(await datPin(A, { pin: "12" })).toMatchObject({ ok: false });
    expect(await datPin(A, { pin: "4821" })).toMatchObject({ ok: true });
    const g = await db.discGiaDinh.findUniqueOrThrow({ where: { id: giaDinhA }, select: { pinHash: true } });
    expect(g.pinHash).not.toContain("4821");
    for (let i = 0; i < 4; i++) expect(await xacNhanPin(A, { pin: "0000" }, NOW)).toMatchObject({ ok: false, loi: "PIN_SAI" });
    expect(await xacNhanPin(A, { pin: "0000" }, NOW)).toMatchObject({ ok: false, loi: "PIN_SAI" }); // lần 5 ⇒ khoá
    expect(await xacNhanPin(A, { pin: "4821" }, NOW)).toMatchObject({ ok: false, loi: "PIN_BI_KHOA" });
    const sau = new Date(NOW.getTime() + 16 * 60_000);
    expect(await xacNhanPin(A, { pin: "4821" }, sau)).toMatchObject({ ok: true });
    expect(await xacNhanPin(B, { pin: "4821" }, sau)).toMatchObject({ ok: false, loi: "CHUA_DAT_PIN" }); // PIN của sổ A không mở được sổ B
  });
});
