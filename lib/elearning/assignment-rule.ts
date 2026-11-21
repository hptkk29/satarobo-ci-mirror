import { z } from "zod";
import type { Prisma } from "@prisma/client";

/**
 * EL-05 — BỘ LỌC TẬP NGƯỜI HỌC: từ luật nhóm ra câu truy vấn.
 *
 * §10.2 liệt kê 12 chiều lọc, cộng "Trạng thái làm việc" là 13. Các điều kiện
 * TRONG một luật nối bằng VÀ; các luật nối với nhau bằng HOẶC.
 *
 * ⚠️ NGUYÊN TẮC BAO TRÙM CẢ TỆP: khi luật thiếu thông tin, tập người học phải
 * HẸP LẠI hoặc BÁO LỖI — không bao giờ được NỞ RA. Một bộ lọc sai không văng lỗi,
 * nó chỉ lặng lẽ giao bài cho sai người; ở quy mô 15 nhân sự thì không ai phát
 * hiện bằng mắt. Vì thế mọi nhánh "không rõ" ở đây đều chọn phía chặt.
 *
 * ⚠️ HAI CHIỀU LỌC CHƯA CÓ NỀN DỮ LIỆU — xem `CHIEU_THIEU_NEN`.
 */

/** Giá trị canh cho nhóm "Chưa khai" của chiều Loại hợp đồng (QĐ-CDA-09 đk 2). */
export const CHUA_KHAI = "CHUA_KHAI";

/**
 * Hai chiều của §10.2 KHÔNG có cột/bảng nào đỡ trong repo này:
 *
 * - `team` — không có model `Team`, và `OrgUnitType` không có giá trị `TEAM`.
 * - `capBac` — không có cột cấp bậc L1–L5 trên `Employee` hay bất kỳ bảng nào.
 *
 * Nhận rồi bỏ qua là lựa chọn TỆ NHẤT: người giao bài tin mình đã thu hẹp theo
 * team, còn hệ thống giao cho cả nhóm rộng hơn. Nên hai chiều này bị TỪ CHỐI
 * tường minh cho tới khi có bảng thật; ngày đó chỉ cần bỏ tên khỏi danh sách này
 * và thêm một nhánh dựng where.
 */
const CHIEU_THIEU_NEN = ["team", "capBac"] as const;

export function chieuLocThieuNen(): readonly string[] {
  return CHIEU_THIEU_NEN;
}

/** Lỗi của tầng luật lọc — tách khỏi `ActionError` để dùng được cả ngoài action. */
export class LoiLuatLoc extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "LoiLuatLoc";
  }
}

const dsChuoi = z.array(z.string().trim().min(1)).min(1);
const dsSo = z.array(z.number().int()).min(1);

/**
 * Hình dạng của `TrnAssignmentRule.filterJson`.
 *
 * ⚠️ `.strict()` là một RÀNG BUỘC AN TOÀN, không phải thói quen gõ code: khoá lạ
 * (gõ sai tên chiều, chiều cũ đã bỏ, hai chiều chưa có nền) mà bị bỏ qua im lặng
 * thì điều kiện người dùng tưởng đang có hoá ra không tồn tại — và tập người học
 * NỞ RA đúng cái hướng nguy hiểm.
 */
export const luatLocSchema = z
  .object({
    lmsRole: dsChuoi.optional(),
    departmentId: dsChuoi.optional(),
    centerId: dsChuoi.optional(),
    jobTitle: dsChuoi.optional(),
    contractType: dsChuoi.optional(),
    teacherRank: dsChuoi.optional(),
    managerEmployeeId: dsChuoi.optional(),
    salaryRank: dsSo.optional(),
    salaryLevel: dsSo.optional(),
    seniorityDaysMin: z.number().int().min(0).optional(),
    seniorityDaysMax: z.number().int().min(0).optional(),
    employmentStatus: dsChuoi.optional(),
    courseCompleted: z
      .object({ courseId: z.string().min(1), da: z.boolean() })
      .optional(),
  })
  .strict();

export type LuatLoc = z.infer<typeof luatLocSchema>;

export type TuyChonLoc = {
  mode: "STATIC" | "DYNAMIC";
  now: Date;
  /**
   * Danh sách `jobTitle` CÓ THẬT trong DB. Truyền vào thì chiều Chức danh nở
   * nhãn đã chọn ra đủ mọi biến thể thật (xem `khopChucDanh`).
   */
  chucDanhCoThat?: string[];
  /**
   * `courseId` → danh sách `userId` ĐÃ hoàn thành khoá đó.
   *
   * Phải truyền từ ngoài vì `TrnEnrollment.userId` là CỘT TRẦN, không có quan hệ
   * Prisma sang `User` — không đi xuyên `where` được. Người gọi tự tra một lượt
   * rồi đưa vào đây, và hàm này giữ nguyên tính thuần.
   */
  daHoanThanh?: Record<string, string[]>;
};

const chuanHoa = (s: string) => s.trim().toLocaleLowerCase("vi-VN");

/**
 * Nở các nhãn chức danh đã chọn ra ĐỦ biến thể có thật trong DB.
 *
 * `Employee.jobTitle` là chuỗi tự do không danh mục (luật 1 — chiều Chức danh đọc
 * thẳng cột này, KHÔNG đi qua `PositionAssignment`, vì prod có 0 `Position`). Nên
 * DB có thể mang cùng lúc "Giáo viên", "giáo viên" và " Giáo Viên ". Người giao
 * bài chọn MỘT nhãn và phải trúng hết — người bị sót không hề biết mình bị sót.
 *
 * So khớp chuẩn hoá làm ở ĐÂY (JS) chứ không ở DB, vì Prisma không trim được cột
 * trong mệnh đề `where`; đổi lại `in` là danh sách giá trị đúng nguyên văn nên
 * vẫn dùng được index.
 */
export function khopChucDanh(chon: string[], coThat: string[]): string[] {
  const dich = new Set(chon.map(chuanHoa));
  return coThat.filter((t) => dich.has(chuanHoa(t)));
}

/**
 * Một luật nhóm → `where` trên `Employee`.
 *
 * Trả `Prisma.EmployeeWhereInput`: mọi chiều lọc đều neo vào bảng nhân sự (vai LMS
 * và ngạch giáo viên đi qua quan hệ `userAccount`).
 */
export function luatToWhere(
  raw: unknown,
  opts: TuyChonLoc,
): Prisma.EmployeeWhereInput {
  // Chặn hai chiều chưa có nền TRƯỚC khi zod kêu "unrecognized key", để thông báo
  // nói đúng lý do thật thay vì một câu chung chung.
  if (raw && typeof raw === "object") {
    for (const chieu of CHIEU_THIEU_NEN) {
      if (chieu in (raw as Record<string, unknown>)) {
        throw new LoiLuatLoc(
          "FILTER_NO_DATA_SOURCE",
          `Chiều lọc "${chieu}" chưa có dữ liệu nền trong hệ thống — chưa dùng được`,
          chieu,
        );
      }
    }
  }

  const parsed = luatLocSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new LoiLuatLoc(
      "FILTER_INVALID",
      `Luật lọc không hợp lệ: ${issue?.message ?? "sai định dạng"}`,
      issue?.path.join("."),
    );
  }
  const f = parsed.data;
  const w: Prisma.EmployeeWhereInput = {};

  if (f.centerId) w.centerId = { in: f.centerId };
  if (f.departmentId) w.departmentId = { in: f.departmentId };
  if (f.managerEmployeeId) w.managerId = { in: f.managerEmployeeId };
  if (f.salaryRank) w.salaryRank = { in: f.salaryRank };
  if (f.salaryLevel) w.salaryLevel = { in: f.salaryLevel };

  // ── Luật 2: trạng thái làm việc mặc định CHỈ `ACTIVE` (C4) ────────────────
  // Không có mặc định này thì người đã nghỉ vẫn nhận bài bắt buộc và vẫn nằm
  // trong mẫu số báo cáo. Prod hiện 15/15 `ACTIVE` nên làm sai KHÔNG có gì báo
  // động — đúng loại lỗi chỉ test giữ được.
  w.status = {
    in: (f.employmentStatus ?? ["ACTIVE"]) as Prisma.EnumEmploymentStatusFilter["in"],
  };

  // ── Luật 1: chức danh ─────────────────────────────────────────────────────
  if (f.jobTitle) {
    // Có danh sách thật thì nở ra biến thể; không có thì giữ nguyên chữ đã chọn.
    // Cả hai nhánh đều ra `in: [...]` — kể cả `in: []`, tức KHỚP KHÔNG AI. Viết
    // ẩu thành "bỏ hẳn điều kiện" là biến luật rỗng thành "mọi người".
    w.jobTitle = {
      in: opts.chucDanhCoThat
        ? khopChucDanh(f.jobTitle, opts.chucDanhCoThat)
        : f.jobTitle,
    };
  }

  // ── Luật 4: "Chưa khai" loại hợp đồng là giá trị THẬT ─────────────────────
  // Prod: FULLTIME 9 · PARTTIME 3 · chưa khai 3. Không có nhánh NULL thì ba người
  // đó vô hình với mọi luật lọc loại hợp đồng, và không ai thấy họ bị bỏ rơi.
  if (f.contractType) {
    const coChuaKhai = f.contractType.includes(CHUA_KHAI);
    const loai = f.contractType.filter((c) => c !== CHUA_KHAI);
    const nhanh: Prisma.EmployeeWhereInput[] = [];
    if (loai.length) {
      nhanh.push({
        contractType: { in: loai as Prisma.EnumContractTypeNullableFilter["in"] },
      });
    }
    if (coChuaKhai) nhanh.push({ contractType: null });
    w.OR = nhanh;
  }

  // ── Vai LMS: khớp nếu BẤT KỲ vai nào khớp (§7.12) ─────────────────────────
  // `User.roles[]` là mảng và quyền là hợp, nên phải soi CẢ vai chính `role` lẫn
  // mảng `roles` — chỉ soi một trong hai là bỏ sót người thật.
  const dieuKienUser: Prisma.UserWhereInput[] = [];
  if (f.lmsRole) {
    dieuKienUser.push({
      OR: [
        { role: { in: f.lmsRole as Prisma.EnumRoleFilter["in"] } },
        { roles: { hasSome: f.lmsRole as Prisma.EnumRoleNullableListFilter["hasSome"] } },
      ],
    });
  }
  if (f.teacherRank) {
    dieuKienUser.push({
      teacherProfile: {
        rank: { in: f.teacherRank as Prisma.EnumTeacherRankFilter["in"] },
      },
    });
  }
  if (dieuKienUser.length) w.userAccount = { AND: dieuKienUser };

  // ── Thâm niên ─────────────────────────────────────────────────────────────
  // `joinedAt` nullable: người chưa khai ngày vào làm có thâm niên KHÔNG BIẾT.
  // Cho họ lọt là đoán bừa, nên `not: null` là bắt buộc — và màn xem trước có
  // trách nhiệm nêu tên nhóm bị loại vì thiếu dữ liệu (không im lặng).
  if (f.seniorityDaysMin !== undefined || f.seniorityDaysMax !== undefined) {
    const dk: Prisma.DateTimeNullableFilter = { not: null };
    // Vào làm càng SỚM thì thâm niên càng LỚN ⇒ min ngày ⇒ mốc `lte`.
    if (f.seniorityDaysMin !== undefined) {
      dk.lte = luiNgay(opts.now, f.seniorityDaysMin);
    }
    if (f.seniorityDaysMax !== undefined) {
      dk.gte = luiNgay(opts.now, f.seniorityDaysMax);
    }
    w.joinedAt = dk;
  }

  // ── Luật 3: cấm vị ngữ trạng-thái-học-tập trong luật ĐỘNG (C5) ────────────
  if (f.courseCompleted) {
    if (opts.mode === "DYNAMIC") {
      // Tự tham chiếu: hoàn thành khoá X làm người ta RỜI tập ⇒ `REVOKED` ⇒ lại
      // khớp luật ⇒ vào lại. Mỗi đêm một vòng, và người học nhận thông báo thu
      // hồi/giao lại luân phiên không dứt.
      throw new LoiLuatLoc(
        "FILTER_SELF_REFERENTIAL",
        'Không dùng được điều kiện "đã/chưa hoàn thành khoá" cho lượt giao ĐỘNG — hãy chuyển sang lượt giao tĩnh',
        "courseCompleted",
      );
    }
    // ⚠️ Fail-closed khi người gọi quên tra danh sách. Coi "thiếu dữ liệu" là
    // "không ai hoàn thành" nghe vô hại, nhưng với vế `da: false` ("CHƯA hoàn
    // thành khoá X") nó biến luật thành KHỚP TẤT CẢ — đúng hướng nguy hiểm.
    const dsHoanThanh = opts.daHoanThanh?.[f.courseCompleted.courseId];
    if (!dsHoanThanh) {
      throw new LoiLuatLoc(
        "FILTER_NEEDS_COMPLETION_DATA",
        "Thiếu dữ liệu hoàn thành khoá để dựng luật lọc",
        "courseCompleted",
      );
    }
    const theoUser: Prisma.UserWhereInput = f.courseCompleted.da
      ? { id: { in: dsHoanThanh } }
      : { id: { notIn: dsHoanThanh } };
    w.userAccount = w.userAccount
      ? { AND: [w.userAccount, theoUser] }
      : theoUser;
  }

  return w;
}

/** Các luật nối với nhau bằng HOẶC (§10.2). */
export function cacLuatToWhere(
  luat: unknown[],
  opts: TuyChonLoc,
): Prisma.EmployeeWhereInput {
  // Không luật nào ⇒ khớp KHÔNG AI. Lượt giao chỉ gồm danh sách cá nhân là hợp
  // lệ, nhưng phần LUẬT của nó phải ra tập rỗng — trả `{}` ở đây là giao cho
  // toàn công ty.
  if (luat.length === 0) return { id: { in: [] } };
  return { OR: luat.map((l) => luatToWhere(l, opts)) };
}

function luiNgay(moc: Date, songay: number): Date {
  return new Date(moc.getTime() - songay * 24 * 60 * 60 * 1000);
}
