#!/usr/bin/env python3
"""
Agent Bounty Feed Client (Python)
Zero-dependency client & CLI for Agent Bounty Feed (MCP, earn-now, and x402).
"""

import sys
import json
import base64
import argparse
import urllib.request
import urllib.error

BASE_URL = "https://agent-bounty-feed.dailydollar.workers.dev"

class AgentBountyFeedClient:
    def __init__(self, base_url=BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.mcp_url = f"{self.base_url}/mcp"
        self.earn_now_url = f"{self.base_url}/earn-now"
        self.v1_url = f"{self.base_url}/v1/bounties"
        self._rpc_id = 1

    def get_earn_now(self):
        """Fetch verified bounties ready to earn now via direct HTTP endpoint"""
        req = urllib.request.Request(self.earn_now_url, headers={"User-Agent": "abf-python/1.0"})
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read().decode("utf-8"))

    def call_mcp(self, method, params=None):
        """Low-level JSON-RPC 2.0 call to the MCP endpoint"""
        if params is None:
            params = {}
        payload = {
            "jsonrpc": "2.0",
            "id": self._rpc_id,
            "method": method,
            "params": params,
        }
        self._rpc_id += 1

        req = urllib.request.Request(
            self.mcp_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "User-Agent": "abf-python/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode("utf-8"))
            if "error" in data:
                raise RuntimeError(f"MCP Error [{data['error'].get('code')}]: {data['error'].get('message')}")
            return data.get("result", {})

    def call_tool(self, name, args=None):
        """Call an MCP tool via tools/call"""
        if args is None:
            args = {}
        result = self.call_mcp("tools/call", {"name": name, "arguments": args})

        if "structuredContent" in result:
            return result["structuredContent"]

        if "content" in result and result["content"] and "text" in result["content"][0]:
            raw_text = result["content"][0]["text"]
            try:
                return json.loads(raw_text)
            except Exception:
                return raw_text

        return result

    def get_feed_stats(self):
        """Get overall bounty feed statistics via MCP"""
        return self.call_tool("get_feed_stats")

    def list_bounties(self, limit=10, source=None, min_usd=None):
        """List bounties with optional filters via MCP"""
        args = {"limit": limit}
        if source:
            args["source"] = source
        if min_usd is not None:
            args["min_usd"] = float(min_usd)
        return self.call_tool("list_bounties", args)

    def get_bounty(self, bounty_id):
        """Get details for a specific bounty via MCP"""
        if not bounty_id:
            raise ValueError("Bounty ID is required")
        return self.call_tool("get_bounty", {"id": bounty_id})

    def check_x402_trust_layer(self):
        """Request x402 paid trust layer endpoint to inspect requirements & scheme"""
        req = urllib.request.Request(self.v1_url, headers={"Accept": "application/json", "User-Agent": "abf-python/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                return {"status": res.status, "body": json.loads(res.read().decode("utf-8"))}
        except urllib.error.HTTPError as e:
            body = None
            try:
                body = json.loads(e.read().decode("utf-8"))
            except Exception:
                pass

            payment_hdr = e.headers.get("payment-required")
            decoded_hdr = None
            if payment_hdr:
                try:
                    decoded_hdr = json.loads(base64.b64decode(payment_hdr).decode("utf-8"))
                except Exception:
                    decoded_hdr = payment_hdr

            return {
                "status": e.code,
                "is402": e.code == 402,
                "paymentRequiredHeader": decoded_hdr,
                "body": body,
            }


def format_table(items):
    if not items:
        return "No bounties found matching criteria."

    rows = []
    for b in items:
        bid = (b.get("id") or "")[:16].ljust(16)
        reward = f"${b.get('est_usd') or b.get('reward') or 0}".rjust(7)
        source = (b.get("source") or "")[:12].ljust(12)
        title = (b.get("title") or "")[:46].ljust(46)
        rows.append(f"{bid} | {reward} | {source} | {title}")

    header = f"{'ID'.ljust(16)} | {'Reward'.rjust(7)} | {'Source'.ljust(12)} | Title"
    divider = f"{'-'*16} | {'-'*7} | {'-'*12} | {'-'*46}"
    return "\n".join([header, divider] + rows)


def main():
    parser = argparse.ArgumentParser(description="Agent Bounty Feed CLI (Python)")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    earn_p = subparsers.add_parser("earn-now", help="Fetch high-confidence bounties ready to earn now")
    earn_p.add_argument("--json", action="store_true", help="Output raw JSON")

    list_p = subparsers.add_parser("list", help="List bounties from MCP feed")
    list_p.add_argument("--limit", type=int, default=10, help="Max results to fetch")
    list_p.add_argument("--source", type=str, help="Filter by source (e.g. frantic, direct, algora)")
    list_p.add_argument("--min-usd", type=float, help="Minimum reward in USD")
    list_p.add_argument("--json", action="store_true", help="Output raw JSON")

    stats_p = subparsers.add_parser("stats", help="Get feed metrics and source breakdown")
    stats_p.add_argument("--json", action="store_true", help="Output raw JSON")

    get_p = subparsers.add_parser("get", help="Get full details for a specific bounty")
    get_p.add_argument("id", type=str, help="Bounty ID, e.g. direct:abf-growth-202610")

    x402_p = subparsers.add_parser("x402-preview", help="Inspect x402 paid trust layer negotiation specs")
    x402_p.add_argument("--json", action="store_true", help="Output raw JSON")

    args = parser.parse_args()
    client = AgentBountyFeedClient()

    cmd = args.command or "earn-now"

    if cmd == "earn-now":
        data = client.get_earn_now()
        if getattr(args, "json", False):
            print(json.dumps(data, indent=2))
        else:
            print(f"\n=== Agent Bounty Feed: Earn Now ({data.get('count', 0)} items, age: {data.get('feed_age_minutes')}m) ===\n")
            print(format_table(data.get("items", [])))
            print(f"\nMore details: {data.get('mcp')}\n")

    elif cmd == "list":
        data = client.list_bounties(limit=args.limit, source=args.source, min_usd=args.min_usd)
        if getattr(args, "json", False):
            print(json.dumps(data, indent=2))
        else:
            items = data.get("items", [])
            print(f"\n=== Verified Bounties ({len(items)} items) ===\n")
            print(format_table(items))
            print("")

    elif cmd == "stats":
        data = client.get_feed_stats()
        if getattr(args, "json", False):
            print(json.dumps(data, indent=2))
        else:
            s = data.get("stats", {})
            print("\n=== Agent Bounty Feed Stats ===")
            print(f"Total Live Bounties: {s.get('items')}")
            print(f"Total Escrow Pool: ${s.get('total_usd')}")
            print(f"New in Last 24h: {s.get('new_last_24h')}")
            print(f"Zero Bond/Stake/KYC: {s.get('no_bond_no_stake_no_kyc')}")
            print("\nBreakdown by Source:")
            for src, meta in (s.get("by_source") or {}).items():
                if meta.get("items", 0) > 0:
                    print(f"  {src.ljust(14)}: {meta.get('items')} bounties (${meta.get('usd')})")
            print("")

    elif cmd == "get":
        data = client.get_bounty(args.id)
        print(json.dumps(data, indent=2))

    elif cmd == "x402-preview":
        data = client.check_x402_trust_layer()
        if getattr(args, "json", False):
            print(json.dumps(data, indent=2))
        else:
            print("\n=== x402 Trust Layer Negotiation Preview ===")
            print(f"Endpoint: {client.v1_url}")
            print(f"Status Code: {data.get('status')} (402 Payment Required expected)")
            body = data.get("body") or {}
            accepts = body.get("accepts", [])
            if accepts:
                acc = accepts[0]
                print(f"Scheme: {acc.get('scheme')}")
                print(f"Network: {acc.get('network')} (Base)")
                amount = float(acc.get("maxAmountRequired", 0)) / 1e6
                print(f"Price: {amount} USDC ($0.01)")
                print(f"Recipient (payTo): {acc.get('payTo')}")
                print(f"Asset (USDC): {acc.get('asset')}")
            print("\nTo unlock, agents attach standard x402 payment authorization in header X-PAYMENT.\n")

if __name__ == "__main__":
    main()
