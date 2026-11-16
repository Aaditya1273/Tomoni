# Go-live checklist

Nothing here is done. Every item must be signed off before the first real patient. `TOMONI_REAL_DATA_ENABLED` stays `false` until the whole list is complete, and the real adapters refuse to start without it.

## Legal review (US counsel)
- [ ] **APCM structure:** the practice bills G0556 to G0558; Tomoni is the practice's vendor. Confirm the contract, the consent wording, and that research time inside a billed call is allowed at all (D-009).
- [ ] **Anti-kickback and the Stark law:** no finder's fees (rule 2.7), work-based sponsor units only, no fee on randomization (D-010). Confirm that sponsor usage reports showing exact unit counts are acceptable (PROGRESS gaps).
- [ ] **HIPAA:** privacy and security risk assessment, notice of privacy practices, breach procedure, the minimum-necessary review of every role (SECURITY.md), and the HIPAA authorization text for research.
- [ ] **TCPA and state telemarketing rules:** prior express consent for automated calls, AI disclosure (rule 2.10), quiet hours, opt-out on every call and text.
- [ ] **State call-recording laws:** all-party consent states. Recording stays off unless the patient agrees, and the disclosure says which.
- [ ] **Legally authorized representatives:** state rules for who may consent for whom (rule 2.6).
- [ ] **Data licensing:** confirm Blue Button data stays out of licensing (D-011).
- [ ] **India bridge (D-027):** cross-border processing under the DPDP Act, the telecom rules for automated calls, and an Indian ethics committee and the DPDP research exemption before any India research.

## IRB and research
- [ ] An IRB-approved protocol for the registry, Trial Bridge and Voice Lab, with the consent document the plain summaries are written from.
- [ ] The IRB approves each trial's voice pre-screen questions and every translation of them (D-033).
- [ ] Staff the research coordinator role (built: matched names only, every read and move audited) and train them on the protocol.
- [ ] Data use agreements with each sponsor. Counsel confirms the aggregate-only portal and small-cell suppression (rule 2.9).

## FDA strategy for Voice Lab
- [ ] Regulatory counsel confirms that speech features are research-only and inform no clinical decision (rule 2.8, BUILD_PROMPT §2), and the path (for example a pre-submission) before any claim about detecting disease.
- [ ] Audio capture is built and off (`TOMONI_SPEECH_AUDIO`, D-032). Counsel reviews consent, recording law and retention (including whether a withdrawal deletes audio) before it is turned on; the research bucket gets its production home and key.

## Clinical protocol sign-off (a US-licensed physician)
- [ ] The safety phrase lists in six languages, the escalation paths, the 911 and 988 scripts, and India's 112 and Tele-MANAS 14416 scripts (rule 2.1, D-031).
- [ ] The warning thresholds (D-018, D-019) and the wording families see.
- [ ] Gene-to-Pill rules reviewed by a clinical pharmacist; doctor-only delivery confirmed (D-028).
- [ ] Care-plan templates and APCM documentation.
- [ ] Native-speaker review of every Hindi string, and call scripts written for Gujarati, Tamil, Punjabi and Bengali (D-025).

## Business associate agreements
- [ ] Hosting and database (including backups and logs).
- [ ] Twilio (voice, SMS) and any speech-to-text or text-to-speech vendor (D-007).
- [ ] Anthropic (the conversation LLM).
- [ ] Email delivery, object storage, the observability backend (even with PHI-free telemetry), error tracking.
- [ ] Pharmacy and e-prescribing partners (Surescripts-certified).

## Security and SOC 2 readiness
- [ ] SOC 2 readiness review: access reviews, change management, vendor management, incident response, and policies.
- [ ] An external penetration test, including the agent's prompt-injection surface and the sponsor portal.
- [ ] Production secrets in a secrets manager. Rotate every key that ever lived in a `.env` file. Plan and test the field-encryption key rotation.
- [ ] TLS everywhere; encryption at rest on the database, backups and object storage.
- [ ] Backups: point-in-time recovery, off-site copies, a restore drill on production-sized data, and agreed RPO and RTO (RUNBOOK).
- [ ] Monitoring and on-call: the alert rules are built (RUNBOOK "Alerts"); choose the pager, set `TOMONI_ONCALL_WEBHOOK_URL`, staff a rota with clinical escalation for urgent flags, and run a paging drill.

## Integrations in production
- [ ] **Blue Button 2.0 production access:** CMS approval of the app, the privacy policy and the production credentials.
- [ ] CMS Part D files: a streaming loader for full releases and the pharmacy network file (PROGRESS).
- [ ] Real pharmacy and e-prescribing partners replace the mocks.
- [ ] Twilio tested end to end against real numbers (signature checks are tested only against Twilio's documented example).
- [ ] The live LLM prompt evaluation run and passed (`pnpm --filter @tomoni/voice eval`, D-023).
- [ ] Drug shortage and pharmacy closure feeds chosen.
- [ ] Stripe account, the live price matching `TOMONI_FAMILY_PLAN_CENTS`, the webhook endpoint and secret (events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`), the customer portal set to cancel at period end, tax registration with `TOMONI_STRIPE_AUTOMATIC_TAX`, and a refund policy (D-030).

## Last step
- [ ] Synthetic demo logins and seed data are absent from production; the seed refuses to run when real data is enabled.
- [ ] `TOMONI_REAL_DATA_ENABLED=true` is set by a named person, on a recorded date, after every item above is signed.
