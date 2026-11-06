"""
從 MaiCoin WebSocket 取得 XAUT 的 Sell Price（NT$），寫入 site/price.json。
由 GitHub Actions 定時執行。失敗時以非零狀態結束。
"""

import asyncio
import json
import sys
import time
from pathlib import Path

import websockets

WS_URL = "wss://ws.maicoin.com/ws"
ORIGIN = "https://www.maicoin.com"  # MaiCoin 只接受來自自家網站的連線
MARKET = "xauttwd"
OUT = Path(__file__).parent / "site" / "price.json"
SUBSCRIBE_MSG = {
    "action": "sub",
    "subscriptions": [{"channel": "pricing", "market": "all_twd"}],
    "combineSnapshots": True,
}


def extract_xaut_bid(msg: dict):
    """快照：{"c":"pricing","pr":[{"M":"xauttwd","pr":{"bid":...}}, ...]}
    單筆更新：{"c":"pricing","M":"xauttwd","pr":{"bid":...}}"""
    if msg.get("c") != "pricing":
        return None
    entries = msg["pr"] if isinstance(msg.get("pr"), list) else [msg]
    for e in entries:
        if isinstance(e, dict) and e.get("M") == MARKET:
            bid = (e.get("pr") or {}).get("bid")
            if bid is not None:
                return str(bid), e.get("T")
    return None


async def fetch_price(timeout: float = 20):
    async with websockets.connect(WS_URL, origin=ORIGIN, open_timeout=15) as ws:
        await ws.send(json.dumps(SUBSCRIBE_MSG))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(1, deadline - time.time()))
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            found = extract_xaut_bid(msg)
            if found:
                return found
    raise TimeoutError("在時限內沒有收到 xauttwd 價格")


def main():
    for attempt in range(1, 4):
        try:
            bid, source_ts = asyncio.run(fetch_price())
            break
        except Exception as e:
            print(f"第 {attempt} 次失敗：{e!r}", file=sys.stderr)
            if attempt == 3:
                sys.exit(1)
            time.sleep(5)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "market": MARKET,
        "sell_price_twd": bid,
        "source_ts": source_ts,
        "fetched_at": int(time.time()),
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("已寫入", OUT, data)


if __name__ == "__main__":
    main()
