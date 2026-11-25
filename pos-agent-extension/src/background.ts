/**
 * Service worker (Manifest V3, module) của "SataRobo POS Agent".
 *
 * MV3 yêu cầu gắn bộ nghe sự kiện ĐỒNG BỘ ở cấp cao nhất mỗi lần service worker thức dậy —
 * `ganSuKien` làm đúng việc đó. Trạng thái không sống trong biến: mọi thứ cần nhớ nằm ở
 * `chrome.storage` (service worker bị tắt/bật lại liên tục).
 */
import { taoBoDieuPhoi } from "./lib/bo-dieu-phoi.js";
import { damBaoAlarms, ganSuKien, layChrome, taoPhuThuocChrome } from "./lib/nen-chrome.js";

const c = layChrome();
const bdp = taoBoDieuPhoi(taoPhuThuocChrome(c));
ganSuKien(c, bdp);
// Alarm sống qua lần tắt/bật service worker nhưng có thể mất khi cập nhật Chrome — đặt lại nếu thiếu.
damBaoAlarms(c).catch(() => undefined);
