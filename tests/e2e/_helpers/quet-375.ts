/**
 * tests/e2e/_helpers/quet-375.ts — BỘ ĐO "MÀN HÌNH ĐIỆN THOẠI 375px DÙNG ĐƯỢC KHÔNG" (AFF-L4, yêu cầu §34).
 *
 * Mỗi màn được đo bằng thứ NGƯỜI DÙNG CẢM THẤY, không bằng grep class:
 *   · TRÀN NGANG  — `doTranNgang` (hai vùng cuộn thật: `documentElement` và `<main>`; xem `tran-ngang.ts` vì sao phép đo cũ nói dối).
 *   · NGOÀI KHUNG — phần tử tương tác có mép phải > bề rộng khung nhìn (hoặc mép trái < 0) mà KHÔNG nằm trong một vùng cuộn ngang ⇒ không với tới được.
 *   · BỊ CHE      — tâm phần tử tương tác trỏ vào một phần tử KHÁC không phải con/cha của nó, ở MỌI bước cuộn mà phần tử nằm trọn trong khung nhìn ⇒ bấm không trúng
 *                   dù cuộn thế nào. (Phần tử chỉ bị thanh dính che LÚC ĐANG cuộn ngang qua rồi hết bị che ở bước cuộn khác thì KHÔNG phải lỗi — người dùng cuộn tiếp là tới.)
 *   · VÙNG CHẠM   — nút/ô quá nhỏ: < `CHAM_CAO` px là CAO (khó chạm trúng), < `CHAM_TOI_THIEU` px là THẤP (chưa đẹp, ghi để người thiết kế cân).
 *                   ⚠️ Ngưỡng KHÁC brief (nút chính ≥ ~40px): đặt CAO < 28, THẤP < 36. Đo một lần ở ngưỡng 40 (13/10/2026): MỌI màn admin đều ra hàng chục điều khiển 36–38px — đó là chuẩn mật độ của khung admin
 *                   (nút `h-9`, ô nhập 36–38px, chip lọc 36px), không phải lỗi riêng Affiliate; để ngưỡng 40 thì ca nào cũng ồn và các phát hiện thật chìm đi. Xem notes l4-e2e-portal-375.md §4.
 *
 * Phân loại: CAO = không dùng được (PHẢI vá); THẤP = chưa đẹp (ghi vào notes, vá nếu vài dòng).
 * Quét theo từng "bước cuộn" của vùng cuộn chính để phần tử ở dưới nếp gấp cũng được đo ở vị trí thật của nó.
 */
import type { Page, TestInfo } from "@playwright/test";

import { doTranNgang } from "./tran-ngang";

export type PhatHien = { muc: "CAO" | "THAP"; loai: "tran-ngang" | "ngoai-khung" | "bi-che" | "vung-cham-nho" | "co-chu" | "hang-bang-cao"; chiTiet: string };
export type KetQuaMan = { man: string; tranPx: number; soPhanTuTuongTac: number; phatHien: PhatHien[]; /** Chiều cao (CSS px) của hàng bảng cao nhất đang hiện — để ca khoá hồi quy "hàng phình cao". */ hangBangCaoNhat: number };

const HANG_BANG_CAO = 160;
const CHAM_CAO = 28;
const CHAM_TOI_THIEU = 36;

type Mau = { la: string; k: number; ten: string; trong: boolean; ngoai: boolean; biChe: string | null; w: number; h: number; l: number; r: number; tick: boolean; chuCat: boolean };

/** Chạy trong trình duyệt: đo các phần tử tương tác đang hiện ở vị trí cuộn HIỆN TẠI. Không tham chiếu gì ngoài thân hàm. */
function doTrongTrang(): { mau: Mau[]; vw: number } {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const sel = "a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=combobox],[role=menuitem],[role=option],[role=switch],[role=checkbox]";
  const nhan = (el: Element): string => {
    const h = el as HTMLElement;
    const t = (h.getAttribute("aria-label") || h.innerText || h.getAttribute("placeholder") || h.getAttribute("title") || h.getAttribute("href") || "").replace(/\s+/g, " ").trim();
    return `${el.tagName.toLowerCase()}${t ? ` «${t.slice(0, 48)}»` : ""}`;
  };
  const trongVungCuonNgang = (el: Element): boolean => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  // Phần tử bị CẮT bởi vùng cuộn/khung của chính tổ tiên nó (ví dụ mục của danh sách thả đã cuộn khỏi tầm nhìn) thì không "bị che", chỉ là chưa tới lượt cuộn.
  const biCatBoiToTien = (el: Element, r: DOMRect): boolean => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const pr = p.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) return true;
    }
    return false;
  };
  const an = (el: Element): boolean => {
    for (let p: Element | null = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return true;
      if (p.getAttribute("aria-hidden") === "true" || p.hasAttribute("inert")) return true;
    }
    return false;
  };

  const mau: Mau[] = [];
  Array.from(document.querySelectorAll(sel)).forEach((el, k) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || an(el)) return;
    if (r.bottom <= 0 || r.top >= vh) return;
    const trong = r.top >= 0 && r.bottom <= vh; // nằm TRỌN trong khung nhìn theo chiều dọc ⇒ mới xét "bị che"
    const ngoai = (r.right > vw + 1 || r.left < -1) && !trongVungCuonNgang(el);
    let biChe: string | null = null;
    if (trong && r.left < vw && r.right > 0 && !biCatBoiToTien(el, r)) {
      const cx = Math.min(Math.max((Math.max(r.left, 0) + Math.min(r.right, vw)) / 2, 0), vw - 1);
      const cy = (r.top + r.bottom) / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) {
        // nhãn bọc ô nhập (label ⊃ input) và phần tử rỗng phủ `after:inset-0` (vùng bấm mở rộng của hàng/thẻ) là CÙNG một khối bấm.
        const cungNhan = el.closest("label") !== null && el.closest("label") === top.closest("label");
        const vungMoRong = !!el.closest("tr[class*='cursor-pointer'], [class*='after:inset-0']") || !!top.closest("tr[class*='cursor-pointer'], [class*='after:inset-0']");
        if (!cungNhan && !vungMoRong && top.tagName !== "NEXTJS-PORTAL") biChe = nhan(top); // nextjs-portal = lớp phủ DEV của Next (chỉ có ở `next dev`)
      }
    }
    const display = getComputedStyle(el).display;
    const trongDoan = el.tagName === "A" && display === "inline";
    // Vùng bấm mở rộng: liên kết có ::after phủ `absolute inset-0` thì VÙNG CHẠM THẬT là khối được định vị gần nhất (cả hàng/thẻ), không phải chữ của liên kết.
    let w = Math.round(r.width);
    let h = Math.round(r.height);
    const sau = getComputedStyle(el, "::after");
    if (sau.position === "absolute" && sau.content !== "none") {
      const op = (el as HTMLElement).offsetParent;
      if (op) {
        const orr = op.getBoundingClientRect();
        w = Math.round(orr.width);
        h = Math.round(orr.height);
      }
    }
    const tick = (el.tagName === "INPUT" && ["checkbox", "radio"].includes((el as HTMLInputElement).type)) || trongDoan;
    const cs = getComputedStyle(el);
    mau.push({ la: el.tagName, k, ten: nhan(el), trong, ngoai, biChe, w, h, l: Math.round(r.left), r: Math.round(r.right), tick, chuCat: cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1 });
  });
  return { mau, vw };
}

/**
 * Đo một màn ở vị trí hiện tại: tràn ngang + quét tương tác theo từng bước cuộn của vùng cuộn chính (`<main>` nếu cuộn được, không thì cửa sổ).
 * Gọi SAU khi màn đã dựng xong (nơi gọi tự chờ phần tử đặc trưng của màn).
 */
export async function quetMan(page: Page, info: TestInfo, man: string, opts: { chup?: boolean } = {}): Promise<KetQuaMan> {
  const tran = await doTranNgang(page);
  const phatHien: PhatHien[] = [];
  if (tran.px > 0) phatHien.push({ muc: "CAO", loai: "tran-ngang", chiTiet: `${tran.px}px — ${tran.thuPham}` });

  // Vùng cuộn để quét: hộp thoại/sheet đang mở (nếu cuộn được) > `<main>` (khung admin cuộn trong main) > cửa sổ. Gắn dấu `data-quet-cuon` để các bước sau tìm lại đúng phần tử.
  const buoc = await page.evaluate(() => {
    document.querySelectorAll("[data-quet-cuon]").forEach((e) => e.removeAttribute("data-quet-cuon"));
    const cuonDuoc = (e: Element) => e.scrollHeight > e.clientHeight + 4 && ["auto", "scroll"].includes(getComputedStyle(e).overflowY);
    const hop = Array.from(document.querySelectorAll("[role=dialog]")).filter((d) => d.getBoundingClientRect().width > 0).pop();
    let dich: Element | null = null;
    if (hop) dich = [hop, ...Array.from(hop.querySelectorAll("*"))].find(cuonDuoc) ?? null;
    if (!dich && !hop) {
      const main = document.querySelector("main");
      if (main && cuonDuoc(main)) dich = main;
    }
    if (dich) dich.setAttribute("data-quet-cuon", "1");
    const cuonMain = !!dich;
    return { cuonMain, tong: dich ? dich.scrollHeight : document.documentElement.scrollHeight, khung: dich ? dich.clientHeight : window.innerHeight };
  });
  const buocCuon = Math.max(buoc.khung - 120, 200);
  const soBuoc = Math.min(10, Math.max(1, Math.ceil(buoc.tong / buocCuon)));

  // gom theo phần tử (chỉ số `k` trong tài liệu) qua mọi bước cuộn
  const theoPhanTu = new Map<number, { la: string; ten: string; ngoai: boolean; w: number; h: number; l: number; r: number; tick: boolean; chuCat: boolean; soLanTrong: number; soLanChe: number; cheBoi: string }>();
  for (let i = 0; i < soBuoc; i++) {
    await page.evaluate(
      ([cuonMain, y]) => {
        if (cuonMain) document.querySelector("[data-quet-cuon]")!.scrollTo(0, y as number);
        else window.scrollTo(0, y as number);
      },
      [buoc.cuonMain, i * buocCuon] as const,
    );
    await page.waitForTimeout(60);
    // ảnh MỖI bước cuộn (tối đa 6): soi bằng mắt cả phần dưới nếp gấp, không chỉ màn đầu
    if (opts.chup !== false && i < 6) await page.screenshot({ path: info.outputPath(`${man.replace(/[^a-z0-9]+/gi, "-")}-${i + 1}.png`), fullPage: false });
    const { mau } = await page.evaluate(doTrongTrang);
    for (const m of mau) {
      const cu = theoPhanTu.get(m.k) ?? { la: m.la, ten: m.ten, ngoai: false, w: m.w, h: m.h, l: m.l, r: m.r, tick: m.tick, chuCat: false, soLanTrong: 0, soLanChe: 0, cheBoi: "" };
      cu.ngoai ||= m.ngoai;
      cu.chuCat ||= m.chuCat;
      if (m.trong) {
        cu.soLanTrong += 1;
        if (m.biChe) {
          cu.soLanChe += 1;
          cu.cheBoi = m.biChe;
        }
      }
      theoPhanTu.set(m.k, cu);
    }
  }
  await page.evaluate((cuonMain) => (cuonMain ? document.querySelector("[data-quet-cuon]")!.scrollTo(0, 0) : window.scrollTo(0, 0)), buoc.cuonMain);

  for (const p of theoPhanTu.values()) {
    if (p.ngoai) phatHien.push({ muc: "CAO", loai: "ngoai-khung", chiTiet: `${p.ten} left=${p.l} right=${p.r}` });
    // bị che = che ở MỌI lần nằm trọn trong khung nhìn (không có tư thế cuộn nào lộ ra)
    if (p.soLanTrong > 0 && p.soLanChe === p.soLanTrong) phatHien.push({ muc: "CAO", loai: "bi-che", chiTiet: `${p.ten} bị che bởi ${p.cheBoi}` });
    if (!p.tick) {
      // nút hình vuông/biểu tượng: cạnh NGẮN quyết định; nút chữ dài: chiều cao quyết định.
      const nho = p.w < p.h * 1.5 ? Math.min(p.w, p.h) : p.h;
      // Liên kết CHỮ (thẻ <a>, không phải nút): WCAG 2.5.8 miễn khi là chữ trong dòng; chỉ CAO khi thấp hơn 16px (không đọc nổi cũng không chạm nổi).
      const nguong = p.la === "A" ? 16 : CHAM_CAO;
      if (nho < nguong) phatHien.push({ muc: "CAO", loai: "vung-cham-nho", chiTiet: `${p.ten} ${p.w}×${p.h}px` });
      else if (nho < CHAM_TOI_THIEU) phatHien.push({ muc: "THAP", loai: "vung-cham-nho", chiTiet: `${p.ten} ${p.w}×${p.h}px` });
    }
    if (p.chuCat) phatHien.push({ muc: "THAP", loai: "co-chu", chiTiet: `${p.ten} bị cắt chữ (ellipsis)` });
  }

  // Hàng bảng phình cao (ví dụ cột thao tác bẻ nút thành cột dọc): không phải "không dùng được" nên là THẤP, nhưng các ca nào đã vá thì tự khẳng định ngưỡng riêng qua `hangBangCaoNhat`.
  const hangBangCaoNhat = await page.evaluate(() => Math.round(Math.max(0, ...Array.from(document.querySelectorAll("tbody tr")).filter((r) => r.getClientRects().length > 0).map((r) => r.getBoundingClientRect().height))));
  if (hangBangCaoNhat > HANG_BANG_CAO) phatHien.push({ muc: "THAP", loai: "hang-bang-cao", chiTiet: `hàng bảng cao ${hangBangCaoNhat}px (> ${HANG_BANG_CAO}px)` });
  const ketQua: KetQuaMan = { man, tranPx: tran.px, soPhanTuTuongTac: theoPhanTu.size, phatHien, hangBangCaoNhat };
  await info.attach(`quet-375-${man}`, { body: JSON.stringify(ketQua, null, 2), contentType: "application/json" });
  return ketQua;
}

export const cao = (k: KetQuaMan): PhatHien[] => k.phatHien.filter((p) => p.muc === "CAO");
export const thap = (k: KetQuaMan): PhatHien[] => k.phatHien.filter((p) => p.muc === "THAP");
