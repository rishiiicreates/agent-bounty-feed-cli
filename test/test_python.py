import unittest
from client import AgentBountyFeedClient

class TestAgentBountyFeedClient(unittest.TestCase):
    def setUp(self):
        self.client = AgentBountyFeedClient()

    def test_earn_now(self):
        data = self.client.get_earn_now()
        self.assertIn("Agent Bounty Feed", data.get("name", ""))
        self.assertIsInstance(data.get("items"), list)
        self.assertGreater(len(data.get("items")), 0)
        item = data["items"][0]
        self.assertIn("id", item)
        self.assertIn("source", item)

    def test_feed_stats(self):
        stats = self.client.get_feed_stats()
        self.assertIn("stats", stats)
        self.assertIn("items", stats["stats"])
        self.assertIn("by_source", stats["stats"])

    def test_list_bounties(self):
        res = self.client.list_bounties(limit=2)
        items = res.get("items", [])
        self.assertIsInstance(items, list)
        self.assertLessEqual(len(items), 2)
        self.assertGreater(len(items), 0)

    def test_x402_negotiation(self):
        res = self.client.check_x402_trust_layer()
        self.assertEqual(res.get("status"), 402)
        self.assertTrue(res.get("is402"))
        body = res.get("body", {})
        self.assertEqual(body.get("error"), "X-PAYMENT header is required")
        accepts = body.get("accepts", [])
        self.assertGreater(len(accepts), 0)
        self.assertEqual(accepts[0].get("network"), "base")
        self.assertEqual(accepts[0].get("scheme"), "exact")

if __name__ == "__main__":
    unittest.main()
