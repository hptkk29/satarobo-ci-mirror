/**
 * scripts/noi-hoc-vien-voi-lead.ts — nối học viên CŨ về lead nguồn (`Student.leadId`), 25/09/2026.
 *
 *   pnpm exec tsx scripts/noi-hoc-vien-voi-lead.ts                        # DRY-RUN (mặc định)
 *   pnpm exec tsx scripts/noi-hoc-vien-voi-lead.ts --ghi --expect=<N>     # GHI (N = số "SẼ NỐI" đã duyệt)
 *
 * Migration `20260925120000_student_lead_nguon_va_thong_tin_ph` phải chạy TRƯỚC. Từ ngày đó
 * convert tự nối HV mới; script này lo phần HV sinh ra TRƯỚC — không suy trong migration vì
 * có ca một HV dính nhiều lead, phải người xem (xem `lib/students/noi-lead-cu.ts`).
 * Runbook đầy đủ: `docs/hoc-vien-lien-ket-lead.md`.
 *
 * ── PHẠM VI ─────────────────────────────────────────────────────────────────────────────
 * Chỉ HV `leadId IS NULL` và `deletedAt IS NULL`. Mỗi lượt ghi là `updateMany` có
 * `leadId: null` trong where ⇒ chạy lại bao nhiêu lần cũng không đè liên kết đã có (kể cả
 * liên kết người dùng vừa gắn tay bằng nút "Gắn lead" giữa lúc duyệt và lúc chạy).
 * Điền ô trống hồ sơ đi CÙNG lượt nối, qua `dienTuLead` — chỉ ô null, không bao giờ ghi đè.
 *
 * ⛔ KHÔNG ghi `Enrollment.leadChildId` (tín hiệu "đã chốt" của báo cáo chuyển đổi —
 * lib/lead/tuong-tac/ghi.ts). Script chỉ ĐỌC cột đó làm bằng chứng.
 *
 * ── CLIENT: `scriptDb()`, KHÔNG phải `lib/db` ────────────────────────────────────────────
 * `scriptDb()` là PrismaClient TRẦN — không có extension xoá mềm của `lib/db`. Mọi lọc
 * `deletedAt` dưới đây vì thế viết TƯỜNG MINH, và đó là chủ đích:
 *   ① Ghi danh: ĐỌC CẢ dòng đã xoá mềm. `Enrollment.leadChildId` chỉ do lượt chốt lead ghi;
 *      ghi danh bị xoá sau đó (huỷ lớp, xếp nhầm lớp) không làm vết "em này đến từ phiếu
 *      kia" sai đi.
 *   ② Khoản thu + ③ Đơn: CHỈ dòng CHƯA xoá (Payment, Order). Khoản/đơn bị xoá mềm thường bị
 *      xoá chính vì ghi nhầm nhà — đọc nó là nối HV theo đúng cái sai đã được sửa.
 *   Lead đã xoá mềm bị loại khỏi MỌI chuỗi.
 *
 * ── KHÔNG N+1 ────────────────────────────────────────────────────────────────────────────
 * Bằng chứng gom theo LÔ (`LO_DOC` HV một câu mỗi chuỗi), không tra theo từng HV — bài học
 * `goiYDon` (CLAUDE.md: N+1 chạy được hôm nay chính là chỗ nguy hiểm).
 *
 * ── HAI CỔNG TRƯỚC KHI GHI ──────────────────────────────────────────────────────────────
 *  1. `--expect=<N>` bắt buộc đi kèm `--ghi`, N = số HV "SẼ NỐI" của bản dry-run đã duyệt.
 *     Kế hoạch lúc chạy ≠ N ⇒ KHÔNG ghi gì (dữ liệu đã đổi so với bảng được duyệt).
 *  2. Dòng tự khai `user=… · CÓ QUYỀN GHI/chỉ đọc`; kết nối chỉ-đọc mà có `--ghi` ⇒ dừng.
 *
 * Bản in KHÔNG chứa tên/SĐT — chỉ id + mã học viên.
 */
import "./_load-env";
import { currentDbHost } from "./_load-env";
import { scriptDb } from "./_script-db";
import { kiemQuyen, inQuyen } from "./_kiem-quyen";
import {
  quyetDinhNoiLead,
  type BangChungNoiLead,
  type ChuoiBangChung,
} from "../lib/students/noi-lead-cu";
import {
  dienTuLead,
  type LeadChildDeDien,
  type LeadDeDien,
  type PhanDien,
} from "../lib/students/dien-tu-lead";
import { writeAudit } from "../lib/audit/audit-log";
import { hocVienDaAnDanhTheoNhatKy, tenLaDaAnDanh } from "../lib/students/da-an-danh";
import { canonicalPhone, expandPhoneVariants, phoneKey } from "../lib/phone";
import { isSameChildName } from "../lib/lead/intake/normalize";

const db = scriptDb();
const GHI = process.argv.includes("--ghi");
/**
 * 26/09/2026 — ĐO trên một DB CHƯA có migration `20260925120000_student_lead_nguon_va_thong_tin_ph`
 * (prod, trước lượt test → main): không đọc cột mới nào, coi MỌI học viên là chưa nối, và in
 * thêm phép đo chuỗi ⑤ "cùng SĐT + đúng tên" (chưa áp dụng). Chỉ đo — đi với `--ghi` là dừng.
 * Chạy bằng nút "Ngưỡng thanh toán · PROD · ĐỌC", lựa chọn `noi-hoc-vien-lead`.
 */
const TRUOC_MIGRATION = process.argv.includes("--truoc-migration");
/** Số HV mỗi câu đọc bằng chứng (danh sách IN). */
const LO_DOC = 500;
/** Số HV mỗi transaction ghi — nhỏ để không chạm trần thời gian qua WAN. */
const LO_GHI = 50;

const ACTOR = { id: null, name: "Script nối học viên ↔ lead (noi-hoc-vien-voi-lead)" };

/** `null` = không truyền; `NaN` = truyền nhưng không phải số nguyên ≥ 0. */
function docSoDuyet(): number | null {
  const a = process.argv.find((x) => x.startsWith("--expect="));
  if (!a) return null;
  const n = Number(a.slice("--expect=".length));
  return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
}

function chiaLo<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const HV_SELECT = {
  id: true,
  // Chỉ để nhận ra hồ sơ đã ẩn danh NĐ13 (tiền tố "[Đã xoá") — KHÔNG in ra.
  name: true,
  studentCode: true,
  centerId: true,
  dateOfBirth: true,
  gender: true,
  school: true,
  currentGrade: true,
  parentEmail: true,
  parentGender: true,
  parentDob: true,
  parentFacebookUrl: true,
  city: true,
  ward: true,
  address: true,
  district: true,
  // Chỉ để ĐO chuỗi ⑤ (--truoc-migration) — không in ra.
  parentPhone: true,
} as const;

/** `HV_SELECT` bỏ 3 cột mà migration 25/09 mới thêm — đọc được trên DB chưa migrate. */
const HV_SELECT_CU = {
  id: true,
  name: true,
  studentCode: true,
  centerId: true,
  dateOfBirth: true,
  gender: true,
  school: true,
  currentGrade: true,
  parentEmail: true,
  city: true,
  ward: true,
  address: true,
  district: true,
  parentPhone: true,
} as const;

/** Đọc `newValues` của dòng AuditLog chốt lead: v2 ghi `studentIds[]`, v1 ghi `studentId`. */
function hocVienTrongNhatKy(newValues: unknown): string[] {
  if (!newValues || typeof newValues !== "object" || Array.isArray(newValues)) return [];
  const v = newValues as Record<string, unknown>;
  const out: string[] = [];
  if (Array.isArray(v.studentIds)) {
    for (const x of v.studentIds) if (typeof x === "string") out.push(x);
  }
  if (typeof v.studentId === "string") out.push(v.studentId);
  return out;
}

/**
 * ĐO (chưa áp dụng) chuỗi ⑤ "cùng SĐT phụ huynh + đúng tên con" cho nhóm KHÔNG có bằng chứng.
 * Luật nối 25/09 (chủ dự án chốt "đừng nới") KHÔNG gồm chuỗi này; con số dưới là để chủ dự án
 * quyết có nới hay không — trả lời câu "lên prod có phải gắn tay từng em không". Một câu đọc lead
 * cho mỗi lô SĐT (không N+1). Chỉ in SỐ, không tên / SĐT.
 */
async function doChuoiSdtTen(ds: { name: string; parentPhone: string | null }[]): Promise<void> {
  const kq = { noiDuoc: 0, tenKhongKhop: 0, phieuChuaCoBe: 0, nhieuPhieu: 0, khongPhieu: 0, khongSdt: 0 };
  const theoSdt = new Map<string, { childName: string | null; children: { fullName: string }[] }[]>();
  const bienThe = expandPhoneVariants(ds.map((s) => s.parentPhone));
  for (const lo of chiaLo(bienThe, LO_DOC)) {
    const leads = await db.lead.findMany({
      where: { deletedAt: null, phone: { in: lo } },
      select: { phone: true, childName: true, children: { select: { fullName: true } } },
    });
    for (const l of leads) {
      const k = phoneKey(l.phone);
      const a = theoSdt.get(k) ?? [];
      a.push({ childName: l.childName, children: l.children });
      theoSdt.set(k, a);
    }
  }
  for (const s of ds) {
    const k = canonicalPhone(s.parentPhone);
    if (!k) {
      kq.khongSdt++;
      continue;
    }
    const phieu = theoSdt.get(k) ?? [];
    if (phieu.length === 0) kq.khongPhieu++;
    else if (phieu.length > 1) kq.nhieuPhieu++;
    else {
      const p = phieu[0]!;
      const khop =
        p.children.filter((c) => isSameChildName(c.fullName, s.name)).length +
        (p.children.length === 0 && isSameChildName(p.childName, s.name) ? 1 : 0);
      if (khop === 1) kq.noiDuoc++;
      else if (p.children.length === 0 && !p.childName) kq.phieuChuaCoBe++;
      else kq.tenKhongKhop++;
    }
  }
  console.log('=== ĐO THÊM (CHƯA áp dụng) — chuỗi ⑤ "cùng SĐT phụ huynh + đúng tên con" ===');
  console.log(`Trên ${ds.length} học viên KHÔNG có bằng chứng ①–④:`);
  console.log(`  nối được (đúng 1 phiếu sống, đúng 1 bé trùng tên): ${kq.noiDuoc}`);
  console.log(`  1 phiếu nhưng không bé nào trùng tên            : ${kq.tenKhongKhop}`);
  console.log(`  1 phiếu chưa khai bé nào                         : ${kq.phieuChuaCoBe}`);
  console.log(`  ≥2 phiếu cùng SĐT (mập mờ — không bao giờ tự nối): ${kq.nhieuPhieu}`);
  console.log(`  không phiếu nào cùng SĐT                         : ${kq.khongPhieu}`);
  console.log(`  SĐT phụ huynh trống / không hợp lệ               : ${kq.khongSdt}`);
  console.log("");
}

type KeHoach = {
  studentId: string;
  studentCode: string | null;
  centerId: string | null;
  leadId: string;
  leadChildId: string | null;
  chain: ChuoiBangChung;
  dien: PhanDien;
};

async function main() {
  const soDuyet = docSoDuyet();
  const quyen = await kiemQuyen(db);
  console.log(`Đích: ${currentDbHost()}`);
  inQuyen(quyen, GHI);
  if (TRUOC_MIGRATION && GHI) {
    console.log("::error::`--truoc-migration` chỉ để ĐO — không đi cùng `--ghi`. KHÔNG ghi gì.");
    process.exitCode = 1;
    return;
  }
  console.log(GHI ? "CHẾ ĐỘ GHI (--ghi)\n" : "DRY-RUN — chưa ghi gì.\n");
  if (TRUOC_MIGRATION) {
    console.log("CHẾ ĐỘ ĐO TRƯỚC MIGRATION — DB chưa có cột Student.leadId: coi MỌI học viên là chưa nối.\n");
  }

  // ── 1. Tập học viên cần xét ─────────────────────────────────────────────────────────
  const hocVienTatCa = TRUOC_MIGRATION
    ? (
        await db.student.findMany({
          where: { deletedAt: null },
          select: HV_SELECT_CU,
          orderBy: { createdAt: "asc" },
        })
      ).map((s) => ({ ...s, parentGender: null, parentDob: null, parentFacebookUrl: null }))
    : await db.student.findMany({
        where: { leadId: null, deletedAt: null },
        select: HV_SELECT,
        orderBy: { createdAt: "asc" },
      });
  console.log(`Học viên chưa nối lead (chưa xoá): ${hocVienTatCa.length}`);

  // ── 1b. LOẠI hồ sơ đã ẩn danh theo NĐ13 ─────────────────────────────────────────────
  // Ẩn danh giữ bản ghi + ghi danh + đơn + nhật ký chốt lead, và đặt NULL các ô PII. Không
  // loại ở đây thì bốn chuỗi bằng chứng vẫn trỏ về lead của gia đình, và `dienTuLead` coi
  // ô vừa xoá là ô TRỐNG ⇒ lượt --ghi điền LẠI ngày sinh / email / link FB phụ huynh — đảo
  // ngược lượt xoá theo yêu cầu mà dry-run (chỉ in số + id) không cho ai thấy.
  // Hai dấu, dùng cả hai: tên "[Đã xoá …]" (sửa được ở form) + nhật ký ERASE_PII (không sửa được).
  const daAnDanhTheoNhatKy = new Set<string>();
  for (const lo of chiaLo(hocVienTatCa.map((s) => s.id), LO_DOC)) {
    for (const id of await hocVienDaAnDanhTheoNhatKy(db, lo)) daAnDanhTheoNhatKy.add(id);
  }
  const hocVien = hocVienTatCa.filter(
    (s) => !tenLaDaAnDanh(s.name) && !daAnDanhTheoNhatKy.has(s.id),
  );
  console.log(`  bỏ qua — đã ẩn danh NĐ13  : ${hocVienTatCa.length - hocVien.length}`);
  const hvTheoId = new Map(hocVien.map((s) => [s.id, s]));

  // ── 2. Gom bằng chứng theo LÔ ─────────────────────────────────────────────────────────
  const ghiDanhTheoHv = new Map<string, { leadChildId: string; enrolledAt: Date }[]>();
  const thanhToanTheoHv = new Map<string, string[]>();
  const donHangTheoHv = new Map<string, string[]>();
  const nhatKyTheoHv = new Map<string, string[]>();
  const day = (m: Map<string, string[]>, k: string, v: string) => {
    const a = m.get(k);
    if (a) a.push(v);
    else m.set(k, [v]);
  };

  for (const lo of chiaLo(hocVien.map((s) => s.id), LO_DOC)) {
    // ① — CÓ đọc ghi danh đã xoá mềm (xem đầu file). Không có khoá `deletedAt` nào ở đây.
    const enr = await db.enrollment.findMany({
      where: { studentId: { in: lo }, leadChildId: { not: null } },
      select: { studentId: true, leadChildId: true, enrolledAt: true },
    });
    for (const e of enr) {
      const a = ghiDanhTheoHv.get(e.studentId) ?? [];
      a.push({ leadChildId: e.leadChildId!, enrolledAt: e.enrolledAt });
      ghiDanhTheoHv.set(e.studentId, a);
    }

    // ② — khoản CHƯA xoá, thuộc đơn CHƯA xoá có leadId.
    const pays = await db.payment.findMany({
      where: {
        deletedAt: null,
        enrollment: { studentId: { in: lo } },
        order: { deletedAt: null, leadId: { not: null } },
      },
      select: { enrollment: { select: { studentId: true } }, order: { select: { leadId: true } } },
    });
    for (const p of pays) {
      if (p.enrollment && p.order.leadId) day(thanhToanTheoHv, p.enrollment.studentId, p.order.leadId);
    }

    // ③ — đơn CHƯA xoá có leadId, ghi `studentId` ở đầu đơn HOẶC ở dòng đơn.
    const orders = await db.order.findMany({
      where: {
        deletedAt: null,
        leadId: { not: null },
        OR: [{ studentId: { in: lo } }, { items: { some: { studentId: { in: lo } } } }],
      },
      select: {
        leadId: true,
        studentId: true,
        items: { where: { studentId: { in: lo } }, select: { studentId: true } },
      },
    });
    const loSet = new Set(lo);
    for (const o of orders) {
      const hv = new Set<string>();
      if (o.studentId && loSet.has(o.studentId)) hv.add(o.studentId);
      for (const it of o.items) if (it.studentId) hv.add(it.studentId);
      for (const sid of hv) day(donHangTheoHv, sid, o.leadId!);
    }
  }

  // ④ — MỘT câu cho cả sổ: dòng chốt lead (`entityType: "Lead"`, `STATUS_CHANGE`) nhắc id HV.
  const nhatKy = await db.auditLog.findMany({
    where: { entityType: "Lead", action: "STATUS_CHANGE" },
    select: { entityId: true, newValues: true },
  });
  for (const r of nhatKy) {
    for (const sid of hocVienTrongNhatKy(r.newValues)) {
      if (hvTheoId.has(sid)) day(nhatKyTheoHv, sid, r.entityId);
    }
  }

  // ── 3. Con (LeadChild) của chuỗi ① + lead CÒN SỐNG ────────────────────────────────────
  const conIds = [...new Set([...ghiDanhTheoHv.values()].flat().map((g) => g.leadChildId))];
  const conTheoId = new Map<string, LeadChildDeDien & { leadId: string }>();
  for (const lo of chiaLo(conIds, LO_DOC)) {
    const rows = await db.leadChild.findMany({
      where: { id: { in: lo } },
      select: { id: true, leadId: true, dob: true, gender: true, schoolName: true, gradeLevel: true },
    });
    for (const c of rows) conTheoId.set(c.id, c);
  }

  const leadIdsUngVien = new Set<string>([
    ...[...conTheoId.values()].map((c) => c.leadId),
    ...[...thanhToanTheoHv.values()].flat(),
    ...[...donHangTheoHv.values()].flat(),
    ...[...nhatKyTheoHv.values()].flat(),
  ]);
  const leadSong = new Map<string, LeadDeDien>();
  for (const lo of chiaLo([...leadIdsUngVien], LO_DOC)) {
    const rows = await db.lead.findMany({
      where: { id: { in: lo }, deletedAt: null },
      select: {
        id: true,
        email: true,
        facebookUrl: true,
        parentGender: true,
        parentDob: true,
        city: true,
        ward: true,
        addressLine: true,
      },
    });
    for (const l of rows) leadSong.set(l.id, l);
  }
  const conSong = (ids: string[]) => ids.filter((id) => leadSong.has(id));

  // ── 4. Quyết định từng HV (thuần) ─────────────────────────────────────────────────────
  const keHoach: KeHoach[] = [];
  const mapHo: { studentId: string; studentCode: string | null; leadIds: string[] }[] = [];
  let khongBangChung = 0;
  const dsKhongBangChung: typeof hocVien = [];
  for (const s of hocVien) {
    const bc: BangChungNoiLead = {
      tuGhiDanh: (ghiDanhTheoHv.get(s.id) ?? []).flatMap((g) => {
        const con = conTheoId.get(g.leadChildId);
        return con && leadSong.has(con.leadId)
          ? [{ leadId: con.leadId, leadChildId: g.leadChildId, enrolledAt: g.enrolledAt }]
          : [];
      }),
      tuThanhToan: conSong(thanhToanTheoHv.get(s.id) ?? []),
      tuDonHang: conSong(donHangTheoHv.get(s.id) ?? []),
      tuNhatKy: conSong(nhatKyTheoHv.get(s.id) ?? []),
    };
    const kq = quyetDinhNoiLead(bc);
    if (kq === null) {
      khongBangChung++;
      dsKhongBangChung.push(s);
      continue;
    }
    if ("mapHo" in kq) {
      mapHo.push({ studentId: s.id, studentCode: s.studentCode, leadIds: kq.leadIds });
      continue;
    }
    const con = kq.leadChildId ? (conTheoId.get(kq.leadChildId) ?? null) : null;
    keHoach.push({
      studentId: s.id,
      studentCode: s.studentCode,
      centerId: s.centerId,
      leadId: kq.leadId,
      leadChildId: kq.leadChildId,
      chain: kq.chain,
      dien: dienTuLead(s, leadSong.get(kq.leadId) ?? null, con),
    });
  }

  // ── 5. Báo cáo ────────────────────────────────────────────────────────────────────────
  const theoChuoi: Record<ChuoiBangChung, number> = {
    GHI_DANH: 0,
    THANH_TOAN: 0,
    DON_HANG: 0,
    NHAT_KY: 0,
  };
  const theoO = new Map<string, number>();
  let hvCoDien = 0;
  for (const k of keHoach) {
    theoChuoi[k.chain]++;
    const oo = Object.keys(k.dien);
    if (oo.length > 0) hvCoDien++;
    for (const o of oo) theoO.set(o, (theoO.get(o) ?? 0) + 1);
  }
  const conNhieuHv = new Map<string, number>();
  for (const k of keHoach) {
    if (k.leadChildId) conNhieuHv.set(k.leadChildId, (conNhieuHv.get(k.leadChildId) ?? 0) + 1);
  }
  const conTrung = [...conNhieuHv.entries()].filter(([, n]) => n > 1);

  console.log("\n=== KẾ HOẠCH NỐI ===");
  console.log(`SẼ NỐI                  : ${keHoach.length} học viên`);
  console.log(`  ① qua ghi danh        : ${theoChuoi.GHI_DANH} (có leadChildId)`);
  console.log(`  ② qua khoản thu       : ${theoChuoi.THANH_TOAN}`);
  console.log(`  ③ qua đơn hàng        : ${theoChuoi.DON_HANG}`);
  console.log(`  ④ qua nhật ký chốt    : ${theoChuoi.NHAT_KY}`);
  console.log(`MẬP MỜ (≥2 lead, KHÔNG ghi): ${mapHo.length} học viên`);
  console.log(`Không có bằng chứng     : ${khongBangChung} học viên (nhập tay/Excel — gắn tay nếu cần)`);
  console.log(
    `Điền ô trống            : ${hvCoDien} học viên · ` +
      `${[...theoO.values()].reduce((a, b) => a + b, 0)} ô` +
      (theoO.size > 0
        ? ` (${[...theoO.entries()].sort().map(([o, n]) => `${o}=${n}`).join(", ")})`
        : ""),
  );
  if (conTrung.length > 0) {
    console.log(
      `⚠️ ${conTrung.length} con (LeadChild) sẽ nối tới >1 học viên — thường là hồ sơ HV trùng: ` +
        conTrung.map(([id, n]) => `${id}×${n}`).join(", "),
    );
  }
  // Dòng nối qua ②③④ là bằng chứng cấp PHIẾU (không biết đúng con nào) — in từng dòng để
  // người duyệt rà được, thay vì chỉ một con số. Chỉ id + mã, không tên/SĐT.
  const kemChac = keHoach.filter((k) => k.chain !== "GHI_DANH");
  if (kemChac.length > 0) {
    console.log("\n--- SẼ NỐI qua ②③④ (bằng chứng cấp phiếu) — rà từng dòng trước khi duyệt ---");
    for (const k of kemChac) {
      console.log(`  ${k.studentId} (${k.studentCode ?? "chưa có mã"}) → lead ${k.leadId} · ${k.chain}`);
    }
  }
  if (mapHo.length > 0) {
    console.log("\n--- MẬP MỜ: người rà mở từng HV, dùng nút \"Gắn lead\" để chọn đúng phiếu ---");
    for (const m of mapHo) {
      console.log(`  ${m.studentId} (${m.studentCode ?? "chưa có mã"}) · lead: ${m.leadIds.join(", ")}`);
    }
  }
  console.log("");

  if (TRUOC_MIGRATION) await doChuoiSdtTen(dsKhongBangChung);

  if (TRUOC_MIGRATION) {
    console.log(
      "ĐO TRƯỚC MIGRATION — không ghi được ở chế độ này. Sau lượt test → main (migration đã chạy), " +
        "chạy DRY-RUN thường để có số duyệt thật rồi mới `--ghi --expect=<N>`.",
    );
    return;
  }

  if (!GHI) {
    console.log(
      keHoach.length > 0
        ? `Chạy lại với \`--ghi --expect=${keHoach.length}\` để ghi. Phần MẬP MỜ không bao giờ được ghi tự động.`
        : "Không có học viên nào nối được tự động.",
    );
    return;
  }

  // ── 6. GHI ────────────────────────────────────────────────────────────────────────────
  if (soDuyet === null || Number.isNaN(soDuyet)) {
    console.log("::error::`--ghi` phải đi kèm `--expect=<số SẼ NỐI của bản dry-run đã duyệt>`. KHÔNG ghi gì.");
    process.exitCode = 1;
    return;
  }
  if (soDuyet !== keHoach.length) {
    console.log(
      `::error::Kế hoạch lúc này (${keHoach.length}) ≠ số đã duyệt (${soDuyet}). KHÔNG ghi gì — ` +
        "dữ liệu đã đổi so với bảng được duyệt; chạy lại dry-run và duyệt bảng mới.",
    );
    process.exitCode = 1;
    return;
  }
  if (quyen.ghiDuoc === false) {
    console.log("::error::Có `--ghi` nhưng kết nối CHỈ ĐỌC — sai chuỗi kết nối. KHÔNG ghi gì.");
    process.exitCode = 1;
    return;
  }

  let daNoi = 0;
  let boQua = 0;
  let oDaDien = 0;
  for (const lo of chiaLo(keHoach, LO_GHI)) {
    const kq = await db.$transaction(
      async (tx) => {
        // Đọc LẠI trong transaction: ô trống được tính trên giá trị MỚI NHẤT, không phải
        // ảnh chụp lúc lập kế hoạch — người dùng có thể vừa điền tay ô đó.
        const moi = await tx.student.findMany({
          where: { id: { in: lo.map((k) => k.studentId) }, leadId: null, deletedAt: null },
          select: HV_SELECT,
        });
        // Kiểm LẠI dấu ẩn danh trong transaction: hồ sơ có thể vừa bị ẩn danh sau lúc lập kế hoạch.
        const anDanhMoi = await hocVienDaAnDanhTheoNhatKy(tx, moi.map((s) => s.id));
        const moiTheoId = new Map(
          moi.filter((s) => !tenLaDaAnDanh(s.name) && !anDanhMoi.has(s.id)).map((s) => [s.id, s]),
        );
        let noi = 0;
        let bo = 0;
        let o = 0;
        for (const k of lo) {
          const s = moiTheoId.get(k.studentId);
          if (!s) {
            bo++; // vừa được nối (tay/convert), vừa bị xoá, hoặc vừa bị ẩn danh — không đụng
            continue;
          }
          const con = k.leadChildId ? (conTheoId.get(k.leadChildId) ?? null) : null;
          const dien = dienTuLead(s, leadSong.get(k.leadId) ?? null, con);
          const r = await tx.student.updateMany({
            where: { id: k.studentId, leadId: null },
            data: { ...dien, leadId: k.leadId, leadChildId: k.leadChildId },
          });
          if (r.count !== 1) {
            bo++;
            continue;
          }
          noi++;
          o += Object.keys(dien).length;
          // Nhật ký: CHỈ tên ô đã điền, không giá trị (ngày sinh PH / link FB là PII).
          await writeAudit({
            actor: ACTOR,
            module: "students",
            entityType: "Student",
            entityId: k.studentId,
            action: "student.link-lead",
            newValues: {
              leadId: k.leadId,
              leadChildId: k.leadChildId,
              chain: k.chain,
              oDaDien: Object.keys(dien),
            },
            changedFields: ["leadId", ...(k.leadChildId ? ["leadChildId"] : []), ...Object.keys(dien)],
            reason: `Nối học viên cũ về lead nguồn (chuỗi ${k.chain})`,
            orgUnitId: s.centerId,
            tx,
          });
        }
        return { noi, bo, o };
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
    daNoi += kq.noi;
    boQua += kq.bo;
    oDaDien += kq.o;
    console.log(`  … lô ${lo.length}: nối ${kq.noi}, bỏ qua ${kq.bo}`);
  }

  console.log(`\nXONG: nối ${daNoi}/${keHoach.length} học viên · điền ${oDaDien} ô · bỏ qua ${boQua}.`);
  console.log("Nghiệm thu: chạy lại DRY-RUN — nhóm \"SẼ NỐI\" phải về 0 (còn lại chỉ MẬP MỜ + không bằng chứng).");
}

main()
  .catch((e) => {
    console.error(String(e instanceof Error ? (e.stack ?? e.message) : e).slice(0, 2000));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
