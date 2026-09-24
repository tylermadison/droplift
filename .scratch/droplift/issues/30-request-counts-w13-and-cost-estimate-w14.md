# 30: Request counts (W13) and cost estimate (W14)

**What to build:** The dashboard shows request counts (R2 Class A/B from the Provider, S3 from local counts) and an estimated monthly cost per Provider with a free-tier gauge. Prices come from a JSON price table that the app can update (PRD story 7, W13, W14, §7.7 price table).

**Blocked by:** 29 (Provider metrics and storage over time (W12))

**Status:** ready-for-agent

- [ ] Bar chart shows request counts per Provider
- [ ] Cost estimate per Provider uses the price table from the PRD (Sept 2026)
- [ ] Free-tier gauge shows R2 use against 10 GB + 1M Class A + 10M Class B
- [ ] Price table is a JSON file that can be updated without a new build
- [ ] Light and dark mode; table view
