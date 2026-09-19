// Seeds the Industry Pack catalog (master plan Phase 8) - idempotent upsert by `key`, safe to
// re-run (e.g. after editing a pack) without duplicating or touching organizations/workspaces.
// Run with: node scripts/seedIndustryPacks.js
//
// Phase 1 packs (user-prioritized 2026-09-19, see server/docs/industry-research/SUMMARY.md for
// the full research these are grounded in - real business-audit documents, not invented). Each
// pack is genuinely three things, not just templates: pipeline stages (with the won/lost `type`
// every downstream revenue/automation check now keys off, see services/pipelineStages.js),
// support ticket categories, and draft WhatsApp templates cloned into a workspace at provisioning
// time (POST /api/platform-admin/organizations/:id/provision). Real Estate is deliberately
// excluded - Samvid OS already covers it as a general platform.
import "dotenv/config";
import mongoose from "mongoose";
import { IndustryPack } from "../models/index.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm";

const packs = [
  {
    key: "hospitality_restaurants",
    label: "Hospitality - Restaurants & Cafés",
    industry: "hospitality_restaurants",
    description: "Reservation confirmations, pickup-ready alerts, and feedback requests for a restaurant or cafe.",
    pipelineStages: [
      { key: "new_enquiry", label: "New Enquiry", color: "info", type: "open" },
      { key: "reservation_confirmed", label: "Reservation Confirmed", color: "success", type: "won" },
      { key: "no_show_cancelled", label: "No-show / Cancelled", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "party_size", label: "Party Size", type: "number", options: [] },
      { key: "preferred_date_time", label: "Preferred Date/Time", type: "date", options: [] },
      { key: "occasion", label: "Occasion", type: "text", options: [] },
      { key: "dietary_requirements", label: "Dietary Requirements", type: "text", options: [] },
    ],
    supportCategories: [
      { key: "reservation_change", label: "Reservation Change" },
      { key: "feedback_complaint", label: "Feedback/Complaint" },
      { key: "catering_enquiry", label: "Catering Enquiry" },
      { key: "billing", label: "Billing" },
    ],
    templates: [
      {
        name: "reservation_confirmation",
        category: "utility",
        body: "Hi {{1}}, your table for {{2}} on {{3}} at {{4}} is confirmed. We look forward to hosting you!",
        variables: ["customer_name", "party_size", "date", "time"],
      },
      {
        name: "order_ready_for_pickup",
        category: "utility",
        body: "Hi {{1}}, your order #{{2}} is ready for pickup at {{3}}.",
        variables: ["customer_name", "order_number", "location"],
      },
      {
        name: "feedback_request",
        category: "utility",
        body: "Hi {{1}}, thanks for dining with us! We'd love to hear how it went - reply with a rating from 1 to 5.",
        variables: ["customer_name"],
      },
    ],
  },
  {
    key: "hospitality_hotels",
    label: "Hospitality - Hotels & Resorts",
    industry: "hospitality_hotels",
    description: "Booking confirmations, stay reminders, and direct-booking follow-ups for a hotel or resort.",
    pipelineStages: [
      { key: "new_enquiry", label: "New Enquiry", color: "info", type: "open" },
      { key: "rate_quoted", label: "Room/Rate Quoted", color: "warning", type: "open" },
      { key: "booking_confirmed", label: "Booking Confirmed", color: "success", type: "won" },
      { key: "cancelled", label: "Cancelled", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "checkin_date", label: "Check-in Date", type: "date", options: [] },
      { key: "checkout_date", label: "Check-out Date", type: "date", options: [] },
      { key: "room_type", label: "Room Type", type: "select", options: ["Standard", "Deluxe", "Suite", "Villa"] },
      { key: "party_size", label: "Party Size", type: "number", options: [] },
      { key: "booking_channel", label: "Booking Channel", type: "select", options: ["Direct", "OTA", "Agent"] },
    ],
    supportCategories: [
      { key: "reservation_change", label: "Reservation Change" },
      { key: "billing_invoice", label: "Billing/Invoice Query" },
      { key: "service_complaint", label: "Service Complaint" },
      { key: "refund_cancellation", label: "Refund/Cancellation" },
    ],
    templates: [
      {
        name: "booking_confirmation",
        category: "utility",
        body: "Hi {{1}}, your booking at {{2}} from {{3}} to {{4}} is confirmed. Room type: {{5}}. We look forward to welcoming you!",
        variables: ["guest_name", "property_name", "checkin_date", "checkout_date", "room_type"],
      },
      {
        name: "checkin_reminder",
        category: "utility",
        body: "Hi {{1}}, we're looking forward to your check-in tomorrow at {{2}}. Reply if you need early check-in or have any special requests.",
        variables: ["guest_name", "property_name"],
      },
      {
        name: "post_stay_feedback",
        category: "utility",
        body: "Hi {{1}}, thanks for staying with us at {{2}}! We'd love your feedback - reply with a rating from 1 to 5.",
        variables: ["guest_name", "property_name"],
      },
    ],
  },
  {
    key: "hospitality_travel",
    label: "Hospitality - Travel Agencies & Tour Operators",
    industry: "hospitality_travel",
    description: "Itinerary proposals, booking confirmations, and payment follow-ups for a travel agency, tour operator, or MICE business.",
    pipelineStages: [
      { key: "new_enquiry", label: "New Enquiry", color: "info", type: "open" },
      { key: "traveller_profiling", label: "Traveller Profiling", color: "info", type: "open" },
      { key: "itinerary_sent", label: "Itinerary/Proposal Sent", color: "warning", type: "open" },
      { key: "negotiation", label: "Negotiation", color: "warning", type: "open" },
      { key: "booking_confirmed", label: "Deposit/Booking Confirmed", color: "success", type: "won" },
      { key: "lost_cancelled", label: "Lost/Cancelled", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "destination", label: "Destination", type: "text", options: [] },
      { key: "travel_dates", label: "Travel Dates", type: "date", options: [] },
      { key: "group_size", label: "Group Size", type: "number", options: [] },
      { key: "budget_range", label: "Budget Range", type: "text", options: [] },
      { key: "booking_channel", label: "Booking Channel", type: "select", options: ["Direct", "OTA", "Agent"] },
    ],
    supportCategories: [
      { key: "reservation_change", label: "Reservation/Booking Change" },
      { key: "billing", label: "Billing" },
      { key: "service_recovery", label: "Service Complaint/Recovery" },
      { key: "itinerary_support", label: "Itinerary/Travel Support" },
    ],
    templates: [
      {
        name: "itinerary_sent",
        category: "utility",
        body: "Hi {{1}}, your itinerary for {{2}} ({{3}}) is ready. Total: {{4}}. Reply with any changes or to confirm your booking.",
        variables: ["customer_name", "destination", "travel_dates", "total_price"],
      },
      {
        name: "booking_confirmation",
        category: "utility",
        body: "Hi {{1}}, your booking for {{2}} is confirmed! We've received your deposit of {{3}}. Full itinerary and vouchers to follow.",
        variables: ["customer_name", "destination", "deposit_amount"],
      },
      {
        name: "balance_payment_reminder",
        category: "utility",
        body: "Hi {{1}}, a friendly reminder that the balance of {{2}} for your {{3}} trip is due on {{4}}.",
        variables: ["customer_name", "balance_amount", "destination", "due_date"],
      },
    ],
  },
  {
    key: "healthcare_clinic",
    label: "Healthcare - Hospital/Clinic (OPD)",
    industry: "healthcare_clinic",
    description: "Appointment scheduling, consultation follow-ups, and billing reminders for a hospital, clinic, or dental practice.",
    pipelineStages: [
      { key: "appointment_request", label: "Appointment Request", color: "info", type: "open" },
      { key: "scheduled", label: "Scheduled", color: "info", type: "open" },
      { key: "consultation_completed", label: "Consultation Completed", color: "warning", type: "open" },
      { key: "billing_closed", label: "Billing Closed", color: "success", type: "won" },
      { key: "no_show", label: "No-show", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "patient_type", label: "Patient Type", type: "select", options: ["New", "Returning", "Referral"] },
      { key: "insurance_provider", label: "Insurance Provider/TPA", type: "text", options: [] },
      { key: "referring_doctor", label: "Referring Doctor", type: "text", options: [] },
      { key: "department", label: "Department/Specialty", type: "text", options: [] },
      { key: "consultation_mode", label: "Consultation Mode", type: "select", options: ["In-person", "Telemedicine"] },
    ],
    supportCategories: [
      { key: "appointment_booking", label: "Appointment Booking/Reschedule" },
      { key: "billing_insurance", label: "Billing & Insurance Claim Query" },
      { key: "lab_report_status", label: "Lab/Report Delivery Status" },
      { key: "prescription_followup", label: "Prescription/Follow-up Query" },
    ],
    templates: [
      {
        name: "appointment_confirmation",
        category: "utility",
        body: "Hi {{1}}, your appointment with {{2}} is confirmed for {{3}} at {{4}}. Reply RESCHEDULE if you need to change it.",
        variables: ["patient_name", "doctor_name", "date", "time"],
      },
      {
        name: "appointment_reminder",
        category: "utility",
        body: "Hi {{1}}, this is a reminder for your appointment with {{2}} tomorrow at {{3}}.",
        variables: ["patient_name", "doctor_name", "time"],
      },
      {
        name: "followup_reminder",
        category: "utility",
        body: "Hi {{1}}, it's time for your follow-up visit with {{2}}. Reply to book a convenient slot.",
        variables: ["patient_name", "doctor_name"],
      },
    ],
  },
  {
    key: "healthcare_diagnostics",
    label: "Healthcare - Diagnostics & Labs",
    industry: "healthcare_diagnostics",
    description: "Test booking, sample collection, and report-ready alerts for a diagnostic lab or imaging center.",
    pipelineStages: [
      { key: "booking_request", label: "Test Booking Request", color: "info", type: "open" },
      { key: "sample_scheduled", label: "Sample Collection Scheduled", color: "info", type: "open" },
      { key: "report_processing", label: "Report Processing", color: "warning", type: "open" },
      { key: "delivered_billed", label: "Report Delivered & Billed", color: "success", type: "won" },
      { key: "cancelled", label: "Cancelled", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "test_panel_type", label: "Test/Panel Type", type: "text", options: [] },
      { key: "referring_doctor", label: "Referring Doctor", type: "text", options: [] },
      { key: "home_collection", label: "Home Collection Required", type: "select", options: ["Yes", "No"] },
      { key: "insurance_provider", label: "Insurance Provider/TPA", type: "text", options: [] },
    ],
    supportCategories: [
      { key: "report_status", label: "Report Status Query" },
      { key: "booking_reschedule", label: "Booking/Reschedule" },
      { key: "billing_dispute", label: "Billing Dispute" },
      { key: "home_collection_complaint", label: "Home-collection Complaint" },
    ],
    templates: [
      {
        name: "booking_confirmation",
        category: "utility",
        body: "Hi {{1}}, your {{2}} test is booked for {{3}} at {{4}}. Fasting/prep instructions: {{5}}.",
        variables: ["patient_name", "test_name", "date", "time_or_location", "prep_instructions"],
      },
      {
        name: "report_ready",
        category: "utility",
        body: "Hi {{1}}, your {{2}} report is ready. You can collect it or view it in your patient portal.",
        variables: ["patient_name", "test_name"],
      },
      {
        name: "home_collection_reminder",
        category: "utility",
        body: "Hi {{1}}, our technician will arrive for your home sample collection today between {{2}}. Please keep your ID ready.",
        variables: ["patient_name", "time_window"],
      },
    ],
  },
  {
    key: "healthcare_telemedicine",
    label: "Healthcare - Telemedicine & Home-care",
    industry: "healthcare_telemedicine",
    description: "Care plan enquiries, teleconsultation scheduling, and renewal reminders for a telemedicine or home-care provider.",
    pipelineStages: [
      { key: "care_request", label: "New Enquiry/Care Request", color: "info", type: "open" },
      { key: "triage_call", label: "Assessment/Triage Call", color: "info", type: "open" },
      { key: "care_plan_proposed", label: "Care Plan Proposed", color: "warning", type: "open" },
      { key: "plan_confirmed", label: "Plan Confirmed & Payment", color: "success", type: "won" },
      { key: "declined", label: "Declined", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "patient_type", label: "Patient Type", type: "select", options: ["New", "Returning"] },
      { key: "care_type", label: "Care Type", type: "select", options: ["Teleconsultation", "Home Nursing", "Physiotherapy", "Elder Care"] },
      { key: "preferred_consultation_mode", label: "Preferred Consultation Mode", type: "select", options: ["Video", "Audio", "In-home visit"] },
      { key: "care_plan_duration", label: "Care Plan Duration", type: "text", options: [] },
      { key: "next_followup_date", label: "Next Follow-up Date", type: "date", options: [] },
    ],
    supportCategories: [
      { key: "appointment_scheduling", label: "Appointment/Visit Scheduling" },
      { key: "care_plan_billing", label: "Care Plan & Billing Query" },
      { key: "caregiver_assignment", label: "Caregiver/Nurse Assignment" },
      { key: "prescription_followup", label: "Prescription/Follow-up Query" },
      { key: "service_complaint", label: "Service Complaint" },
    ],
    templates: [
      {
        name: "consultation_confirmation",
        category: "utility",
        body: "Hi {{1}}, your {{2}} consultation is confirmed for {{3}} at {{4}}. We'll send the video link 10 minutes before.",
        variables: ["patient_name", "care_type", "date", "time"],
      },
      {
        name: "care_plan_renewal_reminder",
        category: "utility",
        body: "Hi {{1}}, your {{2}} care plan is due for renewal on {{3}}. Reply to renew and keep your care uninterrupted.",
        variables: ["patient_name", "care_type", "renewal_date"],
      },
      {
        name: "followup_reminder",
        category: "utility",
        body: "Hi {{1}}, it's time for your follow-up check-in with {{2}}. Reply to schedule a convenient time.",
        variables: ["patient_name", "caregiver_name"],
      },
    ],
  },
  {
    key: "trade_b2b_wholesale",
    label: "Trade & Commerce - B2B Wholesale/Distribution",
    industry: "trade_b2b_wholesale",
    description: "Order-to-collection workflow for a wholesaler or distributor selling to retailers on credit.",
    pipelineStages: [
      { key: "order_request", label: "New Order Request", color: "info", type: "open" },
      { key: "quotation_sent", label: "Quotation Sent", color: "info", type: "open" },
      { key: "credit_check", label: "Credit/Limit Check", color: "warning", type: "open" },
      { key: "order_dispatched", label: "Order Confirmed & Dispatched", color: "warning", type: "open" },
      { key: "payment_collected", label: "Payment Collected", color: "success", type: "won" },
      { key: "cancelled", label: "Cancelled", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "customer_type", label: "Customer Type", type: "select", options: ["Retailer", "Wholesaler", "Institution"] },
      { key: "territory_route", label: "Territory/Route", type: "text", options: [] },
      { key: "credit_limit_terms", label: "Credit Limit & Terms", type: "number", options: [] },
      { key: "product_line", label: "Category/Product Line", type: "text", options: [] },
      { key: "average_order_value", label: "Average Order Value", type: "number", options: [] },
    ],
    supportCategories: [
      { key: "order_dispatch_status", label: "Order/Dispatch Status Query" },
      { key: "stock_availability", label: "Stock Availability Query" },
      { key: "invoice_credit_note", label: "Invoice/Credit Note Query" },
      { key: "outstanding_payment", label: "Outstanding Payment (\"Udhari\") Follow-up" },
      { key: "return_damage_claim", label: "Return/Damage Claim" },
      { key: "pricing_scheme", label: "Pricing/Scheme Query" },
    ],
    templates: [
      {
        name: "order_confirmation",
        category: "utility",
        body: "Hi {{1}}, your order #{{2}} for {{3}} has been confirmed. Total: {{4}}. We'll notify you once it's dispatched.",
        variables: ["customer_name", "order_number", "item_summary", "order_total"],
      },
      {
        name: "dispatch_update",
        category: "utility",
        body: "Hi {{1}}, your order #{{2}} has been dispatched and should arrive by {{3}}.",
        variables: ["customer_name", "order_number", "expected_date"],
      },
      {
        name: "payment_reminder",
        category: "utility",
        body: "Hi {{1}}, this is a reminder that {{2}} is outstanding against invoice #{{3}}, due {{4}}. Please arrange payment at your earliest.",
        variables: ["customer_name", "amount_due", "invoice_number", "due_date"],
      },
    ],
  },
  {
    key: "trade_b2c_retail",
    label: "Trade & Commerce - B2C Retail/E-commerce",
    industry: "trade_b2c_retail",
    description: "Order confirmations, delivery updates, and post-purchase follow-ups for a retail or D2C e-commerce business.",
    pipelineStages: [
      { key: "new_enquiry", label: "New Enquiry", color: "info", type: "open" },
      { key: "product_interest", label: "Product Interest Confirmed", color: "info", type: "open" },
      { key: "order_placed", label: "Order Placed", color: "warning", type: "open" },
      { key: "delivered_paid", label: "Delivered & Paid", color: "success", type: "won" },
      { key: "cancelled", label: "Cancelled", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "product_category", label: "Product Category", type: "text", options: [] },
      { key: "order_channel", label: "Order Channel", type: "select", options: ["WhatsApp", "Website", "Instagram", "Marketplace"] },
      { key: "preferred_delivery_window", label: "Preferred Delivery Window", type: "text", options: [] },
    ],
    supportCategories: [
      { key: "order_status", label: "Order Status" },
      { key: "returns_exchange", label: "Returns/Exchange" },
      { key: "product_question", label: "Product Question" },
      { key: "billing", label: "Billing" },
    ],
    templates: [
      {
        name: "order_confirmation",
        category: "utility",
        body: "Hi {{1}}, thanks for your order #{{2}}! Total: {{3}}. We'll let you know as soon as it ships.",
        variables: ["customer_name", "order_number", "order_total"],
      },
      {
        name: "dispatch_update",
        category: "utility",
        body: "Hi {{1}}, your order #{{2}} is on its way and should arrive by {{3}}. Track it here: {{4}}.",
        variables: ["customer_name", "order_number", "expected_date", "tracking_link"],
      },
      {
        name: "feedback_request",
        category: "utility",
        body: "Hi {{1}}, hope you're loving your order! We'd love a quick rating - reply with 1 to 5.",
        variables: ["customer_name"],
      },
    ],
  },
  {
    key: "professional_services_advisory",
    label: "Professional Services - Advisory (CA/Legal/Consulting)",
    industry: "professional_services_advisory",
    description: "Consultation-to-engagement workflow and billing follow-ups for a CA firm, law firm, or consultancy.",
    pipelineStages: [
      { key: "lead_captured", label: "Lead Captured", color: "info", type: "open" },
      { key: "discovery", label: "Consultation/Discovery", color: "info", type: "open" },
      { key: "risk_check", label: "Conflict-of-Interest & Risk Check", color: "warning", type: "open" },
      { key: "proposal_sent", label: "Proposal/Engagement Letter Sent", color: "warning", type: "open" },
      { key: "negotiation", label: "Negotiation", color: "warning", type: "open" },
      { key: "engagement_won", label: "Engagement Won", color: "success", type: "won" },
      { key: "declined", label: "Declined", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "client_industry", label: "Client Industry", type: "text", options: [] },
      { key: "annual_turnover", label: "Annual Turnover/Employee Count", type: "number", options: [] },
      { key: "service_line", label: "Service Line/Specialisation", type: "select", options: ["Audit", "Tax", "GST", "Litigation", "Consulting", "Recruitment"] },
      { key: "engagement_type", label: "Engagement Type", type: "select", options: ["Fixed fee", "Retainer", "Hourly", "Success fee"] },
      { key: "compliance_deadline", label: "Compliance Deadline/Next Filing Due", type: "date", options: [] },
    ],
    supportCategories: [
      { key: "invoice_billing_dispute", label: "Invoice/Billing Dispute" },
      { key: "compliance_deadline_query", label: "Compliance Deadline & Filing-status Query" },
      { key: "document_portal_access", label: "Document Upload/Portal Access" },
      { key: "scope_clarification", label: "Scope-of-work Clarification" },
      { key: "service_escalation", label: "Service-quality Escalation" },
    ],
    templates: [
      {
        name: "consultation_confirmation",
        category: "utility",
        body: "Hi {{1}}, your consultation with {{2}} is confirmed for {{3}} at {{4}}.",
        variables: ["client_name", "staff_name", "date", "time"],
      },
      {
        name: "proposal_sent",
        category: "utility",
        body: "Hi {{1}}, we've sent your engagement proposal for {{2}}. Please review and let us know if you have any questions.",
        variables: ["client_name", "engagement_name"],
      },
      {
        name: "compliance_deadline_reminder",
        category: "utility",
        body: "Hi {{1}}, a reminder that your {{2}} filing is due on {{3}}. Please share any pending documents at your earliest.",
        variables: ["client_name", "filing_type", "due_date"],
      },
    ],
  },
  {
    key: "entertainment_membership",
    label: "Entertainment - Membership-based (Gyms, Salons, Academies)",
    industry: "entertainment_membership",
    description: "Trial bookings, membership sign-ups, and renewal reminders for a gym, salon, or academy.",
    pipelineStages: [
      { key: "new_enquiry", label: "New Enquiry", color: "info", type: "open" },
      { key: "contacted", label: "Contacted", color: "info", type: "open" },
      { key: "trial_scheduled", label: "Trial/Site Visit", color: "warning", type: "open" },
      { key: "booking_confirmed", label: "Booking Confirmed & Paid", color: "success", type: "won" },
      { key: "no_response", label: "No Response", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "business_subcategory", label: "Business Sub-category", type: "select", options: ["Gym", "Salon", "Gaming", "Park", "Academy"] },
      { key: "membership_tier", label: "Membership Tier", type: "text", options: [] },
      { key: "preferred_activity", label: "Preferred Activity/Class", type: "text", options: [] },
      { key: "age_group", label: "Age Group", type: "select", options: ["Under 18", "18-35", "36-55", "56+"] },
      { key: "renewal_date", label: "Renewal Date", type: "date", options: [] },
    ],
    supportCategories: [
      { key: "booking_slot_change", label: "Booking/Slot Change" },
      { key: "membership_renewal_billing", label: "Membership Renewal & Billing" },
      { key: "facility_complaint", label: "Facility/Equipment/Safety Complaint" },
      { key: "refund_cancellation", label: "Refund/Cancellation" },
      { key: "class_schedule_query", label: "Class/Trainer Schedule Query" },
    ],
    templates: [
      {
        name: "trial_booking_confirmation",
        category: "utility",
        body: "Hi {{1}}, your trial session is confirmed for {{2}} at {{3}}. We look forward to seeing you!",
        variables: ["member_name", "date", "time"],
      },
      {
        name: "membership_renewal_reminder",
        category: "utility",
        body: "Hi {{1}}, your {{2}} membership is due for renewal on {{3}}. Reply to renew and keep your streak going!",
        variables: ["member_name", "membership_tier", "renewal_date"],
      },
      {
        name: "class_schedule_update",
        category: "utility",
        body: "Hi {{1}}, your {{2}} class on {{3}} has been updated to {{4}}. See you there!",
        variables: ["member_name", "class_name", "date", "new_time"],
      },
    ],
  },
];

// The very first 3 packs seeded (2026-09-19, before real industry research existed) used
// different keys (retail/restaurant/professional_services) than this real Phase 1 set
// (trade_b2c_retail/hospitality_restaurants/professional_services_advisory) - remove them
// outright rather than leaving stale, generic-content packs sitting in the catalog alongside the
// real ones.
const RETIRED_KEYS = ["retail", "restaurant", "professional_services"];

async function seedIndustryPacks() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });

  const retired = await IndustryPack.deleteMany({ key: mongoose.trusted({ $in: RETIRED_KEYS }) });
  if (retired.deletedCount) console.log(`removed ${retired.deletedCount} retired generic pack(s): ${RETIRED_KEYS.join(", ")}`);

  for (const pack of packs) {
    const result = await IndustryPack.findOneAndUpdate(
      { key: pack.key },
      { $set: { ...pack, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(
      `upserted industry pack "${result.key}" (${result.templates.length} templates, ${result.pipelineStages.length} stages, ${result.customFieldDefinitions.length} fields, ${result.supportCategories.length} categories)`
    );
  }

  await mongoose.disconnect();
}

seedIndustryPacks()
  .then(() => {
    console.log("done");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
