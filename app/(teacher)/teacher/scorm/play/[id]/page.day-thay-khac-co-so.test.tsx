// @vitest-environment node
// [SCP-DT] Trang trình chiếu SCORM của site GV × GV DẠY THAY ở cơ sở KHÁC lớp. Chạy page THẬT + cổng canOpenScorm THẬT
// (lib/scorm/access.ts); chỉ giả lập tầng dữ liệu. `ClassSession` là model SCOPED: đọc qua scopedDb thì buổi của cơ sở khác
// KHÔNG thấy (giả lập ở đây bằng `sdb.classSession.findUnique → null`), còn đọc qua withMakeupException thì thấy — đúng như prod.
// Ca chặn: người không liên quan / dạy thay buổi KHÁC / buổi không đọc được vẫn bị đá về /teacher (fail-closed).
import { describe, it, expect, beforeEach, vi } from "vitest";

type Buoi = {
  actualTeacherId?: string | null;
  substituteTeacherId?: string | null;
  class?: { teacherId?: string | null; assistantId?: string | null } | null;
} | null;

const h = vi.hoisted(() => ({
  userId: "u-toi",
  // Buổi mà đường ĐỌC XUYÊN CƠ SỞ (withMakeupException) trả về, theo mã buổi.
  buoiXuyenCoSo: {} as Record<string, unknown>,
  // Buổi mà đường scopedDb thường thấy được (rỗng = buổi ở cơ sở khác ⇒ không thấy).
  buoiTrongScope: {} as Record<string, unknown>,
  goiXuyenCoSo: [] as { where: unknown; select: Record<string, unknown> }[],
  goiTrongScope: 0,
  lopCungGiaoTrinh: null as { id: string } | null,
  caBu: null as { id: string } | null,
  quyenDaoTao: false,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: h.userId, email: "gv@example.test" } }) }));
vi.mock("@/lib/auth/actor", () => ({
  resolveActor: async () => ({
    userId: h.userId,
    isSuperAdmin: false,
    permissions: h.quyenDaoTao
      ? [{ action: "training:manage", scopeType: "GLOBAL", orgUnitId: "o", roleCode: "R", centerScope: null }]
      : [],
    grantsAllow: new Set<string>(),
  }),
}));
vi.mock("@/lib/security/client-ip", () => ({ ipKhachHang: () => "203.0.113.9" }));
vi.mock("@/lib/flags", () => ({ isScormEnabled: () => true }));
vi.mock("@/lib/scorm/dem-dia", () => ({ lamNongGoi: async () => undefined }));
vi.mock("@/lib/scorm/ticket", () => ({ signScormTicket: () => "ve-gia" }));
vi.mock("@/components/admin/scorm-player", () => ({ ScormPlayer: () => null }));
vi.mock("@/components/admin/pdf-slide-player", () => ({ PdfSlidePlayer: () => null }));

vi.mock("@/lib/db-scope", () => {
  const goc = {
    scormPackage: {
      findUnique: async () => ({
        id: "goi-1",
        kind: "SCORM",
        name: "Bài 1",
        lessonId: "bai-1",
        launchUrl: "res/index.html",
        status: "PUBLISHED",
        storagePrefix: "scorm/goi-1/",
        lesson: { curriculumId: "gt-1", curriculum: { courseId: "khoa-1" } },
      }),
    },
    user: { findUnique: async () => ({ name: "GV", employee: { employeeCode: "NV1", fullName: "Giáo viên" } }) },
    scormAttempt: { findFirst: async () => null },
    scormAccessLog: { create: async () => ({}) },
    class: { findFirst: async () => h.lopCungGiaoTrinh },
    makeupCase: { findFirst: async () => h.caBu },
  };
  return {
    actorGiangDay: (a: unknown) => a,
    scopedDb: () => ({
      ...goc,
      classSession: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          h.goiTrongScope++;
          return h.buoiTrongScope[where.id] ?? null;
        },
      },
    }),
    withMakeupException: () => ({
      classSession: {
        findUnique: async (args: { where: { id: string }; select: Record<string, unknown> }) => {
          h.goiXuyenCoSo.push({ where: args.where, select: args.select });
          return (h.buoiXuyenCoSo[args.where.id] as Buoi) ?? null;
        },
      },
    }),
  };
});

import TeacherScormPlayPage from "./page";

const MA_BUOI = "buoi-cs2";
const chay = (sessionId: string | undefined = MA_BUOI) =>
  TeacherScormPlayPage({
    params: Promise.resolve({ id: "goi-1" }),
    searchParams: Promise.resolve({ sessionId }),
  });
// Lớp ở cơ sở KHÁC người dùng: GV chính/trợ giảng là người khác.
const lopCs2 = { teacherId: "gv-chinh-cs2", assistantId: "tg-cs2" };

beforeEach(() => {
  h.userId = "u-toi";
  h.buoiXuyenCoSo = {};
  h.buoiTrongScope = {}; // buổi của cơ sở khác ⇒ scopedDb KHÔNG thấy
  h.goiXuyenCoSo = [];
  h.goiTrongScope = 0;
  h.lopCungGiaoTrinh = null;
  h.caBu = null;
  h.quyenDaoTao = false;
});

describe("[SCP-DT] /teacher/scorm/play × GV dạy thay ở cơ sở khác", () => {
  it("[SCP-DT01] dạy thay đúng buổi, lớp ở cơ sở KHÁC (scopedDb không thấy buổi) ⇒ MỞ ĐƯỢC (không redirect)", async () => {
    h.buoiXuyenCoSo[MA_BUOI] = { actualTeacherId: null, substituteTeacherId: "u-toi", class: lopCs2 };
    const out = (await chay()) as { props: { classSessionId: string | null; packageId: string } };
    expect(out.props.packageId).toBe("goi-1");
    expect(out.props.classSessionId).toBe(MA_BUOI);
    // Buổi được đọc xuyên cơ sở THEO ĐÚNG MÃ BUỔI và chỉ lấy cột người dạy (không lộ thêm gì).
    expect(h.goiXuyenCoSo).toHaveLength(1);
    expect(h.goiXuyenCoSo[0]!.where).toEqual({ id: MA_BUOI });
    expect(Object.keys(h.goiXuyenCoSo[0]!.select).sort()).toEqual(["actualTeacherId", "class", "substituteTeacherId"]);
    // Đường scopedDb thường KHÔNG còn được dùng để đọc buổi (nếu dùng, ca này đã bị đá về /teacher).
    expect(h.goiTrongScope).toBe(0);
  });

  it("[SCP-DT03] GV chính của lớp ⇒ mở được", async () => {
    h.userId = "gv-chinh-cs2";
    h.buoiXuyenCoSo[MA_BUOI] = { class: lopCs2 };
    await expect(chay()).resolves.toBeDefined();
  });

  it("[SCP-DT04] trợ giảng của lớp ⇒ mở được", async () => {
    h.userId = "tg-cs2";
    h.buoiXuyenCoSo[MA_BUOI] = { class: lopCs2 };
    await expect(chay()).resolves.toBeDefined();
  });

  it("[SCP-DT05] GV thực dạy buổi (actualTeacherId) ⇒ mở được", async () => {
    h.userId = "thuc-day";
    h.buoiXuyenCoSo[MA_BUOI] = { actualTeacherId: "thuc-day", class: lopCs2 };
    await expect(chay()).resolves.toBeDefined();
  });

  it("[SCP-DT06] dạy thay cùng cơ sở (scopedDb thấy buổi) vẫn mở được — không phụ thuộc đường scopedDb", async () => {
    h.buoiXuyenCoSo[MA_BUOI] = { substituteTeacherId: "u-toi", class: lopCs2 };
    h.buoiTrongScope[MA_BUOI] = h.buoiXuyenCoSo[MA_BUOI];
    await expect(chay()).resolves.toBeDefined();
  });

  it("[SCP-DT07] DENY: buổi này xếp NGƯỜI KHÁC dạy thay, mình không liên quan ⇒ đá về /teacher", async () => {
    h.buoiXuyenCoSo[MA_BUOI] = { substituteTeacherId: "nguoi-khac", class: lopCs2 };
    await expect(chay()).rejects.toThrow("REDIRECT:/teacher");
  });

  it("[SCP-DT08] DENY: dạy thay buổi KHÁC thì không mở được buổi này (quyền không lan sang buổi/lớp khác)", async () => {
    h.buoiXuyenCoSo["buoi-A"] = { substituteTeacherId: "u-toi", class: lopCs2 };
    h.buoiXuyenCoSo["buoi-B"] = { substituteTeacherId: "nguoi-khac", class: lopCs2 };
    await expect(chay("buoi-A")).resolves.toBeDefined();
    await expect(chay("buoi-B")).rejects.toThrow("REDIRECT:/teacher");
  });

  it("[SCP-DT09] DENY: GV không liên quan (không phải GV/trợ giảng/thực dạy/dạy thay, không dạy lớp cùng giáo trình, không case bù) ⇒ /teacher", async () => {
    h.buoiXuyenCoSo[MA_BUOI] = { actualTeacherId: "a", substituteTeacherId: "b", class: lopCs2 };
    await expect(chay()).rejects.toThrow("REDIRECT:/teacher");
  });

  it("[SCP-DT10] DENY (fail-closed): buổi không tồn tại / không đọc được ⇒ classSession rỗng ⇒ /teacher", async () => {
    await expect(chay("khong-co")).rejects.toThrow("REDIRECT:/teacher");
  });

  it("[SCP-DT11] không có sessionId: không đọc buổi nào; người không có quyền đào tạo ⇒ /teacher (hành vi cũ giữ nguyên)", async () => {
    await expect(chay("")).rejects.toThrow("REDIRECT:/teacher");
    expect(h.goiXuyenCoSo).toHaveLength(0);
  });

  it("[SCP-DT12] quyền Đào tạo (training:manage) vẫn mở được dù không thuộc buổi — không bị đổi", async () => {
    h.quyenDaoTao = true;
    h.buoiXuyenCoSo[MA_BUOI] = { class: lopCs2 };
    await expect(chay()).resolves.toBeDefined();
  });
});
