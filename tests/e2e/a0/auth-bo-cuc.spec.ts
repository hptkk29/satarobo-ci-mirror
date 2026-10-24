/**
 * Nợ kỹ thuật #25 (28/09/2026) — DẢI LINK PHÁP LÝ KHÔNG ĐƯỢC ĐÈ LÊN THẺ của nhóm route `(auth)`.
 *
 * Trước bản vá: `app/(auth)/layout.tsx` đặt dải link pháp lý `position: fixed` ở đáy khung nhìn
 * (để khỏi phải sửa bố cục flex-giữa của `.auth-root`). Thẻ nào cao hơn khung nhìn thì dải link
 * nằm ĐÈ lên nội dung thẻ ở mọi vị trí cuộn. Bố cục cột (thẻ rồi dải link TRONG DÒNG) GIỮ — đó là
 * bản vá chung của nhóm `(auth)`.
 *
 * 02/10/2026 — gỡ Cổng dữ liệu agent: bỏ hai ca đo trên trang đồng ý nối Claude `/ket-noi-agent`
 * ([BC-01], [BC-02] — trang đã gỡ). Ca `/login` ở lại.
 *
 * ⚠️ VÌ SAO QUA TRÌNH DUYỆT (luật 11): thứ cần khẳng định là HỘP BAO THẬT sau khi CSS chạy — hai
 * hộp không giao nhau ở MỌI vị trí cuộn, không tràn ngang, không có vùng cuộn thứ hai. Grep class
 * không chứng minh được điều nào trong đó.
 *
 * Mã ca: [BC-03] /login (thẻ ngắn — không cuộn thừa).
 */
import { test, expect, type Page } from "@playwright/test";

const KHUNG = [
  { ten: "375×667", width: 375, height: 667 },
  { ten: "1280×720", width: 1280, height: 720 },
] as const;

// ─── Đo ──────────────────────────────────────────────────────────────────────────────────
type SoDo = {
  /** Vị trí cuộn nào (px) mà hộp thẻ và hộp dải link GIAO nhau. */
  giaoTai: number[];
  tranNgang: number;
  /** Phần tử (ngoài tài liệu) đang là một vùng cuộn dọc riêng. */
  vungCuonPhu: string[];
  cuonToiDa: number;
  /** Cuộn tới đáy: đáy thẻ và đáy dải link có nằm trong khung nhìn không. */
  theToiDuoc: boolean;
  daiToiDuoc: boolean;
};

async function doBoCuc(page: Page): Promise<SoDo> {
  return page.evaluate(async () => {
    const se = document.scrollingElement as HTMLElement;
    const the = (): DOMRect => {
      const ds = [...document.querySelectorAll<HTMLElement>(".my-form")];
      if (ds.length === 0) throw new Error("không thấy thẻ .my-form");
      // Thẻ THẤP NHẤT trên trang (trang có thể có nhiều thẻ .my-form).
      return ds.map((d) => d.getBoundingClientRect()).sort((a, b) => b.bottom - a.bottom)[0]!;
    };
    const dai = (): DOMRect => {
      const a = [...document.querySelectorAll("a")].find((x) => x.textContent?.trim() === "Chính sách bảo mật");
      if (!a?.parentElement) throw new Error("không thấy dải link pháp lý");
      return a.parentElement.getBoundingClientRect();
    };
    const giao = (x: DOMRect, y: DOMRect) =>
      x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom;
    const cho = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const cuonToiDa = Math.max(0, se.scrollHeight - window.innerHeight);
    const viTri = [...new Set([0, Math.round(cuonToiDa / 3), Math.round((2 * cuonToiDa) / 3), cuonToiDa])];
    const giaoTai: number[] = [];
    for (const y of viTri) {
      window.scrollTo({ top: y, behavior: "instant" });
      await cho();
      if (giao(the(), dai())) giaoTai.push(y);
    }
    window.scrollTo({ top: cuonToiDa, behavior: "instant" });
    await cho();
    const tDay = the();
    const dDay = dai();
    const theToiDuoc = tDay.bottom <= window.innerHeight + 0.5;
    const daiToiDuoc = dDay.bottom <= window.innerHeight + 0.5;
    window.scrollTo({ top: 0, behavior: "instant" });

    const vungCuonPhu = [document.body, ...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);

    return {
      giaoTai,
      tranNgang: se.scrollWidth - se.clientWidth,
      vungCuonPhu,
      cuonToiDa,
      theToiDuoc,
      daiToiDuoc,
    };
  });
}

async function kiemBoCuc(page: Page, nhan: string): Promise<SoDo[]> {
  const kq: SoDo[] = [];
  for (const k of KHUNG) {
    await page.setViewportSize({ width: k.width, height: k.height });
    await page.waitForTimeout(200);
    const s = await doBoCuc(page);
    const ten = `${nhan} @ ${k.ten}`;
    expect(s.giaoTai, `${ten}: thẻ và dải link GIAO nhau ở vị trí cuộn ${JSON.stringify(s.giaoTai)}`).toEqual([]);
    expect(s.tranNgang, `${ten}: tràn ngang ${s.tranNgang}px`).toBeLessThanOrEqual(0);
    expect(s.vungCuonPhu, `${ten}: có vùng cuộn thứ hai`).toEqual([]);
    expect(s.theToiDuoc, `${ten}: cuộn tới đáy mà đáy thẻ vẫn khuất`).toBe(true);
    expect(s.daiToiDuoc, `${ten}: cuộn tới đáy mà dải link vẫn khuất`).toBe(true);
    kq.push(s);
  }
  return kq;
}

test.describe("[NKT-25] nhóm (auth): dải link pháp lý không đè thẻ", () => {
  test("[BC-03] /login (thẻ ngắn) — không giao nhau, và ở 1280×720 KHÔNG cuộn thừa (dải link nằm trong khung nhìn)", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Chào mừng trở lại" })).toBeVisible();
    const soDo = await kiemBoCuc(page, "[BC-03] /login");
    expect(soDo[1]!.cuonToiDa, "1280×720: thẻ đăng nhập vừa khung ⇒ không cuộn").toBe(0);
  });
});
