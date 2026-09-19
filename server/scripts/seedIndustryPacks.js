// Seeds the Industry Pack catalog (master plan Phase 8) - idempotent upsert by `key`, safe to
// re-run (e.g. after editing a pack) without duplicating or touching organizations/workspaces.
// Run with: node scripts/seedIndustryPacks.js
//
// Phase 1 + Phase 2 packs (user-prioritized 2026-09-19, see server/docs/industry-research/SUMMARY.md
// for the full research these are grounded in - real business-audit documents, not invented). Each
// pack is genuinely three things, not just templates: pipeline stages (with the won/lost `type`
// every downstream revenue/automation check now keys off, see services/pipelineStages.js),
// support ticket categories, and draft WhatsApp templates cloned into a workspace at provisioning
// time (POST /api/platform-admin/organizations/:id/provision). Real Estate is deliberately
// excluded - Samvid OS already covers it as a general platform.
//
// Phase 2 (added same session): support categories weren't in SUMMARY.md for most of these - each
// one was re-extracted directly from the raw source .txt in server/docs/industry-research/ via a
// dedicated research pass, not invented. Two packs carry an explicit lower-confidence caveat below
// their definition (media_content_production, financial_wealth_investment) because their source
// material is genuinely thinner than the rest - flagged rather than silently smoothed over.
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
  {
    key: "entertainment_ticketed",
    label: "Entertainment - Ticketed Venues (Parks, Arcades, Bowling)",
    industry: "entertainment_ticketed",
    description: "Group and walk-in booking follow-ups, quotations, and cancellation handling for a ticketed entertainment venue.",
    pipelineStages: [
      { key: "enquiry_received", label: "Enquiry Received", color: "info", type: "open" },
      { key: "quotation_sent", label: "Quotation Sent", color: "warning", type: "open" },
      { key: "deposit_collected", label: "Deposit Collected", color: "warning", type: "open" },
      { key: "booking_confirmed", label: "Booking Confirmed", color: "success", type: "won" },
      { key: "cancelled", label: "Cancelled", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "group_size", label: "Group Size", type: "number", options: [] },
      { key: "preferred_date", label: "Preferred Date", type: "date", options: [] },
      { key: "activity_type", label: "Activity/Attraction Type", type: "select", options: ["Park", "Arcade", "Bowling", "VR/Escape Room", "Museum", "Cinema", "Other"] },
      { key: "occasion", label: "Occasion", type: "select", options: ["Birthday", "School Trip", "Corporate Outing", "Sports Team", "Other"] },
      { key: "budget", label: "Budget", type: "number", options: [] },
    ],
    supportCategories: [
      { key: "booking_change", label: "Booking Change" },
      { key: "refund_cancellation", label: "Refund/Cancellation" },
      { key: "lost_property", label: "Lost Property" },
      { key: "equipment_safety", label: "Equipment/Safety Concern" },
      { key: "payment_error", label: "Payment Error" },
    ],
    templates: [
      {
        name: "booking_confirmation",
        category: "utility",
        body: "Hi {{1}}, your booking for {{2}} on {{3}} for {{4}} guests is confirmed. Please arrive 15 minutes early. See you soon!",
        variables: ["customer_name", "activity_type", "date", "group_size"],
      },
      {
        name: "visit_reminder",
        category: "utility",
        body: "Hi {{1}}, just a reminder about your visit tomorrow at {{2}}. {{3}}",
        variables: ["customer_name", "time", "special_instructions"],
      },
      {
        name: "group_quotation_sent",
        category: "utility",
        body: "Hi {{1}}, here's your quotation for a group of {{2}} on {{3}}: {{4}}. Reply to confirm with a deposit.",
        variables: ["customer_name", "group_size", "date", "quote_amount"],
      },
    ],
  },
  {
    key: "entertainment_events_esports",
    label: "Entertainment - Events, Esports & Sponsorship",
    industry: "entertainment_events_esports",
    description: "Sponsorship proposal tracking, event booking confirmations, and post-event reporting for an event management or esports business.",
    pipelineStages: [
      { key: "sponsor_identified", label: "Sponsor/Partner Identified", color: "info", type: "open" },
      { key: "proposal_sent", label: "Proposal Sent", color: "info", type: "open" },
      { key: "negotiation", label: "Negotiation", color: "warning", type: "open" },
      { key: "contract_signed", label: "Contract Signed/Deposit Paid", color: "warning", type: "open" },
      { key: "event_delivered", label: "Event Delivered", color: "success", type: "won" },
      { key: "declined", label: "Declined/Rejected", color: "destructive", type: "lost" },
      { key: "cancelled", label: "Cancelled", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "sponsor_client_name", label: "Sponsor/Client Name", type: "text", options: [] },
      { key: "sponsorship_tier", label: "Sponsorship Tier", type: "select", options: ["Title", "Gold", "Silver", "Bronze", "In-kind"] },
      { key: "event_name", label: "Event Name", type: "text", options: [] },
      { key: "deal_value", label: "Deal Value", type: "number", options: [] },
      { key: "event_date", label: "Event Date", type: "date", options: [] },
      { key: "game_title", label: "Game Title (Esports)", type: "text", options: [] },
    ],
    supportCategories: [
      { key: "sponsor_deliverable_dispute", label: "Sponsor Deliverable Dispute" },
      { key: "ticket_refund_fraud", label: "Ticket Refund/Fraud Issue" },
      { key: "registration_issue", label: "Team/Player Registration Issue" },
      { key: "event_delay_safety", label: "Event Delay/Safety Communication" },
    ],
    templates: [
      {
        name: "proposal_followup",
        category: "utility",
        body: "Hi {{1}}, following up on the {{2}} sponsorship proposal we sent for {{3}}. Let us know if you have any questions.",
        variables: ["contact_name", "sponsorship_tier", "event_name"],
      },
      {
        name: "booking_confirmation",
        category: "utility",
        body: "Hi {{1}}, your registration for {{2}} on {{3}} is confirmed. Entry and safety details: {{4}}.",
        variables: ["participant_name", "event_name", "event_date", "entry_details"],
      },
      {
        name: "post_event_report",
        category: "utility",
        body: "Hi {{1}}, thank you for partnering with us on {{2}}! Your performance report and invoice are attached.",
        variables: ["sponsor_name", "event_name"],
      },
    ],
  },
  // Media & Communication's own document explicitly frames content production/creator work as a
  // greenlight/production workflow, not a sales pipeline ("The concept may be: Approved / revised
  // / placed in development / deferred / rejected") - so this pack tracks a job/project through
  // creative approval and delivery rather than a lead-to-close cycle. Support categories here are
  // the research pass's own lower-confidence flag: the source document has no dedicated helpdesk
  // list for this sub-model like it does for others, so these are inferred from talent-payment/
  // rights/QC-rejection mentions elsewhere in the doc, not a documented category list.
  {
    key: "media_content_production",
    label: "Media & Communication - Content Production/Creator",
    industry: "media_content_production",
    description: "Greenlight-to-delivery tracking for a content production house or creator studio, plus talent and royalty follow-ups.",
    pipelineStages: [
      { key: "pitch_submitted", label: "Pitch/Concept Submitted", color: "info", type: "open" },
      { key: "in_development", label: "In Development", color: "info", type: "open" },
      { key: "greenlit", label: "Greenlit/Approved", color: "warning", type: "open" },
      { key: "in_production", label: "In Production", color: "warning", type: "open" },
      { key: "post_production", label: "Post-Production", color: "warning", type: "open" },
      { key: "released", label: "Released/Delivered", color: "success", type: "won" },
      { key: "deferred", label: "Deferred", color: "destructive", type: "lost" },
      { key: "rejected", label: "Rejected", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "project_title", label: "Project Title", type: "text", options: [] },
      { key: "format", label: "Format", type: "select", options: ["Film", "Web Series", "Podcast", "Music", "Game", "Branded Content", "Other"] },
      { key: "budget", label: "Budget", type: "number", options: [] },
      { key: "expected_delivery_date", label: "Expected Delivery Date", type: "date", options: [] },
      { key: "funding_source", label: "Funding Source", type: "select", options: ["Studio Financing", "Broadcaster Commission", "OTT Licence", "Advertiser Sponsorship", "Co-production", "Crowdfunding"] },
    ],
    supportCategories: [
      { key: "talent_payment_query", label: "Talent/Freelancer Payment Query" },
      { key: "royalty_rights_dispute", label: "Royalty/Rights Dispute" },
      { key: "delivery_qc_rejection", label: "Delivery/QC Rejection" },
      { key: "schedule_change", label: "Production Schedule Change" },
    ],
    templates: [
      {
        name: "approval_status_update",
        category: "utility",
        body: "Hi {{1}}, {{2}} has been {{3}}. {{4}}",
        variables: ["crew_talent_name", "project_title", "status", "next_steps"],
      },
      {
        name: "callsheet_reminder",
        category: "utility",
        body: "Hi {{1}}, reminder for tomorrow's shoot on {{2}}: call time {{3}} at {{4}}.",
        variables: ["crew_name", "project_title", "call_time", "location"],
      },
      {
        name: "payment_royalty_notice",
        category: "utility",
        body: "Hi {{1}}, your payment/royalty statement for {{2}} is ready. Amount: {{3}}.",
        variables: ["talent_name", "project_title", "amount"],
      },
    ],
  },
  {
    key: "logistics_fleet_freight",
    label: "Logistics - Fleet & Freight Brokerage",
    industry: "logistics_fleet_freight",
    description: "Load booking, dispatch tracking, and POD-triggered billing for a freight brokerage or trucking fleet.",
    pipelineStages: [
      { key: "load_request", label: "New Enquiry/Load Request", color: "info", type: "open" },
      { key: "quotation_sent", label: "Quotation Sent", color: "info", type: "open" },
      { key: "vehicle_allocated", label: "Vehicle/Capacity Allocated", color: "warning", type: "open" },
      { key: "in_transit", label: "In-Transit/Dispatched", color: "warning", type: "open" },
      { key: "delivered_pod", label: "Delivered & POD Received", color: "success", type: "won" },
      { key: "cancelled", label: "Lost/Cancelled", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "cargo_type", label: "Cargo Type", type: "select", options: ["General", "Fragile", "Perishable", "Hazardous", "Oversized", "High Value", "Temperature-sensitive", "Liquid", "Bulk", "Containerised", "Automotive", "Pharmaceutical", "Food Grade", "Documents/Parcels"] },
      { key: "origin_destination_lane", label: "Origin-Destination Lane", type: "text", options: [] },
      { key: "vehicle_type_required", label: "Vehicle Type Required", type: "select", options: ["Truck", "Trailer", "LCV", "Van", "Motorcycle", "Refrigerated Vehicle", "Container"] },
      { key: "shipment_weight_volume", label: "Shipment Weight/Volume", type: "number", options: [] },
    ],
    supportCategories: [
      { key: "shipment_status_tracking", label: "Shipment Status/Tracking" },
      { key: "pod_request", label: "POD Request" },
      { key: "freight_billing_dispute", label: "Freight Billing Dispute" },
      { key: "damage_loss_claim", label: "Damage/Loss Claim" },
    ],
    templates: [
      {
        name: "shipment_status_update",
        category: "utility",
        body: "Hi {{1}}, your shipment #{{2}} is currently {{3}}, expected delivery {{4}}.",
        variables: ["customer_name", "shipment_number", "status", "expected_date"],
      },
      {
        name: "pod_confirmation",
        category: "utility",
        body: "Hi {{1}}, shipment #{{2}} has been delivered and POD received. Invoice to follow shortly.",
        variables: ["customer_name", "shipment_number"],
      },
      {
        name: "freight_payment_reminder",
        category: "utility",
        body: "Hi {{1}}, {{2}} is outstanding against freight invoice #{{3}}, due {{4}}. Please arrange payment.",
        variables: ["customer_name", "amount_due", "invoice_number", "due_date"],
      },
    ],
  },
  {
    key: "logistics_3pl_warehousing",
    label: "Logistics - 3PL & Warehousing",
    industry: "logistics_3pl_warehousing",
    description: "Client onboarding, inventory operations, and contract-renewal tracking for a 3PL or contract warehousing business.",
    pipelineStages: [
      { key: "client_onboarding", label: "Client Onboarding", color: "info", type: "open" },
      { key: "site_assessment", label: "Site Assessment & Solution Design", color: "info", type: "open" },
      { key: "contract_negotiation", label: "Contract Negotiation", color: "warning", type: "open" },
      { key: "contract_signed", label: "Contract Signed & Master-Data Setup", color: "success", type: "won" },
      { key: "contract_lost", label: "Contract Lost/Not Renewed", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "storage_type_required", label: "Storage Type Required", type: "select", options: ["Floor Stacking", "Selective Racking", "Pallet Racking", "High-density", "Shelving", "Secure Cage", "Hazardous Storage", "Cold Room", "Freezer", "Bonded Warehouse"] },
      { key: "sku_product_category", label: "SKU/Product Category", type: "text", options: [] },
      { key: "monthly_fee", label: "Monthly Storage/Fulfilment Fee", type: "number", options: [] },
      { key: "value_added_service", label: "Value-Added Service Required", type: "select", options: ["Repacking", "Labelling", "Kitting", "Bundling", "Gift Packing", "Quality Inspection", "Assembly", "Custom Packaging", "None"] },
      { key: "contract_renewal_date", label: "Contract Renewal Date", type: "date", options: [] },
    ],
    supportCategories: [
      { key: "inventory_accuracy", label: "Inventory Accuracy/Discrepancy" },
      { key: "order_fulfilment_issue", label: "Order Fulfilment/Dispatch Issue" },
      { key: "storage_capacity_request", label: "Storage Capacity/Space Request" },
      { key: "contract_billing_query", label: "Contract & Billing Query" },
    ],
    templates: [
      {
        name: "goods_receipt_confirmation",
        category: "utility",
        body: "Hi {{1}}, we've received {{2}} units of {{3}} into inventory at {{4}}.",
        variables: ["client_name", "quantity", "sku_description", "warehouse_location"],
      },
      {
        name: "fulfilment_status_update",
        category: "utility",
        body: "Hi {{1}}, order #{{2}} has been picked, packed, and dispatched.",
        variables: ["client_name", "order_number"],
      },
      {
        name: "contract_renewal_reminder",
        category: "utility",
        body: "Hi {{1}}, your warehousing contract is due for review/renewal on {{2}}. Let's schedule a performance review call.",
        variables: ["client_name", "renewal_date"],
      },
    ],
  },
  {
    key: "professional_services_recruitment",
    label: "Professional Services - Recruitment & Staffing",
    industry: "professional_services_recruitment",
    description: "Requirement-to-joining tracking for a recruitment agency or staffing firm.",
    pipelineStages: [
      { key: "requirement_intake", label: "Requirement Intake", color: "info", type: "open" },
      { key: "candidate_sourcing", label: "Candidate Sourcing/Screening", color: "info", type: "open" },
      { key: "submitted_to_client", label: "Submitted to Client", color: "warning", type: "open" },
      { key: "interview_scheduled", label: "Interview Scheduled", color: "warning", type: "open" },
      { key: "offer_extended", label: "Offer Extended", color: "warning", type: "open" },
      { key: "candidate_joined", label: "Candidate Joined", color: "success", type: "won" },
      { key: "position_lost", label: "Position Lost/Withdrawn", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "role_title", label: "Role/Position Title", type: "text", options: [] },
      { key: "salary_band", label: "Salary Band", type: "text", options: [] },
      { key: "notice_period_days", label: "Notice Period (Days)", type: "number", options: [] },
      { key: "target_client", label: "Target Employer/Client", type: "text", options: [] },
      { key: "hiring_volume", label: "Hiring Volume", type: "number", options: [] },
    ],
    supportCategories: [
      { key: "interview_scheduling", label: "Interview Scheduling/Reschedule" },
      { key: "candidate_feedback_request", label: "Candidate Feedback Request" },
      { key: "offer_counteroffer_query", label: "Offer/Counteroffer Query" },
      { key: "background_verification_status", label: "Background Verification Status" },
      { key: "replacement_guarantee_claim", label: "Replacement Guarantee Claim" },
    ],
    templates: [
      {
        name: "interview_confirmation",
        category: "utility",
        body: "Hi {{1}}, your interview for {{2}} at {{3}} is confirmed for {{4}} with {{5}}.",
        variables: ["candidate_name", "role_title", "client_name", "datetime", "interviewer"],
      },
      {
        name: "submission_update",
        category: "utility",
        body: "Hi {{1}}, we've shortlisted {{2}} candidate(s) for your {{3}} requirement. Review attached.",
        variables: ["client_contact", "candidate_count", "role_title"],
      },
      {
        name: "joining_reminder",
        category: "utility",
        body: "Hi {{1}}, just confirming your joining date of {{2}} for {{3}} at {{4}}. Let us know if you need anything.",
        variables: ["candidate_name", "joining_date", "role_title", "client_name"],
      },
    ],
  },
  {
    key: "financial_lending",
    label: "Financial Services - Lending",
    industry: "financial_lending",
    description: "Loan application, underwriting, and EMI-collection follow-ups for an NBFC or lending business.",
    pipelineStages: [
      { key: "lead_captured", label: "Lead Captured", color: "info", type: "open" },
      { key: "kyc_document_collection", label: "KYC/Document Collection", color: "info", type: "open" },
      { key: "credit_underwriting", label: "Credit Underwriting/Bureau Check", color: "warning", type: "open" },
      { key: "approved_sanction", label: "Approved/Sanction Letter", color: "warning", type: "open" },
      { key: "disbursed", label: "Disbursed", color: "success", type: "won" },
      { key: "rejected_withdrawn", label: "Rejected/Withdrawn", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "product_type", label: "Product Type", type: "select", options: ["Personal Loan", "Housing Loan", "Vehicle Loan", "Gold Loan", "Business Loan", "Working Capital"] },
      { key: "loan_amount_requested", label: "Loan Amount Requested", type: "number", options: [] },
      { key: "monthly_income", label: "Monthly Income", type: "number", options: [] },
      { key: "credit_bureau_score", label: "Credit Bureau Score", type: "number", options: [] },
      { key: "kyc_status", label: "KYC Status", type: "select", options: ["Pending", "Submitted", "Verified", "Rejected"] },
    ],
    supportCategories: [
      { key: "loan_emi_status", label: "Loan/EMI Status Query" },
      { key: "foreclosure_prepayment_request", label: "Foreclosure/Prepayment Request" },
      { key: "kyc_resubmission", label: "KYC Re-submission" },
      { key: "restructuring_hardship_request", label: "Restructuring/Hardship Request" },
      { key: "complaint_escalation", label: "Complaint Escalation" },
    ],
    templates: [
      {
        name: "sanction_status_update",
        category: "utility",
        body: "Hi {{1}}, your {{2}} application for {{3}} has been {{4}}.",
        variables: ["applicant_name", "product_type", "loan_amount", "status"],
      },
      {
        name: "emi_due_reminder",
        category: "utility",
        body: "Hi {{1}}, your EMI of {{2}} is due on {{3}}. Please ensure sufficient balance to avoid late fees.",
        variables: ["borrower_name", "emi_amount", "due_date"],
      },
      {
        name: "kyc_document_request",
        category: "utility",
        body: "Hi {{1}}, we're missing {{2}} to complete your loan application. Please share at your earliest.",
        variables: ["applicant_name", "missing_documents"],
      },
    ],
  },
  {
    key: "financial_insurance",
    label: "Financial Services - Insurance",
    industry: "financial_insurance",
    description: "Quotation-to-policy-issuance workflow and renewal/claims follow-ups for an insurance agency or broker.",
    pipelineStages: [
      { key: "lead", label: "Lead", color: "info", type: "open" },
      { key: "needs_analysis", label: "Needs Analysis", color: "info", type: "open" },
      { key: "quotation", label: "Quotation", color: "warning", type: "open" },
      { key: "underwriting", label: "Underwriting", color: "warning", type: "open" },
      { key: "policy_issued", label: "Policy Issued", color: "success", type: "won" },
      { key: "lapsed_declined", label: "Lapsed/Declined", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "policy_type", label: "Policy Type", type: "select", options: ["Life", "Health", "Motor", "Property"] },
      { key: "sum_insured", label: "Sum Insured", type: "number", options: [] },
      { key: "premium_frequency", label: "Premium Frequency", type: "select", options: ["Monthly", "Quarterly", "Half-yearly", "Annual"] },
      { key: "policy_number", label: "Policy Number", type: "text", options: [] },
      { key: "next_renewal_date", label: "Next Renewal Date", type: "date", options: [] },
    ],
    supportCategories: [
      { key: "claim_intimation_status", label: "Claim Intimation/Status" },
      { key: "premium_renewal_query", label: "Premium Payment/Renewal Query" },
      { key: "policy_endorsement_update", label: "Policy Endorsement/Nominee Update" },
      { key: "complaint_escalation", label: "Complaint Escalation" },
    ],
    templates: [
      {
        name: "policy_issuance_confirmation",
        category: "utility",
        body: "Hi {{1}}, your {{2}} policy #{{3}} is now active. Sum insured: {{4}}.",
        variables: ["policyholder_name", "policy_type", "policy_number", "sum_insured"],
      },
      {
        name: "premium_renewal_reminder",
        category: "utility",
        body: "Hi {{1}}, your premium of {{2}} for policy #{{3}} is due on {{4}}. Renew to stay covered.",
        variables: ["policyholder_name", "premium_amount", "policy_number", "due_date"],
      },
      {
        name: "claim_status_update",
        category: "utility",
        body: "Hi {{1}}, your claim #{{2}} is now {{3}}.",
        variables: ["policyholder_name", "claim_number", "status"],
      },
    ],
  },
  // Financial Services' document has no single dedicated block for wealth/investment advisory the
  // way it does for Lending and Insurance - this pipeline is assembled from scattered explicit
  // mentions (investor acquisition, risk profiling, portfolio monitoring, recurring advisory) per
  // a dedicated research pass, the same "thinner source, still real" caveat SUMMARY.md already
  // uses for Healthcare Telemedicine. Flagging here rather than silently treating it as equally
  // well-documented as the other two Financial Services packs.
  {
    key: "financial_wealth_investment",
    label: "Financial Services - Wealth & Investment Advisory",
    industry: "financial_wealth_investment",
    description: "Risk-profiling-to-onboarding workflow and portfolio-servicing reminders for a wealth management or investment advisory business.",
    pipelineStages: [
      { key: "investor_enquiry", label: "Investor Enquiry/Acquisition", color: "info", type: "open" },
      { key: "risk_profiling", label: "Risk Profiling & Suitability Assessment", color: "info", type: "open" },
      { key: "product_recommendation", label: "Product Recommendation", color: "warning", type: "open" },
      { key: "account_documentation", label: "Account/Mandate Documentation", color: "warning", type: "open" },
      { key: "invested_onboarded", label: "Investment Executed & Onboarded", color: "success", type: "won" },
      { key: "declined_unsuitable", label: "Declined/Unsuitable", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "investment_goal", label: "Investment Goal/Objective", type: "text", options: [] },
      { key: "risk_profile", label: "Risk Profile", type: "select", options: ["Conservative", "Moderate", "Aggressive"] },
      { key: "investment_horizon", label: "Investment Horizon", type: "select", options: ["Short-term", "Medium-term", "Long-term"] },
      { key: "investment_amount", label: "Investment Amount/AUM", type: "number", options: [] },
      { key: "product_type", label: "Product Type", type: "select", options: ["Mutual Fund", "PMS", "Broking", "Insurance-linked", "Other"] },
    ],
    supportCategories: [
      { key: "portfolio_statement_query", label: "Portfolio/Statement Query" },
      { key: "redemption_withdrawal_request", label: "Redemption/Withdrawal Request" },
      { key: "fund_scheme_switch", label: "Fund/Scheme Switch" },
      { key: "kyc_account_update", label: "KYC/Account Update" },
      { key: "complaint_escalation", label: "Complaint Escalation" },
    ],
    templates: [
      {
        name: "portfolio_statement_delivery",
        category: "utility",
        body: "Hi {{1}}, your portfolio statement for {{2}} is ready. Current value: {{3}}.",
        variables: ["investor_name", "period", "portfolio_value"],
      },
      {
        name: "sip_investment_reminder",
        category: "utility",
        body: "Hi {{1}}, your SIP of {{2}} is due on {{3}}. Please ensure sufficient balance.",
        variables: ["investor_name", "sip_amount", "due_date"],
      },
      {
        name: "maturity_redemption_notice",
        category: "utility",
        body: "Hi {{1}}, your investment in {{2}} matures on {{3}}. Reply to discuss reinvestment options.",
        variables: ["investor_name", "product_name", "maturity_date"],
      },
    ],
  },
  {
    key: "automobile_component_manufacturer",
    label: "Automobile - Component Manufacturer/Supplier",
    industry: "automobile_component_manufacturer",
    description: "OEM RFQ-to-dispatch tracking through PPAP approval for an auto component manufacturer.",
    pipelineStages: [
      { key: "oem_rfq_received", label: "OEM Enquiry/RFQ Received", color: "info", type: "open" },
      { key: "sample_technical_development", label: "Sample/Technical Development", color: "info", type: "open" },
      { key: "supplier_audit_nomination", label: "Supplier Audit & Nomination", color: "warning", type: "open" },
      { key: "ppap_approval", label: "PPAP Approval", color: "warning", type: "open" },
      { key: "po_annual_contract", label: "PO/Annual-Rate Contract Confirmed", color: "warning", type: "open" },
      { key: "production_scheduled", label: "Production Scheduled", color: "warning", type: "open" },
      { key: "dispatched_invoiced", label: "Dispatched & Invoiced", color: "success", type: "won" },
      { key: "lost_not_nominated", label: "Lost/Not Nominated", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "oem_tier_level", label: "OEM/Tier Level", type: "select", options: ["OEM", "Tier 1", "Tier 2", "Tier 3"] },
      { key: "part_number_drawing_revision", label: "Part Number & Drawing Revision", type: "text", options: [] },
      { key: "ppap_status", label: "PPAP Status", type: "select", options: ["Not Started", "Submitted", "Approved", "Rejected"] },
      { key: "annual_volume_commitment", label: "Annual Volume Commitment", type: "number", options: [] },
    ],
    supportCategories: [
      { key: "order_dispatch_status", label: "Order/Dispatch Status Query" },
      { key: "quality_rejection_rework", label: "Quality Rejection/Rework Complaint" },
      { key: "ppap_document_request", label: "PPAP/Inspection Document Request" },
      { key: "outstanding_payment_followup", label: "Outstanding Payment Follow-up" },
      { key: "price_escalation_query", label: "Raw-Material/Price Escalation Query" },
    ],
    templates: [
      {
        name: "ppap_status_update",
        category: "utility",
        body: "Hi {{1}}, PPAP for part {{2}} is now {{3}}.",
        variables: ["oem_contact", "part_number", "ppap_status"],
      },
      {
        name: "payment_reminder",
        category: "utility",
        body: "Hi {{1}}, {{2}} is outstanding against invoice #{{3}}, due {{4}}.",
        variables: ["customer_name", "amount_due", "invoice_number", "due_date"],
      },
      {
        name: "dispatch_confirmation",
        category: "utility",
        body: "Hi {{1}}, your order for part {{2}} (qty {{3}}) has been dispatched. E-way bill: {{4}}.",
        variables: ["customer_name", "part_number", "quantity", "eway_bill"],
      },
    ],
  },
  {
    key: "automobile_dealership",
    label: "Automobile - Dealership & Retail",
    industry: "automobile_dealership",
    description: "Test-drive-to-delivery tracking plus service and renewal reminders for a vehicle dealership.",
    pipelineStages: [
      { key: "lead_enquiry", label: "Lead/Enquiry", color: "info", type: "open" },
      { key: "test_drive", label: "Test Drive", color: "info", type: "open" },
      { key: "quotation_finance_insurance", label: "Quotation/Finance & Insurance", color: "warning", type: "open" },
      { key: "booking_confirmed", label: "Booking Confirmed", color: "warning", type: "open" },
      { key: "registration_pdi", label: "Registration/PDI", color: "warning", type: "open" },
      { key: "delivered", label: "Delivered", color: "success", type: "won" },
      { key: "lost_no_response", label: "Lost/No Response", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "vehicle_model_variant", label: "Vehicle Model/Variant Interested", type: "text", options: [] },
      { key: "finance_required", label: "Finance Required", type: "select", options: ["Yes", "No"] },
      { key: "trade_in_vehicle", label: "Trade-in Vehicle", type: "text", options: [] },
      { key: "booking_amount", label: "Booking Amount", type: "number", options: [] },
      { key: "expected_delivery_date", label: "Expected Delivery Date", type: "date", options: [] },
    ],
    supportCategories: [
      { key: "service_booking_reschedule", label: "Service Booking/Reschedule" },
      { key: "warranty_claim_query", label: "Warranty Claim Query" },
      { key: "insurance_renewal_query", label: "Insurance-Renewal Query" },
      { key: "accessory_upgrade_enquiry", label: "Accessory/Upgrade Enquiry" },
      { key: "delivery_registration_status", label: "Delivery/Registration Status Query" },
    ],
    templates: [
      {
        name: "test_drive_confirmation",
        category: "utility",
        body: "Hi {{1}}, your test drive for {{2}} is confirmed for {{3}} at {{4}}.",
        variables: ["customer_name", "vehicle_model", "date", "time"],
      },
      {
        name: "service_reminder",
        category: "utility",
        body: "Hi {{1}}, your {{2}} is due for service. Reply to book a convenient slot.",
        variables: ["customer_name", "vehicle_model"],
      },
      {
        name: "insurance_renewal_alert",
        category: "utility",
        body: "Hi {{1}}, your vehicle insurance for {{2}} expires on {{3}}. Reply to renew.",
        variables: ["customer_name", "vehicle_model", "expiry_date"],
      },
    ],
  },
  {
    key: "metals_heavy_industry",
    label: "Metals & Heavy Industry - Fabrication & Job-work",
    industry: "metals_heavy_industry",
    description: "RFQ-to-dispatch tracking through QC/NDT inspection for a metal fabrication or heavy engineering job-work business.",
    pipelineStages: [
      { key: "enquiry_drawing_rfq", label: "Customer Enquiry/Drawing (RFQ)", color: "info", type: "open" },
      { key: "technical_assessment_costing", label: "Technical Assessment & Costing", color: "info", type: "open" },
      { key: "quotation", label: "Quotation", color: "warning", type: "open" },
      { key: "commercial_negotiation", label: "Commercial Negotiation", color: "warning", type: "open" },
      { key: "po_contract_confirmed", label: "PO/Contract Confirmed", color: "warning", type: "open" },
      { key: "production_scheduled", label: "Production Scheduled", color: "warning", type: "open" },
      { key: "qc_ndt_inspection", label: "QC/NDT Inspection", color: "warning", type: "open" },
      { key: "dispatched_installed_invoiced", label: "Dispatched/Installed & Invoiced", color: "success", type: "won" },
      { key: "lost", label: "Lost", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "material_grade_standard", label: "Material Grade/Standard", type: "select", options: ["BIS", "ASTM", "API", "ASME", "ISO"] },
      { key: "drawing_rfq_reference", label: "Drawing/RFQ Reference", type: "text", options: [] },
      { key: "annual_tonnage", label: "Annual Tonnage", type: "number", options: [] },
      { key: "ndt_certification_requirement", label: "NDT/Certification Requirement", type: "select", options: ["UT", "RT", "MPI", "DPI", "Eddy-current", "None"] },
    ],
    supportCategories: [
      { key: "payment_milestone_billing", label: "Payment-Milestone/Billing Query" },
      { key: "quality_rejection_ndt_failure", label: "Quality Rejection/NDT Failure Query" },
      { key: "material_test_certificate_request", label: "Material Test Certificate Request" },
      { key: "dispatch_installation_schedule", label: "Dispatch/Installation Schedule Query" },
      { key: "price_escalation_query", label: "Raw-Material Price Escalation Query" },
    ],
    templates: [
      {
        name: "quotation_sent",
        category: "utility",
        body: "Hi {{1}}, your quotation for {{2}} is ready: {{3}}. Valid until {{4}}.",
        variables: ["customer_name", "item_description", "quote_amount", "validity_date"],
      },
      {
        name: "qc_report_ready",
        category: "utility",
        body: "Hi {{1}}, the QC/NDT report for {{2}} is ready for download.",
        variables: ["customer_name", "order_reference"],
      },
      {
        name: "payment_milestone_reminder",
        category: "utility",
        body: "Hi {{1}}, payment of {{2}} is due for the {{3}} milestone on order #{{4}}.",
        variables: ["customer_name", "amount_due", "milestone_name", "order_number"],
      },
    ],
  },
  {
    key: "electronics_electricals",
    label: "Electronics & Electricals",
    industry: "electronics_electricals",
    description: "RFQ-to-dispatch tracking with certification approvals for an electronics or electrical components manufacturer.",
    pipelineStages: [
      { key: "enquiry_rfq_received", label: "Enquiry/RFQ Received", color: "info", type: "open" },
      { key: "quotation", label: "Quotation", color: "info", type: "open" },
      { key: "sample_prototype_approval", label: "Sample/Prototype Approval", color: "warning", type: "open" },
      { key: "po_confirmed", label: "PO Confirmed", color: "warning", type: "open" },
      { key: "in_production", label: "In Production", color: "warning", type: "open" },
      { key: "dispatched", label: "Dispatched", color: "success", type: "won" },
      { key: "lost", label: "Lost", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "product_component_type", label: "Product/Component Type", type: "text", options: [] },
      { key: "order_quantity_moq", label: "Order Quantity/MOQ", type: "number", options: [] },
      { key: "certification_requirement", label: "Certification Requirement", type: "select", options: ["BIS", "CE", "FCC", "RoHS", "None"] },
      { key: "customer_type", label: "Customer Type", type: "select", options: ["OEM", "Distributor", "Industrial", "Dealer"] },
    ],
    supportCategories: [
      { key: "warranty_claim_product_failure", label: "Warranty Claim/Product Failure" },
      { key: "component_shortage_delay_query", label: "Component Shortage/Production-Delay Query" },
      { key: "order_dispatch_status_query", label: "Order/Dispatch Status Query" },
      { key: "outstanding_payment_followup", label: "Outstanding Payment Follow-up" },
      { key: "technical_support_installation", label: "Technical Support/Installation Query" },
    ],
    templates: [
      {
        name: "quotation_sent",
        category: "utility",
        body: "Hi {{1}}, your quotation for {{2}} (qty {{3}}) is ready: {{4}}.",
        variables: ["customer_name", "product_name", "quantity", "quote_amount"],
      },
      {
        name: "production_delay_alert",
        category: "utility",
        body: "Hi {{1}}, due to {{2}}, your order #{{3}} dispatch is now expected on {{4}}.",
        variables: ["customer_name", "delay_reason", "order_number", "revised_date"],
      },
      {
        name: "warranty_claim_update",
        category: "utility",
        body: "Hi {{1}}, your warranty claim for {{2}} is now {{3}}.",
        variables: ["customer_name", "product_name", "status"],
      },
    ],
  },
  // Industrial-manufacturing cluster (Textile & Apparel, Leather & Footwear, Paper & Packaging) -
  // batched together per the user's explicit direction since all 6 sub-models share a near-
  // identical RFQ-to-dispatch shape; terminology and fields are grounded per-document, not
  // copy-pasted generically. Each pair is an upstream commodity/raw-material producer (thinner
  // source detail, pipeline built from scratch) and a downstream finished-goods exporter (fuller
  // source detail, verified against SUMMARY.md's existing sketch).
  {
    key: "textile_mill",
    label: "Textile & Apparel - Mill/Fabric Processor",
    industry: "textile_mill",
    description: "RFQ-to-dispatch tracking with shade/quality approval for a yarn or fabric mill selling to garment manufacturers.",
    pipelineStages: [
      { key: "buyer_enquiry_rfq", label: "Buyer Enquiry/RFQ", color: "info", type: "open" },
      { key: "sample_shade_approval", label: "Sample & Shade/Quality Approval", color: "info", type: "open" },
      { key: "quotation_negotiation", label: "Quotation & Commercial Negotiation", color: "warning", type: "open" },
      { key: "po_confirmed", label: "PO/Production Agreement Confirmed", color: "warning", type: "open" },
      { key: "production_scheduled", label: "Spinning-Weaving-Dyeing Scheduled", color: "warning", type: "open" },
      { key: "fabric_inspection_grading", label: "Fabric Inspection & Grading", color: "warning", type: "open" },
      { key: "dispatched_invoiced", label: "Dispatched & Invoiced", color: "success", type: "won" },
      { key: "rejected", label: "Rejected/Buyer Declined", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "yarn_fabric_type", label: "Yarn/Fabric Type", type: "select", options: ["Cotton", "Polyester", "Blended", "Synthetic"] },
      { key: "yarn_count_gsm_spec", label: "Yarn Count/GSM Spec", type: "text", options: [] },
      { key: "order_quantity", label: "Order Quantity", type: "number", options: [] },
      { key: "buyer_type", label: "Buyer Type", type: "select", options: ["Garment Manufacturer", "Wholesaler", "Exporter", "Institutional"] },
      { key: "quote_validity_date", label: "Quote Validity Date", type: "date", options: [] },
    ],
    supportCategories: [
      { key: "dispatch_order_status", label: "Dispatch/Order Status" },
      { key: "shade_grade_quality_complaint", label: "Shade or Grade Quality Complaint" },
      { key: "price_quote_validity_query", label: "Material-Price/Quote-Validity Query" },
      { key: "outstanding_payment_followup", label: "Outstanding Payment Follow-up" },
      { key: "returns_batch_rejection_claim", label: "Returns & Batch Rejection Claim" },
    ],
    templates: [
      {
        name: "quote_validity_reminder",
        category: "utility",
        body: "Hi {{1}}, your quotation for {{2}} expires on {{3}}. Confirm your order to lock in this price.",
        variables: ["buyer_name", "fabric_spec", "validity_date"],
      },
      {
        name: "shade_approval_request",
        category: "utility",
        body: "Hi {{1}}, please review the attached shade/lot sample for {{2}} and confirm approval before bulk dyeing.",
        variables: ["buyer_name", "order_reference"],
      },
      {
        name: "dispatch_confirmation",
        category: "utility",
        body: "Hi {{1}}, your order #{{2}} has been dispatched. Tracking: {{3}}.",
        variables: ["buyer_name", "order_number", "tracking_link"],
      },
    ],
  },
  {
    key: "textile_garment",
    label: "Textile & Apparel - Garment Manufacturer/Exporter",
    industry: "textile_garment",
    description: "Tech-pack-to-shipment tracking for a garment manufacturer or export house.",
    pipelineStages: [
      { key: "buyer_enquiry_techpack", label: "Buyer Enquiry/Tech Pack", color: "info", type: "open" },
      { key: "sampling_costing", label: "Sampling & Costing", color: "info", type: "open" },
      { key: "quotation_moq_negotiation", label: "Quotation & MOQ Negotiation", color: "warning", type: "open" },
      { key: "po_export_contract", label: "PO/Export Contract", color: "warning", type: "open" },
      { key: "production_scheduled", label: "Production Scheduled", color: "warning", type: "open" },
      { key: "qa_buyer_inspection", label: "QA/Buyer Inspection", color: "warning", type: "open" },
      { key: "dispatched_shipped_invoiced", label: "Dispatched/Shipped & Invoiced", color: "success", type: "won" },
      { key: "order_cancelled", label: "Order Cancelled/Buyer Declined", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "buyer_type", label: "Buyer Type", type: "select", options: ["Brand", "Retailer", "Wholesaler", "Distributor"] },
      { key: "fabric_gsm_spec", label: "Fabric/GSM Spec", type: "text", options: [] },
      { key: "moq", label: "MOQ", type: "number", options: [] },
      { key: "payment_terms", label: "Payment Terms", type: "select", options: ["LC", "Advance", "Credit-days"] },
      { key: "compliance_certification", label: "Compliance Certification", type: "text", options: [] },
      { key: "season_collection_tag", label: "Season/Collection Tag", type: "text", options: [] },
    ],
    supportCategories: [
      { key: "shipment_dispatch_tracking", label: "Shipment/Dispatch Tracking Query" },
      { key: "shade_fit_quality_complaint", label: "Shade-Fit-Quality Complaint" },
      { key: "sample_costing_revision", label: "Sample/Costing Revision Request" },
      { key: "compliance_certificate_request", label: "Compliance Certificate Request" },
      { key: "invoice_debit_note_query", label: "Invoice/Deduction & Debit-Note Query" },
      { key: "repeat_order_enquiry", label: "Repeat-Order/New-Collection Enquiry" },
    ],
    templates: [
      {
        name: "inspection_photo_share",
        category: "utility",
        body: "Hi {{1}}, please review the attached inspection photos for order #{{2}} before we proceed to shipment.",
        variables: ["buyer_name", "order_number"],
      },
      {
        name: "shipment_delay_alert",
        category: "utility",
        body: "Hi {{1}}, order #{{2}} is delayed by {{3}} days due to {{4}}. Revised ship date: {{5}}.",
        variables: ["buyer_name", "order_number", "delay_days", "reason", "revised_date"],
      },
      {
        name: "receivables_reminder",
        category: "utility",
        body: "Hi {{1}}, payment of {{2}} against invoice #{{3}} is due on {{4}}.",
        variables: ["buyer_name", "amount_due", "invoice_number", "due_date"],
      },
    ],
  },
  {
    key: "leather_tannery",
    label: "Leather & Footwear - Tannery/Raw Material",
    industry: "leather_tannery",
    description: "RFQ-to-dispatch tracking with grade and compliance approval for a tannery or raw-material leather supplier.",
    pipelineStages: [
      { key: "buyer_enquiry_rfq", label: "Buyer Enquiry/RFQ", color: "info", type: "open" },
      { key: "sample_grade_approval", label: "Sample/Grade Swatch Approval", color: "info", type: "open" },
      { key: "quotation_negotiation", label: "Quotation & Negotiation", color: "warning", type: "open" },
      { key: "po_supply_contract", label: "PO/Supply Contract Confirmed", color: "warning", type: "open" },
      { key: "tanning_finishing_scheduled", label: "Tanning & Finishing Scheduled", color: "warning", type: "open" },
      { key: "grading_measurement", label: "Finished-Leather Grading & Measurement", color: "warning", type: "open" },
      { key: "dispatched_invoiced", label: "Dispatched & Invoiced", color: "success", type: "won" },
      { key: "rejected_downgraded", label: "Rejected/Material Downgraded", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "hide_skin_species", label: "Hide/Skin Species", type: "select", options: ["Cattle", "Buffalo", "Goat", "Sheep"] },
      { key: "tanning_type", label: "Tanning Type", type: "select", options: ["Chrome", "Vegetable", "Alternative"] },
      { key: "grade_thickness", label: "Grade & Thickness", type: "text", options: [] },
      { key: "recoverable_area", label: "Recoverable Area (sq ft)", type: "number", options: [] },
      { key: "buyer_type", label: "Buyer Type", type: "select", options: ["Footwear", "Leather Goods", "Garment Manufacturer", "Exporter"] },
      { key: "compliance_requirement", label: "Compliance Requirement", type: "select", options: ["Restricted-Substance Audit", "Chemical Audit", "Environmental Audit", "None"] },
    ],
    supportCategories: [
      { key: "order_dispatch_status", label: "Order/Dispatch Status Query" },
      { key: "batch_grade_shade_complaint", label: "Batch Grade/Shade Complaint" },
      { key: "compliance_documentation_request", label: "Chemical-Compliance Documentation Request" },
      { key: "outstanding_payment_followup", label: "Outstanding Payment Follow-up" },
      { key: "quote_price_validity_query", label: "Quote/Price Validity Query" },
    ],
    templates: [
      {
        name: "grade_photo_approval",
        category: "utility",
        body: "Hi {{1}}, please review the attached grade/batch photos for order #{{2}} and confirm approval.",
        variables: ["buyer_name", "order_number"],
      },
      {
        name: "dispatch_status_update",
        category: "utility",
        body: "Hi {{1}}, your order #{{2}} has been dispatched. Tracking: {{3}}.",
        variables: ["buyer_name", "order_number", "tracking_link"],
      },
      {
        name: "compliance_certificate_sent",
        category: "utility",
        body: "Hi {{1}}, the compliance certificate for order #{{2}} is attached.",
        variables: ["buyer_name", "order_number"],
      },
    ],
  },
  {
    key: "leather_footwear_brand",
    label: "Leather & Footwear - Footwear Brand/Export Manufacturer",
    industry: "leather_footwear_brand",
    description: "RFQ-to-dispatch tracking through sample and compliance approval for a footwear brand or export manufacturer.",
    pipelineStages: [
      { key: "buyer_enquiry_rfq", label: "Buyer Enquiry/RFQ", color: "info", type: "open" },
      { key: "sample_development", label: "Sample Development", color: "info", type: "open" },
      { key: "buyer_compliance_approval", label: "Buyer/Compliance Approval", color: "warning", type: "open" },
      { key: "costing_quotation", label: "Costing & Quotation", color: "warning", type: "open" },
      { key: "po_confirmed", label: "PO Confirmed", color: "warning", type: "open" },
      { key: "in_production", label: "In Production", color: "warning", type: "open" },
      { key: "dispatched", label: "Dispatched", color: "success", type: "won" },
      { key: "sample_rejected_order_lost", label: "Sample Rejected/Order Lost", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "product_category", label: "Product Category", type: "select", options: ["Footwear", "Bags", "Belts", "Wallets", "Garments"] },
      { key: "material_type", label: "Material Type", type: "select", options: ["Leather", "Synthetic", "Rubber", "EVA", "PU", "PVC"] },
      { key: "moq", label: "MOQ", type: "number", options: [] },
      { key: "buyer_compliance_requirement", label: "Buyer Compliance Requirement", type: "select", options: ["BIS", "RoHS", "Social Audit", "Environmental Audit"] },
    ],
    supportCategories: [
      { key: "order_dispatch_status", label: "Order/Dispatch Status Query" },
      { key: "fit_size_complaint", label: "Fit/Size Complaint" },
      { key: "sole_bond_stitching_defect", label: "Sole-Bond/Stitching Defect Claim" },
      { key: "compliance_test_report_request", label: "Compliance/Test-Report Request" },
      { key: "repair_warranty_claim", label: "Repair or Warranty Claim" },
      { key: "invoice_deduction_query", label: "Invoice/Deduction Query" },
    ],
    templates: [
      {
        name: "compliance_sample_approval",
        category: "utility",
        body: "Hi {{1}}, please review the attached compliance/sample approval photos for order #{{2}}.",
        variables: ["buyer_name", "order_number"],
      },
      {
        name: "production_dispatch_update",
        category: "utility",
        body: "Hi {{1}}, order #{{2}} has reached {{3}}. Expected dispatch: {{4}}.",
        variables: ["buyer_name", "order_number", "production_stage", "expected_dispatch_date"],
      },
      {
        name: "receivables_reminder",
        category: "utility",
        body: "Hi {{1}}, payment of {{2}} against invoice #{{3}} is due on {{4}}.",
        variables: ["buyer_name", "amount_due", "invoice_number", "due_date"],
      },
    ],
  },
  {
    key: "paper_mill",
    label: "Paper & Packaging - Mill",
    industry: "paper_mill",
    description: "RFQ-to-dispatch tracking with grade approval for a paper or pulp mill selling to converters and printers.",
    pipelineStages: [
      { key: "buyer_enquiry_rfq", label: "Buyer Enquiry/RFQ", color: "info", type: "open" },
      { key: "sample_grade_approval", label: "Sample/Grade Approval", color: "info", type: "open" },
      { key: "quotation_negotiation", label: "Quotation & Negotiation", color: "warning", type: "open" },
      { key: "po_rate_contract", label: "PO/Rate Contract Confirmed", color: "warning", type: "open" },
      { key: "production_scheduled", label: "Production Scheduled", color: "warning", type: "open" },
      { key: "quality_grading_release", label: "Quality Grading & Reel Release", color: "warning", type: "open" },
      { key: "dispatched_invoiced", label: "Dispatched & Invoiced", color: "success", type: "won" },
      { key: "lot_rejected", label: "Lot Rejected/Buyer Declined", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "paper_fibre_grade", label: "Paper/Fibre Grade", type: "select", options: ["Kraft", "Linerboard", "Fluting", "Duplex Board", "Recycled", "Virgin Pulp"] },
      { key: "gsm_grammage", label: "GSM/Grammage", type: "number", options: [] },
      { key: "reel_width", label: "Reel Width", type: "number", options: [] },
      { key: "order_quantity_tonnes", label: "Order Quantity (Tonnes)", type: "number", options: [] },
      { key: "fibre_source", label: "Fibre Source", type: "select", options: ["Virgin Pulp", "Recovered Paper", "Agri-residue"] },
      { key: "buyer_type", label: "Buyer Type", type: "select", options: ["Corrugator", "Carton Converter", "Printer", "Distributor"] },
    ],
    supportCategories: [
      { key: "order_dispatch_status", label: "Order/Dispatch Status Query" },
      { key: "grammage_quality_complaint", label: "Grammage/Quality Complaint" },
      { key: "reel_batch_traceability", label: "Reel/Batch Traceability Query" },
      { key: "price_quote_validity_query", label: "Material-Price/Quote-Validity Query" },
      { key: "outstanding_payment_followup", label: "Outstanding Payment Follow-up" },
    ],
    templates: [
      {
        name: "price_adjustment_alert",
        category: "utility",
        body: "Hi {{1}}, your quoted rate for {{2}} is valid until {{3}} due to raw-material price movement.",
        variables: ["buyer_name", "product_grade", "validity_date"],
      },
      {
        name: "dispatch_confirmation",
        category: "utility",
        body: "Hi {{1}}, reel batch #{{2}} has been dispatched. Tracking: {{3}}.",
        variables: ["buyer_name", "batch_number", "tracking_link"],
      },
      {
        name: "test_report_share",
        category: "utility",
        body: "Hi {{1}}, the grade/test certificate for batch #{{2}} is attached.",
        variables: ["buyer_name", "batch_number"],
      },
    ],
  },
  {
    key: "paper_converter",
    label: "Paper & Packaging - Packaging Converter",
    industry: "paper_converter",
    description: "RFQ-to-dispatch tracking through artwork and structural validation for a packaging converter.",
    pipelineStages: [
      { key: "enquiry_rfq", label: "Enquiry/RFQ", color: "info", type: "open" },
      { key: "design_artwork_approval", label: "Structural Design & Artwork/Sample Approval", color: "info", type: "open" },
      { key: "testing_validation", label: "Testing/Validation", color: "warning", type: "open" },
      { key: "quotation", label: "Quotation", color: "warning", type: "open" },
      { key: "po_supply_contract_confirmed", label: "PO/Supply Contract Confirmed", color: "warning", type: "open" },
      { key: "in_production_dispatch", label: "In Production/Dispatch", color: "warning", type: "open" },
      { key: "dispatched_invoiced", label: "Dispatched & Invoiced", color: "success", type: "won" },
      { key: "design_test_rejected", label: "Design or Test Rejected/Lost", color: "destructive", type: "lost" },
    ],
    customFieldDefinitions: [
      { key: "packaging_type", label: "Packaging Type", type: "select", options: ["Corrugated Box", "Folding Carton", "Paper Bag", "Label", "Molded Fibre"] },
      { key: "board_paper_grade_gsm", label: "Board/Paper Grade & GSM", type: "text", options: [] },
      { key: "moq", label: "MOQ", type: "number", options: [] },
      { key: "print_artwork_spec_reference", label: "Print/Artwork Spec Reference", type: "text", options: [] },
      { key: "vmi_call_off_arrangement", label: "VMI/Call-off Arrangement", type: "select", options: ["VMI Managed", "Call-off Order", "Standard PO"] },
    ],
    supportCategories: [
      { key: "order_dispatch_status", label: "Order/Dispatch Status Query" },
      { key: "artwork_print_error_complaint", label: "Artwork/Print Error Complaint" },
      { key: "structural_compression_failure", label: "Structural/Compression Failure Claim" },
      { key: "filling_line_support_request", label: "Filling-Line Support Request" },
      { key: "vmi_replenishment_request", label: "VMI Replenishment Request" },
      { key: "invoice_deduction_query", label: "Invoice/Deduction Query" },
    ],
    templates: [
      {
        name: "artwork_proof_approval",
        category: "utility",
        body: "Hi {{1}}, please review the attached artwork proof for {{2}} before we proceed to plate production.",
        variables: ["buyer_name", "product_name"],
      },
      {
        name: "filling_trial_support",
        category: "utility",
        body: "Hi {{1}}, we've scheduled a filling-line trial for {{2}} on {{3}}.",
        variables: ["buyer_name", "packaging_type", "trial_date"],
      },
      {
        name: "vmi_replenishment_trigger",
        category: "utility",
        body: "Hi {{1}}, stock levels for {{2}} are at {{3}}. Reply to confirm replenishment order.",
        variables: ["buyer_name", "sku_description", "stock_level"],
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
