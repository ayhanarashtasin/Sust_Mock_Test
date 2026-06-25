const Groq = require('groq-sdk');

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Use a fast, capable model. Llama 3.3 70B is excellent for this task.
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Allowed enums (for validation / defaults)
const VALID_CASE_TYPES = [
  'wrong_transfer',
  'payment_failed',
  'refund_request',
  'phishing_or_social_engineering',
  'other'
];

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

const VALID_DEPARTMENTS = [
  'customer_support',
  'dispute_resolution',
  'payments_ops',
  'fraud_risk'
];

/**
 * Build the system prompt with full classification rules and the safety rule.
 */
function buildSystemPrompt() {
  return `You are a careful ticket classification engine for a digital finance company.

Your job: read ONE customer message and return a JSON object classifying it.

====================
OUTPUT SCHEMA
====================
You MUST return ONLY valid JSON (no prose, no markdown fences) with exactly these fields:

{
  "case_type": <one of the case_type values below>,
  "severity": <one of: low, medium, high, critical>,
  "department": <one of the department values below>,
  "agent_summary": <one or two neutral sentences>,
  "human_review_required": <true or false>,
  "confidence": <float between 0 and 1>
}

====================
CASE TYPES
====================
- wrong_transfer: Customer sent money to the wrong recipient (wrong number, wrong account, typo).
- payment_failed: Transaction failed or got stuck, but money may have been deducted from the customer's balance.
- refund_request: Customer is asking for a refund of a completed or recent transaction.
- phishing_or_social_engineering: Someone contacted the customer (call, SMS, chat) asking for PIN, OTP, password, CVV, card number, or trying to impersonate support/staff. Includes scam reports.
- other: Anything that does not clearly fit the above (app crash, login trouble, general inquiry, complaint, feedback).

====================
SEVERITY GUIDELINES
====================
- critical: Active fraud, account compromise, money already stolen by a scammer, or phishing in progress. Customer may lose money any moment.
- high: Customer already lost money or is likely to lose money soon. Wrong transfers, payment failed with deducted balance, large disputed transactions.
- medium: Customer is inconvenienced but not at immediate risk. Failed transaction where balance is intact, refund dispute still being verified, suspicious activity with no money lost yet.
- low: General questions, app issues, simple refund requests, complaints without financial loss.

====================
DEPARTMENT MAPPING
====================
- dispute_resolution: wrong_transfer, contested refund_request.
- payments_ops: payment_failed.
- fraud_risk: phishing_or_social_engineering.
- customer_support: other, simple refund_request, low severity questions.

====================
HUMAN REVIEW RULE
====================
Set "human_review_required" to TRUE when:
- severity is "critical", OR
- case_type is "phishing_or_social_engineering".
Otherwise set it to FALSE.

====================
AGENT SUMMARY RULES
====================
- One or two neutral sentences.
- Describe what the customer reported, not what they should do.
- Use neutral, factual language. No judgments about the customer.

====================
STRICT SAFETY RULE (will fail tests if violated)
====================
The "agent_summary" field MUST NEVER:
- Ask the customer to share their PIN, OTP, password, CVV, or full card number.
- Suggest the customer send sensitive credentials anywhere (chat, SMS, email, phone).
- Encourage the customer to share one-time codes with anyone, including "support staff".

If the customer's message contains sensitive numbers, you must NOT echo them back.
Always end with neutral phrasing like "An agent will reach out to assist." or similar safe language.

====================
CONFIDENCE
====================
- 0.9 to 1.0: Clear, unambiguous case.
- 0.7 to 0.89: Strong signal but some ambiguity.
- 0.5 to 0.69: Moderate confidence; another class is plausible.
- Below 0.5: Low confidence; the message is unclear.

====================
NOW CLASSIFY
====================
Respond with ONLY the JSON object. No prose, no markdown.`;
}

/**
 * Call Groq with strict JSON-only output.
 */
async function callLLM(systemPrompt, userContent) {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: 0.1,
    max_completion_tokens: 600,
    response_format: { type: 'json_object' }
  });

  const text = completion?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('Empty response from LLM');
  }
  return text;
}

/**
 * Defense-in-depth: scrub any request for sensitive credentials from a summary.
 * If the LLM somehow violates the safety rule, we rewrite the summary.
 */
function enforceSafetyOnSummary(summary) {
  if (typeof summary !== 'string') return '';
  const lower = summary.toLowerCase();

  const dangerousPhrases = [
    'send your pin',
    'share your pin',
    'provide your pin',
    'give your pin',
    'tell us your pin',
    'send your otp',
    'share your otp',
    'provide your otp',
    'give your otp',
    'send your password',
    'share your password',
    'provide your password',
    'send your cvv',
    'share your cvv',
    'send your card number',
    'share your card number',
    'forward the otp',
    'share the otp',
    'tell us the otp',
    'tell us your otp',
    'verify with your pin',
    'confirm your pin'
  ];

  for (const phrase of dangerousPhrases) {
    if (lower.includes(phrase)) {
      // Replace the offending summary with a safe one
      return 'Customer issue reported. An agent will reach out to assist through verified channels. Do not share PIN, OTP, or password with anyone.';
    }
  }

  return summary;
}

/**
 * Validate and normalize a single field against an allowed list.
 */
function pickEnum(value, allowed, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().toLowerCase();
  return allowed.includes(trimmed) ? trimmed : fallback;
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function asBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Map case_type -> default department if the LLM omits or supplies an invalid one.
 */
function defaultDepartmentFor(caseType) {
  switch (caseType) {
    case 'wrong_transfer':
      return 'dispute_resolution';
    case 'payment_failed':
      return 'payments_ops';
    case 'phishing_or_social_engineering':
      return 'fraud_risk';
    case 'refund_request':
      return 'dispute_resolution';
    case 'other':
    default:
      return 'customer_support';
  }
}

/**
 * Heuristic fallback if the LLM is unavailable or returns garbage.
 */
function heuristicClassify(message) {
  const m = (message || '').toLowerCase();

  const phishingSignals = [
    'otp', 'pin', 'password', 'cvv', 'one time password',
    'someone called', 'someone asked', 'asking for my',
    'phishing', 'scam', 'fraud call', 'fake', 'impersonat'
  ];
  const wrongTransferSignals = [
    'wrong number', 'wrong account', 'sent to wrong', 'wrong person',
    'mistakenly sent', 'by mistake', 'incorrect number', 'wrong recipient'
  ];
  const paymentFailedSignals = [
    'payment failed', 'transaction failed', 'failed but',
    'deducted', 'money deducted', 'charged but', 'stuck', 'pending since'
  ];
  const refundSignals = [
    'refund', 'refund my', 'please refund', 'want my money back',
    'changed my mind', 'cancel and refund', 'return my money'
  ];

  const has = (signals) => signals.some(s => m.includes(s));

  if (has(phishingSignals)) {
    return {
      case_type: 'phishing_or_social_engineering',
      severity: 'critical',
      department: 'fraud_risk',
      human_review_required: true,
      confidence: 0.7,
      agent_summary: 'Customer reports a suspicious contact that may be a phishing or social engineering attempt. An agent will reach out to assist through verified channels.'
    };
  }
  if (has(wrongTransferSignals)) {
    return {
      case_type: 'wrong_transfer',
      severity: 'high',
      department: 'dispute_resolution',
      human_review_required: true,
      confidence: 0.7,
      agent_summary: 'Customer reports sending money to the wrong recipient and requests recovery. An agent will reach out to assist.'
    };
  }
  if (has(paymentFailedSignals)) {
    return {
      case_type: 'payment_failed',
      severity: 'high',
      department: 'payments_ops',
      human_review_required: true,
      confidence: 0.7,
      agent_summary: 'Customer reports a failed payment with possible balance deduction. An agent will reach out to assist.'
    };
  }
  if (has(refundSignals)) {
    return {
      case_type: 'refund_request',
      severity: 'low',
      department: 'customer_support',
      human_review_required: false,
      confidence: 0.65,
      agent_summary: 'Customer is requesting a refund of a recent transaction. An agent will reach out to assist.'
    };
  }
  return {
    case_type: 'other',
    severity: 'low',
    department: 'customer_support',
    human_review_required: false,
    confidence: 0.5,
    agent_summary: 'Customer submitted a general inquiry or issue. An agent will reach out to assist.'
  };
}

/**
 * Main classify function.
 */
async function classify({ ticket_id, channel, locale, message }) {
  const systemPrompt = buildSystemPrompt();
  const userContent = JSON.stringify({
    ticket_id,
    channel,
    locale,
    message
  });

  let raw;
  try {
    raw = await callLLM(systemPrompt, userContent);
  } catch (err) {
    console.error('LLM call failed, falling back to heuristic:', err.message);
    const h = heuristicClassify(message);
    return {
      ticket_id,
      case_type: h.case_type,
      severity: h.severity,
      department: h.department,
      agent_summary: h.agent_summary,
      human_review_required: h.human_review_required,
      confidence: h.confidence
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('LLM returned invalid JSON, falling back to heuristic:', err.message);
    const h = heuristicClassify(message);
    return {
      ticket_id,
      case_type: h.case_type,
      severity: h.severity,
      department: h.department,
      agent_summary: h.agent_summary,
      human_review_required: h.human_review_required,
      confidence: h.confidence
    };
  }

  // Normalize / validate fields
  let case_type = pickEnum(parsed.case_type, VALID_CASE_TYPES, 'other');
  let severity = pickEnum(parsed.severity, VALID_SEVERITIES, 'low');
  let department = pickEnum(parsed.department, VALID_DEPARTMENTS, defaultDepartmentFor(case_type));

  // Enforce department/severity coherence
  if (case_type === 'payment_failed' && department !== 'payments_ops') {
    department = 'payments_ops';
  }
  if (case_type === 'phishing_or_social_engineering' && department !== 'fraud_risk') {
    department = 'fraud_risk';
  }
  if (case_type === 'wrong_transfer' && department !== 'dispute_resolution') {
    department = 'dispute_resolution';
  }
  if (case_type === 'phishing_or_social_engineering' && severity !== 'critical') {
    severity = 'critical';
  }

  // human_review_required derived rule (overrides LLM)
  const human_review_required =
    severity === 'critical' || case_type === 'phishing_or_social_engineering'
      ? true
      : asBool(parsed.human_review_required);

  // Summary safety enforcement
  let agent_summary = typeof parsed.agent_summary === 'string'
    ? parsed.agent_summary.trim()
    : '';
  agent_summary = enforceSafetyOnSummary(agent_summary);

  if (!agent_summary) {
    agent_summary = 'Customer submitted an inquiry. An agent will reach out to assist through verified channels.';
  }

  const confidence = clampConfidence(parsed.confidence);

  return {
    ticket_id,
    case_type,
    severity,
    department,
    agent_summary,
    human_review_required,
    confidence
  };
}

module.exports = {
  classify,
  // exported for tests
  _internals: {
    buildSystemPrompt,
    enforceSafetyOnSummary,
    heuristicClassify
  }
};