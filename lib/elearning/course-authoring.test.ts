// @vitest-environment node
/**
 * EL-08 — action soạn khoá, chạy qua `runAction` thật.
 *
 * Ticket này chở **chỉ số cổng GĐ1**: *"Trưởng phòng Đào tạo tự tạo trọn một khoá
 * đầu-cuối trong ≤60 phút, 0 lần nhờ lập trình viên"*. Nên case nào ở đây cũng
 * quy về một câu hỏi: thao tác này có thất bại theo kiểu khiến người soạn phải đi
 * gọi lập trình viên không?
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  audit: vi.fn(async () => undefined),
  khoa: { id: "c1", code: "K.001", title: "Khoá A", status: "DRAFT", programId: null } as unknown,
  banNhap: null as unknown,
  banMoiNhat: null as unknown,
  taoBan: vi.fn(async (_a: { data: Record<string, unknown> }) => ({
    id: "v1",
    major: 1,
    minor: 0,
    status: "DRAFT",
  })),
  capNhatBan: vi.fn(async (_a: { where: unknown; data: Record<string, unknown> }) => ({})),
  capNhatKhoa: vi.fn(async (_a: { where: unknown; data: Record<string, unknown> }) => ({})),
  modules: [] as unknown[],
  lessons: [] as unknown[],
  links: [] as unknown[],
  suaChuong: vi.fn(async (_a: { where: { id: string }; data: { orderIndex: number } }) => ({})),
  suaBai: vi.fn(async (_a: { where: { id: string }; data: { orderIndex: number } }) => ({})),
  upsertLink: vi.fn(async (_a: { where: unknown; update: Record<string, unknown> }) => ({})),
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));

const tx = {
  trnModule: { update: h.suaChuong },
  trnLesson: { update: h.suaBai },
  trnCourseVersion: { update: h.capNhatBan },
  trnCourse: { update: h.capNhatKhoa },
};

vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    trnCourse: { findFirst: vi.fn(async () => h.khoa), update: h.capNhatKhoa },
    trnCourseVersion: {
      findFirst: vi.fn(async (a: { where: { status?: unknown } }) =>
        JSON.stringify(a.where).includes("DRAFT") && !JSON.stringify(a.where).includes("in")
          ? h.banNhap
          : (h.banNhap ?? h.banMoiNhat),
      ),
      create: h.taoBan,
      update: h.capNhatBan,
    },
    trnCourseVersionLesson: {
      findMany: vi.fn(async () => h.links),
      upsert: h.upsertLink,
      create: vi.fn(async () => ({})),
    },
    trnModule: {
      findMany: vi.fn(async () => h.modules),
      findFirst: vi.fn(async () => h.modules[0] ?? null),
      update: h.suaChuong,
    },
    trnLesson: {
      findMany: vi.fn(async () => h.lessons),
      findFirst: vi.fn(async () => h.lessons[0] ?? null),
      update: h.suaBai,
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  }),
}));

import { runAction } from "@/lib/actions/factory";
import {
  cauHinhSapThuTu,
  cauHinhDatBatBuoc,
  cauHinhVongDoiKhoa,
} from "@/lib/elearning/course-authoring";

const ACTOR = {
  userId: "u-dt",
  isSuperAdmin: false,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
} as unknown as Parameters<typeof runAction>[1];

beforeEach(() => {
  h.can.mockReturnValue(true);
  h.khoa = { id: "c1", code: "K.001", title: "Khoá A", status: "DRAFT", programId: null };
  h.banNhap = { id: "v1", major: 1, minor: 0, status: "DRAFT" };
  h.banMoiNhat = null;
  h.modules = [];
  h.lessons = [];
  h.links = [];
  h.suaChuong.mockClear();
  h.suaBai.mockClear();
  h.capNhatBan.mockClear();
  h.capNhatKhoa.mockClear();
  h.upsertLink.mockClear();
});

describe("kéo thả — HAI PHA, vì khoá duy nhất chặn ngang giữa chừng", () => {
  it("ghi đủ hai lượt cho MỌI phần tử, không chỉ phần tử đổi chỗ", async () => {
    // Ghi thẳng số mới sẽ va `@@unique([courseId, orderIndex])` ngay bước đầu.
    // Thao tác kéo thả thất bại với một lỗi khó hiểu → người soạn gọi lập trình viên.
    h.modules = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { res } = await runAction(
      cauHinhSapThuTu,
      ACTOR,
      { loai: "CHUONG", parentId: "c1", id: "c", viTriMoi: 0 },
      { actorName: "Đào tạo" },
    );
    expect(res.ok).toBe(true);
    expect(h.suaChuong).toHaveBeenCalledTimes(6);
  });

  it("pha đầu toàn số ÂM, pha sau toàn số không âm", async () => {
    h.modules = [{ id: "a" }, { id: "b" }, { id: "c" }];
    await runAction(
      cauHinhSapThuTu,
      ACTOR,
      { loai: "CHUONG", parentId: "c1", id: "c", viTriMoi: 0 },
      { actorName: "Đào tạo" },
    );
    const so = h.suaChuong.mock.calls.map((c) => c[0].data.orderIndex);
    expect(so.slice(0, 3).every((x) => x < 0)).toBe(true);
    expect(so.slice(3).every((x) => x >= 0)).toBe(true);
  });

  it("thứ tự mới trả về đúng", async () => {
    h.modules = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { res } = await runAction(
      cauHinhSapThuTu,
      ACTOR,
      { loai: "CHUONG", parentId: "c1", id: "c", viTriMoi: 0 },
      { actorName: "Đào tạo" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.thuTu).toEqual(["c", "a", "b"]);
  });

  it("sắp BÀI thì đụng bảng bài, không đụng bảng chương", async () => {
    h.lessons = [{ id: "x" }, { id: "y" }];
    await runAction(
      cauHinhSapThuTu,
      ACTOR,
      { loai: "BAI", parentId: "m1", id: "y", viTriMoi: 0 },
      { actorName: "Đào tạo" },
    );
    expect(h.suaBai).toHaveBeenCalled();
    expect(h.suaChuong).not.toHaveBeenCalled();
  });
});

describe("bắt buộc / tuỳ chọn ghi lên BẢN NHÁP", () => {
  it("sửa cờ đi qua `TrnCourseVersionLesson` của bản nháp", async () => {
    // Cờ nằm trên bài thì mọi phiên bản dùng chung một câu trả lời — xoá luôn lý
    // do tồn tại của phiên bản.
    const { res } = await runAction(
      cauHinhDatBatBuoc,
      ACTOR,
      { courseId: "c1", lessonId: "b1", required: false },
      { actorName: "Đào tạo" },
    );
    expect(res.ok).toBe(true);
    expect(h.upsertLink.mock.calls[0]?.[0].update).toEqual({ required: false });
  });
});

describe("vòng đời xuất bản", () => {
  const danBaiDu = () => {
    h.modules = [
      {
        id: "m1",
        title: "Chương 1",
        lessons: [{ id: "b1", title: "Bài 1", kind: "READ", contentMd: "Nội dung" }],
      },
    ];
    h.links = [{ lessonId: "b1", required: true }];
  };

  const di = (hanhDong: string, reason: string | null = "Đợt tháng 9") =>
    runAction(cauHinhVongDoiKhoa, ACTOR, { courseId: "c1", hanhDong }, {
      actorName: "Đào tạo",
      reason,
    });

  it("dàn bài đủ ⇒ gửi duyệt được", async () => {
    danBaiDu();
    const { res } = await di("GUI_DUYET");
    expect(res.ok).toBe(true);
    expect(h.capNhatBan.mock.calls[0]?.[0].data.status).toBe("PENDING_REVIEW");
  });

  it("chương RỖNG ⇒ chặn ngay ở gửi duyệt, và trả về danh sách lỗi", async () => {
    h.modules = [{ id: "m1", title: "Chương 1", lessons: [] }];
    const { res } = await di("GUI_DUYET");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("CAN_DAN_BAI_HOP_LE");
    expect(h.capNhatBan).not.toHaveBeenCalled();
  });

  it("không bài nào bắt buộc ⇒ chặn", async () => {
    h.modules = [
      {
        id: "m1",
        title: "C1",
        lessons: [{ id: "b1", title: "B1", kind: "READ", contentMd: "x" }],
      },
    ];
    h.links = [{ lessonId: "b1", required: false }];
    const { res } = await di("GUI_DUYET");
    expect(res.ok).toBe(false);
  });

  it("XUẤT BẢN cũng đổi trạng thái KHOÁ, không chỉ phiên bản", async () => {
    // Khoá còn DRAFT thì nó không hiện ở màn giao bài — người soạn xuất bản xong
    // vẫn không giao được, và không hiểu vì sao.
    danBaiDu();
    h.banNhap = { id: "v1", major: 1, minor: 0, status: "APPROVED" };
    const { res } = await di("XUAT_BAN");
    expect(res.ok).toBe(true);
    expect(h.capNhatKhoa.mock.calls[0]?.[0].data.status).toBe("PUBLISHED");
  });

  it("bắt buộc nhập lý do", async () => {
    danBaiDu();
    const { res } = await di("GUI_DUYET", null);
    expect(res.ok).toBe(false);
    expect(h.capNhatBan).not.toHaveBeenCalled();
  });

  it("thiếu quyền XUẤT BẢN ⇒ từ chối", async () => {
    // Quyền xuất bản KHÁC quyền soạn: người soạn không tự quyết được lúc nào nội
    // dung của mình đi ra với cả công ty.
    danBaiDu();
    h.can.mockReturnValue(false);
    const { res } = await di("GUI_DUYET");
    expect(res.ok).toBe(false);
  });
});

/**
 * [VID-LC] CỔNG NGUỒN VIDEO ĐI QUA ĐÚNG BA BƯỚC CỦA VÒNG ĐỜI — GUI_DUYET, DUYET, XUAT_BAN.
 *
 * Cổng `BAI_VIDEO_CHUA_CO_NGUON` nằm trong `kiemDanBai`, còn `chuyenTrangThai` chỉ nhận một cờ
 * `danBaiHopLe`. Test thuần của từng hàm xanh dù dây nối giữa chúng đứt; đây là ca chạy qua
 * `runAction` thật cho CẢ BA hành động, mỗi hành động từ đúng trạng thái xuất phát của nó.
 *
 * Mỗi ca "bị chặn" đi cặp với một ca "qua được" CÙNG fixture, chỉ khác đúng một trường nguồn —
 * để việc bị chặn chỉ có thể do cổng video, không do thiếu chương/thiếu bài bắt buộc.
 */
describe("[VID-LC] vòng đời với bài VIDEO — nguồn là điều kiện qua cổng", () => {
  type Bai = Record<string, unknown>;
  const dungDanBai = (bai: Bai) => {
    h.modules = [
      {
        id: "m1",
        title: "Chương 1",
        lessons: [{ id: "bv", title: "Bài video", kind: "VIDEO", contentMd: null, ...bai }],
      },
    ];
    h.links = [{ lessonId: "bv", required: true }];
  };
  /** Ba hành động có cổng, mỗi cái từ trạng thái xuất phát hợp lệ của nó. */
  const BA_BUOC = [
    ["GUI_DUYET", "DRAFT", "PENDING_REVIEW"],
    ["DUYET", "PENDING_REVIEW", "APPROVED"],
    ["XUAT_BAN", "APPROVED", "PUBLISHED"],
  ] as const;
  /**
   * ⚠️ Khoá phải GẮN CHƯƠNG TRÌNH. Khoá chưa gắn mà có bài video bị `kiemPhuDe` chặn
   * (`CHUA_BIET_KHOA_CO_BAT_BUOC`) — fixture dựng thiếu chương trình thì MỌI ca "qua được" đỏ vì lý do
   * không liên quan tới nguồn video (đúng thứ đã xảy ra ở lượt viết đầu tiên của bộ này).
   */
  const datChuongTrinh = (natureTag: string) => {
    h.khoa = { id: "c1", code: "K.001", title: "Khoá A", status: "DRAFT", programId: "p1", program: { natureTag } };
  };
  beforeEach(() => datChuongTrinh("OPTIONAL"));
  const di = (hanhDong: string, tu: string) => {
    h.banNhap = { id: "v1", major: 1, minor: 0, status: tu };
    return runAction(cauHinhVongDoiKhoa, ACTOR, { courseId: "c1", hanhDong }, {
      actorName: "Đào tạo",
      reason: "Đợt tháng 10",
    });
  };

  const NGUON_HOP_LE: [string, Bai][] = [
    ["MP4 (videoKey + thời lượng)", { videoKey: "elearning/master/bv/a.mp4", durationSec: 19 }],
    ["YouTube (youtubeId + thời lượng)", { youtubeId: "dQw4w9WgXcQ", youtubePhuDe: true, durationSec: 19 }],
  ];
  const NGUON_HONG: [string, Bai][] = [
    ["không có nguồn nào", { durationSec: 19 }],
    ["videoKey rỗng", { videoKey: "", durationSec: 19 }],
    ["youtubeId toàn khoảng trắng", { youtubeId: "   ", durationSec: 19 }],
    ["có nguồn MP4 nhưng thiếu thời lượng", { videoKey: "elearning/master/bv/a.mp4", durationSec: null }],
    ["có nguồn YouTube nhưng thời lượng 0", { youtubeId: "dQw4w9WgXcQ", durationSec: 0 }],
  ];

  for (const [hanhDong, tu, toi] of BA_BUOC) {
    for (const [ten, bai] of NGUON_HOP_LE) {
      it(`${hanhDong}: bài VIDEO có ${ten} ⇒ QUA, version sang ${toi}`, async () => {
        dungDanBai(bai);
        const { res } = await di(hanhDong, tu);
        expect(res.ok).toBe(true);
        expect(h.capNhatBan.mock.calls[0]?.[0].data.status).toBe(toi);
      });
    }
    for (const [ten, bai] of NGUON_HONG) {
      it(`${hanhDong}: bài VIDEO ${ten} ⇒ CHẶN, không ghi version`, async () => {
        dungDanBai(bai);
        const { res } = await di(hanhDong, tu);
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error.code).toBe("CAN_DAN_BAI_HOP_LE");
        expect(h.capNhatBan).not.toHaveBeenCalled();
        expect(h.capNhatKhoa).not.toHaveBeenCalled();
      });
    }
  }

  describe("khoá BẮT BUỘC: phụ đề là điều kiện, và với YouTube nó là LỜI XÁC NHẬN của người soạn", () => {
    const CA: [string, Bai, boolean][] = [
      ["MP4 có nguồn + có phụ đề (captionKey)", { videoKey: "elearning/master/bv/a.mp4", captionKey: "elearning/caption/bv/vi.vtt", durationSec: 19 }, true],
      ["MP4 có nguồn, THIẾU phụ đề", { videoKey: "elearning/master/bv/a.mp4", durationSec: 19 }, false],
      ["YouTube + người soạn xác nhận phụ đề", { youtubeId: "dQw4w9WgXcQ", youtubePhuDe: true, durationSec: 19 }, true],
      ["YouTube, CHƯA xác nhận phụ đề", { youtubeId: "dQw4w9WgXcQ", youtubePhuDe: false, durationSec: 19 }, false],
    ];
    for (const [hanhDong, tu] of BA_BUOC) {
      for (const [ten, bai, qua] of CA) {
        it(`${hanhDong}: ${ten} ⇒ ${qua ? "QUA" : "CHẶN"}`, async () => {
          datChuongTrinh("MANDATORY");
          dungDanBai(bai);
          const { res } = await di(hanhDong, tu);
          expect(res.ok).toBe(qua);
          if (!qua) expect(h.capNhatBan).not.toHaveBeenCalled();
        });
      }
    }
  });

  it("khoá TRỘN: một bài ĐỌC hợp lệ không che được một bài VIDEO thiếu nguồn", async () => {
    h.modules = [
      {
        id: "m1",
        title: "Chương 1",
        lessons: [
          { id: "b1", title: "Bài đọc", kind: "READ", contentMd: "Nội dung" },
          { id: "bv", title: "Bài video", kind: "VIDEO", contentMd: null, durationSec: 19 },
        ],
      },
    ];
    h.links = [
      { lessonId: "b1", required: true },
      { lessonId: "bv", required: true },
    ];
    const { res } = await di("GUI_DUYET", "DRAFT");
    expect(res.ok).toBe(false);
    expect(h.capNhatBan).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG: TRA_LAI không đòi nguồn video (bị chặn ở đây là chặn nhầm đường lùi)", async () => {
    // Trả lại về nháp là đường để người soạn SỬA bài thiếu nguồn — gác cổng ở đó là tự khoá lối ra.
    dungDanBai({ durationSec: 19 });
    const { res } = await di("TRA_LAI", "PENDING_REVIEW");
    expect(res.ok).toBe(true);
    expect(h.capNhatBan.mock.calls[0]?.[0].data.status).toBe("DRAFT");
  });
});
