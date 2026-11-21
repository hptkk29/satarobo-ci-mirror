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
import type { BuoiDay, HienThiBuoi } from "./cong-day";
import { phutGiuaHaiGio, phutGiuaHaiMoc } from "./cong-day";
import { TRANG_THAI_CASE_CO_CONG } from "./buoi-bu-ky";
import { vnParts, vnYmd } from "@/lib/time/vn";

/** "HH:mm" giờ VN của một mốc — chỉ để hiển thị. */
function gioVn(d: Date | null): string | null {
  if (!d) return null;
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

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
        // Chỉ để HIỂN THỊ (màn Công dạy giáo viên) — luật quy đổi không đọc các cột dưới.
        centerId: true,
        roomId: true,
        sessionCategory: { select: { code: true, isActive: true } },
        class: {
          select: { id: true, name: true, centerId: true, roomId: true, teacherId: true, assistantId: true, startTime: true, endTime: true },
        },
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
        roomId: true,
        trialClass: { select: { teacherId: true, centerId: true, roomId: true } },
      },
    }),
    // Case dạy bù (29/09/2026, docs/hoc-bu/DAC-TA.md) — nguồn MAKEUP. Chỉ case ĐÃ DẠY: COMPLETED (có bé có mặt) hoặc NO_SHOW
    // (T07: giáo viên có mặt dạy nhưng mọi bé vắng — vẫn có công; một case = MỘT buổi công, bất kể số bài hay số bé). Case CANCELLED
    // (huỷ trước giờ / không còn bé nào) không sinh công.
    db.makeupCase.findMany({
      where: { status: { in: [...TRANG_THAI_CASE_CO_CONG] }, date: { gte: from, lte: to }, teacherId: { in: userIds } },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        teacherId: true,
        sessionCategoryId: true,
        status: true,
        centerId: true,
        roomId: true,
        courseId: true,
      },
    }),
  ]);

  const quanTam = new Set(userIds);
  const ra: BuoiDay[] = [];

  // Tên phòng + tên khoá (case bù chỉ mang `roomId`/`courseId` trần): MỘT lượt cho cả kỳ, chỉ để
  // hiển thị. Không N+1, không đổi gì trong luật quy đổi.
  const roomIds = [
    ...new Set(
      [
        ...buoiLop.flatMap((s) => [s.roomId, s.class?.roomId]),
        ...buoiTrial.flatMap((s) => [s.roomId, s.trialClass?.roomId]),
        ...buoiBu.map((s) => s.roomId),
      ].filter((x): x is string => !!x),
    ),
  ];
  const courseIds = [...new Set(buoiBu.map((s) => s.courseId))];
  // Phân loại của case bù: MỘT câu cho mọi id (case chỉ mang `sessionCategoryId` trần). Gộp CHUNG lô với hai
  // câu hiển thị — loader này có 4 nơi gọi, thêm một vòng đi-về tuần tự là cả 4 trang chậm theo.
  const plIds = [...new Set(buoiBu.map((s) => s.sessionCategoryId).filter((x): x is string => !!x))];
  const [phongs, khoas, phanLoais] = await Promise.all([
    roomIds.length ? db.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [],
    courseIds.length ? db.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } }) : [],
    plIds.length
      ? db.sessionCategory.findMany({ where: { id: { in: plIds } }, select: { id: true, code: true, isActive: true } })
      : [],
  ]);
  const plTheoId = new Map(phanLoais.map((c) => [c.id, c]));
  const tenPhong = new Map(phongs.map((p) => [p.id, p.name]));
  const tenKhoa = new Map(khoas.map((k) => [k.id, k.name]));
  const phongCua = (...ids: (string | null | undefined)[]) => {
    const id = ids.find((x) => !!x);
    return id ? (tenPhong.get(id) ?? null) : null;
  };

  for (const s of buoiLop) {
    // Giờ thực trước, rơi về giờ lớp. `actualStartAt/EndAt` thực tế gần như luôn rỗng (chỉ ghi
    // khi admin gõ tay), nên phần lớn buổi sẽ dùng giờ lớp — chấp nhận được vì loại mặc định
    // tính theo BUỔI; chỉ loại tính theo GIỜ mới phụ thuộc con số này.
    const phutThuc = phutGiuaHaiMoc(s.actualStartAt, s.actualEndAt);
    const minutes = phutThuc ?? phutGiuaHaiGio(s.class?.startTime, s.class?.endTime);
    const ymd = vnYmd(s.date);
    // Giờ in ra phải là ĐÚNG hai mốc mà `minutes` được tính từ — không thì cột Giờ và cột Thời
    // lượng trên cùng một dòng nói hai chuyện khác nhau.
    const hienThi: HienThiBuoi = {
      gioBatDau: phutThuc != null ? gioVn(s.actualStartAt) : (s.class?.startTime ?? null),
      gioKetThuc: phutThuc != null ? gioVn(s.actualEndAt) : (s.class?.endTime ?? null),
      gioThuc: phutThuc != null,
      lopId: s.class?.id ?? null,
      tenLop: s.class?.name ?? null,
      centerId: s.centerId ?? s.class?.centerId ?? null,
      phong: phongCua(s.roomId, s.class?.roomId),
      trangThai: "COMPLETED",
      gvChinhId: s.class?.teacherId ?? null,
      gvThayId: s.substituteTeacherId,
      nguoiDayThucId: s.actualTeacherId,
    };
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
        hienThi,
      });
    }

    // Trợ giảng: chỉ có ở CẤP LỚP, không có ở cấp buổi — nên mọi buổi của lớp đều tính cho
    // người đang là trợ giảng HIỆN TẠI. Đây là giới hạn của dữ liệu, không phải lựa chọn:
    // đổi trợ giảng giữa khoá sẽ quy lại cả buổi cũ. Loại TRO_GIANG mặc định KHÔNG cộng vào kỳ.
    const tg = s.class?.assistantId ?? null;
    if (tg && tg !== nguoiDay && quanTam.has(tg)) {
      ra.push({ id: s.id, source: "CLASS", userId: tg, role: "ASSISTANT", ymd, minutes, categoryCode: phanLoai, hienThi });
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
      hienThi: {
        gioBatDau: s.startTime,
        gioKetThuc: s.endTime,
        gioThuc: false,
        lopId: null,
        tenLop: null,
        centerId: s.trialClass?.centerId ?? null,
        phong: phongCua(s.roomId, s.trialClass?.roomId),
        trangThai: "COMPLETED",
        gvChinhId: s.trialClass?.teacherId ?? null,
        gvThayId: null,
        nguoiDayThucId: s.teacherId,
      },
    });
  }

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
      hienThi: {
        gioBatDau: s.startTime,
        gioKetThuc: s.endTime,
        gioThuc: false,
        lopId: null,
        tenLop: tenKhoa.get(s.courseId) ?? null,
        centerId: s.centerId,
        phong: phongCua(s.roomId),
        trangThai: s.status,
        gvChinhId: s.teacherId,
        gvThayId: null,
        nguoiDayThucId: s.teacherId,
      },
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
