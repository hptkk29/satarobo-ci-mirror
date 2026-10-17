// lib/parttime/dong-bo-wiring.test.ts — lưới GHIM MÃ NGUỒN cho dây nối ĐỒNG BỘ phân công (SR.QD.238 · P3a).
//
// Thứ ca hành vi (tests/cham-cong/parttime-dong-bo.spec.ts) KHÔNG chạm được: server action cần phiên đăng nhập (huỷ / xoá /
// sửa lớp, đổi GV lớp ở màn GV, sửa buổi, sửa / huỷ buổi trial), route nhập lớp. Ca hành vi dựng TRẠNG THÁI SAU của các
// action đó rồi chạy bộ đồng bộ; lưới này khoá phần còn lại: action CÓ đánh dấu, đánh dấu NẰM TRONG giao dịch, và đồng
// bộ ngay chạy SAU commit.
//
// Mã TRƯỚC P3a: huỷ / xoá / sửa lớp, đổi GV lớp, chuyển buổi sang lớp khác, học bù, trial KHÔNG có dòng nào nhắc phân
// công ⇒ phân công mồ côi (buổi huỷ mà GV vẫn "chờ nhận"), trùng (đổi GV lớp ⇒ hai MAIN), hoặc không bao giờ được dựng.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function than(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}(`);
  if (i < 0) throw new Error(`không thấy ${ten}`);
  const j = src.indexOf("\nexport ", i + 1);
  return src.slice(i, j < 0 ? undefined : j);
}

/** Đánh dấu đứng TRƯỚC lần đóng `$transaction(` gần nhất sau nó, và đồng bộ ngay đứng SAU lần đóng đó. */
function kiemTrongVaSau(t: string, goc: string) {
  const danhDau = t.indexOf(`"${goc}"`);
  expect(danhDau, `thiếu đánh dấu ${goc}`).toBeGreaterThan(-1);
  expect(t.slice(Math.max(0, danhDau - 200), danhDau)).toContain("danhDauCanDongBo(tx");
  const ngay = t.lastIndexOf(`dongBoNgay(`);
  expect(ngay, `thiếu đồng bộ ngay sau commit (${goc})`).toBeGreaterThan(danhDau);
  // Đồng bộ ngay CHỈ khi đã đánh dấu (`canDongBo`) — đừng chạy đồng bộ toàn hệ cho lớp chưa từng có phân công.
  expect(t).toMatch(/if \(canDongBo\) await dongBoNgay\(/);
  expect(t).toMatch(/canDongBo = await danhDauCanDongBo\(tx,/);
}

describe("[PT3A-W] dây nối đồng bộ phân công", () => {
  it("[PT3A-W1] huỷ / xoá / sửa LỚP đánh dấu buổi còn mở TRONG giao dịch và đồng bộ SAU commit", () => {
    const f = doc("app/(admin)/admin/classes/_actions.ts");
    kiemTrongVaSau(than(f, "cancelClassAction"), "HUY_LOP");
    kiemTrongVaSau(than(f, "deleteClass"), "XOA_LOP");
    kiemTrongVaSau(than(f, "updateClass"), "SUA_LOP");
    // Huỷ lớp: danh sách buổi lấy TRƯỚC khi buổi bị chuyển CANCELLED (sau đó `nguonBuoiMoCuaLop` ra rỗng).
    const huy = than(f, "cancelClassAction");
    expect(huy.indexOf("nguonBuoiMoCuaLop(tx, classId, { tuHomNay: false })")).toBeGreaterThan(-1);
    expect(huy.indexOf("nguonBuoiMoCuaLop(")).toBeLessThan(huy.indexOf("classSession.updateMany("));
    // Sửa lớp: CHỈ buổi từ hôm nay — đổi mặc định của lớp không sửa lịch sử.
    expect(than(f, "updateClass")).toContain("nguonBuoiMoCuaLop(tx, id, { tuHomNay: true })");
  });

  it("[PT3A-W2] gán / gỡ lớp ở màn GIÁO VIÊN (đổi GV mặc định của lớp) đánh dấu + đồng bộ", () => {
    const f = doc("app/(admin)/admin/teachers/_actions.ts");
    kiemTrongVaSau(than(f, "assignClassToTeacher"), "SUA_LOP");
    kiemTrongVaSau(than(f, "unassignClassFromTeacher"), "SUA_LOP");
  });

  it("[PT3A-W3] sửa buổi: đổi vị trí (giờ / lớp) ⇒ đánh dấu; chuyển lớp ⇒ cơ sở theo lớp ĐÍCH trong CÙNG lần ghi", () => {
    const t = than(doc("app/(admin)/admin/sessions/_actions.ts"), "updateSession");
    expect(t).toMatch(/if \(doiViTri\) canDongBo = await danhDauCanDongBo\(tx, \[nguonBuoi\], "SUA_BUOI"/);
    expect(t).toMatch(/if \(canDongBo\) await dongBoNgay\(\[nguonBuoi\], "SUA_BUOI"/);
    expect(t).toMatch(/centerId: lopMoi\.centerId/);
  });

  it("[PT3A-W4] nhập lớp từ file đánh dấu buổi tương lai của lớp vừa ghi (chỉ outbox — route không giữ phiên đồng bộ)", () => {
    const t = than(doc("app/api/admin/import/classes/route.ts"), "POST");
    expect(t).toMatch(/danhDauCanDongBo\(txPc, await nguonBuoiMoCuaLop\(txPc, saved\.id, \{ tuHomNay: true \}\), "SUA_LOP"/);
  });

  it("[PT3A-W5] gộp buổi trùng đánh dấu các buổi bị huỷ", () => {
    const t = than(doc("lib/classes/buoi-trung-db.ts"), "apDungDonBuoiTrung");
    expect(t).toMatch(/danhDauCanDongBo\(tx, daHuy\.map\(/);
    expect(t).toContain('"GOP_BUOI_TRUNG"');
  });

  it("[PT3A-W6] HỌC BÙ: tạo / huỷ / sửa case đánh dấu + đồng bộ; sửa case CHỈ khi có thay đổi; chốt lại case về CANCELLED đánh dấu", () => {
    const f = doc("lib/hoc-bu/case-db.ts");
    kiemTrongVaSau(than(f, "taoCaseVaXep"), "HOC_BU_TAO");
    kiemTrongVaSau(than(f, "huyCase"), "HOC_BU_HUY");
    const sua = than(f, "suaCase");
    kiemTrongVaSau(sua, "HOC_BU_SUA");
    const i = sua.indexOf('"HOC_BU_SUA"');
    expect(sua.slice(Math.max(0, i - 400), i)).toMatch(/lietKeThayDoi\(/);
    const chot = than(doc("lib/hoc-bu/case-diem-danh-db.ts"), "chotLaiCaseTrongTx");
    expect(chot).toMatch(/danhDauCanDongBo\(tx, \[\{ sourceType: "MAKEUP_CASE", sourceId: caseId \}\], "HOC_BU_HUY"/);
  });

  it("[PT3A-W7] TRIAL: tạo buổi + huỷ lớp (service) và sửa / huỷ buổi (màn lớp trial) đều đi qua đồng bộ", () => {
    const sv = doc("lib/trial/service.ts");
    kiemTrongVaSau(than(sv, "addTrialSession"), "TRIAL_TAO");
    kiemTrongVaSau(than(sv, "cancelTrialClass"), "TRIAL_HUY_LOP");
    const ac = doc("app/(admin)/admin/lop-trial/_actions.ts");
    const sua = than(ac, "updateLopTrialSessionAction");
    const huy = than(ac, "cancelLopTrialSessionAction");
    expect(sua).toMatch(/danhDauVaDongBo\(\[\{ sourceType: "TRIAL_SESSION", sourceId: data\.sessionId \}\], "TRIAL_SUA"/);
    expect(huy).toMatch(/danhDauVaDongBo\(\[\{ sourceType: "TRIAL_SESSION", sourceId: data\.sessionId \}\], "TRIAL_HUY"/);
    // Đồng bộ đứng SAU phép ghi buổi (không có giao dịch ở đây — đọc trạng thái đã ghi).
    expect(sua.indexOf("danhDauVaDongBo(")).toBeGreaterThan(sua.indexOf("trialClassSession.update("));
    expect(huy.indexOf("danhDauVaDongBo(")).toBeGreaterThan(huy.indexOf("trialClassSession.update("));
  });

  it("[PT3A-W8] trial luôn là hoạt động TRIAL (không thành buổi lớp chính)", () => {
    const t = doc("lib/parttime/phan-cong-db.ts");
    const i = t.indexOf("tx.trialClassSession.findUnique(");
    expect(i).toBeGreaterThan(-1);
    const nhanh = t.slice(i, t.indexOf("\n}", i));
    expect(nhanh.match(/activity: "(\w+)"/g)).toEqual(['activity: "TRIAL"']);
    expect(doc("lib/parttime/buoi.ts")).toMatch(/if \(sourceType === "TRIAL_SESSION"\) return "TRIAL";/);
  });

  it("[PT3A-W9] các điểm cắm cũ (tạo / dời / huỷ / mở lại / đổi GV buổi) CHỈ đánh dấu — không tự huỷ / dựng trong giao dịch có scope", () => {
    const t = doc("lib/parttime/tich-hop.ts");
    for (const ten of ["khiTaoBuoiLop", "khiDoiLichBuoi", "khiHuyBuoiTheoDon", "khiKhoiPhucBuoi", "khiDoiGvBuoi"]) {
      const th = than(t, ten);
      expect(th, ten).toContain("danhDauCanDongBo(tx,");
      expect(th, ten).not.toMatch(/huyPhanCong|phanCongVaoBuoi|dongBoLichPhanCong|dungPhanCongMacDinh|dongBoPhanCongTheoNguon/);
    }
    // Hai hook ĐƠN TỪ giữ việc trong giao dịch (mang mã đơn) VÀ đánh dấu.
    for (const ten of ["khiDuyetDayThay", "khiHuyDonDayThay"]) expect(than(t, ten), ten).toContain("danhDauCanDongBo(tx,");
  });

  it("[PT3A-W10] handler outbox đăng ký đúng tên sự kiện và NÉM khi có nguồn lỗi (để outbox thử lại)", () => {
    const db = doc("lib/parttime/dong-bo.ts");
    expect(db).toContain('on("parttime.staffing_dirty", onStaffingDirty)');
    expect(than(db, "onStaffingDirty")).toMatch(/if \(r\.loi\.length > 0\) throw /);
    expect(doc("lib/events/register.ts")).toContain("registerParttimeHandlers()");
  });

  it("[PT3A-W12] cron đổi giai đoạn lịch (đổi giờ lớp, không ghi buổi) đánh dấu buổi tương lai TRONG giao dịch của lớp đó", () => {
    const t = than(doc("lib/classes/phases-service.ts"), "resyncLegacyScheduleForAllClasses");
    const ghi = t.indexOf("syncLegacyScheduleFromPhases(tx, c.id");
    const dau = t.indexOf('danhDauCanDongBo(tx, await nguonBuoiMoCuaLop(tx, c.id, { tuHomNay: true }), "SUA_LOP"');
    expect(dau).toBeGreaterThan(ghi);
    expect(ghi).toBeGreaterThan(-1);
    expect(dau).toBeLessThan(t.indexOf("changed.push(c.id)"));
  });

  it("[PT3A-W11] đồng bộ đọc cờ NGOÀI giao dịch và tra đơn vị QUA tx (không truy vấn `db` trần dưới khoá tư vấn)", () => {
    expect(than(doc("lib/parttime/dong-bo.ts"), "dongBoNgay")).toMatch(/const congTacBat = await phanCongBat\(\);[\s\S]*db\.\$transaction\(/);
    const pc = doc("lib/parttime/phan-cong-db.ts");
    expect(pc).not.toContain("orgUnitIdForCenter(");
    expect(than(pc, "dongBoPhanCongTheoNguon")).not.toContain("phanCongBat()");
  });
});

// ── [PT3-W-DG] MỘT cửa ghi ──
// Mọi lệnh GHI vào ba bảng phân công (Prisma hoặc SQL thô, kể cả xuống dòng) chỉ được nằm ở `lib/parttime/phan-cong-db.ts`.
// Ghi ở nơi khác là đi vòng qua khoá tư vấn + luật một MAIN + audit + thông báo.
const BANG = ["SessionStaffAssignment", "StaffAssignmentAcceptance", "ClassStaffingRequirement"] as const;
const MAU_PRISMA = new RegExp(`\\b(${BANG.map((b) => b[0].toLowerCase() + b.slice(1)).join("|")})\\s*\\.\\s*(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\\s*\\(`, "g");
const MAU_SQL = new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+"?(${BANG.join("|")})"?`, "gi");

function quetCay(goc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(goc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(goc, ten);
    if (statSync(p).isDirectory()) quetCay(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.tsx?$/.test(ten)) ra.push(p);
  }
  return ra;
}

export function timCuaGhi(src: string): number {
  const sach = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return (sach.match(MAU_PRISMA) ?? []).length + (sach.match(MAU_SQL) ?? []).length;
}

describe("[PT3-W-DG] một cửa ghi phân công", () => {
  it("[PT3-W-DG1] bộ so khớp bắt cả dạng xuống dòng và SQL thô nhiều dòng; bỏ qua chú thích", () => {
    expect(timCuaGhi("await tx.sessionStaffAssignment\n  .update({ where })")).toBe(1);
    expect(timCuaGhi('await db.$executeRaw`\n  UPDATE\n  "StaffAssignmentAcceptance" SET x = 1`')).toBe(1);
    expect(timCuaGhi("// tx.sessionStaffAssignment.update(\n/* db.classStaffingRequirement.upsert( */")).toBe(0);
    expect(timCuaGhi("tx.sessionStaffAssignment.findMany({})")).toBe(0);
  });

  it("[PT3-W-DG2] app/ lib/ scripts/ prisma/: chỉ `lib/parttime/phan-cong-db.ts` ghi ba bảng phân công", () => {
    const vi: string[] = [];
    for (const goc of ["app", "lib", "scripts", "prisma"]) {
      for (const f of quetCay(resolve(process.cwd(), goc))) {
        const rel = f.slice(process.cwd().length + 1).replace(/\\/g, "/");
        if (rel === "lib/parttime/phan-cong-db.ts") continue;
        if (timCuaGhi(readFileSync(f, "utf8")) > 0) vi.push(rel);
      }
    }
    expect(vi).toEqual([]);
    expect(timCuaGhi(readFileSync(resolve(process.cwd(), "lib/parttime/phan-cong-db.ts"), "utf8"))).toBeGreaterThan(0);
  });
});

// ── [PT3B-W] P3b: Control Tower + Công việc của tôi ──
describe("[PT3B-W] dây nối P3b", () => {
  it("[PT3B-W1] bộ đồng bộ (`docBuoi`) và màn đọc (`docBuoiTho`) cùng gọi `macDinhCuaBuoi` cho CẢ BA nguồn — không tự suy mặc định", () => {
    const dongBo = doc("lib/parttime/phan-cong-db.ts");
    const man = doc("lib/parttime/bang-phan-cong.ts");
    for (const t of [dongBo, man]) {
      for (const nguon of ["CLASS_SESSION", "MAKEUP_CASE", "TRIAL_SESSION"]) {
        expect(t).toContain(`macDinhCuaBuoi({ sourceType: "${nguon}"`);
      }
      expect(t).not.toMatch(/macDinhMainId: [a-z]+\.(class\.)?teacherId/);
    }
    expect(man).not.toContain("BUOI_DA_DONG");
  });

  it("[PT3B-W2] trang Control Tower: thẻ số = `demThe`, bộ lọc = `THE[loc].khop` — cùng một vị từ; cảnh báo nhận `now` của trang", () => {
    const t = doc("app/(admin)/admin/cham-cong/phan-cong/page.tsx");
    expect(t).toContain("const dem = demThe(buoi);");
    expect(t).toMatch(/buoi\.filter\(\(b\) => THE\[loc\]\.khop\(b\)\)/);
    expect(t).toMatch(/canhBaoBuoi\(b, now\)/);
    expect(t).toMatch(/docTuanPhanCong\(\{ centerId: coSo, tu: tuan, den: denNgay \}\)/);
    expect(t).toMatch(/docBangChungCong\(\{ centerId: coSo, tu: tuan, den: denNgay, now \}\)/);
    // Ngoại lệ cấp buổi P4 phải TỚI dòng buổi — gỡ vế này thì 'chốt mà không có GV đứng chính' im lặng.
    expect(t.split("...canhBaoTuBangChung(ngoaiLeTheoBuoi.get(b.key) ?? [])").length - 1).toBe(1);
    // Nút "Dựng từ giáo viên của lớp" đếm đúng các buổi mà planner sẽ TẠO (cùng luật với chính nút).
    expect(t).toMatch(/keHoach\.some\(\(x\) => x\.loai === "TAO"\)/);
  });

  it("[PT3B-W3] màn GV: nhận / từ chối / nhận cả lớp đều gửi PHIÊN BẢN đã xem xuống dịch vụ", () => {
    const t = doc("app/(teacher)/teacher/phan-cong/_actions.ts");
    expect((t.match(/phienBanDaXem: (p\.data|m)\.phienBan/g) ?? []).length).toBe(2);
    const ui = doc("app/(teacher)/teacher/phan-cong/_components/nhom-cho.tsx");
    expect((ui.match(/phienBan: x\.phienBan/g) ?? []).length).toBe(3);
  });

  it("[PT3B-W4] bằng chứng chấm công có MỘT định nghĩa (P4): Control Tower + site GV đọc `bang-chung-cong-db`, nhãn qua `nhanBangChung`; `docTuanPhanCong` không tự đọc lượt quẹt", () => {
    expect(doc("lib/parttime/bang-phan-cong.ts")).not.toMatch(/staffTimeLog|LUOT_CON_TINH|lateGraceMinutes/);
    const ct = doc("app/(admin)/admin/cham-cong/phan-cong/page.tsx");
    expect(ct).toContain("const n = nhanBangChung(r);");
    const gv = doc("app/(teacher)/teacher/phan-cong/page.tsx");
    expect(gv).toMatch(/docBangChungCuaToi\(\{ userId: session\.user\.id, tu: tuNgay, den: homNay, now \}\)/);
    expect(gv).toContain("const n = nhanBangChung(r);");
  });
});

// ── [P4-PRE-W] hoàn thành lớp sớm (chủ dự án chốt 13/10/2026) ──
describe("[P4-PRE-W] completeClassAction đóng buổi tương lai", () => {
  it("[P4-PRE-W1] gọi `dongBuoiTuongLaiKhiHoanThanh(tx,` TRONG giao dịch (sau khi lớp → COMPLETED) và đồng bộ phân công SAU commit", () => {
    const t = than(doc("app/(admin)/admin/classes/_actions.ts"), "completeClassAction");
    const lop = t.indexOf('data: { status: "COMPLETED" } });');
    const dong = t.indexOf("dongBuoi = await dongBuoiTuongLaiKhiHoanThanh(tx, {");
    const ketThucGd = t.indexOf("}, { timeout: 30_000, maxWait: 10_000 });");
    const sau = t.indexOf('if (dongBuoi.canDongBo) await dongBoNgay(dongBuoi.nguonDongBo, "HOAN_THANH_LOP"');
    expect(lop).toBeGreaterThan(-1);
    expect(dong).toBeGreaterThan(lop);
    expect(ketThucGd).toBeGreaterThan(dong);
    expect(sau).toBeGreaterThan(ketThucGd);
  });
});
