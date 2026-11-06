# XAUT 持倉 NT$ 估值（GitHub Pages 版）

輸入以太坊地址，查詢持有的 XAUT（Tether Gold），以 MaiCoin Sell Price（NT$）計算現值。

## 運作方式

- **價格**：GitHub Actions 每 5 分鐘執行 `fetch_price.py`，從 MaiCoin WebSocket 取得 `xauttwd` 的 bid（= 網頁上的 Sell Price），寫成 `price.json`，連同網頁一起部署到 GitHub Pages。
- **餘額**：使用者的瀏覽器直接向以太坊公開節點查詢 XAUT 合約的 `balanceOf`。

## 架設步驟

1. 在 GitHub 建立新的 repo（例如 `xaut-twd`），把這個資料夾的所有檔案上傳到 `main` 分支。注意要包含 `.github/workflows/update-price.yml`。
2. 到 repo 的 **Settings → Pages**，在 **Build and deployment → Source** 選 **GitHub Actions**。
3. 到 **Actions** 分頁，點左邊的「更新 XAUT 價格並部署網頁」，按 **Run workflow** 手動執行一次。
4. 執行成功後，網頁網址是 `https://你的帳號.github.io/xaut-twd/`。

## 注意

- GitHub 的排程常會延遲，價格可能落後 5–20 分鐘。網頁會顯示價格時間，超過 60 分鐘未更新會暫停計算。
- 公開 repo 若 60 天沒有任何提交，GitHub 會自動停用排程，需要到 Actions 頁面重新啟用。
- MaiCoin 的 WebSocket 是內部介面，不是公開 API，可能隨時改變或封鎖。
