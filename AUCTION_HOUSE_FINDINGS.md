# Auction House Findings

Paused on: 2026-05-16

We explored adding an Auction House capture module, then removed it because the useful search/listing traffic appears to be HTTPS/TLS rather than parseable plaintext TCP.

## What We Observed

- The legacy game socket still emits some plaintext market/account metadata.
- Plaintext route observed:
  - `market/market_player_get_items_on_sale`
- That route only exposed account sale metadata such as item count.
- User item searches did not appear as plaintext in packet captures.
- A short raw TCP trace showed market-looking HTTPS traffic to:
  - `hsmarket.panicartstudios.com`
  - observed on `172.238.126.79:443`
- TLS handshake/certificate data was visible, but search terms and listing responses were not.

## Conclusion

Passive Npcap capture is not enough for Auction House search/results data. The interesting request and response bodies are encrypted before they hit the wire.

## Possible Future Paths

- Check whether the game honors a local HTTPS proxy and custom CA certificate.
- Look for decoded market data in local client files, cache, or logs.
- Investigate a legitimate API path if session/auth details are discoverable without invasive process work.
- Consider a separate, opt-in memory/client-state approach if the Auction House module becomes important enough.

## Removed

- Auction House tab and capture feed UI.
- Renderer state for auction captures.
- Main-process auction capture IPC.
- Raw broad TCP trace logging to `network-trace.log`.
- Market listing event emission.
