import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentBountyFeedClient } from '../index.mjs';

test('AgentBountyFeedClient: direct earn-now fetch', async () => {
  const client = new AgentBountyFeedClient();
  const data = await client.getEarnNow();

  assert.ok(data.name.includes('Agent Bounty Feed'));
  assert.ok(typeof data.count === 'number');
  assert.ok(Array.isArray(data.items));
  assert.ok(data.items.length > 0);

  const first = data.items[0];
  assert.ok(first.id, 'item has an id');
  assert.ok(first.source, 'item has a source');
  assert.ok(typeof first.est_usd === 'number' || typeof first.reward === 'number');
});

test('AgentBountyFeedClient: MCP tools/list and get_feed_stats', async () => {
  const client = new AgentBountyFeedClient();
  const stats = await client.getFeedStats();

  assert.ok(stats.stats, 'stats object exists');
  assert.ok(typeof stats.stats.items === 'number');
  assert.ok(stats.stats.by_source, 'by_source mapping exists');
});

test('AgentBountyFeedClient: MCP list_bounties with limit', async () => {
  const client = new AgentBountyFeedClient();
  const res = await client.listBounties({ limit: 3 });

  assert.ok(Array.isArray(res.items));
  assert.ok(res.items.length <= 3);
  assert.ok(res.items.length > 0);
});

test('AgentBountyFeedClient: x402 Trust Layer 402 Payment Required negotiation', async () => {
  const client = new AgentBountyFeedClient();
  const x402 = await client.checkX402TrustLayer();

  assert.equal(x402.status, 402, 'status code must be HTTP 402');
  assert.equal(x402.is402, true);
  assert.ok(x402.body, 'response body must exist');
  assert.equal(x402.body.error, 'X-PAYMENT header is required');
  assert.ok(Array.isArray(x402.body.accepts));

  const accept = x402.body.accepts[0];
  assert.equal(accept.network, 'base');
  assert.equal(accept.scheme, 'exact');
  assert.equal(accept.maxAmountRequired, '10000'); // 0.01 USDC (6 decimals)
  assert.equal(accept.payTo, '0x6523acd890Ec5853db6D9eB731D7892666dbd27e');
});
