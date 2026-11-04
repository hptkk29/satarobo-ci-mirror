// prisma/seed-lms/parents-students.ts — Seed phụ huynh (User role PARENT) + học viên.
// 1 PH ↔ 1-3 con (Student.parentUserId). Student ∈ SCOPED_MODELS → BẮT BUỘC set centerId.
// Phụ huynh có password + accountStatus ACTIVE để login portal thử. Thêm StudentConsent
// (CLASS_MEDIA) để test gate ảnh lớp.
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { SeedConfig } from "./_config";
import {
  OPERATING_CENTERS,
  batchCreate,
  chance,
  genAddress,
  genChildDob,
  genGender,
  genName,
  genPhone,
  genRelation,
  gradeForAge,
  pad,
  pick,
  rand,
  weightedPick,
} from "./_lib";

export type StudentRec = { id: string; centerId: string; grade: number };

export async function seedParentsStudents(
  db: PrismaClient,
  cfg: SeedConfig,
): Promise<StudentRec[]> {
  const password = await bcrypt.hash(cfg.password, 10);

  const parents: unknown[] = [];
  const students: unknown[] = [];
  const consents: unknown[] = [];
  const studentRecs: StudentRec[] = [];

  let studentSeq = 0;
  for (let p = 1; p <= cfg.parents; p++) {
    const pGender = genGender();
    const parentName = genName(pGender);
    const parentUserId = `slms-ph-${pad(p, 5)}`;
    const parentEmail = `ph.${pad(p, 5)}@seed.satarobo.test`;
    const parentPhone = genPhone();
    const parentRelation = pGender === "MALE" ? "Bố" : "Mẹ";
    const addr = genAddress();
    // Cơ sở "gốc" của phụ huynh (các con mặc định cùng cơ sở này).
    const centerId = pick(OPERATING_CENTERS);

    parents.push({
      id: parentUserId,
      name: parentName,
      email: parentEmail,
      password,
      role: "PARENT",
      roles: ["PARENT"],
      centerId,
      accountStatus: "ACTIVE",
      isActive: true,
      cccd: `0${rand(48, 49)}${rand(100000000, 999999999)}`,
      address: addr.address,
      ward: addr.ward,
      city: addr.city,
    });

    const numChildren = weightedPick(cfg.childrenWeights);
    for (let c = 0; c < numChildren; c++) {
      studentSeq++;
      const gender = genGender();
      const dob = genChildDob();
      const age = 2026 - dob.getUTCFullYear();
      const grade = gradeForAge(age);
      const childName = `${parentName.split(" ")[0]} ${genName(gender).split(" ").slice(1).join(" ")}`;
      const studentId = `slms-hv-${pad(studentSeq, 6)}`;

      students.push({
        id: studentId,
        name: childName,
        studentCode: `HV-${pad(studentSeq, 6)}`,
        dateOfBirth: dob,
        gender,
        currentGrade: grade,
        school: `Trường Tiểu học / THCS ${pick(["Trần Cao Vân", "Phù Đổng", "Nguyễn Văn Trỗi", "Huỳnh Thúc Kháng", "Lê Lợi"])}`,
        status: "ACTIVE",
        centerId,
        preferredCenterId: centerId,
        parentUserId,
        parentName,
        parentPhone,
        parentEmail,
        parentRelation,
        enrollmentDate: new Date(Date.UTC(2025, rand(0, 11), rand(1, 28))),
        ...genAddress(),
      });
      studentRecs.push({ id: studentId, centerId, grade });

      // Consent ảnh lớp: đa số GRANTED, ít REVOKED (để test ẩn ảnh với PH).
      consents.push({
        studentId,
        type: "CLASS_MEDIA",
        status: chance(0.85) ? "GRANTED" : "REVOKED",
      });
    }
  }

  await batchCreate("parents", parents, (b) => db.user.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("students", students, (b) => db.student.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("consents", consents, (b) => db.studentConsent.createMany({ data: b as never, skipDuplicates: true }), 1000);

  console.log(`✅ Parents/Students: ${parents.length} PH · ${students.length} HV · ${consents.length} consent`);
  return studentRecs;
}
