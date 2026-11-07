import { describe, it, expect } from "vitest";
import {
  getEmployeeFieldVisibility,
  redactEmployeeFields,
  stripHiddenEmployeeFields,
} from "./permissions";

// SEC-H04 — redact-khi-đọc + strip-khi-ghi phải KHỚP nhau và khớp visibility.
const fullEmployee = {
  id: "e1",
  fullName: "Nguyễn Văn A",
  employeeCode: "SR.NV.001",
  // contact
  email: "a@satarobo.vn",
  phone: "0900000000",
  // salary
  salaryRank: 5,
  salaryLevel: 3,
  bhxhBase: 5_000_000,
  // personal
  dateOfBirth: new Date("1990-01-01"),
  gender: "MALE",
  contractType: "FULL_TIME",
  managerId: "mgr1",
  endDate: null,
  nationalId: "012345678901",
  address: "Đà Nẵng",
  emergencyContact: "Mẹ - 0911",
  notes: "ghi chú HR",
};

describe("SEC-H04 employee field redaction", () => {
  it("SUPER_ADMIN: full visibility → không redact gì", () => {
    const vis = getEmployeeFieldVisibility("SUPER_ADMIN");
    const out = redactEmployeeFields(fullEmployee, vis);
    expect(out).toEqual(fullEmployee);
  });

  it("CENTER_MANAGER: giữ contact, redact salary + personal", () => {
    const vis = getEmployeeFieldVisibility("CENTER_MANAGER");
    expect(vis).toMatchObject({ contact: true, salary: false, personal: false });
    const out = redactEmployeeFields(fullEmployee, vis);
    // contact giữ nguyên
    expect(out.email).toBe("a@satarobo.vn");
    expect(out.phone).toBe("0900000000");
    // salary + personal null
    expect(out.salaryRank).toBeNull();
    expect(out.bhxhBase).toBeNull();
    expect(out.dateOfBirth).toBeNull();
    expect(out.nationalId).toBeNull();
    expect(out.managerId).toBeNull();
    expect(out.address).toBeNull();
    // basic không đổi
    expect(out.fullName).toBe("Nguyễn Văn A");
  });

  it("ACCOUNTANT: giữ salary, redact contact + personal", () => {
    const vis = getEmployeeFieldVisibility("ACCOUNTANT");
    expect(vis).toMatchObject({ contact: false, salary: true, personal: false });
    const out = redactEmployeeFields(fullEmployee, vis);
    expect(out.salaryRank).toBe(5);
    expect(out.email).toBeNull();
    expect(out.nationalId).toBeNull();
  });

  it("redact KHÔNG mutate input gốc", () => {
    const vis = getEmployeeFieldVisibility("CENTER_MANAGER");
    redactEmployeeFields(fullEmployee, vis);
    expect(fullEmployee.salaryRank).toBe(5); // gốc còn nguyên
  });

  it("strip-khi-ghi xoá đúng key nhóm bị ẩn (khớp redact)", () => {
    const vis = getEmployeeFieldVisibility("CENTER_MANAGER");
    const data: Record<string, unknown> = { ...fullEmployee };
    stripHiddenEmployeeFields(data, vis);
    // salary + personal bị xoá khỏi payload → Prisma giữ nguyên DB
    expect("salaryRank" in data).toBe(false);
    expect("bhxhBase" in data).toBe(false);
    expect("dateOfBirth" in data).toBe(false);
    expect("nationalId" in data).toBe(false);
    // contact còn (CM có quyền)
    expect("email" in data).toBe(true);
    expect("phone" in data).toBe(true);
    // basic còn
    expect("fullName" in data).toBe(true);
  });
});
