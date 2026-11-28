# So pixel public site: artifact ↔ Next.js

Bộ công cụ cho bước kiểm [5] của brief PUB-V2: mở bản artifact (đúng runtime canvas) và bản Next.js cạnh nhau,
chụp cùng điều kiện, đo % điểm ảnh lệch (mục tiêu ≤ 0,5%).

## Chạy

Trước tiên bật dev server Next ở `:3000` (đã có). Máy chủ artifact (`:4800`) được `so-sanh.mjs` tự bật nếu chưa chạy.
Mọi lệnh nặng chạy qua cổng chung, MỖI LÚC MỘT lệnh:

```bash
export MSYS_NO_PATHCONV=1   # Git Bash: không thì "/" bị đổi thành "C:/Program Files/Git/" (so-sanh.mjs đã tự gỡ lại, nhưng đường dẫn có "/x/y" thì không)
SP="C:/Users/ADMIN/AppData/Local/Temp/claude/E--Worktree-satarobo-vn-disc/f66174ac-bd05-4f57-a0d6-5f679af94bc3/scratchpad"
cd /e/Worktree/satarobo-vn/disc
export SP    # để máy chủ artifact thêm thư mục đệm ảnh của các phiên trước vào đường tìm /_blob/<id>

# một trang: sáng + tối × 1440 + 390 (ảnh TOÀN TRANG)
bash "$SP/gate.sh" node tests/visual/so-sanh.mjs Main /
# thu hẹp
bash "$SP/gate.sh" node tests/visual/so-sanh.mjs KhoaHoc-sata3 /khoa-hoc/sata3 --theme dark --w 390
# chỉ màn hình đầu (nhanh)
bash "$SP/gate.sh" node tests/visual/so-sanh.mjs Main / --fold
# mọi cặp trong bảng ánh xạ (tests/visual/pages.mjs) — LÂU; nên chạy theo nhóm:
bash "$SP/gate.sh" node tests/visual/so-sanh.mjs --all --only Main,About,Courses
node tests/visual/so-sanh.mjs --list           # liệt kê tên trang artifact
# trang artifact có nhiều màn (prop): đặt prop cho bản artifact
bash "$SP/gate.sh" node tests/visual/so-sanh.mjs Disc-LamBai /disc/bat-dau --props manHinh=banNhap,boCon=TH
```

Ảnh ghi ở `tests/visual/out/<trang>-<sáng|tối>-<rộng>-{art,next,diff}.png` (+ `tong-hop.json`). Ảnh `diff`: điểm lệch tô
đỏ/vàng; vùng thừa do hai trang cao khác nhau tô **hồng**. Thoát mã 1 khi có cặp lệch > ngưỡng (`--threshold`, mặc định 0,5),
còn phần tử hiện-dần kẹt `opacity<1`, tràn ngang (`scrollWidth ≠ clientWidth`) hoặc không chụp được.

Chỉ xem bản artifact trong trình duyệt: `node tests/visual/artifact-server.mjs` rồi mở `http://localhost:4800/Main`
(hoặc `/Courses`, `/KhoaHoc-sata3`, ...; `/` liệt kê hết).

## Cách đo (để số có nghĩa)

- Kích thước 1440×900 và 390×844, `deviceScaleFactor` 1, `prefers-reduced-motion: no-preference`, giờ cố định, múi giờ VN.
- CÙNG một đoạn khởi tạo cho hai bên: `Math.random` có hạt giống; `setTimeout` ≥ 15 s bị vô hiệu (popup đăng ký 20 s/60 s
  không bật); `localStorage 'sata-theme'` đặt theo chủ đề; đã đồng ý cookie (bản Next) + ẩn banner + ẩn chỉ báo dev của Next;
  `window.__sataLite = true` ⇒ **cả hai bên chỉ hiện poster, không dựng 3D** (xem "Hạn chế").
- Cuộn từng đoạn ~600 px (chờ 170 ms) cho IntersectionObserver của fx.js gắn `data-fx-sv`, đợi 2,2 s cho count-up/decrypt,
  đo `.sv`/`.a-*` còn `opacity<1` và `scrollWidth`, cuộn về đầu, chờ font + ảnh, chụp với `animations:'disabled'`.
- So bằng pixelmatch `threshold 0.1`. Hai ảnh cao khác nhau: so phần chung, **phần thừa tính là lệch** (chia cho diện tích
  khổ lớn) và in cả hai chiều cao. Trang tự tải lại giữa lúc chụp (HMR do agent khác sửa) ⇒ chụp lại một lần, vẫn lại ⇒ cờ "không ổn định".
- Kiểm công cụ: so một trang với CHÍNH NÓ phải 0 % (`--next http://localhost:4800` và route `/Main.dc.html`); so với trang khác phải lớn.

## Hạn chế (nói thật)

1. **Runtime thật.** `tests/visual/vendor/dc-runtime.js` là `artifact-type/dc-runtime.js` lấy từ artifact Design (đã gồm React 18),
   nên `<x-dc>`, `sc-if`, `sc-for`, `DCLogic` chạy đúng như canvas. Nếu thiếu: tải lại bằng công cụ `Artifact` `read`
   `paths:["artifact-type/dc-runtime.js"]` của https://claude.ai/artifact/NMHqA7PEVD9SESMCDu75ex rồi chép vào `vendor/`
   (hoặc đặt biến `DC_RUNTIME=<đường dẫn>`).
2. **3D không so được.** Bản nguồn artifact-src KHÔNG có `three.js`, các tệp `SATA_GLB_*` (glb base64) và texture 3D
   (`/_blob/4ef61667…`, `b4138cbf…`, `efea9a76…`…): máy chủ trả đoạn rỗng và ghi log. Vì vậy hai bên đều ở chế độ nhẹ (poster tĩnh).
   Khung 3D thật chỉ kiểm bằng mắt trên artifact gốc.
3. **Ảnh thiếu** trong `public/pub` nhưng có ở đệm của phiên trước: đặt `SP` (như trên) hoặc `PUB_ASSET_DIRS="dir1;dir2"`.
   Ảnh không tìm thấy ở đâu ⇒ ảnh 1×1 trong suốt + dòng log `THIẾU /_blob/<id>` ⇒ phần lệch do đó **không phải lỗi của trang Next**.
4. Font: CSS/woff2 Google Fonts của bản artifact tải 1 lần qua máy chủ rồi lưu `tests/visual/.cache/` (chạy offline được sau đó);
   bản Next dùng `next/font` (cùng tệp font) nên lệch do font chỉ còn nếu hai bên khác họ/trọng lượng.
5. Runtime canvas có thể bọc `sc-if`/`sc-for` bằng phần tử trung gian; bản Next thì không (đúng brief). Lệch bố cục nhỏ do khác biệt này nếu có là thật và cần xem ảnh diff.
6. Artifact tải ảnh `Mobile-*` không dùng: trang thật responsive, so ở khổ 390 bằng chính trang đó.
