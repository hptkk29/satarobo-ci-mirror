// lib/cham-cong/cong-day-db.ts — đọc buổi dạy của một kỳ từ DB rồi quy về `BuoiDay[]` để
// `cong-day.ts` (thuần) tính công. Không "use server".
//
// ── Vì sao đọc theo NGƯỜI chứ không theo cơ sở của lớp ──────────────────────────────────
// `buildPeriodSummary` đếm buổi bằng `class: { centerId }`, tức theo cơ sở CỦA LỚP. Giáo viên
// neo CS1 đi dạy một lớp của CS2 thì: kỳ CS2 không có hàng cho họ (hàng dựng từ lưới ca của
// chính cơ sở đó), còn kỳ CS1 không đếm buổi ở CS2 ⇒ buổi ĐÓ BIẾN MẤT khỏi mọi bảng, không
// phải ghi nhầm chỗ. Ở đây hỏi theo `userId` nên buổi luôn về đúng người, dù dạy ở đâu.
//
// ── Vì sao trải nghiệm là model khác ────────────────────────────────────────────────────
// `TrialClassSession` có `date @db.Date` và giờ là hai CHUỖI "HH:mm", không có `centerId` trên
// buổi. Nên hai nguồn phải quy về một dạng chung trước khi tính, thay vì viết hai nhánh tính.
import { db } from "@/lib/db";
import type { BuoiDay } from "./cong-day";
import { phutGiuaHaiGio, phutGiuaHaiMoc } from "./cong-day";
import { vnYmd } from "@/lib/time/vn";

/**
 * Buổi dạy của những người này trong khoảng ngày.
 *
 * `to` là ngày cuối CÓ TÍNH (inclusive) — chỗ gọi truyền ngày cuối kỳ.
 */
export async function loadBuoiDay(userIds: string[], from: Date, to: Date): Promise<BuoiDay[]> {
  if (userIds.length === 0) return [];
  const denHet = new Date(to.getTime() + 86_400_000); // `ClassSession.date` có cả giờ

  // Phân loại mặc định: buổi chưa gán `sessionCategoryId` được tính NHƯ dòng này. Đọc ở đây thay
  // vì để `cong-day.ts` tự đoán — luật thuần không được biết tới DB, và "buổi chưa phân loại rơi
  // vào dòng nào" là quyết định của người vận hành chứ không phải mặc định trong mã.
  const [macDinh, buoiLop, buoiTrial, buoiBu] = await Promise.all([
    db.sessionCategory.findFirst({
      where: { isDefault: true, isActive: true },
      select: { code: true },
    }),
    // Chỉ buổi ĐÃ HOÀN TẤT — buổi chưa chốt thì chưa có công dạy, giống cách kỳ công đang đếm.
    db.classSession.findMany({
      where: {
        status: "COMPLETED",
        date: { gte: from, lt: denHet },
        OR: [
          { actualTeacherId: { in: userIds } },
          { substituteTeacherId: { in: userIds } },
          { class: { teacherId: { in: userIds } } },
          { class: { assistantId: { in: userIds } } },
        ],
      },
      select: {
        id: true,
        date: true,
        actualTeacherId: true,
        substituteTeacherId: true,
        actualStartAt: true,
        actualEndAt: true,
        sessionCategory: { select: { code: true, isActive: true } },
        class: { select: { teacherId: true, assistantId: true, startTime: true, endTime: true } },
      },
    }),
    db.trialClassSession.findMany({
      where: {
        status: "COMPLETED",
        date: { gte: from, lte: to },
        OR: [{ teacherId: { in: userIds } }, { trialClass: { teacherId: { in: userIds } } }],
      },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        teacherId: true,
        trialClass: { select: { teacherId: true } },
      },
    }),
    // Case dạy bù (29/09/2026, docs/hoc-bu/DAC-TA.md) — nguồn MAKEUP. Chỉ case ĐÃ HOÀN TẤT
    // (có ít nhất một bé có mặt); case không ai tới thì chuyển CANCELLED, không sinh công.
    db.makeupCase.findMany({
      where: { status: "COMPLETED", date: { gte: from, lte: to }, teacherId: { in: userIds } },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        teacherId: true,
        sessionCategoryId: true,
      },
    }),
  ]);

  const quanTam = new Set(userIds);
  const ra: BuoiDay[] = [];

  for (const s of buoiLop) {
    // Giờ thực trước, rơi về giờ lớp. `actualStartAt/EndAt` thực tế gần như luôn rỗng (chỉ ghi
    // khi admin gõ tay), nên phần lớn buổi sẽ dùng giờ lớp — chấp nhận được vì loại mặc định
    // tính theo BUỔI; chỉ loại tính theo GIỜ mới phụ thuộc con số này.
    const minutes =
      phutGiuaHaiMoc(s.actualStartAt, s.actualEndAt) ??
      phutGiuaHaiGio(s.class?.startTime, s.class?.endTime);
    const ymd = vnYmd(s.date);
    // Phân loại đã TẮT thì coi như buổi chưa phân loại — rơi về mặc định. Nếu giữ nguyên mã đã
    // tắt thì buổi ăn dòng bao sân, tức tắt một phân loại lại âm thầm đổi hệ số của buổi cũ.
    const phanLoai = (s.sessionCategory?.isActive ? s.sessionCategory.code : null) ?? macDinh?.code ?? null;

    // Người ĐỨNG LỚP: đúng một người, theo thứ tự ưu tiên của cả module.
    const nguoiDay = s.actualTeacherId ?? s.substituteTeacherId ?? s.class?.teacherId ?? null;
    if (nguoiDay && quanTam.has(nguoiDay)) {
      // Vai: là người dạy thay khi họ KHÔNG phải giáo viên chính của lớp. So với `class.teacherId`
      // chứ không so với `substituteTeacherId` — vì `actualTeacherId` đã nuốt cả hai đường.
      //
      // `Class.teacherId` NULLABLE: lớp chưa gán giáo viên chính (thỉnh giảng, gán theo từng
      // buổi) thì không có gì để so. Coi là MAIN trừ khi buổi đó thật sự có người dạy thay —
      // mặc định "dạy thay" cho cả lớp là sai người, và hôm nay vô hại chỉ vì hai loại đang
      // cùng hệ số 1; BLĐ hạ hệ số dạy thay xuống là số của những lớp đó sai ngay.
      const laChinh =
        s.class?.teacherId == null ? s.substituteTeacherId !== nguoiDay : nguoiDay === s.class.teacherId;
      ra.push({
        id: s.id,
        source: "CLASS",
        userId: nguoiDay,
        role: laChinh ? "MAIN" : "SUBSTITUTE",
        ymd,
        minutes,
        categoryCode: phanLoai,
      });
    }

    // Trợ giảng: chỉ có ở CẤP LỚP, không có ở cấp buổi — nên mọi buổi của lớp đều tính cho
    // người đang là trợ giảng HIỆN TẠI. Đây là giới hạn của dữ liệu, không phải lựa chọn:
    // đổi trợ giảng giữa khoá sẽ quy lại cả buổi cũ. Loại TRO_GIANG mặc định KHÔNG cộng vào kỳ.
    const tg = s.class?.assistantId ?? null;
    if (tg && tg !== nguoiDay && quanTam.has(tg)) {
      ra.push({ id: s.id, source: "CLASS", userId: tg, role: "ASSISTANT", ymd, minutes, categoryCode: phanLoai });
    }
  }

  for (const s of buoiTrial) {
    const nguoiDay = s.teacherId ?? s.trialClass?.teacherId ?? null;
    if (!nguoiDay || !quanTam.has(nguoiDay)) continue;
    const laChinh = s.trialClass?.teacherId != null && nguoiDay === s.trialClass.teacherId;
    ra.push({
      id: s.id,
      source: "TRIAL",
      userId: nguoiDay,
      role: laChinh ? "MAIN" : "SUBSTITUTE",
      ymd: vnYmd(s.date),
      minutes: phutGiuaHaiGio(s.startTime, s.endTime),
      // Buổi trải nghiệm KHÔNG mang phân loại: `TrialClassSession` không có cột đó, và nguồn
      // TRIAL đã là chiều phân biệt riêng. null ⇒ luôn ăn dòng bao sân của nguồn TRIAL.
      categoryCode: null,
    });
  }

  // Phân loại của case bù: MỘT câu cho mọi id (case chỉ mang `sessionCategoryId` trần).
  const plIds = [...new Set(buoiBu.map((s) => s.sessionCategoryId).filter((x): x is string => !!x))];
  const plTheoId = new Map(
    (plIds.length
      ? await db.sessionCategory.findMany({ where: { id: { in: plIds } }, select: { id: true, code: true, isActive: true } })
      : []
    ).map((c) => [c.id, c]),
  );
  for (const s of buoiBu) {
    if (!quanTam.has(s.teacherId)) continue;
    const pl = s.sessionCategoryId ? plTheoId.get(s.sessionCategoryId) : undefined;
    ra.push({
      id: s.id,
      source: "MAKEUP",
      userId: s.teacherId,
      role: "MAIN",
      ymd: vnYmd(s.date),
      minutes: phutGiuaHaiGio(s.startTime, s.endTime),
      // Cùng luật với lớp chính: phân loại đã TẮT ⇒ coi như chưa phân loại, rơi về mặc định.
      categoryCode: (pl?.isActive ? pl.code : null) ?? macDinh?.code ?? null,
    });
  }

  return ra;
}

/** Danh mục loại công dạy đang có, theo thứ tự hiển thị. */
export async function loadLoaiCongDay() {
  const rows = await db.teachingCreditType.findMany({
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    select: {
      code: true,
      name: true,
      source: true,
      role: true,
      basis: true,
      factor: true,
      countsInPeriod: true,
      isActive: true,
      category: { select: { code: true } },
    },
  });
  return rows.map(({ category, ...r }) => ({ ...r, categoryCode: category?.code ?? null }));
}
