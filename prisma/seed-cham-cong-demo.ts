// prisma/seed-cham-cong-demo.ts — DỮ LIỆU NGHIỆM THU cho module chấm công v3.
//
//   pnpm exec tsx prisma/seed-cham-cong-demo.ts                  # 2 kỳ gần nhất
//   pnpm exec tsx prisma/seed-cham-cong-demo.ts --ky=2026-08     # chỉ 1 kỳ
//   pnpm exec tsx prisma/seed-cham-cong-demo.ts --nguoi=12       # nhiều người hơn mỗi khối
//
// ── Vì sao cần file này ──────────────────────────────────────────────────────────────
// `seed-cham-cong.ts` CỐ Ý chỉ seed DANH MỤC (21 mã ca · 8 loại nghỉ · điểm chấm công) — trên
// prod lưới ca đến từ import Sheet thật. Hệ quả trên `test`: Bảng công ngày / Lưới phân ca /
// Kỳ công hiện EmptyState ở mọi tháng, nên KHÔNG nghiệm thu được phần nặng nhất của module.
// (Dữ liệu chấm công của bộ UAT cũ nằm ở bảng `EmployeeCheckin` — hệ v2 — nên không chảy vào
// lưới v3.) File này lấp đúng chỗ đó, và CHỈ dành cho test/local.
//
// ── Đi qua ĐÚNG đường thật, không tự chế INSERT ──────────────────────────────────────
//   1. upsert `ShiftWeeklyPattern` (khung ca tuần)  → giống màn /cham-cong/khung-ca
//   2. `generateMonthAssignments()`                 → giống nút "Sinh lưới từ khung"
//   3. `staffTimeLog.createMany` (lượt quét quầy)   → giống người bấm QR, có ca biên
//   4. `recomputeRange()`                           → giống cron tính công
//   5. `getOrCreatePeriod()`                        → mở kỳ công cho từng khối
// Nhờ vậy dữ liệu ra TỰ NHẤT QUÁN: cờ, công ngày, tổng kỳ đều do chính engine sinh, không
// phải số tôi bịa. Sai ở đâu là sai thật, nghiệm thu mới có nghĩa.
//
// ── Điều đã cân nhắc ────────────────────────────────────────────────────────────────
// · Nhập `db` từ `@/lib/db` chứ KHÔNG `new PrismaClient()`: chỉ đường đó mới có ghi kép
//   `orgUnitId` (`lib/org/dual-write.ts` cắm ở `lib/db.ts`). Script tự dựng client sẽ để
//   `orgUnitId` null trên mọi dòng.
// · KHÔNG chờ hàng đợi `DomainEvent`: `markAttendanceDaysDirtyMany` chỉ xếp hàng, còn cron
//   trên test do `cron-pump-test.yml` bơm 5 phút/lần. Gọi thẳng `recomputeRange` để bấm xong
//   là có số.
// · Lượt quét chỉ sinh cho ngày ĐÃ QUA (≤ hôm qua) và mã ca `attendanceMode = REQUIRED`.
//   Sinh cho ngày tương lai là dựng ra thứ không đời nào có thật.
// · Ngẫu nhiên có HẠT theo `userId|ngày` ⇒ chạy lại ra đúng bộ cũ, ảnh chụp nghiệm thu
//   không đổi giữa hai lần seed.
import { db } from "@/lib/db";
import { assertLocalDb } from "./seed-lms/_lib";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { generateMonthAssignments } from "@/lib/cham-cong/generate-db";
import { recomputeAttendanceDay } from "@/lib/cham-cong/recompute";
import { getOrCreatePeriod } from "@/lib/cham-cong/period";
import { toMinutes } from "@/lib/cham-cong/catalog";
import { vnDateAt, vnDateOnly, vnParts, vnYmd } from "@/lib/time/vn";

const DEFAULT_EFFECTIVE_FROM = new Date(Date.UTC(2000, 0, 1));

// ── CỔNG AN TOÀN ─────────────────────────────────────────────────────────────────────
//
// 🔴 Chú thích KHÔNG PHẢI CỔNG (luật 12). Đầu file này đã ghi "CHỈ dành cho test/local" từ
// đầu, mà không có gì giữ: `.env` trên máy dev trỏ DB **DEV** — đúng DB mà `test.satarobo.vn`
// đang dùng — nên chạy nhầm là dựng 2 kỳ dữ liệu giả lên chỗ người khác đang nghiệm thu.
//
// Dùng lại `assertLocalDb` của bộ seed LMS, KHÔNG dựng khuôn thứ ba. Hai cổng, giống
// `tests/_helpers/db-gate.ts`:
//   · ĐỊA CHỈ — URL phải trỏ local/test;
//   · CHỦ ĐÍCH — `SEED_ALLOW_REMOTE=1` cho lượt ghi DB xa.
//
// ⚠️ Workflow `seed-test-data.yml` chạy script này lên `TEST_DIRECT_URL` (Supabase, KHÔNG
// phải localhost) nên nó BẮT BUỘC phải đặt cờ ấy — và workflow có cổng riêng của nó:
// từ chối khi `TEST_DIRECT_URL` trùng `PROD_DIRECT_URL`.
assertLocalDb("seed-cham-cong-demo");

// ── Tham số dòng lệnh ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(ten: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${ten}=`));
  return hit ? hit.slice(ten.length + 3) : null;
}
const soNguoiMoiKhoi = Math.max(1, Number(arg("nguoi") ?? 8));

/** "YYYY-MM" của tháng cách hiện tại `lui` tháng, theo lịch VN. */
function kyLui(lui: number): string {
  const p = vnParts(new Date());
  const d = new Date(Date.UTC(p.year, p.month - lui, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const cacKy = arg("ky") ? [arg("ky")!] : [kyLui(1), kyLui(0)];
for (const k of cacKy) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(k)) throw new Error(`--ky không hợp lệ: "${k}" (cần YYYY-MM)`);
}

// ── Ngẫu nhiên CÓ HẠT ────────────────────────────────────────────────────────────────
function hat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** [0,1) tất định theo khoá. */
function r01(khoa: string): number {
  let a = hat(khoa);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
const soNguyen = (khoa: string, tu: number, den: number) => tu + Math.floor(r01(khoa) * (den - tu + 1));

// ── Khung ca tuần theo vai trò ───────────────────────────────────────────────────────
// weekday: 0 = Chủ nhật … 6 = Thứ Bảy (khớp `ShiftWeeklyPattern.weekday`).
//
// Hội sở làm giờ hành chính T2–T6. Cơ sở đông khách cuối tuần nên xoay hai kiểu nghỉ tuần —
// KHÔNG cứng Thứ Hai: nghỉ tuần cứng trong mã từng là bug đã sửa ở đợt thiết kế lại.
const KHUNG_HO = [1, 2, 3, 4, 5].map((wd) => ({ weekday: wd, code: "HC" }));
const MA_CO_SO = ["CS", "CG", "S", "C", "SC", "T"] as const;
function khungCoSo(i: number): { weekday: number; code: string }[] {
  const nghi = i % 2 === 0 ? 1 : 0; // xen kẽ: nghỉ Thứ Hai / nghỉ Chủ nhật
  const code = MA_CO_SO[i % MA_CO_SO.length]!;
  return [0, 1, 2, 3, 4, 5, 6].filter((wd) => wd !== nghi).map((wd) => ({ weekday: wd, code }));
}

// ── Khoảng HIỆN DIỆN của một mã ca ───────────────────────────────────────────────────
// Người thật quét MỖI LẦN đến và MỖI LẦN rời quầy, nên số cặp quét bằng số khoảng họ có mặt
// liên tục — không phải luôn luôn một cặp.
//
//   CS  [WORK 14:00–16:30][PAID_BREAK 16:30–17:00][WORK 17:00–21:00]  → 1 khoảng 14:00–21:00
//                                                (nghỉ giữa giờ TÍNH VÀO giờ làm, không rời quầy)
//   CG  [WORK 09:00–11:30]          [WORK 14:00–17:45]                → 2 khoảng (nghỉ trưa, về nhà)
//   HC  [WORK 08:00–11:30]          [WORK 13:30–17:30]                → 2 khoảng
//
// Bản đầu sinh đúng MỘT cặp trải từ mốc sớm nhất tới muộn nhất, nên ca gãy và cả giờ hành
// chính đều bị engine gắn cờ THIEU_BUOI_CHIEU/THIEU_GIO oan — dữ liệu nghiệm thu mà cờ sai
// thì người nghiệm thu đi soi nhầm chỗ. Nối hai đoạn khi chúng LIỀN NHAU (đoạn nghỉ có lương
// nằm giữa cũng là một đoạn, nên phép so `start <= hết` tự bắc cầu).
type Doan = { start?: string; end?: string; kind?: string };
function khoiHienDien(segments: unknown): { vao: string; ra: string }[] {
  if (!Array.isArray(segments)) return [];
  const ds = (segments as Doan[])
    .filter((s) => typeof s.start === "string" && typeof s.end === "string")
    .sort((a, b) => toMinutes(a.start!) - toMinutes(b.start!));
  const khoi: { vao: string; ra: string }[] = [];
  for (const s of ds) {
    const cuoi = khoi[khoi.length - 1];
    if (cuoi && toMinutes(s.start!) <= toMinutes(cuoi.ra)) {
      if (toMinutes(s.end!) > toMinutes(cuoi.ra)) cuoi.ra = s.end!;
    } else {
      khoi.push({ vao: s.start!, ra: s.end! });
    }
  }
  return khoi;
}
/** "HH:mm" + `lech` phút → thời điểm tuyệt đối của ngày công `ngay` (giờ VN). */
function mocGio(ngay: Date, hhmm: string, lech: number): Date {
  const p = vnParts(ngay);
  const phut = toMinutes(hhmm) + lech;
  return vnDateAt(p.year, p.month, p.day, 0, phut);
}

async function main() {
  const batDau = Date.now();
  console.log(`[demo] kỳ: ${cacKy.join(", ")} · tối đa ${soNguoiMoiKhoi} người/khối`);

  const centerMap = await loadCenterMap();
  const coSoIds = Object.values(centerMap.byCode).map((c) => c.centerId);
  if (coSoIds.length === 0) throw new Error("Chưa có Center nào đang bật — chạy db:seed:orgunit trước.");

  // Người thực hiện: cần một tài khoản có thật để ghi vào cột `createdById`/audit của lưới.
  const actor =
    (await db.user.findFirst({ where: { email: "uat.admin@satarobo.vn" }, select: { id: true } })) ??
    (await db.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } }));
  if (!actor) throw new Error("Không tìm thấy tài khoản quản trị nào — chạy db:seed:uat trước.");

  // ── 1. Chọn nhân sự theo KHỐI ──────────────────────────────────────────────────────
  // `ShiftWeeklyPattern.centerId` là KHỐI: centerId thật với cơ sở, chuỗi "hoi-so" với Hội sở.
  const nhanSu = await db.employee.findMany({
    where: { isActive: true, status: "ACTIVE", userAccount: { isNot: null } },
    select: { fullName: true, centerId: true, userAccount: { select: { id: true } } },
    orderBy: { employeeCode: "asc" },
  });

  const theoKhoi = new Map<string, { userId: string; ten: string }[]>();
  for (const e of nhanSu) {
    const userId = e.userAccount?.id;
    if (!userId) continue;
    const khoi = e.centerId && coSoIds.includes(e.centerId) ? e.centerId : HO_CENTER_ID;
    const ds = theoKhoi.get(khoi) ?? [];
    if (ds.length >= soNguoiMoiKhoi) continue;
    ds.push({ userId, ten: e.fullName });
    theoKhoi.set(khoi, ds);
  }
  if (theoKhoi.size === 0) throw new Error("Không có nhân sự nào đang làm việc — chạy db:seed:uat trước.");

  // ── 2. Khung ca tuần ───────────────────────────────────────────────────────────────
  const maCa = await db.shiftTemplate.findMany({
    where: { isActive: true },
    select: { id: true, code: true, segments: true, attendanceMode: true },
  });
  const maTheoCode = new Map(maCa.map((t) => [t.code, t]));
  const thieu = [...new Set([...MA_CO_SO, "HC"])].filter((c) => !maTheoCode.has(c));
  if (thieu.length > 0) throw new Error(`Thiếu mã ca ${thieu.join(", ")} — chạy db:seed:cham-cong trước.`);

  let soKhung = 0;
  const moiUserId: string[] = [];
  for (const [khoi, ds] of theoKhoi) {
    for (const [i, ng] of ds.entries()) {
      moiUserId.push(ng.userId);
      const khung = khoi === HO_CENTER_ID ? KHUNG_HO : khungCoSo(i);
      for (const o of khung) {
        const tpl = maTheoCode.get(o.code)!;
        await db.shiftWeeklyPattern.upsert({
          where: {
            userId_centerId_weekday_effectiveFrom: {
              userId: ng.userId,
              centerId: khoi,
              weekday: o.weekday,
              effectiveFrom: DEFAULT_EFFECTIVE_FROM,
            },
          },
          update: { templateId: tpl.id, templateCode: tpl.code },
          create: {
            userId: ng.userId,
            centerId: khoi,
            weekday: o.weekday,
            templateId: tpl.id,
            templateCode: tpl.code,
            effectiveFrom: DEFAULT_EFFECTIVE_FROM,
          },
        });
        soKhung += 1;
      }
    }
  }
  console.log(`[demo] khung ca tuần: ${soKhung} ô cho ${moiUserId.length} người / ${theoKhoi.size} khối`);

  // ── 3. Sinh lưới tháng ─────────────────────────────────────────────────────────────
  for (const ky of cacKy) {
    const r = await generateMonthAssignments({
      db,
      periodKey: ky,
      centerMap,
      canWriteCenter: () => true,
      actorUserId: actor.id,
      onlyUserIds: moiUserId,
      // Seed CỐ Ý dựng dữ liệu cho các kỳ ĐÃ QUA — đó là mục đích của nó. Nên mốc "hôm nay"
      // ở đây là buổi đầu thời gian: mọi ngày đều là tương lai, không ngày nào bị chừa.
      //
      // ⚠️ ĐỪNG đổi thành `vnDateOnly(new Date())`: làm thế là seed không sinh nổi lưới cho
      // kỳ trước, và màn nghiệm thu lại về EmptyState — đúng cái file này sinh ra để chữa.
      // Cổng "chỉ áp từ ngày mai" là luật cho NGƯỜI BẤM NÚT, không phải cho máy dựng dữ liệu.
      homNay: new Date(0),
      ghiThat: true,
    });
    console.log(
      `[demo] lưới ${ky}: +${r.created} tạo · ${r.replaced} thay · ${r.kept} giữ · ${r.skippedProtected} chừa (ô do đơn/sửa tay)`,
    );
  }

  // ── 4. Lượt quét ───────────────────────────────────────────────────────────────────
  // Chỉ ngày ĐÃ QUA. `homNay` là ngày VN hiện tại; mốc cuối là hôm qua.
  const homNay = vnDateOnly(new Date());
  const tu = (() => {
    const [y, m] = cacKy[0]!.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, 1));
  })();
  const denKy = (() => {
    const [y, m] = cacKy[cacKy.length - 1]!.split("-").map(Number);
    return new Date(Date.UTC(y!, m!, 0));
  })();
  const denQuet = new Date(Math.min(denKy.getTime(), homNay.getTime() - 86_400_000));

  const oLuoi = await db.shiftAssignment.findMany({
    where: {
      userId: { in: moiUserId },
      status: "ACTIVE",
      workDate: { gte: tu, lte: denQuet },
    },
    select: { userId: true, centerId: true, orgUnitId: true, workDate: true, templateCode: true },
  });

  // Idempotent: bỏ qua (người × ngày) đã có lượt — chạy lại KHÔNG nhân đôi lượt quét.
  const daCo = new Set(
    (
      await db.staffTimeLog.findMany({
        where: { userId: { in: moiUserId }, workDate: { gte: tu, lte: denQuet } },
        select: { userId: true, workDate: true },
      })
    ).map((l) => `${l.userId}|${vnYmd(l.workDate)}`),
  );

  type LuotMoi = {
    userId: string;
    centerId: string;
    orgUnitId: string | null;
    workDate: Date;
    direction: "CHECK_IN" | "CHECK_OUT";
    loggedAt: Date;
    source: "KIOSK";
    result: "ACCEPTED";
    reviewStatus: "CONFIRMED";
  };
  const luot: LuotMoi[] = [];
  for (const o of oLuoi) {
    const tpl = maTheoCode.get(o.templateCode);
    if (!tpl || tpl.attendanceMode !== "REQUIRED") continue; // X/P/LD/NG không phải quét
    const khoi = khoiHienDien(tpl.segments);
    if (khoi.length === 0) continue;
    const ymd = vnYmd(o.workDate);
    if (daCo.has(`${o.userId}|${ymd}`)) continue;

    const k = `${o.userId}|${ymd}`;
    const chung = { userId: o.userId, centerId: o.centerId, orgUnitId: o.orgUnitId, workDate: o.workDate, source: "KIOSK" as const, result: "ACCEPTED" as const, reviewStatus: "CONFIRMED" as const };

    for (const [i, kh] of khoi.entries()) {
      // Vào: phần lớn sớm 1–12 phút; ~12% đi muộn 6–25 phút (để màn có cờ ĐI MUỘN thật).
      // Chỉ khoảng ĐẦU mới tính đi muộn — về trễ sau nghỉ trưa là chuyện khác, đừng trộn.
      const muon = i === 0 && r01(`muon|${k}`) < 0.12;
      const lechVao = muon ? soNguyen(`pv|${k}`, 6, 25) : -soNguyen(`sv|${k}|${i}`, 1, 12);
      luot.push({ ...chung, direction: "CHECK_IN", loggedAt: mocGio(o.workDate, kh.vao, lechVao) });

      // Ra: ~7% QUÊN quét ra ở khoảng CUỐI (cờ THIẾU LƯỢT); ~6% về sớm.
      const cuoi = i === khoi.length - 1;
      if (cuoi && r01(`quen|${k}`) < 0.07) break;
      const som = cuoi && r01(`som|${k}`) < 0.06;
      const lechRa = som ? -soNguyen(`ps|${k}`, 10, 30) : soNguyen(`sr|${k}|${i}`, 0, 15);
      luot.push({ ...chung, direction: "CHECK_OUT", loggedAt: mocGio(o.workDate, kh.ra, lechRa) });
    }
  }

  for (let i = 0; i < luot.length; i += 500) {
    await db.staffTimeLog.createMany({ data: luot.slice(i, i + 500) });
  }
  console.log(`[demo] lượt quét: +${luot.length} (bỏ qua ${daCo.size} ngày đã có lượt)`);

  // ── 5. Tính công + mở kỳ ───────────────────────────────────────────────────────────
  // KHÔNG dùng `recomputeRange(moiUserId, tu, den)`: nó duyệt đủ tích (người × ngày), tức
  // 30 người × 61 ngày ≈ 1.800 lượt, mà mỗi lượt là vài vòng đi–về mạng. Trên Postgres local
  // là 5 giây; trên runner GitHub nói chuyện với Supabase thì hàng chục phút, và job chỉ có
  // `timeout-minutes: 30`. Phần lớn số đó là công cốc: ngày nghỉ tuần không có ca, ngày tương
  // lai chưa có gì để tính.
  //
  // Chỉ tính đúng những cặp CÓ THẬT: có ô lưới, hoặc có lượt quét. Ngày tương lai loại hẳn —
  // tính chúng chỉ đẻ ra cờ "chưa quét" cho ngày chưa tới, tức dữ liệu nghiệm thu sai.
  const den = new Date(Math.min(denKy.getTime(), homNay.getTime()));
  const oTinh = await db.shiftAssignment.findMany({
    where: { userId: { in: moiUserId }, status: "ACTIVE", workDate: { gte: tu, lte: den } },
    select: { userId: true, workDate: true },
  });
  const cap = new Map<string, { userId: string; workDate: Date }>();
  for (const o of [...oTinh, ...luot]) cap.set(`${o.userId}|${vnYmd(o.workDate)}`, { userId: o.userId, workDate: o.workDate });

  // CHẠY SONG SONG THEO LÔ. Mỗi `recomputeAttendanceDay` là ~6-8 truy vấn nối tiếp, và trên
  // runner GitHub nói chuyện với Supabase thì gần như TOÀN BỘ thời gian là chờ mạng, không phải
  // tính toán. Đo lượt 06/09: 306 ngày-người chạy tuần tự hết 46 phút rồi vẫn bị cắt (~9 giây
  // mỗi phép). Từng phép độc lập nhau — khác (người, ngày) là khác dòng, không tranh chấp — nên
  // xếp 8 phép cùng lúc là cắt thời gian chờ xuống gần 8 lần.
  //
  // 8 chứ không nhiều hơn: pooler của Supabase có trần kết nối, và mục tiêu ở đây là seed chứ
  // không phải vắt kiệt DB mà người khác đang dùng.
  const LO = 8;
  const dsCap = [...cap.values()];
  let daTinh = 0;
  let boQua = 0;
  const t0 = Date.now();
  for (let i = 0; i < dsCap.length; i += LO) {
    const ketQua = await Promise.all(
      dsCap.slice(i, i + LO).map((c) => recomputeAttendanceDay(c.userId, c.workDate)),
    );
    for (const r of ketQua) {
      if (r.skipped === "LOCKED") boQua += 1;
      else daTinh += 1;
    }
    // In tiến độ: lượt trước chạy 46 phút mà log im lặng hoàn toàn, nên không ai biết nó đang
    // ở đâu hay có treo không cho tới lúc job bị cắt.
    const xong = Math.min(i + LO, dsCap.length);
    if (xong % 80 === 0 || xong === dsCap.length) {
      const giay = Math.round((Date.now() - t0) / 1000);
      console.log(`[demo]   … ${xong}/${dsCap.length} ngày-người · ${giay}s`);
    }
  }
  console.log(`[demo] tính công: ${daTinh} ngày-người${boQua ? ` · ${boQua} bỏ qua vì kỳ đã chốt` : ""}`);

  for (const ky of cacKy) {
    for (const khoi of [...theoKhoi.keys()]) {
      const p = await getOrCreatePeriod(khoi, ky as `${number}-${number}`);
      console.log(`[demo] kỳ ${ky} · khối ${khoi}: ${p.status} · công chuẩn ${p.standardUnits}`);
    }
  }

  console.log(`[demo] xong sau ${Math.round((Date.now() - batDau) / 1000)}s`);
}

main()
  .catch((e) => {
    console.error("[seed-cham-cong-demo] lỗi:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
