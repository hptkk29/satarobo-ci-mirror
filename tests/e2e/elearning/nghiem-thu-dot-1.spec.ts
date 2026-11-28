/**
 * [UAT-DOT1] Quét NGHIỆM THU ĐỢT 1 trên MỘT SERVER ĐANG CHẠY với DB local riêng đã dựng dữ liệu (`scripts/elearning-uat-seed.ts`).
 *
 * KHÔNG phải một ca của cổng CI: bỏ qua toàn bộ nếu không đặt `UAT_JSON`. Với mỗi (vai trò × route) nó mở trang ở BA chế độ — desktop 1280×800 · điện thoại 375×800 · tối —
 * khẳng định: trang trả nội dung (không "Application error"/500/trang trắng), có `h1`, KHÔNG tràn ngang, các chuỗi bắt buộc có mặt; rồi CHỤP ảnh. Kết quả ghi ra `UAT_KQ` (JSON).
 * Cuối cùng chạy các ca ÂM về phân quyền (nhân viên không vào được màn quản trị, tài khoản không hồ sơ / đã nghỉ bị chặn).
 *
 *   ELEARNING_SKIP_WEBSERVER=1 BASE_URL=http://localhost:3150 UAT_JSON=E:/tmp/uat/uat-du-lieu.json UAT_ANH=E:/tmp/uat/anh UAT_KQ=E:/tmp/uat/ketqua.json \
 *     pnpm exec playwright test -c playwright.elearning.config.ts nghiem-thu-dot-1 --project=elearning
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { login } from "../_helpers/auth";

const JSON_PATH = process.env.UAT_JSON ?? "";
test.skip(!JSON_PATH, "đặt UAT_JSON (đầu ra của scripts/elearning-uat-seed.ts) để quét nghiệm thu");
test.describe.configure({ mode: "serial" });

type Du = {
  taiKhoan: Record<"nhanVien" | "daoTao" | "khongHoSo" | "daNghi", { email: string }>;
  khoaChinh: { courseId: string; enrollmentId: string; baiDocId: string; baiBuoiId: string; assignmentId: string };
  khoaDuyet: { duyetId: string; nhapId: string };
  chungNhan: { maSapHet: string; maHocLai: string; maNguoiKhac: string; tokenCongKhai: string };
  khoaTheoTab: { enrollmentDaXongId: string };
  chuyenBai: { baiThiId: string; enrollmentId: string };
  baiTap: { lessonId: string; enrollmentId: string };
  soanThu: { courseId: string; doc: string; video: string; quiz: string; task: string; live: string };
};
const D: Du = JSON_PATH ? (JSON.parse(readFileSync(JSON_PATH, "utf8")) as Du) : ({} as Du);
const ANH = process.env.UAT_ANH ?? "E:/tmp/uat/anh";
const KQ = process.env.UAT_KQ ?? "E:/tmp/uat/ketqua.json";

/** `anTheoCo`: route nằm sau cờ tính năng MẶC ĐỊNH TẮT — kỳ vọng là 404 (và không hiện trên menu), không phải "đạt" vì có h1. */
type Muc = { id: string; vai: "nhanVien" | "daoTao"; ten: string; duong: string; co?: (string | RegExp)[]; anTheoCo?: boolean };
const nv = (id: string, ten: string, duong: string, co?: Muc["co"]): Muc => ({ id, vai: "nhanVien", ten, duong, co });
const qt = (id: string, ten: string, duong: string, co?: Muc["co"]): Muc => ({ id, vai: "daoTao", ten, duong, co });

const MUC: Muc[] = [
  nv("NV-01", "Tổng quan", "/elearning", ["Học tập của tôi"]),
  nv("NV-02", "Khoá của tôi · cần làm", "/elearning/khoa-cua-toi", ["Cần làm"]),
  nv("NV-03", "Khoá của tôi · quá hạn", "/elearning/khoa-cua-toi?tab=qua-han", ["Quá hạn"]),
  nv("NV-04", "Khoá của tôi · đã xong", "/elearning/khoa-cua-toi?tab=da-xong", ["Đã xong"]),
  nv("NV-05", "Đề cương khoá", `/elearning/hoc/${D.khoaChinh?.enrollmentId}`),
  nv("NV-06", "Học bài (cổng xác nhận chính sách)", `/elearning/hoc/${D.khoaChinh?.enrollmentId}/${D.khoaChinh?.baiDocId}`),
  nv("NV-07", "Chứng nhận của tôi", "/elearning/chung-nhan-cua-toi"),
  nv("NV-08", "Xem chứng nhận", `/elearning/chung-nhan-cua-toi/${D.chungNhan?.maSapHet}`),
  nv("NV-09", "Dữ liệu của tôi", "/elearning/du-lieu-cua-toi"),
  nv("NV-10", "Chính sách theo dõi", "/elearning/du-lieu-cua-toi/chinh-sach"),
  nv("NV-11", "Thông báo", "/elearning/thong-bao"),
  nv("NV-12", "Đề nghị đào tạo", "/elearning/de-nghi"),
  nv("NV-13", "Tìm kiếm", "/elearning/tim-kiem"),
  nv("NV-14", "Xác minh chứng nhận (công khai)", `/xac-thuc/${D.chungNhan?.tokenCongKhai}`),
  qt("QT-01", "Tổng quan Đào tạo", "/elearning/dao-tao"),
  qt("QT-02", "Soạn khoá · danh sách", "/elearning/soan-khoa"),
  qt("QT-03", "Soạn khoá · tab chờ duyệt", "/elearning/soan-khoa?tab=cho-duyet"),
  qt("QT-04", "Soạn khoá · dàn bài (QtSoanKhoa)", `/elearning/soan-khoa/${D.khoaDuyet?.duyetId}`, ["Vòng đời khoá"]),
  qt("QT-05", "Duyệt khoá", `/elearning/soan-khoa/${D.khoaDuyet?.duyetId}/duyet`),
  qt("QT-06", "Soạn bài đọc (QtSoanDoc)", `/elearning/soan/${D.soanThu?.doc}`, ["Lưu bài", "Xem trước"]),
  qt("QT-07", "Soạn bài video", `/elearning/soan/${D.soanThu?.video}`),
  qt("QT-08", "Soạn bài kiểm tra", `/elearning/soan/${D.soanThu?.quiz}`, ["Đề thi"]),
  qt("QT-09", "Soạn bài tập", `/elearning/soan/${D.soanThu?.task}`, ["Khung chấm"]),
  qt("QT-10", "Soạn buổi trực tiếp", `/elearning/soan/${D.soanThu?.live}`, ["Điểm danh"]),
  qt("QT-11", "Giao khoá · trình giao 4 bước", "/elearning/giao-bai"),
  qt("QT-11b", "Lượt giao · danh sách (QtLuotGiao)", "/elearning/luot-giao"),
  qt("QT-12", "Chi tiết lượt giao", `/elearning/giao-bai/${D.khoaChinh?.assignmentId}`),
  qt("QT-13", "Chương trình", "/elearning/chuong-trinh"),
  qt("QT-14", "Yêu cầu đào tạo", "/elearning/yeu-cau"),
  qt("QT-15", "Kho câu hỏi", "/elearning/kho-cau-hoi"),
  qt("QT-16", "Đề thi", "/elearning/de-thi"),
  qt("QT-17", "Khung chấm", "/elearning/khung-cham"),
  qt("QT-18", "Chấm bài thi tự luận", "/elearning/cham-bai"),
  qt("QT-19", "Chấm bài tập", "/elearning/cham-bai-tap"),
  qt("QT-20", "Báo cáo tuân thủ", "/elearning/bao-cao"),
  qt("QT-21", "Báo cáo xem video", "/elearning/bao-cao/video"),
  qt("QT-22", "Chứng nhận đã cấp", "/elearning/chung-nhan"),
  qt("QT-23", "Ma trận đào tạo", "/elearning/ma-tran"),
  { ...qt("QT-24", "Mức gắn đánh giá (ẨN THEO CỜ ELEARNING_EVAL_LINK_ENABLED)", "/elearning/muc-danh-gia"), anTheoCo: true },
  qt("QT-25", "Tự động hoá", "/elearning/tu-dong-hoa"),
];

const CHE_DO = [
  { ten: "desktop", w: 1280, h: 800, mau: "light" as const },
  { ten: "mobile", w: 375, h: 800, mau: "light" as const },
  { ten: "dark", w: 1280, h: 800, mau: "dark" as const },
];

type KetQua = { id: string; vai: string; ten: string; duong: string; cheDo: string; ok: boolean; loi: string[]; h1: string; anh: string };
const ketQua: KetQua[] = [];
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  mkdirSync(ANH, { recursive: true });
  for (const vai of ["nhanVien", "daoTao"] as const) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email: D.taiKhoan[vai].email, callbackUrl: "/elearning" });
    cookie.set(vai, await ctx.cookies());
    await ctx.close();
  }
});

test.afterAll(async () => {
  writeFileSync(KQ, JSON.stringify(ketQua, null, 2), "utf8");
});

async function mo(page: Page, vai: string, duong: string, che: (typeof CHE_DO)[number]) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie.get(vai)!);
  await page.setViewportSize({ width: che.w, height: che.h });
  await page.emulateMedia({ colorScheme: che.mau });
  await page.goto(duong);
  await page.locator("[data-elearning-theme], main, body").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

for (const m of MUC) {
  test(`[${m.id}] ${m.ten} — ${m.duong.replace(/[a-z0-9]{20,}/g, "…")}`, async ({ page }) => {
    for (const che of CHE_DO) {
      const loi: string[] = [];
      let h1 = "";
      const anh = join(ANH, `${m.vai}-${m.id}-${che.ten}.png`);
      try {
        await mo(page, m.vai, m.duong, che);
        const thanTrang = (await page.locator("body").innerText()).trim();
        if (thanTrang.length < 20) loi.push("trang trắng / gần như không có nội dung");
        if (/Application error|Internal Server Error|Unhandled Runtime Error|This page couldn.t load/i.test(thanTrang)) loi.push("trang báo lỗi máy chủ");
        h1 = (await page.locator("h1").first().innerText().catch(() => "")).trim();
        const la404 = /robot lạc đường|404/i.test(thanTrang) && /lạc đường/i.test(thanTrang);
        if (m.anTheoCo) {
          if (!la404) loi.push("route ẩn theo cờ nhưng KHÔNG trả 404 (lộ ra khi cờ tắt)");
        } else {
          if (la404) loi.push("trả trang 404");
          if (!h1) loi.push("không có h1");
        }
        for (const c of m.co ?? []) {
          const thay = typeof c === "string" ? thanTrang.includes(c) : c.test(thanTrang);
          if (!thay) loi.push(`thiếu chuỗi: ${String(c)}`);
        }
        const tran = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (tran > 1) loi.push(`tràn ngang ${tran}px`);
        await page.screenshot({ path: anh, fullPage: false });
      } catch (e) {
        loi.push(`ngoại lệ: ${(e as Error).message.split("\n")[0]}`);
      }
      ketQua.push({ id: m.id, vai: m.vai, ten: m.ten, duong: m.duong, cheDo: che.ten, ok: loi.length === 0, loi, h1, anh });
    }
    const hong = ketQua.filter((k) => k.id === m.id && !k.ok);
    expect(hong.map((k) => `${k.cheDo}: ${k.loi.join("; ")}`), `${m.id} ${m.ten}`).toEqual([]);
  });
}

test.describe("[UAT-ÂM] phân quyền & tài khoản bị chặn", () => {
  test("[AM-01] nhân viên (không có quyền soạn) mở màn Soạn khoá ⇒ bị từ chối, KHÔNG thấy dàn bài", async ({ page }) => {
    await mo(page, "nhanVien", `/elearning/soan-khoa/${D.khoaDuyet.duyetId}`, CHE_DO[0]!);
    await page.screenshot({ path: join(ANH, "nhanVien-AM-01-desktop.png") });
    await expect(page.getByText(/không có quyền xem màn soạn khoá/i)).toBeVisible();
    await expect(page.getByText("Vòng đời khoá")).toHaveCount(0);
  });
  test("[AM-02] Đào tạo mở lượt học của NGƯỜI KHÁC ⇒ không xem được nội dung học", async ({ page }) => {
    await mo(page, "daoTao", `/elearning/hoc/${D.khoaChinh.enrollmentId}`, CHE_DO[0]!);
    await page.screenshot({ path: join(ANH, "daoTao-AM-02-desktop.png") });
    const t = await page.locator("body").innerText();
    expect(/không (tìm thấy|có quyền|mở được|xem được)|không thuộc/i.test(t), t.slice(0, 200)).toBe(true);
  });
  test("[AM-03] nhân viên mở chứng nhận của NGƯỜI KHÁC ⇒ không xem được", async ({ page }) => {
    await mo(page, "nhanVien", `/elearning/chung-nhan-cua-toi/${D.chungNhan.maNguoiKhac}`, CHE_DO[0]!);
    await page.screenshot({ path: join(ANH, "nhanVien-AM-03-desktop.png") });
    const t = await page.locator("body").innerText();
    expect(/không (tìm thấy|có quyền|mở được|xem được)|không thuộc/i.test(t), t.slice(0, 200)).toBe(true);
  });
  for (const [id, khoa] of [["AM-04", "khongHoSo"], ["AM-05", "daNghi"]] as const) {
    test(`[${id}] tài khoản ${khoa}: đăng nhập được nhưng KHÔNG vào được cổng học (bị chặn có lời nói rõ)`, async ({ browser }) => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await login(p, { email: D.taiKhoan[khoa].email, callbackUrl: "/elearning" });
      await p.goto("/elearning");
      await p.waitForTimeout(800);
      const t = await p.locator("body").innerText();
      expect(t.includes("Học tập của tôi"), `${khoa} thấy Tổng quan: ${t.slice(0, 200)}`).toBe(false);
      await p.screenshot({ path: join(ANH, `${khoa}-${id}-desktop.png`) });
      await ctx.close();
    });
  }
});
