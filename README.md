# XAUT 持倉 NT$ 估值

輸入以太坊地址,查詢該地址持有的 XAUT(Tether Gold),並以 [MAX 交易所](https://max.maicoin.com) XAUT/TWD 的買方掛單估算可換得的新台幣金額。

網頁與價格 API 都由同一個 Cloudflare Worker 提供,不需要自己的伺服器。

## 運作方式

```
瀏覽器 ──► Cloudflare Worker ─┬─ GET /       網頁(site/index.html)
   │                          └─ GET /price  ──► MAX 公開 API(價格、買單深度)
   │
   └─────► 以太坊公開節點 ──► XAUT 合約 balanceOf(餘額)
```

- **網頁**:`site/index.html` 在部署時由 wrangler 打包進 Worker,`GET /` 直接回傳。
- **價格**:網頁以相對路徑呼叫同一個 Worker 的 `GET /price`,取得 MAX `xauttwd` 的最高買價與買單深度。Worker 優先使用 MAX REST API,被擋(HTTP 403)時改用 MAX 行情 WebSocket 的委託簿。結果快取 15 秒,MAX 暫時失敗時 5 分鐘內的舊資料仍可回傳(標示 `stale`)。
- **餘額**:使用者的瀏覽器直接向以太坊公開節點(`ethereum-rpc.publicnode.com`)呼叫 XAUT 合約的 `balanceOf`,地址不會經過 Worker。
- **估值**:以最高買價計算現值;若持有量超過最高買單的數量,會另外依買單由高到低逐筆賣出,列出實際可得金額與賣不掉的數量。

> MAX 的買價與 MaiCoin App 顯示的「賣出價」不同,XAUT 交易量小,實際成交價可能有差距,估值僅供參考。

## 專案結構

| 路徑 | 說明 |
|---|---|
| `site/index.html` | 前端頁面(單一檔案,無建置步驟) |
| `worker/index.js` | Cloudflare Worker:回傳網頁與 `/price` |
| `wrangler.jsonc` | Worker 設定(名稱、入口、自訂網域) |
| `.github/workflows/deploy-cloudflare.yml` | push 到 `main` 時以 wrangler 部署 Worker |

`site/index.html` 以 `import` 打包進 Worker,沒有另外上傳靜態資源;網頁若要拆成多個檔案,再改用 Workers 的 Static Assets。

## 部署

### 自動部署(GitHub Actions)

1. 在 Cloudflare 建立 API Token(範本 **Edit Cloudflare Workers**,Account 與 Zone 只選自己的帳號與網域)。
2. 到 GitHub repo 的 **Settings → Secrets and variables → Actions** 新增兩個 secret:
   - `CLOUDFLARE_API_TOKEN`:上一步的 Token
   - `CLOUDFLARE_ACCOUNT_ID`:Cloudflare 帳號 ID(後台 Workers 首頁右側可找到)
3. 之後 `site/`、`worker/`、`wrangler.jsonc` 有變動並 push 到 `main` 時會自動部署;也可以到 **Actions** 手動執行 **Run workflow**。

### 手動部署

```bash
npx wrangler@4 login
```

```bash
npx wrangler@4 deploy
```

本機測試:

```bash
npx wrangler@4 dev
```

### 自訂網域

`wrangler.jsonc` 的 `routes` 以 `custom_domain` 綁定網域,網域的 DNS 必須由 Cloudflare 管理。部署時 Cloudflare 會自動建立 DNS 記錄與憑證;若該主機名稱已有其他 DNS 記錄(例如指向 GitHub Pages 的 CNAME),要先刪除。

不在 `routes` 內、從後台手動加的網域,之後部署時可能被移除,請以 `wrangler.jsonc` 為準。

## 注意事項

- Cloudflare 上的 Worker 以 repo 為準:不要直接在 Cloudflare 後台編輯程式碼,下次部署會被覆蓋。
- Worker 呼叫的是 MAX 的公開介面,可能隨時改版或限制來源;REST 與 WebSocket 都失敗時,頁面會顯示「無法取得價格資料」。
- 只計算**以太坊主網**上的 XAUT(合約 `0x68749665FF8D2d112Fa859AA293F07A622782F38`)。
- 此專案僅供資訊參考,不構成投資建議。

## 授權

見 [LICENSE](LICENSE)。
