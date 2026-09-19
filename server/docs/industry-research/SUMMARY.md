# Industry CRM Research — Condensed Summary

Source: 22 real business-audit documents supplied by the user (originally `.docx`, raw text
extractions in this directory). Read in full via 3 parallel research passes 2026-09-19 and
converted into concrete CRM configuration (pipeline stages, support categories, custom fields,
and the specific pain point a WhatsApp-CRM solves) per industry.

**Key finding**: 15 of the 22 documents describe 2-4 distinct sub-business-models bundled under
one title. The real pack count is ~40-45 sub-industry configurations, not 22. Real Estate is
explicitly excluded from product scope — Samvid OS already covers it as a general platform.

Phasing (user-directed, 2026-09-19): Phase 1 = highest WhatsApp-native fit + highest Indian SMB
volume, build first. Phase 2 = rest of the user's selected list. Phase 3 = explicitly deferred
(Real Estate, Education, Media-Agency, Cement, Chemicals, Pharmaceuticals, Food Processing,
Construction).

---

## Phase 1 (build first)

### Hospitality — Restaurants/Cafés
- **Pipeline**: New Enquiry/Reservation → Confirmed → Seated/Served (won) / No-show-Cancelled (lost)
- **Fields**: Party Size (number), Preferred Date/Time (date), Occasion (text), Dietary Requirements (text)
- **Support categories**: Reservation Change, Feedback/Complaint, Catering Enquiry, Billing
- **Pain point solved**: enquiries/bookings scattered across Instagram/WhatsApp/phone/walk-in, staff manually re-answer the same questions, slow responses lose bookings — solved by WhatsApp automation + online booking + automated reminders.

### Hospitality — Hotels/Resorts
- **Pipeline**: New Enquiry → Room/Rate Quoted → Deposit/Booking Confirmed (won) / Cancelled (lost)
- **Fields**: Check-in/out Dates (date), Room Type (select), Party Size (number), Booking Channel (select: Direct/OTA/Agent)
- **Support categories**: Reservation Change, Billing/Invoice Query, Service Complaint, Refund/Cancellation
- **Pain point solved**: heavy OTA commission dependence — CRM-captured guest profiles enable direct-booking loyalty offers instead of paying OTA commission every time.

### Hospitality — Travel Agencies/Tour Operators/MICE
- **Pipeline**: New Enquiry → Traveller/Requirement Profiling → Itinerary/Proposal Sent → Negotiation → Deposit/Booking Confirmed (won) / Lost-Cancelled
- **Fields**: Destination/Property (select), Travel/Check-in Dates (date), Party/Group Size (number), Budget Range (number), Special Requirements (text), Booking Channel (select)
- **Support categories**: Reservation/Booking Change, Billing/Invoice Query, Service Complaint/Recovery, Refund & Cancellation, Itinerary/Travel Support
- **Pain point solved**: same multi-channel enquiry chaos as hotels; automated payment links + follow-up reminders directly close the "slow response = lost booking" leak.

### Healthcare — Hospital/Clinic (OPD)
- **Pipeline**: Enquiry/Appointment Request → Appointment Scheduled → Consultation Completed → Treatment/Prescription Advised → Billing Closed (won) → Follow-up Booked / No-show-Lost
- **Fields**: Patient Type (select: New/Returning/Referral), Insurance Provider/TPA (select), Referring Doctor (text), Department/Specialty (select), Consultation Mode (select: In-person/Tele), Chronic Condition Flag (checkbox), Next Follow-up Date (date)
- **Support categories**: Appointment Booking/Reschedule, Billing & Insurance Claim Query, Lab/Report Delivery Status, Prescription/Follow-up Query, Service Complaint
- **Pain point solved**: "Patients call, send WhatsApp messages, or walk in. Appointments maintained manually, follow-ups missed, patients choose another provider due to delayed response" — solved by Patient CRM + WhatsApp integration + automated reminders (verbatim from the doc's own solution).

### Healthcare — Diagnostics/Labs
- **Pipeline**: Test Booking Request → Sample Collection Scheduled → Report Processing → Report Delivered & Billed (won) / Cancelled (lost)
- **Fields**: Test/Panel Type (select), Referring Doctor (text), Home Collection Required (checkbox), Insurance/TPA (select)
- **Support categories**: Report Status Query, Booking/Reschedule, Billing Dispute, Home-collection Complaint
- **Pain point solved**: high-volume, high-frequency test bookings need the same automated-reminder treatment as clinic appointments; report-status queries are the #1 inbound volume driver.

### Trade & Commerce — B2B Wholesale/Distribution
- **Pipeline**: New Enquiry/Order Request → Quotation Sent → Credit/Limit Check → Order Confirmed & Dispatched → Payment Collected (won) / Lost-Cancelled
- **Fields**: Customer Type (select: Retailer/Wholesaler/Institution), Territory/Route (select), Credit Limit & Terms (number), Category/Product Line (select), Average Order Value (number), Payment/Risk History (select)
- **Support categories**: Order Status/Dispatch Query, Stock Availability Query, Invoice/Credit Note Query, Outstanding Payment ("Udhari") Follow-up, Return/Damage Claim, Pricing/Scheme Query
- **Pain point solved**: "Retailers purchase on credit (Udhari). Payments tracked manually, causing delayed collections, blocked cash flow" — solved by automated invoicing + customer ledger + WhatsApp payment reminders + receivables dashboard.

### Trade & Commerce — B2C Retail/E-commerce
- **Pipeline**: New Enquiry → Product Interest Confirmed → Order Placed → Delivered & Paid (won) / Cancelled (lost)
- **Fields**: Product Category (select), Order Channel (select), Preferred Delivery Window (text)
- **Support categories**: Order Status, Returns/Exchange, Product Question, Billing
- **Pain point solved**: excess inventory/stockouts from poor demand visibility; WhatsApp commerce already dominant channel for Indian D2C/retail.

### Professional Services — Advisory (CA/legal/consulting)
- **Pipeline**: Lead Captured → Consultation/Discovery → Conflict-of-Interest & Risk Check → Proposal/Engagement Letter Sent → Negotiation → Engagement Won (signed & advance received) / Declined-Lost
- **Fields**: Client Industry (select), Annual Turnover/Employee Count (number), Service Line/Specialisation (select), Engagement Type (select: fixed fee/retainer/hourly/success fee), Compliance Deadline/Next Filing Due (date), Referral Source (select), Recurring Retainer Value (number)
- **Support categories**: Invoice/Billing Dispute, Compliance Deadline & Filing-status Query, Document Upload/Portal Access, Scope-of-work Clarification, Service-quality Escalation
- **Pain point solved**: scope creep/unbilled advisory work (staff answer extra client questions without billing) — solved by service-request tracking logging every ad-hoc query as a trackable, billable request. Also: slow billing/collections, solved by automated invoicing + WhatsApp payment reminders.
- **Note**: the source doc also covers Recruitment/Staffing as a distinct sub-model with its own pipeline (Requirement Intake → Candidate Sourcing/Screening → Submitted to Client → Interview Scheduled → Offer Extended → Candidate Joined-Won / Position Lost-Withdrawn) — deferred to Phase 2.

### Healthcare — Telemedicine/Home-care
- **Pipeline**: New Enquiry/Care Request → Assessment/Triage Call → Care Plan Proposed → Plan Confirmed & Payment (won) / Declined-Lost. Parallel renewal cycle: Care Plan Renewal Due → Reminder Sent → Renewed (won) / Discontinued (lost)
- **Fields**: Patient Type (select: New/Returning), Care Type (select: Teleconsultation/Home Nursing/Physiotherapy/Elder Care), Preferred Consultation Mode (select), Care Plan Duration (select), Next Follow-up/Visit Date (date)
- **Support categories**: Appointment/Visit Scheduling, Care Plan & Billing Query, Caregiver/Nurse Assignment, Prescription/Follow-up Query, Service Complaint
- **Pain point solved**: same core OPD problem (multi-channel enquiries, missed follow-ups) plus a recurring-revenue renewal risk unique to subscription-style home care — same renewal-reminder pattern as the Entertainment membership pack applies here.
- **Note**: pipeline constructed by extrapolation from the source doc's own characterization ("recurring care-plan/subscription model") combined with the OPD/membership patterns already extracted in detail — the source document itself didn't give this sub-model a fully separate pipeline breakdown, only the clinic/OPD flow was detailed directly.

### Entertainment — Membership-based (gyms/salons/academies)
- **Pipeline**: New Enquiry → Contacted → Trial/Site Visit → Booking Confirmed & Paid (won) / Lost-No Response. Parallel renewal cycle: Renewal Due → Reminder Sent → Renewed (won) / Churned (lost)
- **Fields**: Business Sub-category (select: Gym/Salon/Gaming/Park/Academy), Membership Tier (select), Preferred Activity/Class (select), Age Group (select), Renewal Date (date)
- **Support categories**: Booking/Slot Change, Membership Renewal & Billing, Facility/Equipment/Safety Complaint, Refund/Cancellation, Class/Trainer Schedule Query
- **Pain point solved**: "Customers Joined. But Did They Renew?" — memberships tracked manually so renewal dates are missed — solved by automated WhatsApp renewal reminders + renewal dashboard.

---

## Phase 2 (sequence after Phase 1 proves the mechanism)

- **Entertainment — Ticketed venues** (parks, arcades, bowling): booking/quotation-driven, similar shape to membership pack but no renewal cycle.
- **Entertainment — Events/Esports/Sponsorship**: project/sponsorship-based, longer B2B-style sales cycle.
- **Media & Communication — Content production/creator**: doc itself flags this as not a real sales pipeline (greenlight/production workflow) — needs different treatment than a CRM pipeline.
- **Media & Communication — Agency/B2B services** (advertising, PR, corporate comms): Lead → Brief/Discovery Call → Audit/Strategy → Proposal/Pitch Sent → Negotiation → Contract/SOW Signed (won) / Lost. *(Note: this sub-model was in the "excluded" Phase 3 list per user direction — only Content production/creator is Phase 2.)*
- **Logistics — Fleet/Freight Brokerage**: New Enquiry/Load Request → Quotation Sent → Vehicle/Capacity Allocated → In-Transit/Dispatched → Delivered & POD Received (won) / Lost-Cancelled. Fields: Cargo Type, Origin-Destination Lane, Vehicle Type Required, Shipment Weight/Volume. Categories: Shipment Status/Tracking, POD Request, Freight Billing Dispute, Damage/Loss Claim.
- **Logistics — 3PL/Warehousing**: contract-based account management, different cycle from per-shipment brokerage.
- **Professional Services — Recruitment/Staffing**: see pipeline noted above under Advisory.
- **Financial Services — Lending**: Lead Captured → KYC/Document Collection → Credit Underwriting/Bureau Check → Approved (Sanction Letter) → Disbursed (won) → Repayment/Collections Active / Rejected-Withdrawn (lost). Fields: Product Type, Loan Amount Requested, Monthly Income, Credit Bureau Score, KYC Status. Categories: Loan/EMI Status, Claim Intimation, KYC Re-submission, Account Servicing.
- **Financial Services — Insurance**: Lead → Needs Analysis → Quotation → Underwriting → Policy Issued (won) → Renewal Due / Lapsed-Declined (lost).
- **Financial Services — Wealth/Investment**: onboarding/portfolio cycle, not detailed in extraction — needs its own pass before seeding.
- **Automobile — Component Manufacturer/Supplier**: OEM Enquiry/RFQ (with drawing) → Sample/Technical Development → Supplier Audit & Nomination → PPAP Approval → PO/Annual-Rate Contract → Production Scheduled → Dispatched & Invoiced (won) / Lost-Not Nominated. Fields: OEM/Tier level, Part number & drawing revision, PPAP status, Annual volume commitment.
- **Automobile — Dealership/Retail**: Lead/Enquiry → Test Drive → Quotation/Finance & Insurance → Booking Confirmed → Registration/PDI → Delivered (won) / Lost.
- **Metals & Heavy Industry — Fabrication/Job-work**: Customer Enquiry/Drawing (RFQ) → Technical Assessment & Costing → Quotation → Commercial Negotiation → PO/Contract Confirmed → Production Scheduled → QC/NDT Inspection → Dispatched/Installed & Invoiced (won) / Lost. Fields: Material grade/standard, Drawing/RFQ reference, Annual tonnage, NDT/certification requirement.
- **Electronics & Electricals**: Enquiry/RFQ Received → Quotation → Sample/Prototype Approval → PO Confirmed → In Production → Dispatched (won) / Lost. Fields: Product/component type, Order quantity/MOQ, Certification requirement (BIS/CE/RoHS), Customer type.
- **Industrial-manufacturing cluster** (near-identical RFQ→dispatch shape — batch together once one is built):
  - **Textile & Apparel — Mill/Fabric processor**: industrial B2B, yarn/fabric sold by weight.
  - **Textile & Apparel — Garment manufacturer/exporter**: Buyer Enquiry/Tech Pack → Sampling & Costing → Quotation & MOQ Negotiation → PO/Export Contract → Production Scheduled → QA/Buyer Inspection → Dispatched/Shipped & Invoiced (won) / Lost. Fields: Buyer type, Fabric/GSM spec, MOQ, Payment terms (LC/Advance/Credit-days), Compliance certification, Season/collection tag.
  - **Leather & Footwear — Tannery/raw material**: B2B raw-material supplier model.
  - **Leather & Footwear — Footwear brand/export manufacturer**: Buyer Enquiry/RFQ → Sample Development → Buyer/Compliance Approval → Costing & Quotation → PO Confirmed → In Production → Dispatched (won) / Lost. Fields: Product category, Material type, MOQ, Buyer compliance requirement (BIS/RoHS/social audit).
  - **Paper & Packaging — Mill**: commodity fibre-based upstream model.
  - **Paper & Packaging — Packaging converter**: Enquiry/RFQ → Structural Design & Artwork/Sample Approval → Testing/Validation → Quotation → PO/Supply Contract Confirmed (won) → In Production/Dispatch / Lost. Fields: Packaging type, Board/paper grade & GSM, MOQ, Print/artwork spec reference, VMI/call-off arrangement.

---

## Phase 3 (explicitly deferred, not in current scope)

- **Real Estate — Developer & Broker/Agency**: excluded — Samvid OS already covers this as a general platform.
- **Education — Student/Parent admissions & Corporate/B2B training**: New Enquiry → Counselling/Needs Assessment → Campus Visit/Demo → Application Submitted → Admission Offer → Fee Paid/Enrolled (won) / Lost.
- **Media & Communication — Agency/B2B services**: see pipeline above; excluded from Phase 1/2 scope per user's list (only Content production/creator is Phase 2).
- **Cement & Building Materials**: Enquiry/Lead → Technical Requirement & Sample/Trial Approval → Quotation → Commercial Negotiation (price/credit/freight) → PO/Rate Contract Confirmed (won) → Dispatch & Delivery / Lost.
- **Chemicals & Petrochemicals**: Enquiry/RFQ → Technical Assessment & Sample/Pilot Batch → Product/Vendor Approval Registration → Costing & Quotation → Commercial Negotiation → PO/Annual-Rate Contract → Production Scheduled → Dispatched & Invoiced (won) / Lost. **⚠ Known data-quality issue**: this document's own "Tier 2/3 MSME" section appears to have accidentally substituted Cement & Building Materials content instead of genuine chemicals-industry MSME detail — re-verify against the source `.docx` before seeding a Chemicals pack.
- **Pharmaceuticals — Formulation/Generic, API/CDMO, Medical Devices** (3 distinct sub-models): Enquiry/Quotation → Sample/Technical Approval → Vendor/Tender Registration → PO Received → Batch Production Scheduled → QC/Batch Release → Dispatched & Invoiced (won) / Lost-Rejected. Fields: Drug License number, Customer type, Cold-chain required, Batch/expiry tracking.
- **Food Processing**: Distributor/Retailer Enquiry → Sample/Listing Approval → Quotation & Terms Negotiation → PO Confirmed → Production Batch Scheduled → QC Release → Dispatched/Delivered & Invoiced (won) / Lost. Fields: FSSAI license, Cold-chain required, MOQ, Batch/expiry (FEFO) tracking.
- **Construction — Developer, Contractor/EPC, Specialist Subcontractor** (3 distinct sub-models): Contractor/EPC pipeline: Lead/Project Identification → Qualification (bid/no-bid) → Bid Preparation & Tender Submission → Tender Evaluation/Negotiation → Contract Award (LOI/PO) → Mobilization & Execution → Billing/Measurement Certified & Handover (won) / Lost-Not Awarded. Fields: Project type, Contract/tender value, Payment milestone structure, Retention %.
