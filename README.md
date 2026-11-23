# XAUT 持倉 NT$ 估值

輸入以太坊地址,查詢該地址持有的 XAUT(Tether Gold),並以 [MAX 交易所](https://max.maicoin.com) XAUT/TWD 的買方掛單估算可換得的新台幣金額。

純靜態網頁(GitHub Pages)+ 一個 Cloudflare Worker 價格轉發。不需要自己的伺服器。

## 運作方式

```
瀏覽器 ──► Cloudflare Worker ──► MAX 公開 API(價格、買單深度)
   │
   └─────► 以太坊公開節點 ──► XAUT 合約 balanceOf(餘額)
```

- **價格**:網頁向 Worker 的 `GET /price` 取得 MAX `xauttwd` 的最高買價與買單深度。Worker 優先使用 MAX REST API,被擋(HTTP 403)時改用 MAX 行情 WebSocket 的委託簿。結果快取 15 秒,MAX 暫時失敗時 5 分鐘內的舊資料仍可回傳(標示 `stale`)。
- **餘額**:使用者的瀏覽器直接向以太坊公開節點(`ethereum-rpc.publicnode.com`)呼叫 XAUT 合約的 `balanceOf`,地址不會經過 Worker。
- **估值**:以最高買價計算現值;若持有量超過最高買單的數量,會另外依買單由高到低逐筆賣出,列出實際可得金額與賣不掉的數量。

> MAX 的買價與 MaiCoin App 顯示的「賣出價」不同,XAUT 交易量小,實際成交價可能有差距,估值僅供參考。

## 專案結構

| 路徑 | 說明 |
|---|---|
| `site/index.html` | 前端頁面(單一檔案,無建置步驟) |
| `worker/index.js` | Cloudflare Worker 價格轉發程式碼(不會自動部署,需手動貼到 Cloudflare) |
| `.github/workflows/update-price.yml` | 部署到 GitHub Pages 的 workflow |

Worker 的程式碼放在 `worker/index.js` 供版本控管,但 GitHub Actions 不會自動部署它;修改後要手動貼到 Cloudflare 後台並 Deploy(見下方)。

## 部署

### 1. 前端(GitHub Pages)

1. 到 repo 的 **Settings → Pages → Build and deployment → Source**,選 **GitHub Actions**。
2. 推送到 `main` 會自動部署;也可以到 **Actions** 手動執行 **Run workflow**。
3. 預設網址為 `https://<帳號>.github.io/xaut-twd/`。

### 2. 價格 Worker(Cloudflare)

1. 在 Cloudflare 建立 Worker,貼上 `worker/index.js` 的內容並 Deploy。
2. 把 Worker 的 `ALLOWED_ORIGINS` 設為允許讀取價格的網站來源(CORS),例如:

   ```js
   const ALLOWED_ORIGINS = [
     'https://xaut.example.com',
   ];
   ```

   來源格式為「協定 + 網域」,不含結尾 `/` 或路徑;每個網域各占一行。
3. 把 `site/index.html` 裡的 `PRICE_URL` 改成你的 Worker 網址(`https://<名稱>.<子網域>.workers.dev/price`)。

### 3. 自訂網域(選用)

以子網域 `xaut.example.com` 為例:

1. **先**在 Worker 的 `ALLOWED_ORIGINS` 加入 `https://xaut.example.com` 並 Deploy。
2. 在 DNS 服務商新增記錄:

   | 類型 | 名稱 | 值 |
   |---|---|---|
   | CNAME | `xaut` | `<帳號>.github.io` |

   使用根網域時改設四筆 A 記錄:`185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`(以 GitHub 官方文件為準)。若 DNS 放在 Cloudflare,先設為 **DNS only**,等憑證簽發後再視需要調整。
3. 到 **Settings → Pages → Custom domain** 填入網域並儲存,DNS 檢查通過後勾選 **Enforce HTTPS**。
4. 以 workflow 部署時不需要 `CNAME` 檔。
5. 開啟新網址,在瀏覽器開發者工具確認 `/price` 回 200 且沒有 CORS 錯誤。

## 注意事項

- Worker 呼叫的是 MAX 的公開介面,可能隨時改版或限制來源;REST 與 WebSocket 都失敗時,頁面會顯示「無法取得價格資料」。
- 只計算**以太坊主網**上的 XAUT(合約 `0x68749665FF8D2d112Fa859AA293F07A622782F38`)。
- 此專案僅供資訊參考,不構成投資建議。

## 授權

見 [LICENSE](LICENSE)。
