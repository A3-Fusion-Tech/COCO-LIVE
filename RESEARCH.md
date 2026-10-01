# LiveCoco: Tamil Nadu Coconut Price Intelligence & Marketplace

**Research date:** 1 October 2026  
**Geographic focus:** Tamil Nadu, beginning with the Pollachi–Anaimalai–Udumalpet coconut belt  
**Recommended product:** Tamil-first price intelligence and verified B2B trade leads, followed by managed transactions

## 1. Executive recommendation

LiveCoco should not launch as a broad agriculture marketplace or promise a single “today’s coconut price.” Coconut is traded in several physically different forms, with different units, grades, locations and commercial terms. A useful product must answer:

> What is the credible price, for this coconut type and grade, in this location, at this time, under these pickup and payment terms?

The recommended wedge is:

1. **A trustworthy daily price board** for mature coconut, tender coconut, coconut with husk, milling copra, ball copra and selected by-products.
2. **Verified buy and sell requirements** with structured quality, quantity, pickup, payment and validity fields.
3. **Assisted matching** through Tamil voice/WhatsApp workflows and a small operations team.
4. Only after liquidity is proven, add logistics quotes, quality inspection, digital settlement and dispute handling.

The product’s defensibility will not come from listings alone. It will come from a clean Tamil Nadu coconut price history, verified counterparties, transaction outcomes and a repeat-buyer network.

## 2. Why Tamil Nadu is a credible launch market

Tamil Nadu’s 2025 government notification, using 2022–23 crop figures, reports:

- **4.727 lakh hectares** under coconut.
- **67,989 lakh nuts** of annual production (about 6.8 billion nuts).
- **14,383 nuts per hectare** average yield.
- **3,95,186 metric tonnes** of copra production.
- Production and harvesting occur throughout the year; the notified peak arrival period is **March to August**.
- Major districts include Coimbatore, Tiruppur, Thanjavur, Dindigul, Kanyakumari, Theni, Erode, Krishnagiri, Salem and Tenkasi, among others.

This is large enough for a specialist marketplace, but it is not one uniform market. Pollachi is the most useful launch reference point because it combines farm production, traders, drying yards, processors and outward movement to consumption centres.

### Current policy and price anchors

- The official **2026 MSP** is **₹12,027/quintal (₹120.27/kg)** for Fair Average Quality milling copra and **₹12,500/quintal (₹125/kg)** for ball copra.
- In July 2026, the Centre approved procurement of **87,226 MT of copra in Tamil Nadu**, including 87,000 MT of milling copra and 226 MT of ball copra.
- A public consumer-price page displayed **₹30 per mature coconut in Pollachi on 1 October 2026**, but explicitly does not guarantee accuracy. It is a retail/reference signal, not a farm-gate or wholesale quote.
- A mandi-data aggregator showed a Pollachi Uzhavar Sandhai modal rate of **₹42.50/kg on 7 July 2026**, with ₹40–45/kg minimum/maximum. This is useful historical context, not today’s executable trade price.

These numbers should never be shown side by side without labels. MSP for copra, mandi price per kilogram and retail price per nut describe different products and stages of the chain.

## 3. The real user problem

The information gap is not simply “prices are unavailable.” Prices are scattered, delayed, incomparable and hard to execute.

### Farmer and FPO pain points

- The quote received by phone cannot easily be compared with the market, another grade or another pickup location.
- “Price” may silently exclude harvesting, dehusking, loading, transport, commission, moisture loss or delayed payment.
- Small lots do not attract distant institutional buyers unless they are aggregated.
- A high headline price can become a poor net realization after deductions.
- Farmers often need a trusted human channel, Tamil language and voice support rather than form-heavy software.

### Buyer, trader and processor pain points

- Listings frequently omit harvest age, husk status, count/weight basis, size, moisture, oil content, loading date and minimum lot.
- Availability becomes stale quickly.
- It is difficult to establish whether a counterparty controls the stated stock.
- Quality disputes commonly surface after pickup rather than before agreement.
- Logistics and loading availability can decide whether a nominally good quote is executable.

### The opportunity

LiveCoco can turn an informal phone network into a structured but familiar workflow. The product should preserve calling and negotiation while making identity, lot details, quote history and agreed terms visible.

## 4. Market and value-chain map

| Stage | Typical actors | What LiveCoco should capture |
|---|---|---|
| Production | Individual farmer, tenant farmer, farm manager, FPO | Village/GPS area, number of bearing palms, harvest window, expected count, coconut type |
| Harvest | Climbers, harvest crews, dehuskers | Harvest date, service availability, per-tree/per-nut cost |
| Aggregation | Local trader, commission agent, FPO, cooperative | Lot consolidation, weighment/count, deductions, ownership/authorization |
| Primary processing | Copra yard, dryer, oil mill, desiccated coconut unit | Moisture, oil content, drying method, grade, recovery |
| Logistics | Tractor/mini-truck/lorry owner, transporter | Vehicle type, capacity, pickup time, freight, loading/unloading inclusion |
| Demand | Wholesaler, retailer, hotel/caterer, temple supplier, processor, exporter | Required grade, volume, destination, frequency, payment terms |
| By-products | Coir unit, pith unit, shell/charcoal processor | Husk/shell form, moisture, contamination, bale/bulk unit |

An important product insight is that the same farm can choose between tender harvest, mature nut sale or conversion to copra. The app should eventually show a **net-realization comparison**, not only raw market prices.

## 5. Price taxonomy: the foundation of the application

Every price record must include all of the following:

- Product: tender coconut, mature coconut, coconut with husk, dehusked coconut, milling copra, ball copra, oil, husk, shell or pith.
- Variety or locally used commercial label.
- Grade and measurable quality attributes.
- Unit: per nut, 100 nuts, kilogram, quintal, tonne, load or litre.
- Market stage: farm-gate, aggregator, regulated market, wholesale, processor purchase or retail.
- Exact location and whether the term is ex-farm, delivered or market-yard.
- Minimum, maximum and modal/executable quote—not an unlabeled average.
- Source, observed time, publication time and last verification time.
- Tax, commission, loading, dehusking and transport inclusion.
- Available quantity and quote-valid-until time.
- Confidence level and number of supporting observations.

### Recommended price labels

- **Official reference:** government/MSP/e-NAM/regulated-market data.
- **Verified market quote:** confirmed with a known trader, processor, cooperative or FPO.
- **Community report:** submitted by a user but not yet independently confirmed.
- **Live offer:** an executable buy or sell offer with an expiry time.
- **Estimated fair range:** calculated by LiveCoco and explicitly labelled as an estimate.

Never call delayed government data “live.” Show “reported for [date]” and freshness prominently.

## 6. Data-source strategy

| Source | Strength | Limitation | Recommended use |
|---|---|---|---|
| AGMARKNET via data.gov.in | Official daily min/max/modal wholesale data; API available | Reporting gaps, delays and inconsistent market coverage | Baseline history and cross-market comparison |
| Tamil Nadu Agricultural Marketing portal | State regulated-market and Uzhavar Sandhai information | Web interfaces may not provide a stable public API | State reference; pursue a formal data-sharing arrangement |
| Uzhavan / Uzhavan e-Market | Existing Tamil Nadu farmer reach, market price and buyer/seller interface | General agriculture product, not coconut-specific transaction intelligence | Do not duplicate; link users to government services where appropriate |
| e-NAM | Official trading network, commodity list, quality framework and integrated mandis | Coverage does not mean every coconut market has frequent online trades | Market/quality reference and later interoperability exploration |
| Coconut Development Board and MSP/PSS releases | Sector statistics, policy and procurement anchors | Not a daily local executable price | Policy layer and educational context |
| Cooperatives, FPOs, mills and traders | Best source of genuinely executable local quotes | Requires relationships, verification and anti-manipulation controls | Core proprietary data collection |
| User-submitted transactions | Reveals actual price realization and deductions | Incentive to misreport; privacy sensitivity | Use only after verification and anonymization |

### Daily data pipeline

1. Ingest official feeds and store the untouched source record.
2. Normalize product names, market names, grades, units and dates.
3. Reject impossible values; quarantine extreme changes for review.
4. Collect structured morning and afternoon quotes from a verified panel.
5. Compute a range and confidence score by product/location/term.
6. Publish provenance and freshness with every displayed number.
7. Retain corrections as an audit trail instead of silently overwriting history.

### Fair-price calculation

For an early product, use a transparent weighted median rather than opaque AI:

- Recent verified executable quotes: highest weight.
- Recent completed transactions: high weight after fraud checks.
- Official market modal price: medium weight.
- Unverified community submissions: low weight.
- Down-weight observations that are old, distant, a different grade or a different delivery term.

Display a range and confidence—e.g. “₹29–32/nut, medium confidence, 8 verified quotes”—rather than false precision.

## 7. Competitive landscape

| Product | What it already does | Gap LiveCoco can occupy |
|---|---|---|
| Uzhavan / Uzhavan e-Market | Tamil Nadu government market prices and farmer–trader interface; the wider Uzhavan app has substantial state reach | Coconut-specific grades, quote freshness, net realization, verification and operational follow-through |
| e-NAM | National regulated-market network, online trading and quality parameters; coconut, coconut with husk and tender coconut are listed commodities | Hyperlocal off-mandi discovery, assisted workflow and specialized Tamil coconut trading |
| Coconut Market App | Coconut-focused buy/sell Android app based in Pollachi | LiveCoco must differentiate on trusted price methodology, verified outcomes and stronger operations—not merely another listings feed |
| AgroDealz | Tamil Nadu-focused free produce listings for farmers, traders and agents | Structured coconut quality, trade terms, price intelligence and fulfillment confidence |
| Pollachi Farmers Market | Direct seller onboarding and buyer reach for local produce | Primarily a farm-market proposition; LiveCoco can focus on repeat wholesale trade |
| Agribazaar | Verified users, negotiation, quality checks, logistics, payment and settlement across commodities | Specialist Tamil network and coconut-specific workflow can be simpler and locally denser |
| Ninjacart | Mature B2B fresh-produce supply chain and retailer ordering | Operationally broad; LiveCoco can serve coconut farms, copra/processors and by-products in depth |

The main competitive risk is not a single app. It is the existing WhatsApp/phone network, which is fast, familiar and relationship-based. LiveCoco must make that workflow safer and more informative without forcing all communication into an unfamiliar interface.

## 8. Primary personas

1. **Small/medium coconut farmer** — wants a credible price, an actual buyer, quick payment and no surprise deductions.
2. **FPO/cooperative manager** — needs aggregation, member-lot records, buyer discovery, weighment and settlement reports.
3. **Local aggregator/trader** — needs recurring supply, fast matching, transport coordination and reputation.
4. **Copra/oil/food processor** — needs repeatable grade, moisture/oil data, volume and scheduled deliveries.
5. **Institutional or city buyer** — needs dependable count/size, delivery time, invoices and replacement/dispute rules.
6. **Transporter/harvest crew** — needs dense local jobs, clear scope and predictable payment.

Treat traders as participants to formalize, not enemies to remove. They provide aggregation, working capital, quality judgment and logistics that software alone does not replace.

## 9. MVP scope

### Farmer/seller experience

- Phone OTP and Tamil-first onboarding.
- Choose role without requiring a complicated business profile.
- Post a lot using photos, Tamil voice note or assisted phone call.
- Required fields: product, location, available date, approximate count/weight, husk status, grade/size, expected price/unit and pickup terms.
- See nearby reference prices with source and date.
- Receive offers; accept, reject or counter.
- One-tap call/WhatsApp after mutual interest, with phone-number masking if feasible.
- Record the final price and whether the trade completed.

### Buyer experience

- Post recurring or one-time requirements.
- Search by radius, product, quantity, date and quality.
- Save sourcing routes and suppliers.
- Make a structured offer with validity, pickup/delivery and payment terms.
- View verified identity, completion rate, dispute rate and recent activity—not a simplistic star rating alone.

### Operations console

- Verify accounts and supporting documents.
- Review stale, duplicate or suspicious listings.
- Confirm daily quotes from market contacts.
- Match unfulfilled requirements manually.
- Freeze an agreed “deal card” containing the exact commercial terms.
- Track cancellation, quality dispute, non-payment and resolution reason.

### Price board

- Tamil and English names.
- Today/latest reported range, prior day/week movement and data freshness.
- Separate tabs for farm-gate, market/wholesale, copra MSP and retail.
- Source-level confidence and “why prices differ” explainer.
- Alerts for a chosen product, market and threshold.

### Explicitly defer from v1

- Platform-held escrow or wallet.
- Automated credit.
- Guaranteed logistics across the state.
- AI visual grading presented as authoritative.
- Open anonymous chat.
- Consumer grocery delivery.

These features add capital, regulatory exposure and operational failure modes before supply-demand liquidity is established.

## 10. Product-specific quality fields

### Mature coconut

- With husk/dehusked, harvest date, age/maturity, size band, average weight, water/sloshing condition, cracked/sprouted/damaged percentage and count/weight basis.

### Tender coconut

- Harvest age, colour/variety, size band, expected water volume, tender meat preference, stem condition and count.

### Copra

- Milling/ball type, moisture, oil content if assayed, mould/smoke/burn/foreign matter, wrinkled kernel percentage, drying method and lab/assayer evidence.

e-NAM’s coconut reference uses oil content, maximum moisture and wrinkled kernels among key copra quality parameters. LiveCoco should align field names to recognized standards while keeping farmer entry simple.

## 11. Recommended transaction workflow

```text
Verified requirement/listing
        ↓
Structured offer and counter-offer
        ↓
Deal card: product + grade + quantity + unit + location + deductions + payment
        ↓
Optional inspection / photo / weighment evidence
        ↓
Pickup or delivery proof
        ↓
Buyer acceptance or time-limited dispute
        ↓
Completion record and private outcome feedback
```

For v1, payment can occur directly between parties through their chosen method. LiveCoco records the stated terms and confirmation but should not hold funds. Use a regulated payment provider later if integrated settlement becomes necessary.

## 12. Trust, safety and market integrity

- OTP for everyone; stronger KYC for traders, processors and high-volume sellers.
- Verify GST/FSSAI/market licence only when applicable; do not imply that every farmer needs every business licence.
- Distinguish “identity verified,” “business document verified,” and “stock verified.”
- Rate-limit new accounts and hide full phone numbers until mutual interest.
- Detect duplicate images, copied listings, impossible prices and coordinated quote manipulation.
- Require disclosure when an agent lists on behalf of a farmer.
- Keep evidence: time-stamped lot photos, agreed deal card, weighment slip and pickup proof.
- Provide Tamil complaint handling and a clear suspension/appeal process.
- Never publish an individual farm’s sensitive production or exact location without necessity and consent.

## 13. Compliance checklist before commercial launch

This is a product checklist, not legal advice. Obtain Tamil Nadu counsel before facilitating trades or charging transaction fees.

1. **Agricultural marketing:** Determine when the platform, seller, buyer, commission agent or place of trade requires registration/licensing under the Tamil Nadu Agricultural Produce Marketing (Regulation) Act, 1987 and current rules/notifications. The answer depends on the exact transaction model and notified produce/area.
2. **Food licensing:** FSSAI describes an online marketplace facilitating food sales as an e-commerce food business operator; FoSCoS currently lists e-commerce as requiring a Central licence. Confirm the treatment of raw primary produce and every seller category before launch.
3. **GST:** Determine whether LiveCoco is only a lead-generation service or an e-commerce operator collecting consideration. Marketplace invoicing, TCS, seller GST treatment and platform fees need tax advice.
4. **Payments:** Do not pool or hold customer money in LiveCoco’s own account. Use a regulated payment provider and marketplace settlement product if platform-managed payments are introduced.
5. **Consumer/e-commerce rules:** B2C sales require price, seller, grievance, return/refund and other marketplace disclosures. Even a B2B product needs clear terms, prohibited conduct and dispute rules.
6. **Weights and measures:** Clearly state standardized units, weighing method and who is responsible for verified weighing equipment.
7. **Privacy:** Build for India’s Digital Personal Data Protection framework: plain-language notice in Tamil/English, purpose limitation, consent/other lawful basis as applicable, access/correction/erasure handling, security safeguards, breach response and limited retention. Final DPDP Rules were notified in November 2025 with staged commencement.
8. **Messaging:** Obtain consent for WhatsApp/SMS price alerts and provide simple opt-out.

## 14. Technology and data design

### Practical first architecture

- Mobile-responsive web app or Android-first PWA for farmers and traders.
- Tamil-first interface with English toggle, large touch targets and voice-note capture.
- Backend API with PostgreSQL and geospatial support.
- Scheduled price ingestion plus an operator review queue.
- Object storage for compressed listing and evidence photos.
- Role-based internal console with immutable audit events.
- SMS/WhatsApp provider for OTP, alerts and assisted workflows.
- Analytics events designed around trades, not vanity page views.

### Core entities

- User, Organization, Farm/Facility, Verification, Product, GradeDefinition
- Market, PriceObservation, PriceSource, PriceAggregate
- SellLot, BuyRequirement, Offer, Deal, Inspection, Weighment
- Shipment, PaymentConfirmation, Dispute, ReputationEvent, AuditEvent

Store the original unit and normalized unit together. Do not convert per-nut prices to per-kilogram without an observed or explicitly assumed average weight.

### Resilience requirements

- Low-bandwidth pages and compressed images.
- Draft listing that survives a lost connection.
- Tamil text plus icon/voice guidance.
- Human-assisted onboarding and a phone fallback.
- Price pages should remain readable without login.

## 15. Business model

### Recommended sequence

1. **Free price board and basic listings** to build density.
2. **Buyer subscription** for alerts, saved requirements, sourcing dashboard and verified supplier access.
3. **Success/coordination fee** only for deals that LiveCoco actively fulfills and can measure.
4. **Inspection and logistics referral margin** through disclosed partners.
5. Later: FPO software, market analytics and processor procurement tools.

Avoid charging farmers merely to see reference prices. Avoid hidden lead resale. A fee is defensible only when it creates a verified opportunity or reduces execution work.

## 16. Go-to-market plan

### Pilot geography

- Supply: Pollachi, Anaimalai, Kinathukadavu, Sulur/Palladam and Udumalpet belt.
- Initial demand: Coimbatore wholesalers/processors and selected repeat buyers in Chennai, Bengaluru and nearby industrial/retail corridors.
- Start with mature coconut and milling copra; add tender coconut after the core workflow works because tender-coconut fulfilment is more time-sensitive.

### Seed strategy

- Recruit 3–5 FPOs/cooperatives or village aggregators.
- Enrol 20–30 repeat buyers/processors before broad farmer marketing.
- Create a verified price panel of 10–15 diverse participants; no single trader should determine the displayed range.
- Run assisted onboarding camps and a Tamil helpline.
- Publish a short morning price bulletin users can share on WhatsApp, linking back to source detail.

The marketplace should be demand-led. Farmer onboarding without active buyers creates stale listings and destroys trust.

## 17. Twelve-week validation plan

### Weeks 1–2: discovery

- Interview at least 15 farmers, 5 FPO/cooperative staff, 10 traders/aggregators, 5 processors, 5 city buyers and 5 transport/harvest providers.
- Observe three real negotiations from quote to payment.
- Document local grade vocabulary, units, deductions and payment timelines.

### Weeks 3–4: concierge pilot

- Operate the price bulletin and matching workflow manually through phone/WhatsApp.
- Record every quote’s source, grade, term and outcome in a structured dataset.
- Test whether buyers will publish requirements and whether farmers accept structured deal cards.

### Weeks 5–8: MVP

- Launch public price pages, verified requirements/listings, offers and operations console.
- Keep matching assisted.
- Measure quote-to-contact, contact-to-deal and completed-deal rates.

### Weeks 9–12: repeatability

- Add saved requirements, alerts, repeat order and basic reputation.
- Test one inspection partner and two transport corridors.
- Decide whether transaction settlement is valuable enough to justify compliance and integration work.

## 18. Success metrics

The north-star metric should be **verified completed trade value with repeat counterparties**, not registrations.

Track:

- Weekly active verified sellers and buyers by micro-market.
- Percentage of listings/requirements receiving a qualified response within 24 hours.
- Median time to first offer and to agreed deal.
- Completed volume and gross merchandise value by product.
- Repeat trade rate within 30/60 days.
- Farmer net realization versus their credible local alternative, after all deductions.
- Cancellation, rejection, quality dispute and delayed-payment rate.
- Price observation freshness, coverage and confidence.
- Share of activity requiring manual intervention.

Suggested pilot gates before expansion:

- 70% of active requirements receive a qualified match within 24 hours.
- 30% or more of completed buyers repeat within 60 days.
- Fewer than 5% of completed deals become unresolved disputes.
- At least three independent verified price sources per published micro-market/product range.

## 19. Biggest risks and mitigations

| Risk | Mitigation |
|---|---|
| Empty two-sided marketplace | Recruit repeat buyers first; assisted matching; narrow geography and products |
| Manipulated price reports | Weighted sources, contributor diversity, anomaly review, provenance and confidence |
| Stale listings | Short expiry, reconfirmation prompts and automatic archive |
| Quality dispute | Structured grade fields, deal card, evidence, optional inspection and acceptance window |
| Users bypass platform | Make price history, repeat ordering, documentation, logistics and reputation worth retaining |
| Trader resistance | Include traders and agents transparently; solve their sourcing and logistics pain |
| Operational overreach | Defer guarantees, escrow and statewide logistics until density is proven |
| Regulatory uncertainty | Launch as verified information/lead facilitation only after counsel reviews the exact model |
| Low digital comfort | Tamil, voice, WhatsApp, assisted onboarding and phone fallback |

## 20. Final product position

**Tamil:** “நம்பகமான தேங்காய் விலை. சரிபார்க்கப்பட்ட வாங்குபவர்கள். தெளிவான வர்த்தக நிபந்தனைகள்.”  
**English:** “Trusted coconut prices, verified buyers, and clear trade terms.”

LiveCoco should win by being the system of record for a coconut deal: what product, what grade, what quantity, which unit, whose transport, which deductions, when payment is due and what actually happened. That is a stronger and more durable proposition than another buy/sell board.

## Sources

Primary and official sources were preferred for statistics, policy, standards and compliance. Commercial sites are used only to describe their own products or illustrate a clearly labelled market signal.

1. Government of Tamil Nadu, 2025 copra/PSS notification: https://www.stationeryprinting.tn.gov.in/extraordinary/2025/60_Ex_II_1_2025.pdf
2. Government of Tamil Nadu Department of Economics and Statistics, Season and Crop Reports: https://des.tn.gov.in/en/node/18
3. Government of India PIB, 2026 copra MSP: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2203006&lang=1&reg=3
4. Government of India PIB, 2026 Tamil Nadu copra procurement approval: https://www.pib.gov.in/newsite/erelcontent.aspx?lang=2&reg=48&relid=291021
5. data.gov.in, AGMARKNET daily mandi price dataset: https://www.data.gov.in/catalog/current-daily-price-various-commodities-various-markets-mandi
6. Tamil Nadu Department of Agricultural Marketing and Agri Business: https://agrimark.tn.gov.in/
7. Tamil Nadu Uzhavan services and e-Market: https://www.tnagrisnet.tn.gov.in/people_app/dashboard/main/en
8. e-NAM overview and commodity coverage: https://www.enam.gov.in/web/
9. e-NAM coconut quality specification: https://enam.gov.in/web/assest/download/sul/231_commodity_list.pdf
10. TNAU coconut harvest and post-harvest guidance: https://www.agritech.tnau.ac.in/expert_system/coconut/coconut/coconut_harvest_postharvest.html
11. India Code, Tamil Nadu Agricultural Produce Marketing (Regulation) Act, 1987: https://www.indiacode.nic.in/handle/123456789/20406?view_type=browse
12. FSSAI e-commerce food-business guidelines: https://www.fssai.gov.in/upload/advisories/2018/02/5a968f14cc994189.pdf
13. FoSCoS eligibility criteria: https://foscos.fssai.gov.in/search-eligibility/CL
14. MeitY, final Digital Personal Data Protection Rules, 2025: https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
15. Agribazaar marketplace: https://www.agribazaar.com/our-products/marketplace
16. Ninjacart: https://ninjacart.com/
17. Coconut Market App listing: https://play.google.com/store/apps/details?id=com.coconutmarketapp
18. AgroDealz Pollachi coconut listing proposition: https://agrodealz.in/sell-coconut-in-pollachi
19. Pollachi Farmers Market seller proposition: https://www.pollachifarmersmarket.com/become-seller/
20. Pollachi public consumer-price signal (non-authoritative): https://www.oneindia.com/coconut-price-in-pollachi.html

