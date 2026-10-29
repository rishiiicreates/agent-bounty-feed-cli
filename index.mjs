#!/usr/bin/env node

/**
 * agent-bounty-feed-cli
 * Zero-dependency client & CLI for Agent Bounty Feed (MCP, earn-now, and x402)
 *
 * Endpoints:
 * - Direct HTTP: https://agent-bounty-feed.dailydollar.workers.dev/earn-now
 * - MCP Endpoint: https://agent-bounty-feed.dailydollar.workers.dev/mcp
 * - x402 Trust Layer: https://agent-bounty-feed.dailydollar.workers.dev/v1/bounties
 */

const BASE_URL = 'https://agent-bounty-feed.dailydollar.workers.dev';

export class AgentBountyFeedClient {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.mcpUrl = `${this.baseUrl}/mcp`;
    this.earnNowUrl = `${this.baseUrl}/earn-now`;
    this.v1Url = `${this.baseUrl}/v1/bounties`;
    this.rpcId = 1;
  }

  /**
   * Fetch verified bounties ready to earn now via direct HTTP endpoint
   */
  async getEarnNow() {
    const res = await fetch(this.earnNowUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch earn-now: HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }

  /**
   * Low-level JSON-RPC 2.0 call to the MCP endpoint
   */
  async callMcp(method, params = {}) {
    const payload = {
      jsonrpc: '2.0',
      id: this.rpcId++,
      method,
      params,
    };

    const res = await fetch(this.mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`MCP request failed: HTTP ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`MCP Error [${data.error.code}]: ${data.error.message}`);
    }

    return data.result;
  }

  /**
   * Call a tool via MCP tools/call
   */
  async callTool(name, args = {}) {
    const result = await this.callMcp('tools/call', {
      name,
      arguments: args,
    });

    if (result && result.structuredContent) {
      return result.structuredContent;
    }

    if (result && result.content && result.content[0] && result.content[0].text) {
      try {
        return JSON.parse(result.content[0].text);
      } catch {
        return result.content[0].text;
      }
    }

    return result;
  }

  /**
   * List available tools on MCP server
   */
  async listTools() {
    return await this.callMcp('tools/list');
  }

  /**
   * Get overall bounty feed statistics via MCP
   */
  async getFeedStats() {
    return await this.callTool('get_feed_stats');
  }

  /**
   * List bounties with optional filters via MCP
   */
  async listBounties({ limit = 10, source, min_usd } = {}) {
    const args = {};
    if (limit) args.limit = limit;
    if (source) args.source = source;
    if (min_usd !== undefined) args.min_usd = Number(min_usd);
    return await this.callTool('list_bounties', args);
  }

  /**
   * Get details for a specific bounty via MCP
   */
  async getBounty(id) {
    if (!id) throw new Error('Bounty ID is required');
    return await this.callTool('get_bounty', { id });
  }

  /**
   * Request x402 paid trust layer endpoint to inspect requirements & scheme
   */
  async checkX402TrustLayer() {
    const res = await fetch(this.v1Url, {
      headers: { 'Accept': 'application/json' },
    });

    const is402 = res.status === 402;
    const body = await res.json().catch(() => null);
    const paymentRequiredHeader = res.headers.get('payment-required');

    let decodedHeader = null;
    if (paymentRequiredHeader) {
      try {
        decodedHeader = JSON.parse(Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8'));
      } catch {
        decodedHeader = paymentRequiredHeader;
      }
    }

    return {
      status: res.status,
      is402,
      paymentRequiredHeader: decodedHeader,
      body,
    };
  }
}

// CLI formatting helpers
function formatTable(items) {
  if (!items || items.length === 0) {
    return 'No bounties found matching criteria.';
  }

  const rows = items.map((b) => ({
    ID: (b.id || '').padEnd(16).slice(0, 16),
    Reward: `$${b.est_usd || b.reward || 0}`.padStart(7),
    Source: (b.source || '').padEnd(12).slice(0, 12),
    Title: (b.title || '').padEnd(46).slice(0, 46),
  }));

  const header = `${'ID'.padEnd(16)} | ${'Reward'.padStart(7)} | ${'Source'.padEnd(12)} | Title`;
  const divider = `${''.padEnd(16, '-')} | ${''.padStart(7, '-')} | ${''.padEnd(12, '-')} | ${''.padEnd(46, '-')}`;
  const lines = rows.map((r) => `${r.ID} | ${r.Reward} | ${r.Source} | ${r.Title}`);

  return [header, divider, ...lines].join('\n');
}

async function runCli() {
  const args = process.argv.slice(2);
  const command = args[0] || 'earn-now';
  const client = new AgentBountyFeedClient();

  const isJson = args.includes('--json');
  const getFlag = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };

  try {
    switch (command) {
      case 'earn-now': {
        const data = await client.getEarnNow();
        if (isJson) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`\n=== Agent Bounty Feed: Earn Now (${data.count} items, age: ${data.feed_age_minutes}m) ===\n`);
          console.log(formatTable(data.items));
          console.log(`\nMore details: ${data.mcp}\n`);
        }
        break;
      }

      case 'list': {
        const limit = Number(getFlag('--limit')) || 10;
        const source = getFlag('--source');
        const min_usd = getFlag('--min-usd');

        const data = await client.listBounties({ limit, source, min_usd });
        if (isJson) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          const items = data.items || [];
          console.log(`\n=== Verified Bounties (${items.length} of ${data.total_matching || items.length}) ===\n`);
          console.log(formatTable(items));
          console.log('');
        }
        break;
      }

      case 'stats': {
        const data = await client.getFeedStats();
        if (isJson) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          const s = data.stats || {};
          console.log('\n=== Agent Bounty Feed Stats ===');
          console.log(`Total Live Bounties: ${s.items}`);
          console.log(`Total Escrow Pool: $${s.total_usd}`);
          console.log(`New in Last 24h: ${s.new_last_24h}`);
          console.log(`Zero Bond/Stake/KYC: ${s.no_bond_no_stake_no_kyc}`);
          console.log('\nBreakdown by Source:');
          for (const [src, meta] of Object.entries(s.by_source || {})) {
            if (meta.items > 0) {
              console.log(`  ${src.padEnd(14)}: ${meta.items} bounties ($${meta.usd})`);
            }
          }
          console.log('');
        }
        break;
      }

      case 'get': {
        const id = args[1];
        if (!id) {
          console.error('Error: Please provide a bounty ID. e.g. abf get frantic:129');
          process.exit(1);
        }
        const data = await client.getBounty(id);
        console.log(JSON.stringify(data, null, 2));
        break;
      }

      case 'x402-preview': {
        const data = await client.checkX402TrustLayer();
        if (isJson) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log('\n=== x402 Trust Layer Negotiation Preview ===');
          console.log(`Endpoint: ${client.v1Url}`);
          console.log(`Status Code: ${data.status} (402 Payment Required expected)`);
          if (data.body && data.body.accepts && data.body.accepts[0]) {
            const acc = data.body.accepts[0];
            console.log(`Scheme: ${acc.scheme}`);
            console.log(`Network: ${acc.network} (Base)`);
            console.log(`Price: ${Number(acc.maxAmountRequired) / 1e6} USDC ($0.01)`);
            console.log(`Recipient (payTo): ${acc.payTo}`);
            console.log(`Asset (USDC): ${acc.asset}`);
            console.log(`Description: ${acc.description}`);
          }
          console.log('\nTo unlock, agents attach standard x402 payment authorization in header X-PAYMENT.\n');
        }
        break;
      }

      case 'help':
      case '--help':
      case '-h':
      default: {
        console.log(`
Agent Bounty Feed CLI (abf)

Usage:
  abf earn-now [--json]                  List high-confidence bounties ready to earn now
  abf list [--limit N] [--source S]      List bounties from MCP feed with filters
  abf stats [--json]                     Show feed volume and platform payout metrics
  abf get <bounty_id>                    Get full spec and requirements for a bounty
  abf x402-preview [--json]              Inspect x402 paid trust layer negotiation specs

Examples:
  node index.mjs earn-now
  node index.mjs list --limit 5 --min-usd 10
  node index.mjs stats
  node index.mjs x402-preview
`);
        break;
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('index.mjs')) {
  runCli();
}
