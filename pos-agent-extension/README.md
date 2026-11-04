# SataRobo POS Agent — Chrome extension (GĐ5 POS)

Đọc giao dịch thẻ SmartPOS từ **merchant portal Techcombank** trong phiên của người đã đăng nhập,
rồi gửi về satarobo (`/api/pos-agent/*`) để phiếu thu thẻ tự khớp. Chạy 24/7 trên **máy POS Agent**,
mỗi cơ sở một **hồ sơ Chrome** riêng (CS1, CS2).

- Hợp đồng với máy chủ: [`docs/pos-agent-api.md`](../docs/pos-agent-api.md) (phiên bản 1, **bản sửa 1.1** — header
  `X-Agent-Contract` vẫn `1`; tệp trùng sha256 với worktree máy chủ GĐ4).
- Thiết kế + các điểm TỰ QUYẾT + phần còn chờ đo: [`docs/pos-gd5-thiet-ke.md`](../docs/pos-gd5-thiet-ke.md) (phụ lục
  "HỢP ĐỒNG 1.1" cho phần đổi theo bản sửa 1.1).

### Hợp đồng 1.1 — extension làm gì khác bản 1

| Luật 1.1 | Extension | Nếu lệch |
|---|---|---|
| Trần độ dài TỪNG trường = cột "Trần · vượt (agent)" bảng §6.1 | `TRAN_GIAO_DICH` (`src/lib/payload.ts`) = đúng cột; vượt ⇒ `cắt` (giữ N ký tự đầu) hoặc `null`; hai trạng thái · `currency` · `store_code` luôn CẮT (null = máy chủ bỏ phép kiểm) | Máy chủ từ chối DÒNG `FIELD_TOO_LONG` (xem §4) |
| Lô `final:true` mang `windowTo` của CẢ LƯỢT | mốc cuối mảnh cuối, kể cả khi mảnh cuối rỗng | Job của sale kẹt PENDING ("chưa trả lời kịp") |
| `rejected[]` có `FIELD_TOO_LONG` + `field` | `/status ERROR FIELD_TOO_LONG` MỘT lần; KHÔNG bỏ dòng, KHÔNG gửi lại lô, KHÔNG giữ `jobIds` (dòng đã có dấu ở máy chủ) | — |
| `/status` chỉ gửi mốc `exp` của access token | sự kiện `SESSION_READY` chỉ mang mốc nguồn `ACCESS_TOKEN`; nguồn khác ⇒ bỏ khoá | Máy chủ lưu hạn phiên sai |
| Máy chủ CŨ (1.0) trả 400 cho dòng dài | giữ đường "bỏ dòng ở `field` rồi gửi lại" (lượt đó không đóng job) — CHỈ với dòng THANH TOÁN; 400 trỏ dòng hủy / hoàn / loại lạ / thiếu loại ⇒ DỪNG cả lượt (rà đối kháng 1.1) | Bỏ dòng hủy = thanh toán cùng RRN vào sổ một mình |
| Dòng hủy / hoàn bị máy chủ TỪ CHỐI — máy chủ chỉ GIỮ LẠI thanh toán cùng RRN khi thấy dòng hủy TRONG CÙNG lô (RVG-02 của GĐ4) | KHÔNG tự lọc dòng nào: mọi loại (PAYMENT · VOID · REFUND · loại lạ), kể cả dòng đã bị từ chối ở lượt trước, được gửi lại mỗi lượt còn trong cửa sổ (`[EXT-BDP-35]`) | Thanh toán của lần quẹt đã hủy vào sổ |

## Extension làm gì và KHÔNG làm gì

| Làm | Không bao giờ làm |
|---|---|
| Gọi đúng **hai** API của portal, TRONG trang portal: `GET /api/auth/session` và `POST /api/partners/merchant-portal/{merchantCode}/v2/transactions/search` (đúng merchant cấu hình) | Gọi bất kỳ URL nào khác của portal — hoàn trả, nhân viên, đổi mật khẩu, đăng xuất… (chặn cứng, có test) |
| Gửi về satarobo các **trường giao dịch** theo whitelist hợp đồng §6.1 + **mốc** hết hạn phiên | Gửi token, cookie, header (`X-API-Auth`, `x-api-payment`, `X-Device-ID`), `deviceId`, tên chủ thẻ (`sender_card_name`), `device_id` của dòng |
| Ký HMAC-SHA256 mọi request tới satarobo (bí mật chỉ nằm ở `chrome.storage.local` của hồ sơ) | Lưu mật khẩu portal, tự đăng nhập, vượt reCAPTCHA |
| Giữ **một** tab portal ghim ở `/soft-pos-transaction`; báo hết phiên để admin đăng nhập lại | Mở cổng nhận kết nối (chỉ kết nối ĐI RA); cho trang web khác nói chuyện với extension |

## 1. Dựng gói (máy dev, từ gốc repo)

```bash
pnpm exec tsx pos-agent-extension/scripts/dong-goi.ts                    # cả PROD và TEST
pnpm exec tsx pos-agent-extension/scripts/dong-goi.ts --moi-truong=PROD  # chỉ PROD
```

Ra (đã `.gitignore`):

| Tệp | Dùng cho |
|---|---|
| `pos-agent-extension/dist/satarobo-pos-agent-<ver>-prod.zip` | máy agent thật — gọi `https://admin.satarobo.vn` |
| `pos-agent-extension/dist/satarobo-pos-agent-<ver>-test.zip` | thử trên `https://test.satarobo.vn` |
| `pos-agent-extension/dist/prod/`, `dist/test/` | thư mục nạp thẳng được ("Load unpacked") |

Lệnh in **SHA-256** của từng `.zip` — ghi lại để so sau khi chép sang máy agent. Cùng mã nguồn ⇒ cùng
SHA-256 (gói nén tất định). Mỗi gói chỉ được phép gọi ĐÚNG MỘT địa chỉ satarobo (hợp đồng §1): gói PROD
không gửi được tới TEST và ngược lại.

> Bản theo hợp đồng 1.1 vẫn mang phiên bản `0.1.0` (bản `0.1.0` trước 1.1 CHƯA từng được cài lên máy agent; thân
> heartbeat của test vector V2 neo chuỗi đó). Phân biệt bản build bằng **SHA-256** — số của bản 1.1 ghi ở phụ lục
> "HỢP ĐỒNG 1.1" của `docs/pos-gd5-thiet-ke.md`. Gói dựng TRƯỚC bản sửa 1.1 KHÔNG được cài.

## 2. Cài trên máy POS Agent — 2 hồ sơ Chrome (CS1, CS2)

> Làm lần lượt cho **từng** hồ sơ. Mỗi cơ sở có agent riêng trên satarobo (agentId + bí mật riêng),
> tài khoản portal riêng (`pos.cs1` / `pos.cs2`), merchant riêng (`NCCPH6KE` / `NCCQYY4D`).

1. **Chép + kiểm gói.** Chép `satarobo-pos-agent-<ver>-prod.zip` sang máy agent, chạy
   `certutil -hashfile satarobo-pos-agent-<ver>-prod.zip SHA256` — phải trùng SHA-256 lúc dựng.
   Giải nén vào thư mục CỐ ĐỊNH, vd `C:\SataRoboPOSAgent\0.1.0\` (đừng xoá thư mục này sau khi cài —
   "Load unpacked" chạy thẳng từ đó). Hai hồ sơ dùng chung một thư mục mã là được (kho dữ liệu tách
   theo hồ sơ).
2. **Tạo hồ sơ Chrome** "POS CS1" (và "POS CS2"). Hồ sơ này **CHỈ** cài extension này — không cài
   extension nào khác (extension khác trên cùng trang nhìn được kênh `postMessage` của trang).
   Không đăng nhập tài khoản Google, tắt đồng bộ.
3. `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục ở bước 1.
   Ghim icon extension lên thanh công cụ (để thấy huy hiệu trạng thái).
4. Trên satarobo: **Biến động số dư → Sức khoẻ POS Agent** → khối **Thêm POS Agent** → **Tạo và lấy cấu hình** cho đúng cơ sở. Hộp thoại
   hiện 5 ô **một lần duy nhất** — giữ hộp thoại mở tới khi dán xong.
5. Bấm icon extension (hoặc `chrome://extensions` → Details → Extension options) → dán `agentId`,
   `centerCode` (CS1/CS2), `merchantCode`, chọn địa chỉ satarobo, dán `agentSecret` → **Lưu cấu hình**.
   Ô bí mật sẽ trống lại ngay — đúng thiết kế (không bao giờ hiện lại).
6. Extension tự mở một **tab ghim** `https://merchant.techcombank.com/soft-pos-transaction`. Đăng nhập
   portal **trong tab đó** bằng tài khoản bot của đúng cơ sở (reCAPTCHA do người làm). Sau khi đăng nhập,
   để tab ở trang giao dịch — app portal tự gọi search, extension học header từ lời gọi đó.
7. **Memory Saver**: `chrome://settings/performance` → Memory Saver → *Always keep these sites active* →
   thêm `merchant.techcombank.com`. (Extension cũng tự đặt tab của nó `autoDiscardable = false`.)
8. **Máy không ngủ / Chrome luôn chạy**: Windows → Power → *Sleep: Never*; Chrome → Settings → System →
   *Continue running background apps when Google Chrome is closed* = BẬT. Tạo shortcut khởi động cùng
   Windows cho từng hồ sơ: `chrome.exe --profile-directory="Profile 1"` (tên thư mục hồ sơ xem ở
   `chrome://version` → Profile Path).
   **Đồng bộ giờ Windows** (RV5): Settings → Time & language → Date & time → *Set time automatically* = BẬT,
   bấm *Sync now*. Máy nhóm làm việc mặc định 7 ngày mới đồng bộ một lần — extension đã tự hiệu chỉnh mốc
   cuối cửa sổ theo giờ máy chủ satarobo (+2 phút biên), nhưng đồng hồ đúng vẫn là tuyến phòng thủ đầu.
9. Kiểm: trang Options → **Kiểm tra kết nối ngay** → "Phiên portal: Đang đăng nhập (READY)"; màn Sức khoẻ
   POS Agent trên satarobo: thẻ của cơ sở mang nhãn **"Đang làm việc"**.

## 3. Vận hành hằng ngày

Huy hiệu trên icon:

| Huy hiệu | Nghĩa | Việc của người |
|---|---|---|
| (trống) | READY, đồng bộ bình thường | — |
| `HẾT` (đỏ) | Phiên portal đã hết | Remote vào máy agent, mở hồ sơ CSx, **đăng nhập lại trong tab ghim**. Extension tự thấy và quét bù |
| `LỖI` (cam) | Có lỗi đang mở (di chuột lên icon để xem mã) | Xem bảng §4 |
| `DỪNG` (đỏ) | Bí mật sai / agent bị tắt / merchant lệch satarobo | Dán lại cấu hình đúng từ satarobo |
| `CHƯA` (xám) | Chưa cấu hình | Làm bước 4–5 |
| `…` (xám) | Đang kiểm phiên | Chờ 1 phút |

- **Đừng dùng tab ghim để làm việc khác** — cần xem portal thì mở tab mới. Extension có thể đưa tab ghim
  về `/soft-pos-transaction` khi cần học lại header (tối đa một lần mỗi đợt lỗi).
- Không đóng Chrome của hồ sơ agent. Lỡ đóng thì mở lại — extension tự chạy, tự quét bù.
- Lộ/mất bí mật ⇒ satarobo **Tạo lại bí mật** (thẻ máy trên màn Sức khoẻ POS Agent) ⇒ dán bí mật mới vào Options (bí mật cũ chết ngay).

## 4. Mã lỗi thường gặp (hiện ở Options + màn Sức khoẻ POS Agent)

| Mã | Nghĩa | Xử lý |
|---|---|---|
| `HEADER_NOT_CAPTURED` | Chưa học được header app portal (extension đã tự tải lại tab một lần) | Mở tab ghim, bấm làm mới danh sách giao dịch trên portal; vẫn lỗi ⇒ xem mục "Chờ đo DevTools" |
| `BODY_ENCRYPTED` | Thân search của portal không phải JSON thuần như đã đo — extension KHÔNG đoán thuật toán | Báo dev — cần đo lại (mục 5) |
| `PORTAL_HTTP_ERROR` | Portal trả lỗi HTTP / mất mạng | Tự thử lại mỗi phút; kéo dài ⇒ kiểm mạng máy agent |
| `PORTAL_BAD_SHAPE` | Phản hồi portal khác hình dạng đã đo | Báo dev |
| `PORTAL_TAB_MISSING` | Tab portal không phản hồi (đã tải lại một lần) | Đóng tab ghim — extension mở lại |
| `SYNC_FAILED` | satarobo từ chối lô (lỗi mã); hoặc (RV5, chỉ còn với máy chủ CŨ bản 1.0) trả 400 trỏ MỘT dòng THANH TOÁN ⇒ extension bỏ đúng dòng đó, các dòng khác vẫn tới, nhưng job của sale KHÔNG được đóng cho tới khi dòng đó ra khỏi cửa sổ (~2 giờ); 400 trỏ dòng hủy / hoàn / loại lạ ⇒ extension DỪNG cả lượt (không bỏ tín hiệu hủy — bỏ là để thanh toán cùng RRN vào sổ một mình) | Báo dev kèm giờ xảy ra; giao dịch bị bỏ đi đường import file |
| `FIELD_TOO_LONG` | (1.1) Máy chủ từ chối một DÒNG vì một trường dài hơn trần hợp đồng §6.1 ⇒ extension đang LỆCH hợp đồng (bản đúng làm vừa trần trước khi gửi). Trang Options hiện kèm tên trường, vd `FIELD_TOO_LONG (store_code)`. Dòng đó không vào sổ (file import là dự phòng); các dòng khác + job của sale vẫn chạy bình thường; máy chủ tự báo admin. Báo `/status` đúng MỘT lần — mã giữ mở tới khi nạp lại extension, khởi động lại Chrome hoặc bấm **Lưu cấu hình** (kho phiên mới) | Báo dev kèm tên trường; cập nhật extension (đóng gói lại từ nhánh mới nhất, cài lại) |
| `MERCHANT_CONFIG_MISMATCH` | `merchantCode` ở Options khác merchant satarobo gắn cho agent | Dán lại cấu hình đúng cơ sở |

## 5. CHỜ ĐO DEVTOOLS (trên máy agent, hồ sơ CS1 đã đăng nhập `pos.cs1`)

Những thứ dưới đây **chưa đo được** khi viết GĐ5. Extension đang chạy theo phương án dự phòng an toàn;
đo xong thì ghi KẾT LUẬN (bản chất, **không chép giá trị** header/token vào ticket/chat).

Cách đo chung: mở tab portal → F12 → **Network** → lọc `transactions/search` → bấm làm mới danh sách
giao dịch trên portal → chọn request.

| # | Cần đo | Xem ở đâu | Đang làm (dự phòng) | Nếu kết quả khác |
|---|---|---|---|---|
| 1 | `X-API-Auth` dựng thế nào — cố định cả phiên hay đổi theo từng request (có giống chữ ký/thời gian?) | Headers của 2–3 request search liên tiếp: giá trị có đổi giữa các lần không | Học header từ lời gọi THÀNH CÔNG gần nhất của app rồi dùng lại | Nếu đổi theo từng request: lời gọi của extension bị 401 ngay sau mỗi lần đăng nhập (`SESSION_EXPIRED` / `HTTP_401` lặp lại) ⇒ phải dựng header như app (cần đọc mã JS của portal) |
| 2 | `x-api-payment` — như trên | như trên | như trên | như trên |
| 3 | `X-Device-ID` = `localStorage.device_id`? | Application → Local Storage | dùng lại giá trị app gửi | — |
| 4 | Thân search có **mã hoá** không | Payload của request: JSON đọc được (`page_index`, `transaction_time_from`…) hay chuỗi lạ | Thân JSON thuần như roadmap §2.3; không phải ⇒ `BODY_ENCRYPTED`, dừng | Báo dev; không tự đoán thuật toán |
| 5 | App gọi search bằng `fetch` hay `XMLHttpRequest` | Cột *Type* (fetch / xhr) | bắt cả hai | — |
| 6 | `page_size` tối đa portal nhận; khoảng ngày tối đa của một lần search | Thử trên portal (đổi số dòng/trang, chọn khoảng ngày dài) | 50 dòng/trang, mỗi lần ≤ 24 giờ, đếm theo `total_items` | Portal ép cỡ trang khác: extension vẫn đúng (đếm dòng thật nhận được) |
| 7 | Hết phiên thì app chuyển về `/login` đúng không | Để phiên hết (hoặc đăng xuất ở tab khác) rồi quan sát URL tab | coi `/login` là tín hiệu hết phiên thứ 3 | Đường khác ⇒ sửa `DUONG_DANG_NHAP` (`src/lib/hang-so.ts`); tín hiệu 1 (session không có `user`) và 2 (401/403) vẫn chạy |
| 8 | `accessToken` trong `/api/auth/session` có phải JWT có `exp` | Response của `api/auth/session`: chuỗi 3 phần ngăn bởi `.` | đọc `exp` từ JWT (`ACCESS_TOKEN`); không được ⇒ **không biết hạn** (`sessionExpiresAt = null`). RV5: KHÔNG lùi về `expires` của phiên — NextAuth JWT làm nó TRƯỢT (+30 ngày ở mỗi lần gọi). 1.1: `/status SESSION_READY` chỉ mang mốc nguồn `ACCESS_TOKEN` (nguồn khác ⇒ bỏ khoá) | Không phải JWT ⇒ màn Sức khoẻ không hiện hạn phiên và chuông 07:30 "sắp hết phiên" KHÔNG rung — chỉ còn chuông "đã hết phiên" |
| 10 | Portal nhận `transaction_time_to` ở TƯƠNG LAI không (RV5: extension gửi giờ máy chủ + 2 phút) | Search tay với mốc cuối = giờ hiện tại + vài phút | gửi tương lai ≤ 2′ + lệch giờ | Portal từ chối ⇒ `PORTAL_HTTP_ERROR` mỗi lượt ⇒ hạ `BIEN_CUOI_CUA_SO_MS` về 0 (`src/lib/hang-so.ts`) |
| 11 | `meta.page_index` đánh số từ 0 hay 1; portal có tôn trọng `page_index` | So `meta.page_index` với `page_index` đã gửi ở trang 2 | RV5: trang trả lại y hệt trang trước ⇒ `SYNC_FAILED` (`THIEU_DONG`), không báo xong | Cần chặn theo `meta.page_index` thì thêm sau khi đo |
| 9 | Ba trường số tiền khác nhau khi nào; tập giá trị `transaction_type` / trạng thái; dòng `VOID` có mã giao dịch gốc không; trường lý do thất bại | Response của search | Gửi nguyên giá trị theo whitelist §6.1 — máy chủ quyết | Thêm trường tuỳ chọn ⇒ nâng hợp đồng (máy chủ trước) |

## 6. Phát triển

```bash
pnpm exec vitest run pos-agent-extension   # 18 tệp test (chạy cả trong pnpm test:unit)
pnpm exec eslint pos-agent-extension       # nằm trong pnpm lint
pnpm typecheck                             # tsconfig gốc phủ cả thư mục này
```

- Mã nguồn TypeScript ở `src/`; `scripts/dong-goi.ts` biên dịch bằng gói `typescript` sẵn có (không thêm
  phụ thuộc) và nén bằng `jszip` (đã có trong repo).
- `src/content-main.ts`, `src/content-isolated.ts` là **script cổ điển** (Chrome không nạp content script
  dạng module): KHÔNG `import`/`export`. Test nạp đúng bản biên dịch của chúng vào `node:vm`.
- Logic thuần ở `src/lib/*` (allowlist dựng lệnh, whitelist payload, phân trang, cửa sổ thời gian, máy
  trạng thái phiên, nhịp hỏi, ký HMAC, bộ điều phối) — test không cần trình duyệt.
