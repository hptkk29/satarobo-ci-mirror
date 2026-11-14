// lib/lead/rotation.ts — Đợt D: chia lead LUÂN PHIÊN ĐỀU LƯỢT.
//
// Chủ dự án chốt Q7 (21/08/2026): công bằng đo bằng SỐ LƯỢT, bộ đếm không bao
// giờ reset, và KHÔNG nhìn khối lượng công việc. Nguyên văn + lý do đánh đổi:
// xem đầu `rotation.test.ts`.
//
// ⚠️ Đây là ĐẢO hành vi đang chạy prod. `pickRoundRobin` (assign-strategy.ts) chọn
// người có ÍT LEAD MỞ NHẤT — nghe như "cân tải" nhưng thực chất thưởng người đóng
// lead nhanh, kể cả đóng bằng cách bỏ. Hàm cũ được GIỮ NGUYÊN, không xoá: chế độ
// CLOSE_RATE vẫn dùng nó, và giữ lại thì so sánh hai cách chia được khi cần.
//
// ── Vì sao là bảng riêng chứ không đếm từ bảng Lead ───────────────────────────
// Đếm lead theo người thì không tách được lead "tới lượt" khỏi lead gán tay /
// sale tự nhập / nhập Excel. Chẩn đoán 21/08 trên prod cho thấy 69% lead KHÔNG đi
// qua vòng chia — lấy tổng lead làm bộ đếm là để 69% nhiễu quyết định 31% còn lại.
//
// Bảng dùng `orgUnitId` chứ không `centerId` (luật cứng Nền Hệ thống #3: bảng mới
// có dữ liệu theo đơn vị thì dùng orgUnitId).
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/** Một ứng viên trong vòng luân phiên. KHÔNG có trường nào về tải — cố ý. */
export type RotationCandidate = {
  id: string;
  /** Tổng số lượt ĐÃ NHẬN từ trước tới nay. Không reset theo ngày/tháng/kỳ. */
  turns: number;
  /** Lần gần nhất tới lượt. `null` = chưa bao giờ. */
  lastTurnAt: Date | null;
};

/**
 * Ai tới lượt tiếp theo. THUẦN — không đọc DB, không đọc đồng hồ.
 *
 * Thứ tự: ít lượt nhất → tới lượt lâu nhất (chưa bao giờ đứng đầu) → id.
 * Nhánh cuối theo `id` để kết quả TÁI LẬP ĐƯỢC: chia lead mà không giải thích
 * được thì mọi tranh cãi thiên vị đều thành lời-tôi-chống-lời-anh.
 */
export function pickFairTurn(candidates: RotationCandidate[]): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.turns !== b.turns) return a.turns - b.turns;
    const at = a.lastTurnAt?.getTime() ?? -Infinity;
    const bt = b.lastTurnAt?.getTime() ?? -Infinity;
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  })[0].id;
}

/**
 * Người mới vào vòng bắt đầu ở số lượt nào.
 *
 * NGANG người ít lượt nhất, không phải 0. Để 0 thì người mới nhận liên tiếp cho
 * tới khi đuổi kịp — với vòng đã chạy vài trăm lượt là hàng trăm lead dồn vào
 * người chưa quen việc, và người cũ đứng chơi. "Luân phiên" là nhập vòng, không
 * phải được trả nợ quá khứ.
 */
export function seedTurnsForNewcomer(existing: RotationCandidate[]): number {
  if (existing.length === 0) return 0;
  return Math.min(...existing.map((e) => e.turns));
}

/**
 * Lên kế hoạch cho MỘT LÔ: ai nhận lead thứ 1, thứ 2, … THUẦN.
 *
 * Dùng khi chia lại cả rổ lead một lần (sale nghỉ việc). Không gọi
 * `pickFairTurn` n lần từ tầng DB: n lần khoá + n lần ghi cho một việc vốn là
 * một quyết định, và nếu hỏng giữa chừng thì sổ lượt lệch dở dang.
 *
 * Mốc `lastTurnAt` trong lô lấy theo THỨ TỰ trong lô (không cần đồng hồ thật) —
 * đủ để phá hoà đúng chiều: ai vừa nhận trong lô này thì lùi về cuối hàng.
 */
export function planFairTurns(candidates: RotationCandidate[], count: number): string[] {
  if (candidates.length === 0 || count <= 0) return [];
  const work = candidates.map((c) => ({ ...c }));
  const ke: string[] = [];
  // Mốc giả tăng dần, bắt đầu SAU mọi mốc thật, để lượt vừa phát trong lô này
  // luôn xếp sau lượt cũ khi so bằng nhau.
  let nhip = Math.max(0, ...work.map((w) => w.lastTurnAt?.getTime() ?? 0)) + 1;
  for (let i = 0; i < count; i++) {
    const picked = pickFairTurn(work);
    if (!picked) break;
    ke.push(picked);
    const w = work.find((x) => x.id === picked)!;
    w.turns += 1;
    w.lastTurnAt = new Date(nhip++);
  }
  return ke;
}

/** Phạm vi cơ sở của màn sổ lượt: không lọc / đúng một cơ sở / không cơ sở nào. */
export type RotationBoardScope =
  | { kind: "all" }
  | { kind: "one-center"; centerId: string }
  | { kind: "none" };

/**
 * Người đang xem sổ lượt được thấy sổ của (những) cơ sở nào. THUẦN.
 *
 * S-5: màn kiểm chứng mở cho tổ Sale, nhưng "mở" không có nghĩa là mở toàn hệ.
 * Sale xem sổ CƠ SỞ MÌNH — vừa đủ để đối chiếu với đồng nghiệp cùng vòng chia,
 * không hơn. `Center` ∈ SCOPE_EXEMPT nên `scopedDb` pass-through: cách ly cơ sở ở
 * màn này phải tự tính, và tính ở MỘT hàm thuần thì test được, tản trong JSX thì không.
 *
 * @param superAdmin quản trị tối cao — nhìn toàn hệ kể cả khi hồ sơ có gắn cơ sở.
 * @param xemToanBo  giữ `leads:view-all` (quản lý cơ sở / marketing).
 * @param centerId   cơ sở gắn với hồ sơ người dùng; `null` = người Hội sở.
 */
export function rotationBoardScope({
  superAdmin,
  xemToanBo,
  centerId,
}: {
  superAdmin: boolean;
  xemToanBo: boolean;
  centerId: string | null | undefined;
}): RotationBoardScope {
  if (superAdmin) return { kind: "all" };
  // Gắn cơ sở nào thì chỉ sổ cơ sở đó — áp cho MỌI vai, kể cả quản lý cơ sở (giữ
  // nguyên hành vi cũ) lẫn tư vấn viên (mới mở).
  if (centerId) return { kind: "one-center", centerId };
  // Không gắn cơ sở: người Hội sở điều phối toàn hệ thì xem toàn hệ. Còn người chỉ
  // được xem "cơ sở mình" mà lại không có cơ sở nào ⇒ ĐÓNG, không rơi vào nhánh
  // "không lọc" — đó đúng là cách một màn chỉ-đọc lặng lẽ thành lỗ xem chéo cơ sở.
  return xemToanBo ? { kind: "all" } : { kind: "none" };
}

/** Khoá theo đơn vị: hai lead cùng lúc TRONG một cơ sở mới phải xếp hàng. */
function lockKey(orgUnitId: string): string {
  return `lead_rotation:${orgUnitId}`;
}

/**
 * Lấy MỘT lượt: chọn người tới lượt rồi ghi nhận lượt đó, trong CÙNG một
 * transaction dưới khoá advisory.
 *
 * Vì sao phải khoá: `getSaleStats` của luồng cũ đọc NGOÀI transaction, nên hai
 * lead vào cùng lúc đọc chung một trạng thái và chọn trúng một người (kịch bản
 * SS-LR-06 của kế hoạch kiểm thử). Với luật "tuyệt đối không được sai" thì một
 * lượt trôi mất là một lỗi thật, không phải chuyện hiếm bỏ qua được.
 *
 * ⚠️ PHẢI `$executeRaw`, KHÔNG `$queryRaw`: `pg_advisory_xact_lock()` trả kiểu
 * `void`, `$queryRaw` cố giải mã cột đó và ném "Failed to deserialize column of
 * type 'void'". Đã giết mọi lần refresh token Zalo trên prod 31/07 — cùng bài
 * học, cùng cách viết (xem `lib/zalo/token.ts:139`).
 *
 * @returns id người tới lượt, hoặc `null` khi không có ứng viên nào.
 */
export async function takeRotationTurn(
  orgUnitId: string,
  candidateIds: string[],
  now: Date = new Date(),
): Promise<string | null> {
  const [picked] = await takeRotationTurns(orgUnitId, candidateIds, 1, now);
  return picked ?? null;
}

/**
 * Lấy NHIỀU lượt một lần — cùng khoá, cùng transaction (chia lại cả rổ lead khi
 * sale nghỉ việc). Trả về danh sách người nhận theo đúng thứ tự lead truyền vào.
 */
export async function takeRotationTurns(
  orgUnitId: string,
  candidateIds: string[],
  count: number,
  now: Date = new Date(),
): Promise<string[]> {
  if (candidateIds.length === 0 || count <= 0) return [];
  return db.$transaction((tx) => takeRotationTurnsTx(tx, orgUnitId, candidateIds, count, now), {
    maxWait: 5_000,
    timeout: 15_000,
  });
}

/**
 * BẢN CHẠY TRONG TRANSACTION SẴN CÓ — dùng khi việc chia lượt chỉ là một bước của
 * một giao dịch lớn hơn (tạo lead + ghi sổ + ghi nhật ký, xem `assign-lead.ts`).
 *
 * Vẫn tự giành khoá: `pg_advisory_xact_lock` ĐỆM ĐƯỢC trong cùng một transaction
 * (giành hai lần cùng khoá không tự chẹn mình), và khoá nhả lúc COMMIT. Nhờ vậy
 * caller giành trước hay không giành đều đúng.
 *
 * ⚠️ KHOÁ PHẢI CÙNG KHOÁ với `takeRotationTurns` (`lead_rotation:<orgUnitId>`).
 * Đặt tên khoá khác là hai đường ghi cùng một bộ đếm mà không loại trừ nhau —
 * đúng thứ mà toàn bộ cơ chế này sinh ra để tránh.
 */
export async function takeRotationTurnsTx(
  tx: Prisma.TransactionClient,
  orgUnitId: string,
  candidateIds: string[],
  count: number,
  now: Date = new Date(),
): Promise<string[]> {
  if (candidateIds.length === 0 || count <= 0) return [];
  {
    {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(orgUnitId)}))`;

      // ĐỌC LẠI SAU KHI GIÀNH KHOÁ — đọc trước khoá thì khoá vô nghĩa.
      const rows = await tx.leadRotationTurn.findMany({
        where: { orgUnitId },
        select: { userId: true, turns: true, lastTurnAt: true },
      });
      const byUser = new Map(rows.map((r) => [r.userId, r]));

      // ── GHI DANH TRƯỚC, CHỌN SAU ─────────────────────────────────────────
      // Mọi ứng viên chưa có dòng thì TẠO NGAY, ở khởi điểm của thời điểm này,
      // rồi mới chọn trên danh sách đã đầy đủ.
      //
      // ⚠️ Bản đầu (22/08) tính khởi điểm ngay trong lúc ghi và bị THỔI PHỒNG SỔ:
      // khi vòng đang lấp đầy, "min của những dòng đã có" là 1 (người vừa nhận),
      // nên người thứ hai vào vòng bị ghi khởi điểm 1 rồi thành 2 khi mới nhận 1
      // lead. 6 lead chia ra thành 8 lượt. Bắt được bằng e2e chạm DB thật — test
      // thuần không thấy vì nó nhận sẵn danh sách ứng viên đầy đủ, tức đã giả
      // định sẵn đúng cái mà tầng này phải tự dựng.
      //
      // Người rời vòng vẫn giữ dòng — chủ đích: quay lại thì vào đúng chỗ cũ,
      // không làm lại từ đầu để nhận dồn.
      const daCo = rows
        .filter((r) => candidateIds.includes(r.userId))
        .map((r) => ({ id: r.userId, turns: r.turns, lastTurnAt: r.lastTurnAt }));
      const khoiDiem = seedTurnsForNewcomer(daCo);
      for (const userId of candidateIds) {
        if (byUser.has(userId)) continue;
        const moi = await tx.leadRotationTurn.create({
          data: { orgUnitId, userId, turns: khoiDiem, seedTurns: khoiDiem, lastTurnAt: null },
          select: { userId: true, turns: true, lastTurnAt: true },
        });
        byUser.set(userId, moi);
      }

      const candidates: RotationCandidate[] = candidateIds.map((id) => {
        const r = byUser.get(id)!;
        return { id, turns: r.turns, lastTurnAt: r.lastTurnAt };
      });

      const ke = planFairTurns(candidates, count);
      if (ke.length === 0) return [];

      // Gộp theo người rồi ghi MỘT lần mỗi người — lô 200 lead không nên thành
      // 200 lượt ghi trong một transaction. Mọi dòng đã tồn tại sau bước ghi
      // danh ⇒ chỉ còn `increment`, không còn nhánh `create` để tính sai.
      const them = new Map<string, number>();
      for (const id of ke) them.set(id, (them.get(id) ?? 0) + 1);
      for (const [userId, n] of them) {
        await tx.leadRotationTurn.update({
          where: { orgUnitId_userId: { orgUnitId, userId } },
          data: { turns: { increment: n }, lastTurnAt: now },
        });
      }
      return ke;
    }
  }
}

/**
 * CỘNG MỘT LƯỢT cho một người ĐÃ ĐƯỢC CHỌN SẴN — dùng khi quản lý gán tay.
 *
 * Khác `takeRotationTurnsTx` ở chỗ: hàm kia CHỌN người rồi tiêu lượt, hàm này chỉ
 * tiêu lượt cho người mà nơi gọi đã chỉ đích danh.
 *
 * ─── Vì sao gán tay cũng phải tiêu lượt (chủ dự án chốt 03/09/2026) ──────────
 * Trước đợt này `manualAssignLead` đổi chủ lead mà KHÔNG đụng sổ lượt. Hệ quả:
 * người vừa được giao tay 5 lead vẫn đứng nguyên vị trí trong vòng, nên lượt chia
 * tự động kế tiếp lại rơi vào chính họ — càng giao tay nhiều càng nhận thêm. Sổ
 * lượt sinh ra để nói "ai đã nhận bao nhiêu", mà một trong hai đường giao lead
 * không ghi vào đó thì con số ấy sai theo đúng hướng gây tranh cãi nhất.
 *
 * ⚠️ CÙNG KHOÁ với `takeRotationTurnsTx` (`lead_rotation:<orgUnitId>`). Khoá khác
 * là hai đường ghi cùng một bộ đếm mà không loại trừ nhau.
 *
 * Người chưa có dòng thì GHI DANH TRƯỚC ở khởi điểm hiện tại của vòng (y hệt
 * đường tự động) rồi mới cộng — nếu không, người mới được giao tay sẽ khởi điểm 0
 * và hút sạch mọi lượt tự động sau đó.
 *
 * @returns số lượt SAU khi cộng, hoặc `null` nếu không ghi được.
 */
export async function congMotLuot(
  tx: Prisma.TransactionClient,
  orgUnitId: string,
  userId: string,
  now: Date = new Date(),
): Promise<number | null> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(orgUnitId)}))`;

  const rows = await tx.leadRotationTurn.findMany({
    where: { orgUnitId },
    select: { userId: true, turns: true, lastTurnAt: true },
  });
  const daCo = rows.find((r) => r.userId === userId);

  if (!daCo) {
    const khoiDiem = seedTurnsForNewcomer(
      rows.map((r) => ({ id: r.userId, turns: r.turns, lastTurnAt: r.lastTurnAt })),
    );
    const moi = await tx.leadRotationTurn.create({
      data: {
        orgUnitId,
        userId,
        turns: khoiDiem + 1,
        seedTurns: khoiDiem,
        lastTurnAt: now,
      },
      select: { turns: true },
    });
    return moi.turns;
  }

  const sau = await tx.leadRotationTurn.update({
    where: { orgUnitId_userId: { orgUnitId, userId } },
    data: { turns: { increment: 1 }, lastTurnAt: now },
    select: { turns: true },
  });
  return sau.turns;
}

/**
 * Bảng theo dõi công khai.
 *
 * Trả CẢ `turns` (vị trí trong vòng) lẫn `seedTurns` (khởi điểm lúc vào vòng),
 * để màn hình nói được con số THẬT: `turns - seedTurns` = số lead người đó thật
 * sự đã nhận qua vòng chia. Với người có mặt từ đầu, khởi điểm là 0 nên hai số
 * trùng nhau; chỉ người vào sau mới lệch — và nếu không tách ra thì bảng bằng
 * chứng lại nói sai đúng về người dễ bị soi nhất.
 */
export async function getRotationBoard(
  orgUnitId: string,
): Promise<{ userId: string; turns: number; seedTurns: number; lastTurnAt: Date | null }[]> {
  return db.leadRotationTurn.findMany({
    where: { orgUnitId },
    select: { userId: true, turns: true, seedTurns: true, lastTurnAt: true },
    orderBy: [{ turns: "desc" }, { userId: "asc" }],
  });
}
