// prisma/seed-lms/staff.ts — Seed nhân viên: 10 phòng ban × N (mặc định 10) =
// Employee + User (login) + UserOrgRole (RBAC động — để admin pages resolve actor).
// Trả về pool teacher (userId theo center) cho module classes dùng làm teacherId.
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { SeedConfig } from "./_config";
import {
  CENTERS,
  ORG_CODES,
  batchCreate,
  genAdultDob,
  genGender,
  genName,
  genPhone,
  pad,
  pick,
} from "./_lib";

// department(enum) → { User.role, RoleDef code, đặt ở HO hay center, có thể dạy }
type DeptSpec = {
  dept: string;
  role: string; // Role enum
  roleDef: string; // RoleDef code (từ seed-roles)
  loc: "ho" | "center";
  canTeach?: boolean;
  jobTitle: string;
};
const DEPTS: DeptSpec[] = [
  { dept: "BAN_GIAM_DOC", role: "CENTER_MANAGER", roleDef: "CENTER_MANAGER", loc: "center", jobTitle: "Giám đốc điều hành" },
  { dept: "DAO_TAO", role: "TRAINING", roleDef: "CENTER_MANAGER", loc: "ho", canTeach: true, jobTitle: "Chuyên viên Đào tạo" },
  { dept: "MARKETING", role: "MARKETING", roleDef: "HO_MARKETING", loc: "ho", jobTitle: "Chuyên viên Marketing" },
  { dept: "KINH_DOANH", role: "SALES_CSM", roleDef: "CENTER_SALES_CSM", loc: "center", jobTitle: "Tư vấn tuyển sinh" },
  { dept: "IT", role: "HR", roleDef: "HO_HR", loc: "ho", jobTitle: "Kỹ sư CNTT" },
  { dept: "HANH_CHANH_NHAN_SU", role: "HR", roleDef: "HO_HR", loc: "ho", jobTitle: "Chuyên viên Nhân sự" },
  { dept: "KE_TOAN", role: "ACCOUNTANT", roleDef: "HO_ACCOUNTANT", loc: "ho", jobTitle: "Kế toán" },
  { dept: "TUYEN_SINH", role: "SALES_CSM", roleDef: "CENTER_SALES_CSM", loc: "center", jobTitle: "Chuyên viên Tuyển sinh" },
  { dept: "GIAO_VU", role: "SALES_CSM", roleDef: "CENTER_MANAGER", loc: "center", jobTitle: "Giáo vụ" },
  { dept: "GIANG_DAY", role: "TEACHER", roleDef: "TEACHER", loc: "center", canTeach: true, jobTitle: "Giáo viên" },
];

export type TeacherPool = { userId: string; centerId: string }[];

export async function seedStaff(
  db: PrismaClient,
  cfg: SeedConfig,
): Promise<TeacherPool> {
  const password = await bcrypt.hash(cfg.password, 10);
  const admin = await db.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  const grantedById = admin!.id;

  // RoleDef code → id ; DepartmentDef code → id
  const roleDefs = await db.roleDef.findMany({ select: { id: true, code: true } });
  const roleDefByCode = new Map(roleDefs.map((r) => [r.code, r.id]));
  const deptDefs = await db.departmentDef.findMany({ select: { id: true, code: true } });
  const deptIdByCode = new Map(deptDefs.map((d) => [d.code, d.id]));

  const orgUnits = await db.orgUnit.findMany({ select: { id: true, code: true } });
  const orgIdByCode = new Map(orgUnits.map((o) => [o.code, o.id]));

  const employees: unknown[] = [];
  const users: unknown[] = [];
  const orgRoles: unknown[] = [];
  const teacherPool: TeacherPool = [];

  let seq = 0;
  for (const spec of DEPTS) {
    for (let i = 0; i < cfg.staffPerDept; i++) {
      seq++;
      const gender = genGender();
      const fullName = genName(gender);
      const empId = `slms-emp-${pad(seq, 4)}`;
      const userId = `slms-staff-${pad(seq, 4)}`;
      const empCode = `NV-${pad(seq, 4)}`;
      const email = `nv.${spec.dept.toLowerCase()}.${pad(i + 1, 2)}@seed.satarobo.test`;

      // Phân bổ cơ sở: dept "center" chia đều CS1/CS2; dept "ho" đặt HO.
      const centerId = spec.loc === "ho" ? CENTERS.HO : i % 2 === 0 ? CENTERS.CS1 : CENTERS.CS2;
      const orgCode = spec.loc === "ho" ? ORG_CODES.HO : centerId === CENTERS.CS1 ? ORG_CODES.CS1 : ORG_CODES.CS2;
      const orgUnitId = orgIdByCode.get(orgCode)!;

      const roles = spec.role === "TEACHER" ? ["TEACHER"] : spec.canTeach ? [spec.role, "TEACHER"] : [spec.role];

      employees.push({
        id: empId,
        employeeCode: empCode,
        fullName,
        jobTitle: spec.jobTitle,
        department: spec.dept,
        departmentId: deptIdByCode.get(spec.dept) ?? null,
        email,
        gender,
        phone: genPhone(),
        dateOfBirth: genAdultDob(),
        centerId,
        status: "ACTIVE",
        isActive: true,
        joinedAt: new Date(Date.UTC(2024, pick([0, 1, 2, 5, 8]), pick([1, 5, 12, 20]))),
        subjects: spec.canTeach ? ["Lập trình Robot"] : [],
        createdById: grantedById,
      });
      users.push({
        id: userId,
        name: fullName,
        email,
        password,
        role: spec.role,
        roles,
        centerId,
        orgUnitId,
        employeeId: empId,
        accountStatus: "ACTIVE",
        isActive: true,
      });
      const roleId = roleDefByCode.get(spec.roleDef);
      if (roleId) {
        orgRoles.push({ userId, orgUnitId, roleId, status: "ACTIVE", grantedById });
      }

      if (spec.canTeach && centerId !== CENTERS.HO) {
        teacherPool.push({ userId, centerId });
      }
    }
  }

  // Thứ tự: Employee trước (User.employeeId FK) → User → UserOrgRole.
  await batchCreate("employees", employees, (b) => db.employee.createMany({ data: b as never, skipDuplicates: true }), 500);
  await batchCreate("staff users", users, (b) => db.user.createMany({ data: b as never, skipDuplicates: true }), 500);
  await batchCreate("user-org-roles", orgRoles, (b) => db.userOrgRole.createMany({ data: b as never, skipDuplicates: true }), 500);

  // DAO_TAO (HO, canTeach) cũng có thể được xếp lớp bất kỳ cơ sở → thêm vào pool cho cả 2 CS.
  const trainers = users.filter((u) => (u as { role: string }).role === "TRAINING") as { id: string }[];
  for (const t of trainers) {
    teacherPool.push({ userId: t.id, centerId: CENTERS.CS1 });
    teacherPool.push({ userId: t.id, centerId: CENTERS.CS2 });
  }

  console.log(`✅ Staff: ${employees.length} Employee + User · ${orgRoles.length} UserOrgRole · ${teacherPool.length} teacher-slots`);
  return teacherPool;
}
