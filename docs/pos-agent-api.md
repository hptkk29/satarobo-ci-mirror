# Hợp đồng API POS Agent ↔ satarobo — phiên bản 1 (bản sửa 1.1)

> Chốt 07/10/2026 (GĐ4 POS). Nguồn: đặc tả GĐ4/GĐ5 (chủ dự án 07/10/2026), roadmap POS §2.3 · D8–D10,
> thiết kế phía server `docs/pos-gd4-thiet-ke.md`. Mã nền đo trên `origin/test` @ `f452bc531`.
>
> **Đủ để viết Chrome extension "SataRobo POS Agent" (GĐ5) mà KHÔNG đọc mã server.** Mọi chỗ ghi
> PHẢI / KHÔNG ĐƯỢC là luật; server từ chối khi vi phạm. Test vector ở §3.8 tính bằng `node:crypto`
> VÀ WebCrypto (`crypto.subtle`) — hai bên ra cùng chữ ký.
>
> **Bản sửa 1.1 — CHỐT HỢP ĐỒNG GĐ4 ↔ GĐ5 (07/10/2026):** trần độ dài TỪNG trường (§6.1, cột "Trần · vượt") — máy
> chủ và extension so CÙNG bảng đó; vượt trần ⇒ từ chối DÒNG `FIELD_TOO_LONG` (+ `rejected[].field`) thay vì 400 cả
> lô (§6.1, §7.2); lô final mang `windowTo` của CẢ LƯỢT (§4.4) và máy chủ lưu nó làm "dữ liệu đã đọc tới"; nguồn mốc
> `SESSION` = KHÔNG rõ hạn (§4.1, §4.2). `X-Agent-Contract` VẪN là `1` — tương thích hai chiều (§9). Tệp này phải
> TRÙNG sha256 ở worktree GĐ4 (máy chủ) và GĐ5 (extension) — test hai phía đọc thẳng nó.

---

## 0. Tóm tắt

| # | Method | Path | Thân | Việc | Trả về (`data`) |
|---|---|---|---|---|---|
| 1 | `POST` | `/api/pos-agent/heartbeat` | JSON ≤ 4 096 byte | báo còn sống + trạng thái phiên + mốc hết hạn + phiên bản | `nextPollMs`, `serverTime`, `merchantCode`, `sessionState` |
| 2 | `POST` | `/api/pos-agent/status` | JSON ≤ 4 096 byte | báo SỰ KIỆN: phiên sống lại / hết phiên / lỗi | `sessionState`, `nextPollMs`, `serverTime` |
| 3 | `GET` | `/api/pos-agent/jobs` | **rỗng** (0 byte) | lấy yêu cầu "đồng bộ ngay" của chính agent | `jobs[]`, `nextPollMs`, `serverTime` |
| 4 | `POST` | `/api/pos-agent/transactions` | JSON ≤ 524 288 byte, ≤ 200 dòng | gửi giao dịch đọc từ portal | số đếm, `rejected[]` (+ `field` khi `FIELD_TOO_LONG`), `errors[]`, `jobsDone`, `nextPollMs` |

Mọi request: HTTPS, ký HMAC-SHA256 (§3), header `X-Agent-Contract: 1`. Mọi response: JSON
(`{ ok:true, data }` hoặc `{ ok:false, error:{ code, message, field?, requestId } }`), header
`X-Server-Time` (Unix ms) và `Cache-Control: no-store`. Không có CORS: chỉ **service worker (background)**
của extension gọi API này — trang web/ content script KHÔNG gọi.

---

## 1. Địa chỉ gốc và kênh

| Môi trường | `satAroboBaseUrl` |
|---|---|
| PROD | `https://admin.satarobo.vn` |
| TEST | `https://test.satarobo.vn` |

- `/api/*` đi thẳng tới handler ở MỌI host (`isInfraPath` — `lib/auth/route-policy.ts:272`), không bị đá
  302/308 theo vai. Dùng đúng host trong bảng; host khác không được hỗ trợ.
- Không dấu `/` cuối path (Next trả 308 sang bản không có `/`; chữ ký sẽ sai). Không query string —
  có `?…` là **400** (chuỗi query không được ký nên server không nhận).
- Chỉ kết nối ĐI RA từ máy agent tới hai địa chỉ trên. Server không bao giờ gọi vào máy agent.
- `host_permissions` của extension: `https://merchant.techcombank.com/*` + đúng một trong hai địa chỉ trên.

---

## 2. Khoá agent

### 2.1 Bộ cấu hình người dán vào trang Options của extension

| Ô | Ví dụ | Nguồn |
|---|---|---|
| `agentId` | `cm9posagentcs1test0000001` | màn Sức khoẻ POS Agent, lúc tạo |
| `merchantCode` | `NCCPH6KE` | = `merchant_code` của portal (CS1) |
| `centerCode` | `CS1` | chỉ để hiển thị trên extension — **server không đọc** |
| `agentSecret` | 64 ký tự hex thường | hiện **MỘT LẦN** lúc tạo / tạo lại |
| `satAroboBaseUrl` | `https://admin.satarobo.vn` | §1 |

### 2.2 Cách lấy

1. Quản trị tối cao (quyền `settings:edit`) mở **Biến động số dư → Sức khoẻ POS Agent**
   (`/bien-dong-so-du/pos-agent`), bấm **Tạo agent**, chọn cơ sở, nhập `merchant_code`.
2. Hộp thoại hiện đủ năm ô ở §2.1 kèm nút "Chép cấu hình". **Đóng hộp là mất** — server KHÔNG lưu bí mật
   nên không có màn nào hiện lại nó.
3. Mất / lộ bí mật ⇒ **Tạo lại secret**: bí mật cũ chết NGAY (request ký bằng nó nhận 401
   `BAD_SIGNATURE`), bí mật mới hiện một lần. Kế toán HO (quyền `payments:import-pos`) xem được màn
   nhưng không tạo/đổi được.

### 2.3 Định dạng + lưu giữ

- `agentSecret` = đúng **64 ký tự `[0-9a-f]`** (chữ thường). Trang Options PHẢI từ chối chuỗi khác
  (`/^[0-9a-f]{64}$/` sau khi `trim()`), không tự sửa hoa/thường.
- Chỉ lưu ở `chrome.storage.local`. KHÔNG hiện lại sau khi lưu (ô hiện "đã lưu — dán bí mật mới để
  thay"), KHÔNG log, KHÔNG gửi đi đâu — kể cả tới satarobo (server chỉ nhận CHỮ KÝ).
- Phía server (để hiểu, extension không cần làm): `agentSecret = hex(HMAC-SHA256(POS_AGENT_MASTER_KEY,
  agentId + ":" + secretVersion))`; DB chỉ giữ `secretVersion`. Đổi `POS_AGENT_MASTER_KEY` trên máy chủ ⇒
  MỌI agent phải nhận bí mật mới. Thiếu biến đó ⇒ mọi endpoint trả **503 `NOT_CONFIGURED`**.

---

## 3. Ký request (HMAC-SHA256) — CHÍNH XÁC

### 3.1 Header bắt buộc (mọi request)

| Header | Giá trị | Luật |
|---|---|---|
| `X-Agent-Contract` | `1` | phiên bản hợp đồng (§9). Khác ⇒ 400 `UNSUPPORTED_CONTRACT` |
| `X-Agent-Id` | `agentId` | `^[a-z0-9]{20,40}$` |
| `X-Agent-Ts` | Unix epoch **mili-giây**, thập phân, đúng 13 chữ số | `^[0-9]{13}$`, vd `1791343200000` |
| `X-Agent-Nonce` | ngẫu nhiên, mới cho MỖI request | `^[A-Za-z0-9_-]{16,64}$`; nên = 32 hex từ `crypto.getRandomValues(16 byte)` |
| `X-Agent-Sig` | chữ ký | `^[0-9a-f]{64}$` (server hạ chữ thường trước khi so) |
| `Content-Type` | `application/json` (có thể kèm `; charset=utf-8`) | BẮT BUỘC với POST; sai ⇒ 415 |

Header KHÔNG được ký là `X-Agent-Contract`, `Content-Type` — đúng chủ đích, đừng thêm chúng vào chuỗi ký.

### 3.2 Chuỗi ký

```
METHOD + "\n" + PATH + "\n" + TS + "\n" + NONCE + "\n" + BODY_SHA256_HEX
```

| Phần | Luật |
|---|---|
| `METHOD` | chữ HOA đúng như gửi: `GET` / `POST` |
| `PATH` | pathname đúng như gửi, bắt đầu bằng `/`, không host, không query, không `/` cuối — vd `/api/pos-agent/heartbeat` |
| `TS` | đúng chuỗi trong `X-Agent-Ts` (không đổi định dạng, không thêm khoảng trắng) |
| `NONCE` | đúng chuỗi trong `X-Agent-Nonce` |
| `BODY_SHA256_HEX` | 64 hex **thường** của SHA-256 trên **đúng các byte thân request đã gửi** (UTF-8). Thân rỗng (GET) ⇒ `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

- Dấu ngăn là `"\n"` (LF, `0x0A`), đúng **4** dấu, **không** có `"\n"` sau phần cuối.
- Băm **chuỗi JSON đúng như sẽ gửi** — `const body = JSON.stringify(obj)` một lần, băm `body`, gửi
  `body`. Đừng `JSON.stringify` hai lần (thứ tự khoá/ khoảng trắng có thể khác ⇒ 401).

### 3.3 Khoá và chữ ký

- **Khoá HMAC = các byte UTF-8 của chuỗi `agentSecret` (64 ký tự)** — KHÔNG hex-decode thành 32 byte.
- Chữ ký = HMAC-SHA256(khoá, UTF-8(chuỗi ký)), mã hoá **hex thường** (64 ký tự) ⇒ `X-Agent-Sig`.

### 3.4 Mẫu mã (WebCrypto — chạy được trong service worker MV3)

```js
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function kyYeuCau({ agentId, secret, method, path, body /* chuỗi, "" cho GET */, lechGioMs = 0 /* §3.6 */ }) {
  const ts = String(Date.now() + lechGioMs);
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const bodyHash = hex(await crypto.subtle.digest("SHA-256", enc.encode(body)));
  const chuoiKy = `${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", key, enc.encode(chuoiKy)));
  return { "X-Agent-Contract": "1", "X-Agent-Id": agentId, "X-Agent-Ts": ts, "X-Agent-Nonce": nonce, "X-Agent-Sig": sig };
}
```

### 3.5 Server kiểm theo THỨ TỰ (để hiểu mã lỗi nào ra trước)

1. Thiếu `POS_AGENT_MASTER_KEY` (hoặc < 32 ký tự) ⇒ 503 `NOT_CONFIGURED`.
2. `X-Agent-Contract` ≠ `1` ⇒ 400 `UNSUPPORTED_CONTRACT`.
3. Có query string / header thiếu hoặc sai định dạng (§3.1) ⇒ 400 `BAD_REQUEST`.
4. Thân vượt trần (khai báo `Content-Length` hoặc đếm thật khi đọc) ⇒ 413 `BODY_TOO_LARGE`.
5. Không có agent mang `X-Agent-Id`, hoặc chữ ký sai ⇒ 401 `BAD_SIGNATURE` (hai trường hợp CÙNG mã,
   CÙNG câu — không lộ agent nào tồn tại; so chữ ký bằng phép so hằng thời gian).
6. |giờ máy chủ − `X-Agent-Ts`| > **300 000 ms** (5 phút) ⇒ 401 `CLOCK_SKEW`. Đúng 300 000 vẫn qua.
7. Agent đang tắt (`active = false`) ⇒ 401 `AGENT_DISABLED`.
8. Quá **120 request / 60 giây / agent** ⇒ 429 `RATE_LIMITED` + `Retry-After` (giây).
9. Nonce đã dùng (cùng agent) trong **10 phút** gần nhất ⇒ 401 `NONCE_REUSED` (máy chủ nhớ nonce 15 phút —
   dùng lại trong khoảng đó đều bị từ chối). Nonce chỉ được ghi nhận SAU khi qua bước 5–8.
10. Ghi nhận "còn sống" (§8 mục 2 — `lastHeartbeatAt`), rồi mới đọc JSON + kiểm schema (400
    `PAYLOAD_INVALID`).

### 3.6 Đồng hồ

- Mọi response (kể cả lỗi) mang `X-Server-Time: <Unix ms>`. Agent nên giữ `lechGioMs = X-Server-Time −
  Date.now()` (đo lúc nhận response) và cộng vào `X-Agent-Ts` khi |lệch| > 60 000 ms.
- Nhận 401 `CLOCK_SKEW`: cập nhật `lechGioMs` từ `X-Server-Time` của chính response đó, ký lại với nonce
  MỚI, gửi lại MỘT lần.

### 3.7 Thử lại

Gửi lại một request (mạng lỗi, 5xx, 429) PHẢI dựng lại `X-Agent-Ts`, `X-Agent-Nonce` MỚI và ký lại. Gửi
lại nguyên header cũ ⇒ 401 `NONCE_REUSED` nếu lần trước đã tới máy chủ. Mọi endpoint đều chịu được gửi
lại (heartbeat/status đổi trạng thái theo kiểu idempotent; transactions khoá theo `transaction_id`, §4.4).

### 3.8 Test vector (cố định — test của extension PHẢI ra đúng các chữ ký này)

Tính ngày 07/10/2026 bằng `node:crypto` và WebCrypto (`crypto.subtle`) trên Node v26.1.0 — **cả ba
vector KHỚP giữa hai thư viện**. Bản JSON để test hai phía cùng đọc:
`tests/fixtures/pos/agent-hmac-vectors.json` (GĐ4 tạo, nội dung đúng bảng dưới).

**Khoá dùng cho mọi vector:**

| | Giá trị |
|---|---|
| `POS_AGENT_MASTER_KEY` (chỉ để test, KHÔNG dùng thật) | `pos-agent-master-key-CHI-DE-TEST-khong-dung-that-0123456789` |
| `agentId` | `cm9posagentcs1test0000001` |
| `secretVersion` | `1` |
| `agentSecret` = hex(HMAC-SHA256(master, `cm9posagentcs1test0000001:1`)) | `293c3ade00fc88792aba32e1c692d50596efbb52b42967973aea1c6f55f855a9` |

**V1 — `GET /api/pos-agent/jobs`, thân rỗng**

| | |
|---|---|
| `X-Agent-Ts` | `1791343200000` (= 2026-10-07T10:20:00+07:00) |
| `X-Agent-Nonce` | `5f0c1a9e2b7d4c3e8a6f1b2d3c4e5f60` |
| Thân | (rỗng, 0 byte) |
| SHA-256 thân | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Chuỗi ký (JSON-escaped) | `"GET\n/api/pos-agent/jobs\n1791343200000\n5f0c1a9e2b7d4c3e8a6f1b2d3c4e5f60\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"` |
| **`X-Agent-Sig`** | **`de599aaf3f7a7a273d9d7f19a905e26f4f7cba4adba4e699f557608a4f6332ce`** |

**V2 — `POST /api/pos-agent/heartbeat`** (thân 161 byte, đúng từng ký tự dưới, không xuống dòng)

```
{"extensionVersion":"0.1.0","sessionState":"READY","sessionExpiresAt":"2026-10-08T08:15:00+07:00","lastSyncedAt":"2026-10-07T10:19:30+07:00","profileName":"CS1"}
```

| | |
|---|---|
| `X-Agent-Ts` | `1791343201500` |
| `X-Agent-Nonce` | `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6` |
| SHA-256 thân | `c8aaf8aa0140c43d277596ee81d2baf1f2c9e9169fed8a270fd10a922b0ab69d` |
| Chuỗi ký | `"POST\n/api/pos-agent/heartbeat\n1791343201500\na1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6\nc8aaf8aa0140c43d277596ee81d2baf1f2c9e9169fed8a270fd10a922b0ab69d"` |
| **`X-Agent-Sig`** | **`fa2e93875455a9d6bd3d8cdbe73e79a7eceda1ff68c863391f90028684c6da33`** |

**V3 — `POST /api/pos-agent/transactions`** (thân 857 byte UTF-8 — có chữ tiếng Việt: kiểm phép băm
dùng đúng byte UTF-8, không đếm ký tự JS)

```
{"syncId":"sync-20261007-102000-cs1","batchIndex":0,"final":true,"windowFrom":"2026-10-07 08:20:00","windowTo":"2026-10-07 10:20:00","jobIds":["cm9posjob0000000000000001"],"transactions":[{"transaction_id":"TXN20261007000123","transaction_type":"PAYMENT","transaction_detail_status":"SUCCESS","transaction_master_status":"SUCCESS","order_description":"Học phí bé An K7M2N","authorization_id":"123456","card_transaction_id":"628012345678","order_amount":6732000,"transaction_master_amount":6732000,"transaction_detail_amount":6732000,"fee":null,"currency":"VND","transaction_time":"2026/10/07 10:18:42","merchant_code":"NCCPH6KE","store_code":"CH9TSGU9","terminal_code":"QTT45XWQT","payment_method":"CARD","service_type":"OMSMARTPOS","sender_card_number":"411111******1111","sender_card_type":"VISA","accounting_reference_id":null,"settlement_id":null}]}
```

| | |
|---|---|
| `X-Agent-Ts` | `1791343203000` |
| `X-Agent-Nonce` | `0123456789abcdef0123456789abcdef` |
| SHA-256 thân | `c46861f341034deca561173052b5373fddc866df93da36bc1f7750eb1ccee224` |
| Chuỗi ký | `"POST\n/api/pos-agent/transactions\n1791343203000\n0123456789abcdef0123456789abcdef\nc46861f341034deca561173052b5373fddc866df93da36bc1f7750eb1ccee224"` |
| **`X-Agent-Sig`** | **`964e19ab22f156cc5d1397b7585474e7e8163e1e1833cfc926953b086241034a`** |

(Mã `K7M2N`, số thẻ, mã giao dịch trong V3 là dữ liệu minh hoạ — chỉ dùng cho vector.)

**Đối chứng ÂM** (test PHẢI khẳng định ra chữ ký KHÁC `de599aaf…32ce` của V1):

| Lỗi cài đặt | Chữ ký sai ra |
|---|---|
| Khoá hex-decode thành 32 byte thay vì UTF-8 của chuỗi 64 ký tự | `603836a5b0acfc3b187cf1166c7f9fd3bfa1c17d2800d030d65a87fdc422f2b0` |
| Thừa `"\n"` sau BODY_SHA256_HEX | `8626e2c4c5f4b62e620e6c5358c295aaa97be43915515aa911ce5d64925d6872` |

---

## 4. Endpoint

Mọi thân JSON là object **strict**: khoá lạ ⇒ 400 `PAYLOAD_INVALID` (kèm `error.field` = đường dẫn khoá,
vd `transactions[3].sender_card_name`). Mọi mốc thời gian ISO-8601 phải có offset (`+07:00` hoặc `Z`).

### 4.1 `POST /api/pos-agent/heartbeat`

Gửi mỗi 10 phút (cùng nhịp keepalive `GET /api/auth/session` của portal) và ngay khi extension khởi động.

| Trường | Kiểu | Bắt buộc | Luật |
|---|---|---|---|
| `extensionVersion` | string | có | 1–32 ký tự `[0-9A-Za-z.+-]` |
| `sessionState` | `"READY"` \| `"EXPIRED"` \| `"UNKNOWN"` | có | phiên portal agent đang thấy. `UNKNOWN` = chưa kiểm được — server KHÔNG hạ trạng thái đang có xuống UNKNOWN |
| `sessionExpiresAt` | string ISO \| `null` | có | mốc `exp` của access token portal (chỉ THỜI ĐIỂM — §6.3); không đọc được `exp` ⇒ `null` |
| `sessionExpiresSource` | `"ACCESS_TOKEN"` \| `"SESSION"` \| `null` | không | mốc lấy từ đâu. **`SESSION`** (= `expires` của session NextAuth — TRƯỢT tới "lúc gọi + 30 ngày" ở mỗi lần gọi) ⇒ máy chủ coi là **KHÔNG RÕ hạn**: lưu `sessionExpiresAt = null`, không chuông 07:30 theo nó (1.1). `ACCESS_TOKEN` / vắng / `null` ⇒ dùng `sessionExpiresAt` như gửi |
| `lastSyncedAt` | string ISO \| `null` | có | lần đồng bộ xong gần nhất theo đồng hồ agent — chỉ để chẩn đoán |
| `profileName` | string | không | ≤ 64, tên hồ sơ Chrome (vd `CS1`) |

Server: nếu `sessionState` (READY/EXPIRED) khác trạng thái đang lưu ⇒ đổi trạng thái y như `/status`
(sự kiện + cảnh báo, §4.2). Cập nhật `sessionExpiresAt` (theo luật nguồn ở bảng trên — `SESSION` ⇒ `null`),
`extensionVersion` (đổi ⇒ một sự kiện), `profileName`. KHÔNG ghi một dòng sự kiện cho mỗi lần heartbeat.

`data`: `{ "nextPollMs": 2000|60000, "serverTime": <ms>, "merchantCode": "NCCPH6KE", "sessionState": "READY"|"EXPIRED"|"UNKNOWN" }`
— `merchantCode` là merchant server gắn cho agent: khác cấu hình Options ⇒ extension PHẢI dừng gọi portal
và báo lỗi (`/status` `ERROR` `MERCHANT_CONFIG_MISMATCH`).

### 4.2 `POST /api/pos-agent/status`

Gửi NGAY khi có sự kiện (không chờ heartbeat). Mỗi lần CHUYỂN trạng thái gửi đúng một lần.

| Trường | Kiểu | Bắt buộc | Luật |
|---|---|---|---|
| `state` | `"SESSION_READY"` \| `"SESSION_EXPIRED"` \| `"ERROR"` | có | |
| `reason` | string | có | `^[A-Z][A-Z0-9_]{1,63}$` — bảng dưới |
| `occurredAt` | string ISO | có | lúc agent thấy sự kiện (đồng hồ agent) |
| `profileName` | string | không | ≤ 64 |
| `sessionExpiresAt` | string ISO \| `null` | không | gửi kèm khi `SESSION_READY` — CHỈ mốc `exp` của access token (bản 1.1: endpoint này không có trường nguồn ⇒ mốc nguồn khác / không chắc thì KHÔNG gửi khoá này; máy chủ lưu như gửi, heartbeat kế tiếp sửa theo nguồn) |
| `httpStatus` | integer 100–599 | không | mã HTTP portal trả khi `reason` liên quan HTTP |

| `state` | `reason` nên dùng |
|---|---|
| `SESSION_EXPIRED` | `NO_USER` (session không có `user`) · `HTTP_401` · `HTTP_403` · `REDIRECT_LOGIN` (bị chuyển về `/login`) |
| `SESSION_READY` | `USER_PRESENT` (thấy `user` trở lại — admin vừa đăng nhập) · `EXTENSION_START` |
| `ERROR` (không đổi trạng thái phiên) | `HEADER_NOT_CAPTURED` (chưa bắt được header app) · `BODY_ENCRYPTED` · `PORTAL_HTTP_ERROR` · `PORTAL_BAD_SHAPE` · `PORTAL_TAB_MISSING` · `SYNC_FAILED` · `MERCHANT_CONFIG_MISMATCH` · `FIELD_TOO_LONG` (1.1 — máy chủ vừa từ chối dòng vì vượt trần §6.1: extension lệch hợp đồng, cần cập nhật) |

Mã khác khớp regex vẫn được nhận (ghi nguyên mã). KHÔNG gửi chữ tự do, URL, token hay header trong
bất kỳ trường nào. Server: `SESSION_*` ⇒ đổi trạng thái (nếu khác), ghi sự kiện, báo admin khi
`SESSION_EXPIRED` (một chuông / cơ sở / ngày; lần hết phiên mới trong ngày rung lại). `ERROR` ⇒ ghi sự
kiện (gộp theo agent + mã + ngày), hiện trên màn Sức khoẻ, báo admin một chuông / cơ sở / ngày (mã lỗi
đổi thì rung lại).

`data`: `{ "sessionState": …, "nextPollMs": …, "serverTime": … }`.

### 4.3 `GET /api/pos-agent/jobs`

Gọi theo nhịp `nextPollMs` (§5). Thân PHẢI rỗng (0 byte; có thân ⇒ 400 `BAD_REQUEST`). Đây cũng là
request "còn sống" chính: agent PHẢI gửi ít nhất một request đã ký mỗi **60 giây**.

`data`:

```json
{ "jobs": [ { "id": "cm9posjob0000000000000001",
              "createdAt": "2026-10-07T10:19:58+07:00",
              "scanFrom": "2026-10-07T10:10:12+07:00" } ],
  "nextPollMs": 2000, "serverTime": 1791343200000 }
```

- Chỉ job `PENDING` của CHÍNH agent, tạo trong **2 phút** gần nhất, tối đa 20. Job cũ hơn coi như hết hạn.
- Có job ⇒ agent đồng bộ NGAY với cửa sổ `[min(lastSyncedAt − 2h, min(scanFrom)), now]` rồi gửi
  `/transactions`, lô CUỐI mang `jobIds` (§4.4). Job không chứa mã phiếu, số tiền hay gì của khách.

### 4.4 `POST /api/pos-agent/transactions`

| Trường | Kiểu | Bắt buộc | Luật |
|---|---|---|---|
| `syncId` | string | có | `^[A-Za-z0-9_-]{1,64}$`, chung cho mọi lô của MỘT lượt đồng bộ |
| `batchIndex` | integer | có | 0..999, lô thứ mấy trong lượt |
| `final` | boolean | có | `true` ở lô CUỐI của lượt — kể cả lượt 0 giao dịch (gửi `transactions: []`) |
| `windowFrom`, `windowTo` | string | có | `YYYY-MM-DD HH:mm:ss` giờ VN — đúng hai chuỗi đã gửi portal. **Lô `final:true`: `windowTo` PHẢI là cận trên cửa sổ của CẢ LƯỢT** (= mốc cuối của mảnh CUỐI, kể cả khi mảnh đó rỗng và lô final là lô đang giữ của một mảnh SỚM hơn — `windowFrom` giữ của lô). Server chỉ đóng job tạo ≤ mốc này (lô final mang `windowTo` của một mảnh 24h SỚM hơn thì job giữ PENDING, sale nhận "chưa trả lời kịp") và (1.1) lưu nó làm **"dữ liệu đã đọc tới"** trên màn Sức khoẻ |
| `jobIds` | string[] | có | ≤ 50, mỗi phần tử `^[a-z0-9]{20,40}$`. CHỈ điền ở lô `final:true`; lô `final:false` PHẢI gửi `[]` (khác ⇒ 400 `PAYLOAD_INVALID`, `field = "jobIds"`). Job được đánh DONE sau khi CẢ lô cuối đã ghi xong, và CHỈ job **tạo không muộn hơn `windowTo`** của lượt (job tạo sau lúc agent đóng cửa sổ quét ⇒ giữ PENDING, lượt sau đóng nó — rà đối kháng 07/10/2026) |
| `transactions` | Row[] | có | 0..200 dòng (§6); tổng thân ≤ 524 288 byte — vượt thì chia lô |

Server, theo thứ tự: kiểm từng dòng (từ chối dòng lỗi, §7.2 — kể cả dòng VƯỢT TRẦN §6.1, bản 1.1) ⇒ **lô `final:false`: XẾP CHỜ các dòng nhận, chưa
ghi gì vào sổ** (trả `staged`) ⇒ **lô `final:true`: gom mọi lô `final:false` đã xếp chờ của CÙNG `syncId` + lô này,
xử lý CẢ LƯỢT như MỘT file** (cặp `PAYMENT` + `VOID` của cùng lượt nằm ở hai lô vẫn thấy nhau ⇒ không ghi tiền cho
lần quẹt đã hủy — rà đối kháng 07/10/2026) ⇒ bỏ qua dòng **y hệt lần agent gửi trước** (`unchanged`) ⇒ ghi phần
còn lại qua ĐÚNG luồng của import file (một bản ghi cho mỗi `transaction_id` dù agent hay file thấy trước; không bao
giờ hai giao dịch / hai khoản thu cho một lần quẹt) ⇒ đánh DONE các `jobIds` thuộc agent này, ghi `lastSyncedAt` ⇒
kiểm lại phiếu thu thẻ đang mở liên quan. Lô final mà server THIẾU lô `final:false` nào của lượt (`batchIndex`
0..n−1) ⇒ vẫn ghi phần đã có nhưng KHÔNG đánh DONE job, KHÔNG ghi `lastSyncedAt` / "dữ liệu đã đọc tới" (lượt sau
gửi lại cả cửa sổ). Dòng bị TỪ CHỐI (mọi mã §7.2, kể cả `FIELD_TOO_LONG`) KHÔNG chặn đóng job / ghi `lastSyncedAt` — dòng
đó không vào sổ, file import là đường dự phòng (1.1 — TỰ QUYẾT: agent đúng hợp đồng làm vừa trần trước khi gửi nên
`FIELD_TOO_LONG` chỉ xảy ra khi agent lệch hợp đồng; giữ job PENDING vì nó là nói dối "agent chưa trả lời"). Lô
xếp chờ của lượt bỏ dở (không bao giờ có lô final) bị xoá sau 1 giờ. Trùng `transaction_id` trong lượt: dòng xuất
hiện SAU thắng (lô sau thắng lô trước).

`data`:

```json
{ "received": 1, "unchanged": 0, "created": 1, "updated": 0, "matched": 1, "needsReview": 0, "ignored": 0, "staged": 0,
  "rejected": [ { "index": 3, "transaction_id": "TXN…", "code": "MERCHANT_MISMATCH" },
                { "index": 4, "transaction_id": "TXN…", "code": "FIELD_TOO_LONG", "field": "store_code" } ],
  "errors":   [ { "index": 5, "transaction_id": "TXN…", "code": "PROCESSING_ERROR" } ],
  "jobsDone": 1, "nextPollMs": 2000, "serverTime": 1791343203000 }
```

- `created/updated/matched/needsReview/ignored` đếm trên các dòng ĐÃ XỬ LÝ (không gồm `unchanged`,
  `rejected`) — ở lô final là của CẢ LƯỢT (gồm dòng đã xếp chờ). `matched` = tự ghi nhận vào phiếu; `needsReview`
  = vào hàng chờ kế toán; `ignored` = thất bại / đã hủy. `staged` (lô `final:false`) = số dòng đã xếp chờ.
- `rejected` / `errors` chỉ báo theo `index` của lô HIỆN TẠI; dòng đã xếp chờ lỗi ở lô final thì không có `index`
  (không cần làm gì — lượt sau tự gửi lại).
- `rejected`: dòng không vào sổ — gửi lại y hệt cũng bị từ chối y hệt (không cần làm gì; lần gửi lại y hệt vào
  `unchanged`, không vào `rejected` lần hai). `field` (1.1) CHỈ có với `FIELD_TOO_LONG` = tên khoá §6.1 ĐẦU TIÊN vượt
  trần. `transaction_id` = mã agent gửi (đã trim) nếu ≤ 64 ký tự; dài hơn ⇒ `null` (không vọng lại chuỗi dài).
- Agent gặp `FIELD_TOO_LONG` ⇒ `/status` `ERROR` `FIELD_TOO_LONG` MỘT lần (extension lệch hợp đồng — người vận hành
  cần cập nhật extension); mã khác: không cần làm gì.
- `errors`: lỗi máy chủ trên dòng đó — KHÔNG ghi gì cho dòng ấy; lượt đồng bộ sau (cửa sổ chồng lấn) tự
  gửi lại. Không cần thử lại riêng.
- Server ghi tiền ĐỒNG BỘ trong request (khoá đơn + khoá giao dịch cho từng dòng có mã phiếu): lô 200 dòng
  MỚI có thể mất tới vài chục giây ⇒ đặt timeout `fetch` của lời gọi này ≥ 60 giây. Lô toàn dòng không đổi
  trả về trong vài trăm mili-giây.

---

## 5. Luật `nextPollMs`

| Điều kiện (đánh giá lúc trả lời) | `nextPollMs` |
|---|---|
| Agent có job `PENDING` tạo trong 2 phút gần nhất, **hoặc** cơ sở của agent có phiếu thu thẻ đang mở (`CHO_QUET`/`THAT_BAI`) tạo trong **10 phút** gần nhất | `2000` |
| Còn lại | `60000` |

Agent: nhận `2000` ⇒ chế độ nhanh **120 giây** tính từ lần nhận `2000` GẦN NHẤT (gọi `GET /jobs` mỗi 2 giây);
hết 120 giây không nhận thêm `2000` ⇒ về nhịp 60 giây (alarm 1 phút). Không gọi nhanh hơn `nextPollMs`.
Vì sao có vế "phiếu mở 10 phút": sale bấm Kiểm tra thì server chỉ chờ agent **8 giây** — agent phải đang
ở chế độ nhanh từ lúc sale tạo phiếu, không đợi tới alarm 1 phút kế tiếp.

---

## 6. Ánh xạ trường portal (roadmap §2.3) ⇒ payload ⇒ satarobo

### 6.1 Một dòng `transactions[i]` — CHỈ các khoá dưới (strict)

Giá trị: string, number hoặc `null` như bảng. Thiếu khoá tuỳ chọn = `null`. Chuỗi được `trim()`.

**Trần độ dài (bản 1.1 — chốt GĐ4 ↔ GĐ5).** Cột "Trần · vượt" là luật của CẢ HAI phía:

- **Trần** = số ký tự tối đa của chuỗi ĐÃ GỬI (đơn vị `String.length` của JS; agent trim trước khi đo). Trường số
  (`*_amount`, `fee`, `tax`): trần áp cho DẠNG CHUỖI — gửi dạng number JSON thì không có trần độ dài.
- **Máy chủ**: vượt trần ⇒ từ chối DÒNG đó (`rejected[]` mã `FIELD_TOO_LONG`, kèm `field` = tên khoá — §7.2), các dòng
  khác của lô vẫn xử lý. KHÔNG còn 400 cả lô (bản 1 cũ: một dòng dài ⇒ 400 `PAYLOAD_INVALID` ⇒ cả lô hỏng, agent gửi
  lại y hệt mỗi phút). `transaction_id` vượt ⇒ `BAD_TRANSACTION_ID`; `merchant_code` vượt ⇒ `MERCHANT_MISMATCH` (hai mã
  đó kiểm TRƯỚC trần).
- **Agent PHẢI làm vừa trần TRƯỚC khi gửi** (FIELD_TOO_LONG chỉ xảy ra khi agent lệch hợp đồng): `cắt` = giữ đúng N ký
  tự đầu; `null` = gửi `null`. Bốn trường BẮT BUỘC `cắt`, KHÔNG được `null`, vì `null` làm máy chủ BỎ một phép kiểm
  (fail-open): `transaction_detail_status` / `transaction_master_status` (null ⇒ trạng thái CÒN LẠI một mình quyết
  "Thành công") · `currency` (vắng ⇒ coi như VND) · `store_code` (vắng ⇒ không đối chiếu `maCuaHang`). Bản cắt không
  bao giờ trùng một giá trị hợp lệ ⇒ dòng ra "treo" / bị từ chối / máy không xác định — fail-closed.

| Khoá (giữ tên portal) | Gửi | Kiểu | Trần · vượt (agent) | Server dùng | Cột satarobo |
|---|---|---|---|---|---|
| `transaction_id` | **bắt buộc** | string `^[0-9A-Za-z]{8,64}$` | ≤ 64 · null | khoá — = "Mã giao dịch" của file. Sai dạng / dài hơn ⇒ `BAD_TRANSACTION_ID` | `PosCardTransaction.maGiaoDich` = `BankTransaction.providerTxnId` (provider `CARD_POS`) |
| `transaction_type` | **bắt buộc** | string | ≤ 128 · null | `PAYMENT`→"Thanh toán" · `VOID`→"Hủy" · `REFUND`→"Hoàn" · khác ⇒ giữ nguyên mã (không phải thanh toán ⇒ đi luật hủy/hoàn, không bao giờ tự thu) | `loaiGiaoDich` |
| `transaction_detail_status` · `transaction_master_status` | ≥ 1 trong 2 | string | ≤ 128 · cắt | mọi giá trị có mặt = `SUCCESS` ⇒ "Thành công"; mọi giá trị có mặt ∈ {`FAIL`,`FAILED`} ⇒ "Thất bại"; còn lại (`PENDING`, lẫn lộn…) ⇒ giữ mã = "chưa ngã ngũ" (sale được dặn ĐỪNG cho quẹt lại) | `trangThai` |
| `order_description` | nên có | string | ≤ 4000 · cắt | ghi chú POS — server tự tách mã 5 ký tự (D2) | `dienGiai` |
| `authorization_id` | có thì gửi | string | ≤ 64 · null | mã chuẩn chi | `maChuanChi` |
| `card_transaction_id` | có thì gửi | string | ≤ 64 · null | RRN — dòng `VOID` dùng chung với dòng gốc; server nối VOID ↔ gốc theo nó (§6.2) | `maGiaoDichThe` |
| `tcb_transaction_id` | tuỳ | string | ≤ 64 · null | không lưu | — |
| `order_amount` · `transaction_master_amount` · `transaction_detail_amount` | ≥ 1 trong 3 | số nguyên VND — number hoặc chuỗi chữ số (`"6732000"`, chấp nhận đuôi `.0`) | ≤ 32 · null | các số có mặt phải BẰNG NHAU về trị tuyệt đối; `PAYMENT` giữ dấu, `VOID`/`REFUND` ⇒ số âm | `soTien` |
| `fee` | tuỳ | số nguyên | ≤ 32 · null | phí (hậu kết toán) | `phiGiaoDich` |
| `tax` | tuỳ | số | ≤ 32 · null | không lưu | — |
| `currency` | tuỳ | string | ≤ 16 · cắt | có mặt thì phải `VND` hoặc `704` | — |
| `transaction_time` | **bắt buộc** | `YYYY/MM/DD HH:mm:ss` giờ VN (chấp nhận `-` thay `/`, hoặc ISO có offset) | ≤ 40 · null | giờ quẹt (Q-C) | `thoiGianGiaoDich` |
| `merchant_code` | **bắt buộc** | string | ≤ 128 · null | phải = `merchantCode` của agent | — |
| `store_code` | nên có | string | ≤ 128 · cắt | đối chiếu `PosTerminal.maCuaHang` (đã khai mà khác ⇒ máy không xác định) | — |
| `terminal_code` | nên có | string | ≤ 128 · null | máy = `PosTerminal` đang bật có `maNhaCungCap` = `merchant_code` VÀ `maQuay` = `terminal_code` ⇒ cơ sở | `maQuay`; `maThietBi` (suy từ máy) |
| `payment_method` | tuỳ | string | ≤ 64 · null | `CARD`→"Thẻ" · `QR`→"QR" · khác giữ nguyên | `hinhThuc` |
| `service_type` | tuỳ | string | ≤ 64 · null | không lưu | — |
| `sender_card_number` | tuỳ | string (portal đã che) | ≤ 64 · null | server che lại lần nữa (6 đầu + 4 cuối) | `soTheMasked` |
| `sender_card_type` | tuỳ | string | ≤ 64 · null | | `loaiThe` |
| `accounting_reference_id` | có thì gửi | string | ≤ 128 · null | mã hạch toán (có sau kết toán) | `maHachToan` |
| `settlement_id` | có thì gửi | string | ≤ 128 · null | mã kết toán | `maKetToan` |
| `merchant_order_id` | tuỳ | string | ≤ 128 · null | | `maDonHang` |
| `transaction_operation_msg` | tuỳ | string | ≤ 500 · cắt | CHỈ nhận nếu là MÃ dạng `^[A-Z][A-Z0-9_]{2,63}$` (vd `USER_CANCELLED`) ⇒ lý do thất bại; chữ tự do bị bỏ, không lưu | `maLyDoThatBai` |

### 6.2 Server tự làm (agent KHÔNG cần)

- Dòng **đã ghi nhận** chỉ đổi các cột hậu kết toán (`maHachToan`, `phiGiaoDich`, `maKetToan`, tín hiệu
  hủy) — y luật import lại file. `null` của agent KHÔNG xoá giá trị file đã có.
- `VOID` không mang mã giao dịch gốc ⇒ gốc = dòng `PAYMENT` DUY NHẤT cùng `card_transaction_id` + cùng
  `terminal_code`, giờ không sau dòng VOID. 0 hoặc ≥ 2 ứng viên ⇒ VOID chờ kế toán; gốc tới sau ⇒ tự xét lại.
- Hủy sau khi đã ghi nhận ⇒ cờ cho kế toán, KHÔNG tự đảo tiền (D7).

### 6.3 CẤM gửi (đâu cũng vậy, kể cả lồng sâu)

- `sender_card_name` — có khoá này ⇒ **400 cả lô**.
- `device_id` của dòng — cố ý loại để không lẫn với `deviceId` của phiên portal (D10); server suy máy từ
  `terminal_code` + `merchant_code`.
- Mọi thứ của PHIÊN portal: header (`X-API-Auth`, `x-api-payment`, `X-Device-ID`), cookie,
  `accessToken`, `refreshToken`, `deviceId`, `permissions`, `user`, `localStorage.device_id`.
  Strict schema chặn khoá lạ ⇒ 400; nhưng KHÔNG dựa vào server — extension phải tự lọc bằng whitelist §6.1.
- Heartbeat chỉ mang MỐC `exp` (thời điểm), không bao giờ mang token.

---

## 7. Mã lỗi

### 7.1 Lỗi cả request — `{ ok:false, error:{ code, message, field?, requestId } }`

| HTTP | `code` | Khi nào | Agent làm gì |
|---|---|---|---|
| 400 | `BAD_REQUEST` | header thiếu/sai định dạng, có query string, GET có thân, thân không phải UTF-8/JSON | sửa mã extension |
| 400 | `UNSUPPORTED_CONTRACT` | `X-Agent-Contract` ≠ `1` | cập nhật extension |
| 400 | `PAYLOAD_INVALID` | sai schema / khoá lạ / khoá cấm (`error.field` = đường dẫn) | sửa mã — KHÔNG gửi lại y hệt |
| 400 | `TOO_MANY_ROWS` | > 200 dòng | chia lô |
| 401 | `BAD_SIGNATURE` | agent không tồn tại hoặc chữ ký sai (gồm bí mật đã bị "Tạo lại") | dừng; báo "Bí mật sai/đã đổi — dán bí mật mới" |
| 401 | `CLOCK_SKEW` | lệch giờ > 5 phút | §3.6 |
| 401 | `NONCE_REUSED` | nonce đã dùng trong 10 phút | ký lại với nonce mới |
| 401 | `AGENT_DISABLED` | admin đã tắt agent | dừng mọi lời gọi portal; báo trên extension |
| 413 | `BODY_TOO_LARGE` | heartbeat/status > 4 096 byte; transactions > 524 288 byte | chia lô |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | POST không `application/json` | sửa mã |
| 429 | `RATE_LIMITED` | > 120 request / 60 giây | chờ `Retry-After` |
| 503 | `NOT_CONFIGURED` | máy chủ chưa đặt `POS_AGENT_MASTER_KEY` | thử lại sau 5 phút |
| 500 | `INTERNAL` | lỗi máy chủ | thử lại theo nhịp thường (nonce mới) |
| 405 | — | method khác bảng §0 (thân có thể không phải JSON) | sửa mã |

### 7.2 Từ chối từng dòng — `data.rejected[]` (HTTP vẫn 200)

| `code` | Khi nào | Lưu gì |
|---|---|---|
| `MERCHANT_MISMATCH` | `merchant_code` ≠ merchant của agent, **hoặc** `transaction_id` đã có trong sổ mà thuộc máy / cơ sở / merchant khác, quầy mâu thuẫn `terminal_code`, hoặc do agent của cơ sở / merchant khác gửi (rà đối kháng 07/10/2026 — `merchant_code` là trường tự khai) | KHÔNG lưu dòng; một sự kiện lỗi / agent / ngày |
| `BAD_TRANSACTION_ID` | `transaction_id` sai định dạng (kể cả dài hơn 64 ký tự) | không lưu |
| `BAD_TIME` | `transaction_time` không đọc được / ngày không có thật | lưu dấu từ chối (đối chiếu) |
| `TYPE_MISSING` · `STATUS_MISSING` · `AMOUNT_MISSING` | thiếu trường bắt buộc theo §6.1 | lưu dấu từ chối |
| `AMOUNT_NOT_INTEGER` | số tiền có phần lẻ | lưu dấu từ chối |
| `AMOUNT_MISMATCH` | ba số tiền có mặt lệch nhau | lưu dấu từ chối |
| `CURRENCY_UNSUPPORTED` | `currency` không phải VND | lưu dấu từ chối |
| `FIELD_TOO_LONG` (1.1) | một trường vượt trần §6.1 — `field` = tên khoá. Kiểm SAU `MERCHANT_MISMATCH` + `BAD_TRANSACTION_ID`, TRƯỚC các mã khác | lưu dấu từ chối — chỉ bản đã CẮT về trần, không lưu phần vượt; dòng `FIELD_TOO_LONG` ĐẦU TIÊN trong ngày ⇒ máy chủ báo admin MỘT chuông / cơ sở / ngày (không chờ agent tự báo) |

"Lưu dấu từ chối" = server nhớ agent đã thấy giao dịch này và vì sao không nhận (màn Đối chiếu agent ↔
file, GĐ6); tiền KHÔNG vào sổ — file import vẫn là đường dự phòng cho giao dịch đó.

`data.errors[]`: `PROCESSING_ERROR` — lỗi máy chủ trên đúng dòng đó (§4.4).

---

## 8. Hành vi agent BẮT BUỘC (phía server dựa vào)

1. Mỗi request một nonce mới; ký đúng §3; chỉ gọi từ service worker.
2. Ít nhất một request đã ký mỗi 60 giây (`GET /jobs` theo alarm 1 phút là đủ). Server coi agent **mất
   kết nối** khi > 3 phút không nhận request hợp lệ nào (sale thấy "Tạm mất kết nối Techcombank CSx"), và
   báo admin khi > 5 phút trong giờ hoạt động.
3. Lượt đồng bộ: cửa sổ `[lastSyncedAt − 2h, now]` (lần đầu: 3 ngày; sau `SESSION_READY`: từ
   `min(lastSyncedAt − 2h, 00:00 hôm nay)`), `page_size` 50, lặp tới hết `total_items`; gửi theo lô ≤ 200
   dòng; **lô cuối `final:true`** (kể cả 0 dòng) mang `jobIds` của các job lượt này trả lời VÀ `windowTo` của CẢ
   LƯỢT (§4.4).
4. KHÔNG chạy hai lượt đồng bộ song song (server chịu được, nhưng phí công và làm job DONE sớm sai).
5. Đổi trạng thái phiên ⇒ `/status` ngay, đúng một lần; hết phiên ⇒ ngừng gọi API portal, chờ `user`
   xuất hiện lại ⇒ `SESSION_READY` + quét bù.
6. Nhận 401 `BAD_SIGNATURE`/`AGENT_DISABLED` ⇒ dừng mọi lời gọi portal + báo rõ trên extension; không
   lặp gửi.
7. Không bao giờ gửi gì ngoài whitelist §6.1 + các trường envelope ở §4.
8. (1.1) Mọi giá trị chuỗi của dòng ≤ trần §6.1, làm vừa theo cột "Trần · vượt" (`cắt` / `null`) — bốn trường
   `cắt` KHÔNG được thay bằng `null`.

---

## 9. Phiên bản hợp đồng

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| `1` | 07/10/2026 | Bản đầu: 4 endpoint, HMAC §3, vector V1–V3, whitelist §6.1 |
| `1` | 07/10/2026 (rà đối kháng) | Hành vi SERVER: lô `final:false` xếp chờ, xử lý cả lượt ở lô final (+ trường trả về `staged`); job DONE chỉ khi tạo ≤ `windowTo`; `MERCHANT_MISMATCH` mở rộng cho giao dịch đã có của nơi khác. Một yêu cầu cho extension: lô final mang `windowTo` của CẢ LƯỢT (§4.4) — thiếu thì chỉ chậm đóng job (chiều an toàn) |
| `1.1` | 07/10/2026 (chốt hợp đồng GĐ4 ↔ GĐ5) | **Hình dạng (thêm, tương thích):** `rejected[].field` (tuỳ chọn) + mã `FIELD_TOO_LONG` (§7.2); mã `ERROR` `FIELD_TOO_LONG` của `/status` (§4.2). **Luật:** trần độ dài từng trường + cách agent làm vừa (§6.1); vượt trần ⇒ từ chối DÒNG, hết 400 cả lô; dòng bị từ chối không chặn đóng job (§4.4); `sessionExpiresSource: SESSION` = không rõ hạn (§4.1); `/status` chỉ gửi mốc `exp` access token (§4.2); `rejected[].transaction_id` > 64 ký tự ⇒ `null`. **Extension:** lô final `windowTo` của cả lượt (đã làm). **Máy chủ (không đổi API):** lưu `windowTo` lô final làm "dữ liệu đã đọc tới" trên màn Sức khoẻ. `X-Agent-Contract` giữ `1`: extension cũ (trần ≤ trần mới, không gửi `SESSION` cho `/status`) chạy nguyên; máy chủ cũ trả 400 cho dòng dài ⇒ extension mới vẫn giữ đường "bỏ dòng ở `field` rồi gửi lại" |

- Đổi KHÔNG tương thích (chuỗi ký, tên/ý nghĩa trường bắt buộc, bỏ endpoint) ⇒ tăng `X-Agent-Contract`;
  server nhận song song bản cũ ít nhất 30 ngày.
- Thêm trường TUỲ CHỌN mới vào whitelist ⇒ vẫn bản `1`, ghi vào bảng này; extension cũ không gửi trường đó
  vẫn chạy. (Ngược lại không được: extension gửi trường mà server chưa nhận ⇒ 400 — nâng server trước.)
- Đổi tương thích có thêm HÌNH DẠNG (trường tuỳ chọn mới ở phản hồi, mã mới) hoặc siết/nới LUẬT ⇒ tăng số PHỤ
  (`1.1`, `1.2`…) ở bảng này; header vẫn `1`.

---

## 10. Chờ đo DevTools (trên máy agent, đăng nhập `pos.cs1`) — có thể làm thêm trường TUỲ CHỌN

| Việc đo | Ảnh hưởng hợp đồng | Mặc định hôm nay (an toàn) |
|---|---|---|
| Ba trường số tiền khác nhau khi nào (tip? hủy một phần?) | luật §6.1 | lệch ⇒ `AMOUNT_MISMATCH`, dòng không vào sổ, file là dự phòng |
| Tập giá trị thật của `transaction_type` / hai trường trạng thái | ánh xạ §6.1 | lạ ⇒ không tự thu, không mời quẹt lại |
| `VOID` có mang mã giao dịch gốc trong list không (hay chỉ ở API chi tiết) | thêm `original_transaction_id` tuỳ chọn | nối theo RRN (§6.2) |
| Trường "lý do thất bại" (`USER_CANCELLED` trên UI) nằm ở đâu | có thể thêm trường tuỳ chọn | chỉ đọc mã trong `transaction_operation_msg` |
| Dòng `VOID` mang số âm hay dương | không (server tự lấy trị tuyệt đối rồi gán âm) | — |
| `X-API-Auth` / `x-api-payment` dựng thế nào; body search có mã hoá không | không (việc của extension, §6.3 cấm gửi) | — |
