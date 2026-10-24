/**
 * 🔴 MỘT VÒNG HỌC THẬT, bằng trình duyệt.
 *
 * Vì sao spec này tồn tại: bản kiểm đối chiếu mã thật (27/08/2026) cho ra kết quả
 * khó chịu — module gần đủ mã, 6009 test đơn vị xanh, mà **chưa ai đi hết được một
 * vòng nào**. Trang chủ khu là khung tạm 0 link, `/elearning/hoc/{id}` chưa bao giờ
 * có tệp dù ba thông báo trỏ vào đó, và `/elearning/soan-khoa` là link chết.
 *
 * Không test nào bắt được, vì hai spec e2e duy nhất của khu (`employee-gate`,
 * `host-routing`) đều là `fixme`: job CI `e2e-elearning` chạy mỗi lần, xanh mỗi
 * lần, và **chưa từng mở một trang e-learning nào**.
 *
 * ⚠️ Spec này KHÔNG kiểm logic — logic đã có 6009 test. Nó kiểm ĐƯỜNG ĐI: người
 * thật, trình duyệt thật, bấm từ trang chủ tới khi khoá chuyển sang hoàn thành. Đó
 * là thứ duy nhất phân biệt "mã chạy đúng" với "dùng được".
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import {
  chayVongHetHan,
  chungNhanCuaLuot,
  datHanChungNhan,
  demChungNhan,
  demLuotGhiDanh,
  trangThaiChungNhan,
  dungVongHoc,
  trangThaiGhiDanh,
  tienDoBai,
  type BoDuLieu,
  phatLaiSuKienHoanThanh,
} from "./_helpers/seed-elearning";

/**
 * ⚠️ CHẠY TUẦN TỰ, cố ý.
 *
 * Cấu hình chung bật `fullyParallel`, nên các ca trong cùng tệp chia cho nhiều
 * worker và chạy KHÔNG theo thứ tự viết. Tệp này là một hành trình: ca "cổng đồng ý
 * chặn" chỉ đúng khi người học CHƯA xác nhận, mà ca cuối lại xác nhận để học tiếp.
 * Chạy song song thì hai ca đó tráo nhau và ca đầu đỏ oan — đã đỏ đúng như vậy một
 * lần trước khi thêm dòng này.
 *
 * Đây KHÔNG phải cách vá test rung. Một vòng học là chuỗi có trước có sau; ép nó
 * song song mới là mô tả sai việc thật.
 */
test.describe.configure({ mode: "serial" });

let d: BoDuLieu;

/**
 * Cookie phiên của hai tài khoản, lấy MỘT lần rồi dùng lại.
 *
 * ⚠️ KHÔNG đăng nhập lại ở mỗi ca. `lib/auth.ts:131` chặn 10 lượt đăng nhập / phút /
 * IP (SEC-H01, chống dò mật khẩu) — đó là hành vi ĐÚNG của sản phẩm, không phải thứ
 * để nới ra cho test chạy. Spec này có gần chục ca, cộng thêm lượt thử lại của chế
 * độ CI, nên đăng nhập từng ca là tự đâm vào cái chốt ấy: một ca đỏ vì bị chặn, rồi
 * kéo theo cả nhóm tuần tự.
 *
 * Đã chập chờn đúng như vậy trên CI gương của PR này (23/10/2026): ca cuối đỏ ở
 * `login()` (`toPass` 20s) lượt đầu, đạt ở lượt thử lại — và nó đỏ ở `auth.ts` chứ
 * không ở ca gây ra.
 */
const cookieCua = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();

  for (const email of [d.hocVienEmail, d.daoTaoEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    await expect(p).toHaveURL(/\/elearning/);
    cookieCua.set(email, await ctx.cookies());
    await ctx.close();
  }
});

/** Thanh điều hướng chính của khu (bản cố định ở desktop; ngăn kéo điện thoại ẩn ở 1280px). */
const thanhDieuHuong = (page: Page) =>
  page.getByRole("navigation", { name: "Điều hướng khu học tập" });

async function vaoKhu(page: Page, email: string) {
  const ck = cookieCua.get(email);
  if (!ck) throw new Error(`chưa có phiên cho ${email}`);
  await page.context().clearCookies();
  await page.context().addCookies(ck);

  // ⚠️ Chờ tới khi trang THẬT SỰ dựng bằng phiên mới, không chỉ tới khi URL đúng.
  //
  // Đây là nguồn của một ca RUNG đã bắt được: đổi cookie xong, `goto` trả về một
  // trang còn dựng bằng phiên CŨ (bộ nhớ đệm router/RSC của Next), nên bước sau mở
  // màn soạn bài bằng tư cách người học và nhận "Không có quyền soạn bài" — một lỗi
  // đọc ra như lỗi phân quyền trong khi thật ra là test lấy nhầm phiên.
  //
  // Mốc nhận dạng là bộ chuyển khu làm việc trên thanh điều hướng: khu "Đào tạo" chỉ có với người soạn
  // nội dung / giao / chấm (người học thuần chỉ có khu "Học tập" nên không có bộ chuyển). Canh nó vừa khử
  // rung, vừa bắt được đúng lỗi lẫn phiên nếu có thật.
  const laDaoTao = email === d.daoTaoEmail;
  const nav = thanhDieuHuong(page);
  await expect(async () => {
    await page.goto("/elearning");
    await expect(page).toHaveURL(/\/elearning/);
    await expect(nav.getByRole("link", { name: "Đào tạo", exact: true })).toHaveCount(
      laDaoTao ? 1 : 0,
      { timeout: 3_000 },
    );
  }).toPass({ timeout: 30_000 });
}

/**
 * Xác nhận chính sách theo dõi học tập.
 *
 * ⚠️ KHÔNG seed sẵn ở DB. Đây là cổng đầu tiên mọi người mới đâm vào, và chính chỗ
 * spec này chết ở lần chạy đầu: màn chặn bảo "vào mục Dữ liệu của tôi rồi xác nhận"
 * mà không có link nào tới đó, còn thanh điều hướng của người học thuần cũng không
 * có mục ấy. Seed sẵn cờ đồng ý là bước qua đúng cái lỗ cần canh.
 */
async function xacNhanChinhSach(page: Page) {
  await page.goto("/elearning/du-lieu-cua-toi");
  // Đã xác nhận ở một ca trước trong cùng tệp thì nút không còn — không phải lỗi.
  const nut = page.getByRole("button", { name: /^Tôi xác nhận bản/ });
  // Chờ trang DỰNG XONG (hoặc nút, hoặc dòng "đã xác nhận") rồi mới rẽ nhánh: `count()` trả ngay, nên trên máy chủ dev còn
  // nguội nó đếm 0 khi trang chưa render và rẽ nhầm sang nhánh "đã xác nhận" — ca chạy riêng lẻ đỏ oan (luật 18).
  await expect(nut.or(page.getByText("Bạn đã xác nhận bản"))).toBeVisible({ timeout: 30_000 });
  if ((await nut.count()) === 0) {
    await expect(page.getByText("Bạn đã xác nhận bản")).toBeVisible();
    return;
  }
  await nut.click();
  await expect(page.getByText("Bạn đã xác nhận bản")).toBeVisible();
}

test.describe("[EL-VÒNG] người học đi từ trang chủ tới hết khoá", () => {
  test("🔴 trang chủ khu LIỆT KÊ khoá được giao, và bấm được vào", async ({
    page,
  }) => {
    // Trang này từng là khung tạm 16 dòng với ĐÚNG 0 link, trong khi mục menu "Học
    // tập nội bộ" dẫn thẳng vào đó — nên mọi màn đã dựng không ai tới được.
    await vaoKhu(page, d.hocVienEmail);
    await expect(page.getByRole("heading", { name: /^Xin chào/ })).toBeVisible();

    // Trang chủ nay có nhiều lối vào cùng một khoá (Tiếp tục học · thẻ · Việc cần làm): lấy cái đầu tiên.
    const link = page.getByRole("link", { name: /E2E Khoá an toàn lao động/ }).first();
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(new RegExp(`/elearning/hoc/${d.enrollmentId}$`));
  });

  test("🔴 màn đề cương hiện đủ bài, và bài ĐỌC bấm được", async ({ page }) => {
    // `/elearning/hoc/{enrollmentId}` chưa bao giờ có tệp, mà BA chỗ sinh thông báo
    // trỏ vào nó: "được giao khoá", "quá hạn", và chuông. Bấm thông báo = 404.
    await vaoKhu(page, d.hocVienEmail);
    await page.goto(`/elearning/hoc/${d.enrollmentId}`);

    await expect(
      page.getByRole("heading", { name: "E2E Khoá an toàn lao động" }),
    ).toBeVisible();
    await expect(page.getByText("Bài đọc mở đầu")).toBeVisible();
    await expect(page.getByText("Buổi thực hành tại xưởng")).toBeVisible();

    await page.getByRole("link", { name: "Bài đọc mở đầu" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/elearning/hoc/${d.enrollmentId}/${d.baiDocId}`),
    );

    // 🔴 Cổng đồng ý chặn ở đây — ĐÚNG chính sách, nhưng lời chặn phải kèm đường đi.
    // Bản trước chỉ có nút "Về trang chủ khu đào tạo": người mới bị chặn ở mọi bài,
    // đọc một câu bảo đi đâu đó, rồi tự đi tìm.
    await expect(
      page.getByRole("heading", { name: "Cần xác nhận trước khi bắt đầu" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Xem và xác nhận" }).click();
    await expect(page).toHaveURL(/\/elearning\/du-lieu-cua-toi/);

    const nut = page.getByRole("button", { name: /^Tôi xác nhận bản/ });
    await expect(nut).toBeVisible();
    await nut.click();

    // Màn hình phải THÔI nói "chưa xác nhận" ngay, không bắt người dùng tự F5.
    //
    // ⚠️ Canh câu do MÁY CHỦ dựng, KHÔNG canh dòng "✓ Đã xác nhận" của nút. Dòng ấy
    // là trạng thái thoáng qua: `router.refresh()` xong thì cả nút lẫn dòng ấy biến
    // mất, và trên bản build thật refresh nhanh tới mức nó gần như không kịp hiện.
    // Bản đầu canh đúng vào đó — xanh ở `pnpm dev`, ĐỎ ở chế độ CI. Nếu không chạy
    // thử đường CI thì lỗi này rơi vào lần merge.
    await expect(page.getByText("Bạn đã xác nhận bản")).toBeVisible();
    await expect(page.getByText("Bạn chưa xác nhận bản nào")).toHaveCount(0);

    // Quay lại đúng bài đó — giờ mới thấy nội dung thật, không phải trang trắng.
    await page.goto(`/elearning/hoc/${d.enrollmentId}/${d.baiDocId}`);
    await expect(page.getByText("Nội dung bài đọc dùng cho e2e")).toBeVisible();
  });

  test("🔴 bài BUỔI TRỰC TIẾP không dựng link — nói rõ thay vì dẫn vào ngõ cụt", async ({
    page,
  }) => {
    // Người học không tự bấm xong buổi trực tiếp được; giảng viên tick. Dựng link
    // để họ bấm vào rồi nhận một câu từ chối là bắt đi một vòng vô ích.
    await vaoKhu(page, d.hocVienEmail);
    await page.goto(`/elearning/hoc/${d.enrollmentId}`);
    await expect(
      page.getByRole("link", { name: "Buổi thực hành tại xưởng" }),
    ).toHaveCount(0);
    // Và phải NÓI VÌ SAO. Một dòng chữ xám không bấm được, không kèm lý do, đọc ra
    // thành "bạn chưa được phép" — trong khi sự thật là giảng viên điểm danh hộ.
    await expect(
      page.getByText("giảng viên điểm danh, bạn không cần mở"),
    ).toBeVisible();
  });
});

test.describe("[EL-UX] rời bài không làm mất tiến độ đọc", () => {
  test("🔴 đọc quá ngưỡng giây nhưng chưa tới nhịp 15s, rời bài bằng liên kết của khung ⇒ server VẪN nhận tiến độ", async ({
    page,
  }) => {
    // Bộ đo chỉ ghi nhịp mỗi 15 giây và nhịp CUỐI chỉ gửi ở `pagehide`. Điều hướng phía client của `<Link>` không bắn
    // `pagehide` ⇒ đo 24/10/2026: đọc 12 giây rồi bấm "Bài sau" = 0 dòng tiến độ. Khung trình học dùng `<a href>` thường
    // (full navigation) để nhịp cuối đi đúng đường cũ — ca này canh đúng chỗ đó.
    await vaoKhu(page, d.hocVienEmail);
    await xacNhanChinhSach(page);
    await page.goto(`/elearning/hoc/${d.enrollmentId}/${d.baiDocId}`);
    await expect(page.getByText("Nội dung bài đọc dùng cho e2e")).toBeVisible();
    // 11 giây: qua `minReadSeconds` mẫu, nhưng CHƯA tới nhịp định kỳ 15 giây.
    await page.waitForTimeout(11_000);

    await page.getByRole("link", { name: /^Về đề cương/ }).click();
    await expect(page).toHaveURL(new RegExp(`/elearning/hoc/${d.enrollmentId}$`));

    await expect(async () => {
      const tt = await tienDoBai(d.enrollmentId, d.baiDocId);
      expect(tt, "server không nhận nhịp cuối khi rời bài").not.toBeNull();
      expect(tt!.readSeconds).toBeGreaterThanOrEqual(10);
    }).toPass({ timeout: 15_000 });
  });
});

test.describe("[EL-VÒNG] thanh điều hướng gác theo quyền", () => {
  test("người học thuần KHÔNG thấy mục Chấm bài / Báo cáo", async ({ page }) => {
    // Thấy một cánh cửa mở ra sẽ bị từ chối thì người ta nghĩ mình mất quyền, chứ
    // không nghĩ mục đó không dành cho mình.
    await vaoKhu(page, d.hocVienEmail);
    const nav = thanhDieuHuong(page);
    await expect(nav.getByRole("link", { name: "Khoá của tôi" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Chấm bài" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Báo cáo" })).toHaveCount(0);
    // Và không có bộ chuyển khu: người học thuần chỉ có một khu.
    await expect(nav.getByRole("link", { name: "Đào tạo", exact: true })).toHaveCount(0);
  });

  test("người Đào tạo THẤY đủ mục của mình", async ({ page }) => {
    await vaoKhu(page, d.daoTaoEmail);
    const nav = thanhDieuHuong(page);
    // Mỗi khu làm việc mở ra các mục của nó; người Đào tạo có ĐỦ ba khu: Đào tạo, Báo cáo & tuân thủ, Quản trị.
    await nav.getByRole("link", { name: "Đào tạo", exact: true }).click();
    for (const nhan of ["Chương trình", "Chấm bài tập", "Chấm bài thi", "Giao khoá"]) {
      await expect(nav.getByRole("link", { name: nhan })).toBeVisible();
    }
    await nav.getByRole("link", { name: "Báo cáo & tuân thủ", exact: true }).click();
    for (const nhan of ["Tổng quan báo cáo", "Ma trận đào tạo", "Chứng nhận"]) {
      await expect(nav.getByRole("link", { name: nhan })).toBeVisible();
    }
  });
});

test.describe("[EL-VÒNG] người Đào tạo tick buổi ⇒ khoá KHÉP", () => {
  test("🔴 tick 'đã dự' rồi khoá chuyển sang hoàn thành", async ({ page, browser }) => {
    // Đây là ca đắt nhất của cả spec. `diemDanhBuoiAction` từng là action MỒ CÔI
    // (0 màn nào gọi), và `cauHinhDiemDanhBuoi` KHÔNG gọi `cuonKhoaSauKhiXongBai`.
    // Hai lỗi cộng lại: bài `LIVE_SESSION` không bao giờ xong, nên MỌI khoá kết hợp
    // đứng mãi ở "đang học" — chứng nhận không cấp được, báo cáo đếm thiếu.
    //
    // Không ai tự nhận ra: người tick thấy ô đã tích, người học thấy bài đã xong.

    // (1) Người học đọc xong bài đọc — đi qua đường ghi tiến độ thật.
    await vaoKhu(page, d.hocVienEmail);
    await xacNhanChinhSach(page);
    await page.goto(`/elearning/hoc/${d.enrollmentId}/${d.baiDocId}`);
    await expect(page.getByText("Nội dung bài đọc dùng cho e2e")).toBeVisible();

    // Người đọc cuộn tới cuối bài. Bộ đo đòi ≥ 90% độ sâu cuộn của TRANG; bản trước của ca này không cuộn vì bài mẫu vừa khít
    // một màn hình — khung trình học mới (thanh trên + cột chương/bài) làm trang dài hơn 720px nên phải cuộn như người thật.
    // Cuộn là cách thật để đạt điều kiện, không phải đường tắt: thiếu bước này bộ đo vẫn đúng là KHÔNG cho hoàn thành.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

    // ⚠️ Ở LẠI trang bài cho tới khi SERVER xác nhận xong.
    //
    // Bản đầu của ca này quay về đề cương mỗi 3 giây để dò chữ "đã xong" — nhưng
    // rời trang là gỡ luôn bộ đo, nên nhịp 15 giây không bao giờ bắn và 60 giây
    // chờ kia dò một thứ không đời nào tới. Test sai, mã đúng.
    //
    // Và canh dòng do server trả về (`done`), KHÔNG canh đồng hồ client: đồng hồ
    // client nói "đủ thời gian" từ giây thứ 10, trong khi số thật là số đã bị kẹp
    // ở server. Canh nhầm chỗ là test xanh trong lúc hệ thống chưa ghi gì.
    await expect(page.getByText("✓ Đã hoàn thành bài này")).toBeVisible({
      timeout: 60_000,
    });

    await page.goto(`/elearning/hoc/${d.enrollmentId}`);
    await expect(page.getByText("đã xong").first()).toBeVisible();

    // (2) Người Đào tạo tick "đã dự" cho buổi trực tiếp.
    //
    // ⚠️ MỘT NGỮ CẢNH TRÌNH DUYỆT RIÊNG cho người Đào tạo — KHÔNG đổi cookie trong cùng
    // ngữ cảnh vừa dùng cho người học.
    //
    // Bản trước đổi danh tính ngay trong `page` (xoá cookie người học, nạp cookie người
    // Đào tạo). Đo trên CI gương 23/10/2026, ở các nhánh có lớp kiểm phiên SỐNG: ca này đỏ ở
    // đúng bước đổi ấy ở 3 trên 4 lượt chạy đã có kết quả (có lượt đỏ cả ba lần thử) — chữ
    // "Điểm danh buổi trực tiếp" không hiện, hoặc thanh điều hướng thiếu mục "Chương trình",
    // tức server vẫn thấy phiên NGƯỜI HỌC; nhánh chưa có lớp kiểm phiên mới có MỘT lượt chạy (đạt) — chưa đủ để kết luận gì. Lượt
    // thử lại che mất điều đó. Cơ chế nghi ngờ: phản hồi muộn của trang người học (nhịp tiến
    // độ gửi lúc rời trang) ghi lại cookie người học vào kho cookie CỦA NGỮ CẢNH, đè lên
    // cookie vừa nạp. CHƯA có bằng chứng trực tiếp (CI không giữ ảnh chụp lỗi) — nhưng một
    // ngữ cảnh mới thì miễn nhiễm với cả họ lỗi đó, nên đổi cách làm thay vì đoán tiếp.
    const nguCanhDaoTao = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    try {
      const pageDT = await nguCanhDaoTao.newPage();
      await vaoKhu(pageDT, d.daoTaoEmail);
      await pageDT.goto(`/elearning/soan/${d.baiBuoiId}`);
      await expect(pageDT.getByText("Điểm danh buổi trực tiếp")).toBeVisible();

      const o = pageDT.getByRole("checkbox").first();
      await expect(o).toBeVisible();
      // ⚠️ `.click()` chứ KHÔNG `.check()`. Ô này là controlled: `checked` lấy từ dữ
      // liệu máy chủ, chỉ đổi sau khi action chạy xong và `router.refresh()` dựng lại
      // trang. `.check()` bấm rồi đòi trạng thái đổi NGAY, thấy chưa đổi thì bấm lại —
      // vừa sai vừa nguy hiểm, vì mỗi lần bấm là một lần ghi điểm danh thật.
      await o.click();
      // Chờ con số của máy chủ, không chờ đồng hồ: `waitForTimeout` chỉ giấu lỗi.
      await expect(
        pageDT.getByText("1/1 người đã được ghi có mặt"),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await nguCanhDaoTao.close();
    }

    // (3) Khoá phải KHÉP ở tầng dữ liệu — đây là khẳng định thật, không phải câu
    // chữ trên màn hình.
    await expect(async () => {
      const tt = await trangThaiGhiDanh(d.enrollmentId);
      expect(tt?.status).toMatch(/^COMPLETED/);
    }).toPass({ timeout: 30_000 });
  });
});

test.describe("[EL-17] yêu cầu đào tạo và ma trận R3", () => {
  test("🔴 người Đào tạo KHAI được yêu cầu — cổng `requirement:manage` có cửa", async ({
    page,
  }) => {
    // Khoá quyền này có từ EL-02 và tới trước PR này không mã nào gọi: mẫu số của
    // toàn bộ North Star Metric chỉ khai được bằng seed hoặc SQL tay.
    await vaoKhu(page, d.daoTaoEmail);
    await page.goto("/elearning/yeu-cau");
    await expect(page.getByRole("heading", { name: "Yêu cầu đào tạo" })).toBeVisible();

    await page.getByRole("button", { name: "Khai yêu cầu đào tạo" }).click();
    await page.getByRole("combobox").first().selectOption({ index: 1 });
    await page
      .getByPlaceholder("vd: theo quy định ATLĐ")
      .fill("Bắt buộc theo quy định an toàn lao động nội bộ");

    await page.getByRole("button", { name: "Khai yêu cầu" }).click();
    await expect(page.getByText("Chưa có yêu cầu nào")).toHaveCount(0);
    await expect(page.getByText("ALL_STAFF").first()).toBeVisible();
  });

  test("🔴 ma trận vẽ ô, và ô XÁM khác ô 'chưa đối chiếu được'", async ({ page }) => {
    await vaoKhu(page, d.daoTaoEmail);
    await page.goto("/elearning/ma-tran");
    await expect(page.getByRole("heading", { name: "Ma trận đào tạo" })).toBeVisible();

    // Chú giải phải có ĐỦ BỐN nhãn — gộp hai cái cuối là biến một khoảng trống dữ
    // liệu thành kết luận về một con người.
    for (const nhan of ["Đạt", "Chưa đạt", "Không áp dụng", "Chưa đối chiếu được"]) {
      await expect(page.getByText(nhan, { exact: true }).first()).toBeVisible();
    }

    // Người học e2e phải có mặt trong ma trận (yêu cầu ALL_STAFF vừa khai áp cho họ).
    await expect(page.getByText("E2E_EL_HV")).toBeVisible();

    // Ngưỡng in bằng NGƯỜI, không bằng phần trăm.
    await expect(page.getByText("12/15 người")).toBeVisible();
  });

  test("người học thuần KHÔNG vào được ma trận", async ({ page }) => {
    await vaoKhu(page, d.hocVienEmail);
    await page.goto("/elearning/ma-tran");

    await expect(page.getByText("Không có quyền xem")).toBeVisible();
  });
});

test.describe("[EL-16] khoá khép ⇒ CHỨNG NHẬN có thật", () => {
  test("🔴 hàng đợi sự kiện chạy xong thì có chứng nhận, và nó là ẢNH CHỤP", async () => {
    // Ca này nối vào đúng lượt ghi danh mà ca trên vừa đưa về `COMPLETED` (tệp chạy
    // tuần tự). Nó kiểm ĐƯỜNG NỐI, không kiểm công thức: công thức đã có 43 test
    // đơn vị, còn hai mắt xích hay đứt là "sự kiện có được phát không" và "handler
    // có được đăng ký không" — cả hai chỉ lộ khi chạy thật.
    const cn = await chungNhanCuaLuot(d.enrollmentId);

    expect(cn, "khoá đã hoàn thành mà không có chứng nhận nào").not.toBeNull();
    expect(cn!.certCode).toMatch(/^SR\.CN\.\d{4}\.\d{5}$/);
    expect(cn!.verifyToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(cn!.status).toBe("VALID");

    // Phải trỏ vào một PHIÊN BẢN đã chốt — không có thì câu "người này đạt nội dung
    // X" không có nghĩa, và sửa khoá sau đó sẽ đổi hồi tố thứ nó đang chứng cho.
    expect(cn!.courseVersionId).toBeTruthy();

    // ẢNH CHỤP tên + mã nhân viên, không join sống.
    expect(cn!.snapFullName).toContain("E2E");
    expect(cn!.snapEmployeeCode).toBe("E2E_EL_HV");

    // Khoá e2e không gắn chương trình và không có yêu cầu nào ⇒ nhánh (3): vô thời
    // hạn. `null` ở đây là câu trả lời, không phải ô chưa tính.
    expect(cn!.validUntil).toBeNull();
  });

  test("🔴 chạy lại hàng đợi KHÔNG cấp thêm tấm thứ hai", async () => {
    // `dispatch-events` chạy lại sự kiện khi handler ném lỗi giữa chừng. Chống trùng
    // bằng `findFirst` rồi mới ghi là không đủ — hai lượt song song cùng vượt qua
    // được. Chống bằng ràng buộc `@unique` + bắt P2002 mới là chống thật.
    const truoc = await demChungNhan(d.enrollmentId);
    expect(truoc, "ca này đòi đã có đúng MỘT chứng nhận từ ca trước").toBe(1);
    // PHÁT LẠI sự kiện cho handler — không phải "chạy lại hàng đợi" (hàng đợi đã rỗng nên không chạy handler
    // nào, ca xanh vì không có gì chạy). Hai lượt thử lại liên tiếp với cùng payload.
    await phatLaiSuKienHoanThanh(d.enrollmentId, 2);
    expect(await demChungNhan(d.enrollmentId)).toBe(1);
  });
});

test.describe("[EL-16] chứng nhận ĐẾN TAY người học, và tra cứu được từ ngoài", () => {
  test("🔴 màn đề cương hiện chứng nhận và tải được bản PDF", async ({ page }) => {
    // Chứng nhận cấp TỰ ĐỘNG qua hàng đợi sự kiện. Không hiện ở màn nào thì người
    // học không biết mình đã có, và đường tải PDF thành một cổng không cửa — đúng
    // lỗi đã lặp lại tám lần trong module này.
    await vaoKhu(page, d.hocVienEmail);
    await page.goto(`/elearning/hoc/${d.enrollmentId}`);
    await expect(page.getByText("Bạn đã có chứng nhận hoàn thành khoá này")).toBeVisible();

    const cn = await chungNhanCuaLuot(d.enrollmentId);
    const res = await page.request.get(`/api/elearning/chung-nhan?id=${cn!.id}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    // Tệp có nội dung thật, không phải 0 byte.
    expect((await res.body()).byteLength).toBeGreaterThan(5_000);
  });

  test("🔴 trang xác minh mở được KHÔNG cần đăng nhập", async ({ browser }) => {
    // Đây là lý do tồn tại của cả tấm chứng nhận: người NGOÀI công ty quét QR bằng
    // điện thoại của họ. Bắt đăng nhập là biến nó thành thứ nội bộ tự xem nhau.
    const cn = await chungNhanCuaLuot(d.enrollmentId);
    const ctx = await browser.newContext(); // ngữ cảnh SẠCH — không cookie nào
    const p2 = await ctx.newPage();
    await p2.goto(`/xac-thuc/${cn!.verifyToken}`);

    await expect(p2).not.toHaveURL(/\/login/);
    await expect(p2.getByText("Chứng nhận đào tạo nội bộ")).toBeVisible();
    await expect(p2.getByText(cn!.certCode)).toBeVisible();
    await expect(p2.getByText("Còn hiệu lực")).toBeVisible();

    // ⚠️ Và KHÔNG rò gì thêm. Trang này công khai với cả internet: mỗi dòng thừa là
    // nới quyền cho mọi người, không phải cho một vai nào.
    const chu = (await p2.textContent("body")) ?? "";
    for (const cam of ["Đào tạo", "@satarobo.vn", "Chấm bài", "Báo cáo"]) {
      expect(chu, `trang xác minh rò "${cam}"`).not.toContain(cam);
    }
    await ctx.close();
  });

  test("🔴 token sai KHÔNG nói cái nào có thật", async ({ browser }) => {
    // Phân biệt "token sai" với "không tồn tại" là dựng một cái máy dò: người thử
    // token biết được cái nào có thật. Ở trang công khai, đó là toàn bộ giá trị của
    // việc token ngẫu nhiên.
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto("/xac-thuc/khongtontai00000000000000000000");
    await expect(p2.getByText("Không tìm thấy chứng nhận")).toBeVisible();
    await ctx.close();
  });
});

test.describe("[EL-16] hết hiệu lực ⇒ chốt EXPIRED và giao lại vòng mới", () => {
  test("🔴 quá hạn thì chuyển EXPIRED và sinh lượt học vòng 2", async () => {
    // Đây là vế cuối của TS-34 bước ⑦. Lượt mới phải là bản ghi MỚI với `cycle` tăng
    // — `TrnLessonProgress` khoá theo `[enrollmentId, lessonId]` nên bitmap tiến độ
    // bắt đầu lại từ rỗng: người học phải xem lại thật, không được tính hoàn thành
    // ngay. Mở lại lượt cũ là bỏ qua đúng chuyện đó.
    const truoc = await demLuotGhiDanh(d.hocVienEmail, `${"e2e_el_"}khoa`);
    expect(truoc.vongCaoNhat).toBe(1);

    await datHanChungNhan(d.enrollmentId, new Date(Date.now() - 86_400_000));
    const kq = await chayVongHetHan(new Date());

    expect(kq.loi, `cron báo lỗi: ${kq.loi.join(" | ")}`).toEqual([]);
    expect(kq.chotHetHan).toBeGreaterThanOrEqual(1);
    expect(kq.giaoLai).toBeGreaterThanOrEqual(1);

    expect((await trangThaiChungNhan(d.enrollmentId))?.status).toBe("EXPIRED");
    const sau = await demLuotGhiDanh(d.hocVienEmail, `${"e2e_el_"}khoa`);
    expect(sau.vongCaoNhat).toBe(2);
    expect(sau.tong).toBe(truoc.tong + 1);
  });

  test("🔴 chạy lại KHÔNG đẻ thêm lượt — cron 15 phút/lần", async () => {
    // Không chặn thì sau một ngày người học mở khu ra thấy gần trăm lượt cùng một
    // khoá, và mọi báo cáo tuân thủ đếm sai theo.
    const truoc = await demLuotGhiDanh(d.hocVienEmail, `${"e2e_el_"}khoa`);
    await chayVongHetHan(new Date());
    await chayVongHetHan(new Date());
    expect((await demLuotGhiDanh(d.hocVienEmail, `${"e2e_el_"}khoa`)).tong).toBe(
      truoc.tong,
    );
  });

  test("🔴 trang xác minh công khai đổi câu trả lời NGAY, không chờ cron", async ({
    browser,
  }) => {
    // Trạng thái hiển thị suy từ `validUntil`, không đọc cột `status`. Cột ấy là bộ
    // nhớ đệm do cron cập nhật; tin nó là để hệ thống nói dối người đi kiểm, ở đúng
    // trang được dựng để không nói dối.
    const cn = await trangThaiChungNhan(d.enrollmentId);
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto(`/xac-thuc/${cn!.verifyToken}`);
    await expect(p2.getByText("Đã hết hiệu lực")).toBeVisible();
    await ctx.close();
  });
});

test.describe("[EL-16] nút THU HỒI gác bằng khoá quyền riêng", () => {
  test("người Đào tạo thấy màn chứng nhận nhưng KHÔNG có nút thu hồi", async ({
    page,
  }) => {
    // Xem được ai đã có chứng nhận gì là việc của Đào tạo; vô hiệu một chứng từ là
    // quyết định của Nhân sự Hội sở. `elearning:certificate:revoke` chỉ thuộc
    // SUPER_ADMIN và HO_HR (`prisma/seed-roles.ts`).
    await vaoKhu(page, d.daoTaoEmail);
    await page.goto("/elearning/chung-nhan");
    await expect(page.getByRole("heading", { name: "Chứng nhận đã cấp" })).toBeVisible();
    await expect(page.getByText(/^SR\.CN\./).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Thu hồi" })).toHaveCount(0);
  });

  test("người học thuần KHÔNG vào được màn đó", async ({ page }) => {
    await vaoKhu(page, d.hocVienEmail);
    await page.goto("/elearning/chung-nhan");
    await expect(page.getByText("Không có quyền xem")).toBeVisible();
  });
});

test.describe("[EL-UX] giao diện mới: Khoá của tôi · Tổng quan Đào tạo", () => {
  test("Khoá của tôi: tìm bỏ dấu ra đúng khoá; tìm không ra thì nói rõ và có đường xoá bộ lọc", async ({
    page,
  }) => {
    await vaoKhu(page, d.hocVienEmail);
    await page.goto("/elearning/khoa-cua-toi?q=khoa+an+toan");
    await expect(page.getByRole("link", { name: /E2E Khoá an toàn lao động/ }).first()).toBeVisible();

    await page.goto("/elearning/khoa-cua-toi?q=khong-co-khoa-nao-ten-the");
    await expect(page.getByText("Không có khoá nào khớp bộ lọc")).toBeVisible();
    // ĐỐI CHỨNG DƯƠNG: bỏ bộ lọc thì khoá quay lại — "không khớp" không phải "chưa được giao".
    await page.getByRole("link", { name: "Xoá bộ lọc" }).first().click();
    await expect(page.getByRole("link", { name: /E2E Khoá an toàn lao động/ }).first()).toBeVisible();
  });

  test("người học thuần mở /elearning/dao-tao ⇒ màn KHÔNG CÓ QUYỀN, không một con số vận hành nào", async ({
    page,
  }) => {
    await vaoKhu(page, d.hocVienEmail);
    await page.goto("/elearning/dao-tao");
    await expect(page.getByText("Bạn không có quyền xem tổng quan Đào tạo")).toBeVisible();
    await expect(page.getByText("Bài tập chờ chấm")).toHaveCount(0);
    await expect(page.getByText("Lượt giao đang mở")).toHaveCount(0);
  });

  test("người Đào tạo: bộ chuyển khu dẫn tới Tổng quan Đào tạo có các khối đúng quyền", async ({
    page,
  }) => {
    await vaoKhu(page, d.daoTaoEmail);
    await thanhDieuHuong(page).getByRole("link", { name: "Đào tạo", exact: true }).click();
    await expect(page).toHaveURL(/\/elearning\/dao-tao$/);
    await expect(page.getByRole("heading", { name: "Tổng quan Đào tạo" })).toBeVisible();
    await expect(page.getByText("Bài tập chờ chấm")).toBeVisible();
    await expect(page.getByText("Lượt giao đang mở")).toBeVisible();
  });
});
