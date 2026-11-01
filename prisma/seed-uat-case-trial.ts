// prisma/seed-uat-case-trial.ts — dựng dữ liệu để NGHIỆM THU màn "case trial" (23/09/2026).
//
// VÌ SAO CÓ FILE NÀY. Màn chi tiết lớp trải nghiệm đổi hình: một lớp = một ngày × một
// khung giờ, bên trong là các CASE của nhiều Sale, mỗi case một nhóm học viên. Mọi lớp
// trial trên DB local lúc đó đều RỖNG (0 case, 0 học viên) — mở ra chỉ thấy trạng thái
// rỗng, không nghiệm thu được thanh khung giờ, case chồng giờ, hay luật gắn/gỡ.
//
// DỰNG HAI LỚP, MỖI LỚP MỘT MỤC ĐÍCH:
//
//   A. "CS1-Lớp trial 3" — T4 23/09 17:30–21:00 — ĐÚNG ví dụ chủ dự án đưa ra:
//        Sale 1: 1 case — 1 bạn Sata 3, 18:00–19:00
//        Sale 2: 2 case — 3 bạn Sata 4 17:30–18:30 · 1 bạn Sata 6 19:00–20:00
//      Nhìn vào đây để thấy thanh khung giờ tự chia 2 làn cho ba case chồng giờ.
//
//   B. "CS1-Lớp trial 9" — CN 27/09 14:00–17:30 — lớp bạn đang mở; dùng để THỬ QUYỀN:
//        · case của Sale 1 có GẮN CHÉO một bé của Sale 2  → Sale 1 thấy nút gỡ bị KHOÁ,
//          và KHÔNG xoá được case của chính mình (đang giữ khách người khác)
//        · case CŨ (createdById NULL)                      → chỉ Quản lý sửa được
//        · 2 bé "Chưa xếp case"                            → khối riêng + ô chọn case
//
// "Sale 1" = uat.sale1, "Sale 2" = uat.sale3 — cả hai neo CS1. (uat.sale2 thuộc CS2 nên
// không dùng được: lớp CS1 thì người CS2 không nhìn thấy.)
//
// CHẠY (chỉ máy local):
//   UAT_SEED=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/satarobo_local \
//     pnpm exec tsx prisma/seed-uat-case-trial.ts
//
// ⚠️ Id sinh TẤT ĐỊNH nên chạy lại là ĐƯA VỀ ĐÚNG KỊCH BẢN (idempotent): bé đã bị gỡ sẽ
// được xếp lại, case đã sửa giờ sẽ quay về giờ gốc. Thứ người dùng TỰ TẠO thêm (case
// mới, học viên mới) thì KHÔNG bị đụng tới — file này không có một câu xoá nào.
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, loiTunnelVps } from "../lib/security/url-db-cuc-bo";

const db = new PrismaClient();
/**
 * Mật khẩu chung của tài khoản UAT — BẮT BUỘC đặt bằng env `UAT_PASSWORD` (≥ 8 ký tự).
 *
 * 09/10/2026: bỏ giá trị mặc định cố định. Chuỗi gõ sẵn trong mã nguồn là mật khẩu ai đọc
 * được mã cũng biết — và mã sắp được xuất sang một repo gương PUBLIC cho CI, nên một tài
 * khoản UAT trên test.satarobo.vn dùng chuỗi đó là cửa đăng nhập mở cho người lạ.
 * Thiếu env ⇒ NÉM, không rơi về chuỗi nào. Đọc lười (trong hàm) để chỉ import file thì không ném.
 */
function matKhauUat(): string {
  const v = process.env.UAT_PASSWORD;
  if (!v || v.length < 8) {
    throw new Error(
      "[seed UAT] Thiếu UAT_PASSWORD (≥ 8 ký tự). Không còn mật khẩu mặc định — đặt env " +
        "UAT_PASSWORD trước khi seed (workflow: secret UAT_PASSWORD).",
    );
  }
  return v;
}

function uid(...phan: string[]): string {
  return "uat" + createHash("sha1").update(["case-trial", ...phan].join("|")).digest("hex").slice(0, 22);
}

// ── Chặn cứng: chỉ ghi vào Postgres trên CHÍNH máy này ────────────────────────────────
function assertLocal(): void {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  let ten = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    ten = u.pathname.replace(/^\//, "");
  } catch {
    throw new Error("DATABASE_URL không đọc được");
  }
  console.log(`\n  Đích ghi: ${host} / ${ten}`);
  // 28/09/2026 — tunnel VPS (127.0.0.1:<cổng tunnel PROD> = PROD, :<cổng tunnel TEST> = TEST) mang host 127.0.0.1 ⇒ phép
  // hỏi theo hostname cũ cho qua. Nhận diện ở `lib/security/url-db-cuc-bo.ts`.
  const tunnel = loiTunnelVps(url);
  if (tunnel) throw new Error(tunnel);
  if (!laDbCucBo(url)) {
    // Cờ UAT_SEED một mình KHÔNG đủ: nó chỉ hỏi "có chủ đích không", không hỏi "đúng
    // chỗ không". Seed này đặt lịch hẹn giả với tên phụ huynh giả — lên Supabase là rác
    // trên màn của người thật.
    throw new Error(`Từ chối: seed này chỉ chạy trên Postgres local, không chạy trên ${host}`);
  }
  if (process.env.UAT_SEED !== "1") {
    throw new Error("Chưa bật cờ an toàn. Đúng DB rồi thì chạy lại với UAT_SEED=1.");
  }
}

// ── Kịch bản ────────────────────────────────────────────────────────────────────────
type Sale = "sale1" | "sale3";
type Khoa = "sata-3" | "sata-4" | "sata-5" | "sata-6";

/** Một bé. `sale` = ai phụ trách LEAD của bé (thứ quyết định ai gỡ được). */
type Be = {
  key: string;
  ten: string;
  phuHuynh: string;
  sdt: string;
  sale: Sale;
  khoa: Khoa;
  lop: string;
  /** Người GẮN bé vào lớp — có thể khác người phụ trách lead (gắn chéo). */
  gan: Sale;
};

type Case = {
  key: string;
  startTime: string;
  endTime: string;
  phong: number; // thứ tự phòng 1..6 của CS1
  gv: "gv1" | "gv2";
  /** `null` = case CŨ, tạo trước khi có cột `createdById`. */
  moi: Sale | null;
  be: string[];
  /** Case ĐÃ HUỶ — bé bên trong phải hiện ở khối "Chưa xếp case", không kẹt lại. */
  huy?: true;
};

const BE: Be[] = [
  // Lớp A — đúng ví dụ chủ dự án
  { key: "a-an", ten: "Trần Minh An", phuHuynh: "Trần Văn Hải", sdt: "84987650001", sale: "sale3", khoa: "sata-4", lop: "Lớp 4", gan: "sale3" },
  { key: "a-binh", ten: "Lê Gia Bình", phuHuynh: "Lê Thị Hoa", sdt: "84987650002", sale: "sale3", khoa: "sata-4", lop: "Lớp 4", gan: "sale3" },
  { key: "a-chi", ten: "Phạm Bảo Chi", phuHuynh: "Phạm Quốc Tuấn", sdt: "84987650003", sale: "sale3", khoa: "sata-4", lop: "Lớp 5", gan: "sale3" },
  { key: "a-dung", ten: "Nguyễn Tiến Dũng", phuHuynh: "Nguyễn Thị Mai", sdt: "84987650004", sale: "sale1", khoa: "sata-3", lop: "Lớp 3", gan: "sale1" },
  { key: "a-giang", ten: "Võ Hương Giang", phuHuynh: "Võ Đình Nam", sdt: "84987650005", sale: "sale3", khoa: "sata-6", lop: "Lớp 7", gan: "sale3" },
  // Lớp B — thử quyền
  { key: "b-ha", ten: "Đặng Thu Hà", phuHuynh: "Đặng Văn Long", sdt: "84987650011", sale: "sale1", khoa: "sata-5", lop: "Lớp 6", gan: "sale1" },
  { key: "b-khoa", ten: "Huỳnh Anh Khoa", phuHuynh: "Huỳnh Thị Lan", sdt: "84987650012", sale: "sale3", khoa: "sata-5", lop: "Lớp 6", gan: "sale3" },
  { key: "b-lan", ten: "Bùi Ngọc Lan", phuHuynh: "Bùi Minh Đức", sdt: "84987650013", sale: "sale3", khoa: "sata-4", lop: "Lớp 4", gan: "sale3" },
  { key: "b-minh", ten: "Hồ Quang Minh", phuHuynh: "Hồ Thị Thu", sdt: "84987650014", sale: "sale3", khoa: "sata-4", lop: "Lớp 5", gan: "sale3" },
  { key: "b-nam", ten: "Phan Hoài Nam", phuHuynh: "Phan Văn Tùng", sdt: "84987650015", sale: "sale1", khoa: "sata-3", lop: "Lớp 3", gan: "sale1" },
  { key: "b-oanh", ten: "Trịnh Kim Oanh", phuHuynh: "Trịnh Quốc Việt", sdt: "84987650016", sale: "sale1", khoa: "sata-6", lop: "Lớp 7", gan: "sale1" },
  { key: "b-phuc", ten: "Lý Hồng Phúc", phuHuynh: "Lý Thanh Bình", sdt: "84987650017", sale: "sale3", khoa: "sata-5", lop: "Lớp 6", gan: "sale3" },
  { key: "b-quan", ten: "Trần Đức Quân", phuHuynh: "Trần Văn Hùng", sdt: "84987650018", sale: "sale1", khoa: "sata-4", lop: "Lớp 5", gan: "sale1" },
];

const LOP: {
  id: string;
  nhan: string;
  ymd: string;
  cases: Case[];
  /** Bé đã vào lớp nhưng CHƯA thuộc case nào. */
  chuaXep: string[];
}[] = [
  {
    id: "cmuch080r000712lst133dm12", // CS1-Lớp trial 3 · T4 23/09 · 17:30–21:00
    nhan: "A · ví dụ của chủ dự án",
    ymd: "2026-09-23",
    cases: [
      { key: "a-s2a", startTime: "17:30", endTime: "18:30", phong: 1, gv: "gv1", moi: "sale3", be: ["a-an", "a-binh", "a-chi"] },
      { key: "a-s1", startTime: "18:00", endTime: "19:00", phong: 2, gv: "gv2", moi: "sale1", be: ["a-dung"] },
      { key: "a-s2b", startTime: "19:00", endTime: "20:00", phong: 1, gv: "gv1", moi: "sale3", be: ["a-giang"] },
    ],
    chuaXep: [],
  },
  {
    id: "cmuch096o000v12lsts08jffq", // CS1-Lớp trial 9 · CN 27/09 · 14:00–17:30
    nhan: "B · thử quyền",
    ymd: "2026-09-27",
    cases: [
      // Case của Sale 1 nhưng GIỮ một bé của Sale 2 (b-khoa, do Sale 2 tự gắn vào).
      { key: "b-s1", startTime: "14:00", endTime: "15:00", phong: 3, gv: "gv1", moi: "sale1", be: ["b-ha", "b-khoa"] },
      { key: "b-s2", startTime: "14:30", endTime: "15:30", phong: 4, gv: "gv2", moi: "sale3", be: ["b-lan", "b-minh"] },
      // Case CŨ — không biết ai mở.
      { key: "b-cu", startTime: "16:00", endTime: "17:00", phong: 3, gv: "gv1", moi: null, be: ["b-nam"] },
      // Case ĐÃ HUỶ còn giữ một bé ACTIVE — huỷ case không đụng ghi danh (cố ý giữ vết), nên
      // màn lớp phải đưa bé này về khối "Chưa xếp case" để xếp lại (23/09 — trước bản vá
      // bé kẹt trong thẻ case đã huỷ, không khối nào nhận).
      { key: "b-huy", startTime: "15:30", endTime: "16:30", phong: 4, gv: "gv2", moi: "sale1", be: ["b-quan"], huy: true },
    ],
    chuaXep: ["b-oanh", "b-phuc"],
  },
];

async function main() {
  assertLocal();

  const CS1 = "co-so-nguyen-huu-tho";
  const [org, sale1, sale3, gv1, admin, vaiGv, phong, khoa] = await Promise.all([
    db.orgUnit.findFirst({ where: { code: "CS1" }, select: { id: true } }),
    db.user.findUnique({ where: { email: "uat.sale1@satarobo.vn" }, select: { id: true, name: true } }),
    db.user.findUnique({ where: { email: "uat.sale3@satarobo.vn" }, select: { id: true, name: true } }),
    db.user.findUnique({ where: { email: "uat.giaovien@satarobo.vn" }, select: { id: true } }),
    db.user.findUnique({ where: { email: "uat.admin@satarobo.vn" }, select: { id: true } }),
    db.roleDef.findFirst({ where: { code: "TEACHER" }, select: { id: true } }),
    db.room.findMany({
      where: { centerId: CS1, status: "ACTIVE" },
      select: { id: true },
      orderBy: { displayOrder: "asc" },
    }),
    db.course.findMany({
      where: { slug: { in: ["sata-3", "sata-4", "sata-5", "sata-6"] } },
      select: { id: true, slug: true },
    }),
  ]);

  // Thiếu nền thì DỪNG và nói thiếu gì — đừng dựng nửa kịch bản rồi báo xong.
  const thieu = [
    !org && "OrgUnit CS1 (chạy pnpm db:seed:orgunit)",
    !sale1 && "uat.sale1 (chạy UAT_SEED=1 pnpm db:seed:uat)",
    !sale3 && "uat.sale3",
    !gv1 && "uat.giaovien",
    !admin && "uat.admin",
    !vaiGv && "RoleDef TEACHER (chạy pnpm db:seed:roles)",
    phong.length < 4 && `đủ 4 phòng ở CS1 (đang có ${phong.length})`,
    khoa.length < 4 && `4 khoá Sata 3–6 (đang có ${khoa.length})`,
  ].filter(Boolean);
  if (thieu.length) throw new Error("Thiếu nền: " + thieu.join(" · "));

  for (const lop of LOP) {
    const c = await db.trialClassV2.findUnique({
      where: { id: lop.id },
      select: { id: true, name: true, centerId: true, startTime: true, endTime: true },
    });
    if (!c) throw new Error(`Không thấy lớp ${lop.id} (${lop.nhan})`);
    if (c.centerId !== CS1) throw new Error(`Lớp ${c.name} không thuộc CS1`);
    // Kịch bản viết cho ĐÚNG khung này. Khung đã đổi thì dừng, đừng đẻ case ngoài khung.
    for (const k of lop.cases) {
      if (!c.startTime || !c.endTime || k.startTime < c.startTime || k.endTime > c.endTime) {
        throw new Error(`${c.name}: case ${k.startTime}–${k.endTime} nằm ngoài khung ${c.startTime}–${c.endTime}`);
      }
    }
  }

  // 23/09 — cả hai lớp là lớp THEO KHUNG (mô hình case). Cột `theoKhung` là thứ phân loại
  // lớp (lib/trial/nghia-null.ts), KHÔNG phải việc có giờ hay không: lớp mở bằng form trước
  // khi có cột này mang FALSE theo mặc định của migration.
  await db.trialClassV2.updateMany({
    where: { id: { in: LOP.map((l) => l.id) } },
    data: { theoKhung: true },
  });

  const saleId = { sale1: sale1!.id, sale3: sale3!.id };
  const khoaId = new Map(khoa.map((k) => [k.slug, k.id]));

  // ── Giáo viên thứ hai ────────────────────────────────────────────────────────────
  // CS1 chỉ có ĐÚNG một giáo viên UAT, mà ví dụ của chủ dự án có hai case CHỒNG GIỜ
  // (17:30–18:30 và 18:00–19:00). Một người không dạy hai chỗ cùng lúc.
  const hash = await bcrypt.hash(matKhauUat(), 10);
  const gv2 = await db.user.upsert({
    where: { email: "uat.giaovien2@satarobo.vn" },
    update: { name: "UAT — Giáo viên CS1 (2)", isActive: true, deletedAt: null },
    create: {
      email: "uat.giaovien2@satarobo.vn",
      name: "UAT — Giáo viên CS1 (2)",
      password: hash,
      role: "TEACHER",
      roles: ["TEACHER"],
      centerId: CS1,
      isActive: true,
    },
    select: { id: true },
  });
  await db.userOrgRole.upsert({
    where: { userId_orgUnitId_roleId: { userId: gv2.id, orgUnitId: org!.id, roleId: vaiGv!.id } },
    update: { status: "ACTIVE", effectiveTo: null },
    create: { userId: gv2.id, orgUnitId: org!.id, roleId: vaiGv!.id, grantedById: admin!.id },
  });
  const gvId = { gv1: gv1!.id, gv2: gv2.id };

  // ── Lead + con ────────────────────────────────────────────────────────────────────
  for (const b of BE) {
    const leadId = uid("lead", b.key);
    await db.lead.upsert({
      where: { id: leadId },
      update: { assignedToId: saleId[b.sale], status: "DA_HEN_HOC_THU", deletedAt: null },
      create: {
        id: leadId,
        parentName: b.phuHuynh,
        phone: b.sdt,
        centerId: CS1,
        orgUnitId: org!.id,
        assignedToId: saleId[b.sale],
        // Người NHẬP phiếu = chính Sale phụ trách. Cố ý: `laLeadCuaToi` cho qua cả
        // người nhập, nên nhập bởi người KHÁC sẽ làm một bé "thuộc" hai Sale và mọi
        // ca thử quyền ở lớp B mất nghĩa.
        createdById: saleId[b.sale],
        assignedAt: new Date(),
        status: "DA_HEN_HOC_THU",
        source: "UAT",
        note: "[seed case-trial 23/09]",
      },
    });
    await db.leadChild.upsert({
      where: { id: uid("con", b.key) },
      update: { fullName: b.ten, interestedCourseId: khoaId.get(b.khoa) ?? null, trialStatus: "SCHEDULED" },
      create: {
        id: uid("con", b.key),
        leadId,
        fullName: b.ten,
        gradeLevel: b.lop,
        interestedCenterId: CS1,
        interestedCourseId: khoaId.get(b.khoa) ?? null,
        trialStatus: "SCHEDULED",
      },
    });
  }
  const beTheoKey = new Map(BE.map((b) => [b.key, b]));

  // ── Case + ghi danh ───────────────────────────────────────────────────────────────
  for (const lop of LOP) {
    const ngay = new Date(`${lop.ymd}T00:00:00.000Z`); // @db.Date = nửa đêm UTC của ngày VN
    // `seq` theo giờ bắt đầu — nhưng phải CHỪA chỗ cho case người dùng tự tạo: lấy từ
    // seq lớn nhất hiện có, trừ những case của chính seed này.
    const idSeed = new Set(lop.cases.map((k) => uid("case", k.key)));
    const khac = await db.trialClassSession.aggregate({
      where: { trialClassId: lop.id, id: { notIn: [...idSeed] } },
      _max: { seq: true },
    });
    let seq = khac._max.seq ?? 0;

    const sapXep = [...lop.cases].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const k of sapXep) {
      seq += 1;
      const du = {
        seq,
        date: ngay,
        startTime: k.startTime,
        endTime: k.endTime,
        roomId: phong[k.phong - 1]!.id,
        teacherId: gvId[k.gv],
        status: k.huy ? ("CANCELLED" as const) : ("SCHEDULED" as const),
        createdById: k.moi ? saleId[k.moi] : null,
      };
      await db.trialClassSession.upsert({
        where: { id: uid("case", k.key) },
        update: du,
        create: { id: uid("case", k.key), trialClassId: lop.id, ...du },
      });
    }

    const ghiDanh: { be: string; sessionId: string | null }[] = [
      ...lop.cases.flatMap((k) => k.be.map((be) => ({ be, sessionId: uid("case", k.key) }))),
      ...lop.chuaXep.map((be) => ({ be, sessionId: null })),
    ];
    for (const g of ghiDanh) {
      const b = beTheoKey.get(g.be)!;
      const du = {
        status: "ACTIVE" as const,
        scheduledSessionId: g.sessionId,
        addedById: saleId[b.gan],
      };
      await db.trialEnrollment.upsert({
        where: { id: uid("ghidanh", g.be) },
        update: du,
        create: {
          id: uid("ghidanh", g.be),
          trialClassId: lop.id,
          leadChildId: uid("con", g.be),
          ...du,
        },
      });
    }
  }

  // ── Báo cáo: đọc LẠI từ DB, không in lại kịch bản ─────────────────────────────────
  // In lại mảng hằng số ở trên là báo cáo điều mình ĐỊNH ghi, không phải điều đã ghi.
  for (const lop of LOP) {
    const c = await db.trialClassV2.findUnique({
      where: { id: lop.id },
      select: {
        name: true,
        startTime: true,
        endTime: true,
        sessions: {
          where: { id: { in: lop.cases.map((k) => uid("case", k.key)) } },
          orderBy: { startTime: "asc" },
          select: { id: true, startTime: true, endTime: true, createdById: true, status: true },
        },
        enrollments: {
          where: { status: "ACTIVE", id: { in: BE.map((b) => uid("ghidanh", b.key)) } },
          select: { scheduledSessionId: true, leadChild: { select: { fullName: true, lead: { select: { assignedToId: true } } } } },
        },
      },
    });
    if (!c) continue;
    const ten = (id: string | null) =>
      id === saleId.sale1 ? "Sale 1 (uat.sale1)" : id === saleId.sale3 ? "Sale 2 (uat.sale3)" : "KHÔNG RÕ (case cũ)";
    console.log(`\n  ${c.name} · khung ${c.startTime}–${c.endTime} — ${lop.nhan}`);
    for (const s of c.sessions) {
      const be = c.enrollments.filter((e) => e.scheduledSessionId === s.id);
      console.log(`    ${s.startTime}–${s.endTime}  mở bởi ${ten(s.createdById)}  · ${be.length} bé${s.status === "CANCELLED" ? "  [ĐÃ HUỶ]" : ""}`);
      for (const e of be) {
        console.log(`        - ${e.leadChild.fullName}  (lead của ${ten(e.leadChild.lead.assignedToId)})`);
      }
    }
    const cx = c.enrollments.filter((e) => e.scheduledSessionId === null);
    if (cx.length) {
      console.log(`    Chưa xếp case · ${cx.length} bé`);
      for (const e of cx) console.log(`        - ${e.leadChild.fullName}  (lead của ${ten(e.leadChild.lead.assignedToId)})`);
    }
  }
  console.log(`
  Đăng nhập (mật khẩu chung = env UAT_PASSWORD):`);
  console.log("    uat.sale1@satarobo.vn     — Sale 1");
  console.log("    uat.sale3@satarobo.vn     — Sale 2");
  console.log("    uat.giamdoc@satarobo.vn   — Quản lý cơ sở CS1");
  console.log("    uat.daotao@satarobo.vn    — Đào tạo");
  console.log("    uat.giaovien2@satarobo.vn — giáo viên thứ hai (mới)\n");
}

main()
  .catch((e) => {
    console.error("\n  ✖", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
