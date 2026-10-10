// lib/export/nhap-lai.ts — bảy đường xuất "NHẬP LẠI ĐƯỢC": tệp xuất ra dùng được luôn làm
// tệp nhập vào.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO LÀ MỘT FILE, KHÔNG PHẢI BẢY ROUTE
//
// Bảy màn này có đường NHẬP mà không có đường XUẤT (đo 27/09/2026: 11 màn import, 14 đường
// export, và chúng gần như không giao nhau). Hệ quả vận hành: muốn sửa hàng loạt thì phải
// gõ lại tay một tệp mà hệ thống đang giữ đủ dữ liệu để tự sinh ra.
//
// Điều kiện làm cho việc này có nghĩa: **khoá cột phải TRÙNG KHÍT `columnHints` của màn
// nhập.** Sai một khoá là tệp xuất ra không nhập lại được — mà đó chính là lý do người ta
// bấm xuất. Nên spec nằm cạnh nhau trong một file, và `nhap-lai.test.ts` đọc thẳng
// `columnHints` từ mã nguồn màn nhập rồi so từng khoá. Bảy route rời là bảy chỗ để lệch.
//
// ⚠️ TÊN CỘT LÀ KHOÁ MÁY (`fullName`, `centerSlug`), KHÔNG phải nhãn tiếng Việt. Trông kém
// thân thiện, nhưng `ExcelImporter` đọc dòng tiêu đề theo khoá — in nhãn tiếng Việt là tệp
// đẹp mà nhập lại thì mọi cột đều rỗng. Dòng 2 của tệp in nhãn tiếng Việt để người đọc hiểu,
// và màn nhập bỏ qua dòng đó vì nó không khớp khoá nào… nên **KHÔNG** in nhãn vào tệp; nhãn
// đi vào sheet `_watermark` dưới dạng bảng tra.
//
// ─────────────────────────────────────────────────────────────────────────────
// MỘT THỨ CỐ Ý KHÔNG XUẤT
//
// `Student.parentNationalId` (CCCD phụ huynh) KHÔNG có trong tệp, dù màn nhập cũng không
// nhận nó. Cùng lý do đã ghi ở `lib/hr/xuat-nhan-su.ts`: tệp rời khỏi hệ thống được.
import type { Center, InventoryItem, Prisma, TrialClassV2 } from "@prisma/client";
import type { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";

type ScopedDb = ReturnType<typeof scopedDb>;

/** Một cột của tệp nhập-lại-được. `khoa` phải trùng `columnHints[].key` của màn nhập. */
export type CotNhapLai<T> = {
  khoa: string;
  nhan: string;
  lay: (r: T) => string | number | null;
  /** Ép ô thành Text — mã có số 0 đầu, SĐT, mã lớp dạng số. */
  chuoi?: boolean;
  rong?: number;
};

export type KetQuaNap<T> = {
  cot: CotNhapLai<T>[];
  dong: T[];
  /**
   * Sheet phụ (bảng tổng, nhóm…). Bảy tệp nhập-lại-được KHÔNG dùng: thêm sheet vào một tệp
   * sinh ra để nhập lại là mời người ta sửa nhầm sheet rồi tải lên.
   */
  bangPhu?: { tieuDe: string; cot: string[]; dong: (string | number)[][] }[];
};

/** Ngày `dd/mm/yyyy` — đúng dạng màn nhập đọc được. Rỗng khi không có. */
export function ngayNhapLai(d: Date | null | undefined): string {
  if (!d) return "";
  // Cột `@db.Date` lưu mốc UTC 00:00 của NGÀY VN, nên đọc theo UTC là đúng ngày. Cộng 7 giờ
  // ở đây sẽ đẩy sang ngày sau — sai lệch một ngày, loại bug im lặng nhất của module này.
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** Danh sách → chuỗi "a, b, c" đúng dạng màn nhập tách lại được. */
export const gopTag = (xs: readonly string[] | null | undefined): string =>
  xs && xs.length > 0 ? xs.join(", ") : "";

/** Boolean → "TRUE"/"FALSE". Màn nhập đọc cả hai dạng; chọn dạng nói rõ nhất. */
export const co = (b: boolean | null | undefined): string => (b ? "TRUE" : "FALSE");

const c = <T,>(x: CotNhapLai<T>): CotNhapLai<T> => x;

// ─────────────────────────────────────────────────────────────────────────────
// CƠ SỞ
type DongCoSo = Center;
async function napCoSo(sdb: ScopedDb, actor: Actor): Promise<KetQuaNap<DongCoSo>> {
  // ⚠️ LỌC TAY, KHÔNG dựa vào `scopedDb`. `Center` nằm trong danh sách MIỄN scope
  // (`lib/db-scope.ts` — "Center LÀ ranh giới tenant, không tự scope theo chính nó"), nên
  // `sdb.center.findMany()` trả về MỌI cơ sở kể cả với quản lý cấp cơ sở. Chính chú thích ở
  // đó đã dặn: lớp bảo vệ phải là điều kiện tường minh theo `actor.visibleCenterIds` ở
  // call-site. Bỏ dòng này là tệp xuất ra chứa cả cơ sở người xuất không được nhìn.
  const toanBo = actor.isSuperAdmin || actor.isHoLevel;
  const dong = await sdb.center.findMany({
    where: toanBo ? {} : { id: { in: actor.visibleCenterIds } },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return {
    dong,
    cot: [
      c<DongCoSo>({ khoa: "name", nhan: "Tên chi nhánh", lay: (r) => r.name, rong: 28 }),
      c<DongCoSo>({ khoa: "slug", nhan: "Slug", lay: (r) => r.slug, chuoi: true, rong: 16 }),
      c<DongCoSo>({ khoa: "address", nhan: "Địa chỉ", lay: (r) => r.address ?? "", rong: 32 }),
      c<DongCoSo>({ khoa: "ward", nhan: "Phường", lay: (r) => r.ward ?? "" }),
      c<DongCoSo>({ khoa: "district", nhan: "Quận", lay: (r) => r.district ?? "" }),
      c<DongCoSo>({ khoa: "city", nhan: "Tỉnh/TP", lay: (r) => r.city ?? "" }),
      c<DongCoSo>({ khoa: "phone", nhan: "SĐT", lay: (r) => r.phone ?? "", chuoi: true }),
      c<DongCoSo>({ khoa: "email", nhan: "Email", lay: (r) => r.email ?? "", rong: 24 }),
      c<DongCoSo>({ khoa: "googleMapUrl", nhan: "Google Maps", lay: (r) => r.googleMapUrl ?? "", rong: 30 }),
      c<DongCoSo>({ khoa: "workingHours", nhan: "Giờ làm việc", lay: (r) => r.workingHours ?? "" }),
      c<DongCoSo>({ khoa: "managerName", nhan: "Quản lý", lay: (r) => r.managerName ?? "" }),
      c<DongCoSo>({ khoa: "description", nhan: "Mô tả", lay: (r) => r.description ?? "", rong: 30 }),
      // Màn nhập đọc cột này dạng 1/0, KHÔNG phải TRUE/FALSE — xem `columnHints` "Active (1/0)".
      c<DongCoSo>({ khoa: "isActive", nhan: "Active (1/0)", lay: (r) => (r.isActive ? 1 : 0) }),
      c<DongCoSo>({ khoa: "displayOrder", nhan: "Order", lay: (r) => r.displayOrder ?? 0 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHÒNG HỌC
type DongPhong = Prisma.RoomGetPayload<{ include: { center: { select: { slug: true } } } }>;
async function napPhong(sdb: ScopedDb): Promise<KetQuaNap<DongPhong>> {
  const dong = await sdb.room.findMany({
    include: { center: { select: { slug: true } } },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
  return {
    dong,
    cot: [
      c<DongPhong>({ khoa: "name", nhan: "Tên phòng", lay: (r) => r.name, rong: 24 }),
      c<DongPhong>({ khoa: "code", nhan: "Mã phòng", lay: (r) => r.code, chuoi: true }),
      c<DongPhong>({ khoa: "centerSlug", nhan: "Slug cơ sở", lay: (r) => r.center?.slug ?? "", chuoi: true }),
      c<DongPhong>({ khoa: "capacity", nhan: "Sức chứa", lay: (r) => r.capacity }),
      c<DongPhong>({ khoa: "equipment", nhan: "Thiết bị (cách bằng dấu ,)", lay: (r) => gopTag(r.equipment), rong: 30 }),
      c<DongPhong>({ khoa: "status", nhan: "Trạng thái", lay: (r) => r.status }),
      c<DongPhong>({ khoa: "notes", nhan: "Ghi chú", lay: (r) => r.notes ?? "", rong: 26 }),
      c<DongPhong>({ khoa: "displayOrder", nhan: "Order", lay: (r) => r.displayOrder ?? 0 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LỊCH NGHỈ
type DongNghi = Prisma.HolidayGetPayload<{ include: { center: { select: { slug: true } } } }>;
async function napNghi(sdb: ScopedDb): Promise<KetQuaNap<DongNghi>> {
  const dong = await sdb.holiday.findMany({
    include: { center: { select: { slug: true } } },
    orderBy: { date: "desc" },
  });
  return {
    dong,
    cot: [
      c<DongNghi>({ khoa: "name", nhan: "Tên", lay: (r) => r.name, rong: 28 }),
      c<DongNghi>({ khoa: "date", nhan: "Ngày bắt đầu", lay: (r) => ngayNhapLai(r.date), rong: 13 }),
      c<DongNghi>({ khoa: "endDate", nhan: "Ngày kết thúc", lay: (r) => ngayNhapLai(r.endDate), rong: 13 }),
      // `centerId = null` nghĩa là TOÀN HỆ THỐNG, và ô rỗng là đúng cách màn nhập hiểu điều
      // đó ("rỗng = toàn HT"). Điền slug vào đây khi không có cơ sở là biến một ngày nghỉ
      // toàn công ty thành ngày nghỉ của một cơ sở.
      c<DongNghi>({ khoa: "centerSlug", nhan: "Slug cơ sở (rỗng = toàn HT)", lay: (r) => r.center?.slug ?? "", chuoi: true }),
      c<DongNghi>({ khoa: "type", nhan: "Loại", lay: (r) => r.type }),
      c<DongNghi>({ khoa: "note", nhan: "Ghi chú", lay: (r) => r.note ?? "", rong: 26 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HỌC CỤ
type DongHocCu = InventoryItem;
async function napHocCu(sdb: ScopedDb): Promise<KetQuaNap<DongHocCu>> {
  const dong = await sdb.inventoryItem.findMany({ orderBy: { itemCode: "asc" } });
  return {
    dong,
    cot: [
      c<DongHocCu>({ khoa: "itemCode", nhan: "Mã hàng (upsert key)", lay: (r) => r.itemCode, chuoi: true, rong: 16 }),
      c<DongHocCu>({ khoa: "name", nhan: "Tên hàng", lay: (r) => r.name, rong: 30 }),
      c<DongHocCu>({ khoa: "description", nhan: "Mô tả", lay: (r) => r.description ?? "", rong: 30 }),
      c<DongHocCu>({ khoa: "category", nhan: "Danh mục", lay: (r) => r.category ?? "" }),
      c<DongHocCu>({ khoa: "unit", nhan: "Đơn vị (Cái/Bộ/Mét...)", lay: (r) => r.unit ?? "" }),
      c<DongHocCu>({ khoa: "pricePerUnit", nhan: "Giá / đơn vị (VND)", lay: (r) => r.pricePerUnit ?? "" }),
      c<DongHocCu>({ khoa: "supplier", nhan: "Nhà cung cấp", lay: (r) => r.supplier ?? "", rong: 24 }),
      c<DongHocCu>({ khoa: "defaultMinThreshold", nhan: "Ngưỡng tối thiểu", lay: (r) => r.defaultMinThreshold ?? "" }),
      c<DongHocCu>({ khoa: "tags", nhan: "Tags (cách ,)", lay: (r) => gopTag(r.tags), rong: 24 }),
      c<DongHocCu>({ khoa: "isActive", nhan: "Active (TRUE/FALSE)", lay: (r) => co(r.isActive) }),
      c<DongHocCu>({ khoa: "notes", nhan: "Ghi chú", lay: (r) => r.notes ?? "", rong: 26 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NGÂN HÀNG CÂU HỎI
type DongCauHoi = Prisma.QuestionGetPayload<{
  include: {
    course: { select: { slug: true } };
    curriculum: { select: { version: true } };
    choices: { select: { order: true; text: true; isCorrect: true } };
  };
}>;
async function napCauHoi(sdb: ScopedDb): Promise<KetQuaNap<DongCauHoi>> {
  const dong = await sdb.question.findMany({
    include: {
      course: { select: { slug: true } },
      curriculum: { select: { version: true } },
      choices: { select: { order: true, text: true, isCorrect: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // Bốn lựa chọn thành tám cột phẳng, đúng hình dạng màn nhập. Xếp theo `order` chứ không
  // theo thứ tự trả về: thiếu `orderBy` trên quan hệ thì Postgres không hứa thứ tự, và đáp
  // án đúng sẽ nhảy cột giữa hai lần xuất.
  const chon = (r: DongCauHoi, i: number) =>
    [...r.choices].sort((a, b) => a.order - b.order)[i];
  const cotChon: CotNhapLai<DongCauHoi>[] = [1, 2, 3, 4].flatMap((n) => [
    c<DongCauHoi>({
      khoa: `choice${n}`,
      nhan: `Lựa chọn ${"ABCD"[n - 1]}`,
      lay: (r) => chon(r, n - 1)?.text ?? "",
      rong: 26,
    }),
    c<DongCauHoi>({
      khoa: `choice${n}_correct`,
      nhan: `${"ABCD"[n - 1]} đúng?`,
      lay: (r) => {
        const x = chon(r, n - 1);
        // Lựa chọn KHÔNG tồn tại phải ra ô RỖNG, không phải "FALSE": "FALSE" nói rằng có
        // một lựa chọn D và nó sai, còn rỗng nói rằng câu này chỉ có ba lựa chọn.
        return x ? co(x.isCorrect) : "";
      },
    }),
  ]);
  return {
    dong,
    cot: [
      c<DongCauHoi>({ khoa: "questionCode", nhan: "Mã (upsert key)", lay: (r) => r.questionCode ?? "", chuoi: true, rong: 16 }),
      c<DongCauHoi>({ khoa: "type", nhan: "Loại", lay: (r) => r.type, rong: 16 }),
      c<DongCauHoi>({ khoa: "text", nhan: "Đề bài", lay: (r) => r.text, rong: 40 }),
      c<DongCauHoi>({ khoa: "difficulty", nhan: "Độ khó (EASY/MEDIUM/HARD/EXPERT)", lay: (r) => r.difficulty ?? "" }),
      c<DongCauHoi>({ khoa: "tags", nhan: "Tags (cách ,)", lay: (r) => gopTag(r.tags), rong: 22 }),
      c<DongCauHoi>({ khoa: "courseSlug", nhan: "Khoá (slug) — khung CT", lay: (r) => r.course?.slug ?? "", chuoi: true }),
      c<DongCauHoi>({ khoa: "curriculumVersion", nhan: "Khung phiên bản (số)", lay: (r) => r.curriculum?.version ?? "" }),
      c<DongCauHoi>({ khoa: "points", nhan: "Điểm/câu", lay: (r) => r.points ?? "" }),
      c<DongCauHoi>({ khoa: "timeLimitSec", nhan: "Thời gian/câu (giây)", lay: (r) => r.timeLimitSec ?? "" }),
      c<DongCauHoi>({ khoa: "correctAnswer", nhan: "Đáp án (SA/CODE/ESSAY)", lay: (r) => r.correctAnswer ?? "", rong: 26 }),
      ...cotChon,
      c<DongCauHoi>({ khoa: "explanation", nhan: "Giải thích", lay: (r) => r.explanation ?? "", rong: 34 }),
      c<DongCauHoi>({ khoa: "isPublic", nhan: "Public (TRUE/FALSE, default TRUE)", lay: (r) => co(r.isPublic) }),
      c<DongCauHoi>({ khoa: "notes", nhan: "Ghi chú", lay: (r) => r.notes ?? "", rong: 24 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HỌC VIÊN
type DongHocVien = Prisma.StudentGetPayload<{
  include: { preferredCenter: { select: { slug: true } } };
}>;
async function napHocVien(sdb: ScopedDb): Promise<KetQuaNap<DongHocVien>> {
  const dong = await sdb.student.findMany({
    where: { deletedAt: null },
    include: { preferredCenter: { select: { slug: true } } },
    orderBy: { createdAt: "desc" },
  });
  return {
    dong,
    cot: [
      c<DongHocVien>({ khoa: "studentCode", nhan: "Mã HS (upsert key)", lay: (r) => r.studentCode ?? "", chuoi: true, rong: 14 }),
      // ⚠️ Khoá là `fullName` nhưng cột DB là `name`. Màn nhập dùng `fullName`, nên lệch ở
      // đây là tệp nhập lại mất sạch tên học viên — và nhập KHÔNG báo lỗi vì tên là cột
      // bắt buộc rỗng ⇒ mọi dòng bị loại. Đừng "sửa cho khớp DB".
      c<DongHocVien>({ khoa: "fullName", nhan: "Họ tên HS", lay: (r) => r.name, rong: 26 }),
      c<DongHocVien>({ khoa: "dateOfBirth", nhan: "Ngày sinh", lay: (r) => ngayNhapLai(r.dateOfBirth), rong: 12 }),
      c<DongHocVien>({ khoa: "gender", nhan: "Giới tính", lay: (r) => r.gender ?? "" }),
      c<DongHocVien>({ khoa: "currentGrade", nhan: "Lớp (1-12)", lay: (r) => r.currentGrade ?? "" }),
      c<DongHocVien>({ khoa: "school", nhan: "Trường", lay: (r) => r.school ?? "", rong: 26 }),
      c<DongHocVien>({ khoa: "parentName", nhan: "Tên PH chính", lay: (r) => r.parentName ?? "", rong: 24 }),
      c<DongHocVien>({ khoa: "parentPhone", nhan: "SĐT PH chính", lay: (r) => r.parentPhone ?? "", chuoi: true, rong: 14 }),
      c<DongHocVien>({ khoa: "parentEmail", nhan: "Email PH", lay: (r) => r.parentEmail ?? "", rong: 24 }),
      c<DongHocVien>({ khoa: "parentRelation", nhan: "Quan hệ PH", lay: (r) => r.parentRelation ?? "" }),
      c<DongHocVien>({ khoa: "parent2Name", nhan: "Tên PH 2", lay: (r) => r.parent2Name ?? "", rong: 22 }),
      c<DongHocVien>({ khoa: "parent2Phone", nhan: "SĐT PH 2", lay: (r) => r.parent2Phone ?? "", chuoi: true, rong: 14 }),
      c<DongHocVien>({ khoa: "parent2Relation", nhan: "Quan hệ PH 2", lay: (r) => r.parent2Relation ?? "" }),
      c<DongHocVien>({ khoa: "address", nhan: "Địa chỉ", lay: (r) => r.address ?? "", rong: 30 }),
      c<DongHocVien>({ khoa: "ward", nhan: "Phường", lay: (r) => r.ward ?? "" }),
      c<DongHocVien>({ khoa: "district", nhan: "Quận", lay: (r) => r.district ?? "" }),
      c<DongHocVien>({ khoa: "city", nhan: "Tỉnh/TP", lay: (r) => r.city ?? "" }),
      c<DongHocVien>({ khoa: "centerSlug", nhan: "Slug cơ sở mong muốn", lay: (r) => r.preferredCenter?.slug ?? "", chuoi: true }),
      c<DongHocVien>({ khoa: "enrollmentDate", nhan: "Ngày đăng ký", lay: (r) => ngayNhapLai(r.enrollmentDate), rong: 13 }),
      c<DongHocVien>({ khoa: "status", nhan: "Trạng thái", lay: (r) => r.status }),
      c<DongHocVien>({ khoa: "bloodType", nhan: "Nhóm máu", lay: (r) => r.bloodType ?? "" }),
      c<DongHocVien>({ khoa: "allergies", nhan: "Dị ứng (cách ,)", lay: (r) => gopTag(r.allergies), rong: 22 }),
      c<DongHocVien>({ khoa: "healthNotes", nhan: "Ghi chú sức khoẻ", lay: (r) => r.healthNotes ?? "", rong: 26 }),
      c<DongHocVien>({ khoa: "notes", nhan: "Ghi chú nội bộ", lay: (r) => r.notes ?? "", rong: 26 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LỚP TRẢI NGHIỆM
//
// ⚠️ `TrialClassV2` mang `centerId` nhưng KHÔNG có quan hệ `center` trong schema (khác
// `Room`/`Holiday`/`Student`), nên slug phải tra bằng một truy vấn riêng. Đừng thêm
// `include: { center }` — nó không biên dịch, và cách "sửa" nhanh là đổi sang in `centerId`,
// mà mã UUID thì màn nhập KHÔNG đọc được (nó khớp theo mã cơ sở hoặc slug).
type DongTrial = TrialClassV2 & { slugCoSo: string };
async function napTrial(sdb: ScopedDb): Promise<KetQuaNap<DongTrial>> {
  const tho = await sdb.trialClassV2.findMany({ orderBy: { startDate: "desc" } });
  const slug = new Map(
    (await sdb.center.findMany({ select: { id: true, slug: true } })).map((x) => [x.id, x.slug]),
  );
  const dong: DongTrial[] = tho.map((r) => ({ ...r, slugCoSo: slug.get(r.centerId) ?? "" }));
  return {
    dong,
    cot: [
      c<DongTrial>({ khoa: "centerSlug", nhan: "Cơ sở (mã CS1 hoặc slug)", lay: (r) => r.slugCoSo, chuoi: true }),
      c<DongTrial>({ khoa: "date", nhan: "Ngày (dd/mm/yyyy)", lay: (r) => ngayNhapLai(r.startDate), rong: 13 }),
      c<DongTrial>({ khoa: "startTime", nhan: "Giờ bắt đầu (HH:MM)", lay: (r) => r.startTime ?? "", chuoi: true }),
      c<DongTrial>({ khoa: "endTime", nhan: "Giờ kết thúc (HH:MM)", lay: (r) => r.endTime ?? "", chuoi: true }),
      c<DongTrial>({ khoa: "name", nhan: "Tên lớp (bỏ trống để hệ thống tự đặt)", lay: (r) => r.name ?? "", rong: 30 }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Bộ nạp theo mã màn. `ScopedDb` truyền vào từ route ⇒ cách ly cơ sở giữ nguyên: quản lý
 * CS1 xuất ra tệp chỉ có phòng học, học viên, lớp trial của CS1.
 *
 * Bốn màn được `scopedDb` che sẵn: phòng học · lịch nghỉ · học viên · lớp trial (`Room` ·
 * `Holiday` · `Student` · `TrialClassV2` đều ∈ `SCOPED_MODELS`).
 *
 * ⚠️ BA màn KHÔNG được che, và mỗi màn một lý do khác nhau — đừng gộp:
 * · `Center` nằm trong danh sách MIỄN scope vì nó LÀ ranh giới tenant (tự scope theo chính
 *   nó sẽ vỡ mọi thao tác cross-center hợp lệ). ⇒ `napCoSo` LỌC TAY theo
 *   `actor.visibleCenterIds`. Đây là lỗ rò thật nếu quên.
 * · `InventoryItem` và `Question` là DANH MỤC dùng chung toàn công ty, không mang `centerId`.
 *   Không có gì để lọc, và hai màn đó vốn đã hiện đủ cho ai mở được chúng.
 */
export const BO_NAP: Record<string, (sdb: ScopedDb, actor: Actor) => Promise<KetQuaNap<never>>> = {
  "co-so": napCoSo as never,
  "phong-hoc": napPhong as never,
  "lich-nghi": napNghi as never,
  "hoc-cu": napHocCu as never,
  "cau-hoi": napCauHoi as never,
  "hoc-vien": napHocVien as never,
  "lop-trial": napTrial as never,
};

export const MA_NHAP_LAI = Object.keys(BO_NAP);
