// lib/bao-luu/trang-thai.test.ts — máy trạng thái bảo lưu + lưới đối chiếu với migration/schema. PHIÊN 2.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHO_PHEP, TRANG_THAI_DONG, kiemChuyen, laTrangThaiMo, suyRaIsActive, type TrangThai } from "./trang-thai";

const TAT_CA = Object.keys(CHO_PHEP) as TrangThai[];

describe("[BL2-ST] máy trạng thái", () => {
  it("[BL2-ST-01] đường chính: PENDING → APPROVED → ACTIVE → RESUME_PENDING → ENDED", () => {
    const duong: TrangThai[] = ["PENDING", "APPROVED", "ACTIVE", "RESUME_PENDING", "ENDED"];
    for (let i = 0; i < duong.length - 1; i++) {
      expect(kiemChuyen(duong[i]!, duong[i + 1]!, "PARENT"), `${duong[i]}→${duong[i + 1]}`).toEqual({ ok: true });
    }
  });

  it("[BL2-ST-02] nhánh quá hạn: ACTIVE → OVERDUE → NOTICE_SENT → TERMINATED, và gia hạn quay về ACTIVE", () => {
    for (const [a, b] of [["ACTIVE", "OVERDUE"], ["OVERDUE", "NOTICE_SENT"], ["NOTICE_SENT", "TERMINATED"], ["OVERDUE", "ACTIVE"], ["NOTICE_SENT", "ACTIVE"]] as const) {
      expect(kiemChuyen(a, b, "PARENT").ok, `${a}→${b}`).toBe(true);
    }
  });

  it("[BL2-ST-03] BR-19: KHÔNG có đường tắt tới TERMINATED — chưa gửi thông báo chính thức thì không bao giờ tự chấm dứt", () => {
    const tuDau = TAT_CA.filter((t) => CHO_PHEP[t].includes("TERMINATED"));
    expect(tuDau).toEqual(["NOTICE_SENT"]);
    expect(kiemChuyen("OVERDUE", "TERMINATED", "PARENT").ok).toBe(false);
    expect(kiemChuyen("ACTIVE", "TERMINATED", "PARENT").ok).toBe(false);
  });

  it("[BL2-ST-04] trạng thái cuối (ENDED/REJECTED/CANCELLED) không đi đâu nữa; TERMINATED chỉ có cạnh RESTORE → ACTIVE", () => {
    for (const t of ["ENDED", "REJECTED", "CANCELLED"] as const) expect(CHO_PHEP[t], t).toEqual([]);
    expect(CHO_PHEP.TERMINATED).toEqual(["ACTIVE"]);
  });

  it("[BL2-ST-05] huỷ chỉ được trước ngày bắt đầu: PENDING/APPROVED → CANCELLED, ACTIVE → CANCELLED thì không", () => {
    expect(kiemChuyen("PENDING", "CANCELLED", "PARENT").ok).toBe(true);
    expect(kiemChuyen("APPROVED", "CANCELLED", "PARENT").ok).toBe(true);
    expect(kiemChuyen("ACTIVE", "CANCELLED", "PARENT").ok).toBe(false);
  });

  it("[BL2-ST-06] BR-23: loại CENTER không bao giờ vào OVERDUE/NOTICE_SENT/TERMINATED; loại PARENT/LEGACY thì có", () => {
    expect(kiemChuyen("ACTIVE", "OVERDUE", "CENTER").ok).toBe(false);
    expect(kiemChuyen("OVERDUE", "NOTICE_SENT", "CENTER").ok).toBe(false);
    expect(kiemChuyen("NOTICE_SENT", "TERMINATED", "CENTER").ok).toBe(false);
    for (const loai of ["PARENT", "LEGACY"] as const) expect(kiemChuyen("ACTIVE", "OVERDUE", loai).ok, loai).toBe(true);
    // CENTER vẫn phục học bình thường:
    expect(kiemChuyen("ACTIVE", "RESUME_PENDING", "CENTER").ok).toBe(true);
  });

  it("[BL2-ST-08] cùng trạng thái ⇒ từ chối (không có phép chuyển rỗng)", () => {
    for (const t of TAT_CA) expect(kiemChuyen(t, t, "PARENT").ok, t).toBe(false);
  });
});

describe("[BL2-ST] isActive suy ra từ status", () => {
  it("[BL2-ST-09] chỉ các trạng thái ĐANG NGHỈ mới isActive; APPROVED (chưa bắt đầu) và TERMINATED thì không", () => {
    const dung = TAT_CA.filter(suyRaIsActive).sort();
    expect(dung).toEqual(["ACTIVE", "NOTICE_SENT", "OVERDUE", "RESUME_PENDING"]);
    expect(suyRaIsActive("APPROVED")).toBe(false);
  });

  it("[BL2-ST-10] trạng thái đóng KHÔNG BAO GIỜ isActive; trạng thái mở nhưng chưa nghỉ (PENDING/APPROVED) cũng không", () => {
    for (const t of TRANG_THAI_DONG) expect(suyRaIsActive(t), t).toBe(false);
    expect(laTrangThaiMo("PENDING")).toBe(true);
    expect(suyRaIsActive("PENDING")).toBe(false);
  });
});

describe("[BL2-ST-07] đối chiếu với chỉ mục duy nhất từng phần trong migration", () => {
  it("TRANG_THAI_DONG khớp ĐÚNG vế `NOT IN (…)` của StudentReserve_enrollment_open_key", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "prisma/migrations/20261008150000_bao_luu_nen_du_lieu/migration.sql"),
      "utf8",
    );
    const khop = [...sql.matchAll(/"status" NOT IN \(([^)]*)\)/g)];
    expect(khop.length).toBeGreaterThanOrEqual(2); // một ở kiểm trùng, một ở chỉ mục
    for (const m of khop) {
      const trongSql = [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
      expect(trongSql).toEqual([...TRANG_THAI_DONG].sort());
    }
  });

  it("mọi trạng thái trong schema.prisma có mặt trong bảng CHO_PHEP (và ngược lại)", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8").replace(/\r\n/g, "\n");
    const khoi = /enum StudentReserveStatus \{([^}]*)\}/.exec(schema)?.[1] ?? "";
    const trongSchema = khoi.split("\n").map((l) => l.trim()).filter(Boolean).sort();
    expect(trongSchema).toEqual([...TAT_CA].sort());
  });
});
