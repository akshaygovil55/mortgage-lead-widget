import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Four distinct journeys — do not merge first-home with other owner-occupiers */
export type Goal = "buy_home" | "first_home" | "invest" | "refinance";

export type EmploymentType =
    | "full_time"
    | "part_time"
    | "self_employed"
    | "casual_contractor";

export type BuyTimeline =
    | "asap"
    | "1_3"
    | "3_6"
    | "6plus";

export type RefinanceGoal =
    | "lower_repayments"
    | "better_rate"
    | "access_equity"
    | "consolidate_debt";

export type RefinanceTimeline = "asap" | "1_3" | "3plus";

export type FirstHomeBuyerStatus = "yes" | "unsure";

export type PurchasePathInputs = {
    propertyPrice: string;
    deposit: string;
    annualIncome: string;
    hasSecondApplicant: boolean;
    secondIncome: string;
    monthlyDebts: string;
    buyTimeline: BuyTimeline | "";
    listingUrl: string;
    employmentType?: EmploymentType | "";
    fhbStatus?: FirstHomeBuyerStatus | null;
    ownsProperty?: boolean | null;
    weeklyRent?: string;
};

export type RefinancePathInputs = {
    loanBalance: string;
    propertyValue: string;
    interestRate: string;
    currentRepayment: string;
    annualIncome: string;
    monthlyDebts: string;
    refinanceGoal: RefinanceGoal | "";
    refinanceTimeline: RefinanceTimeline | "";
};

export type LeadDetails = {
    fullName: string;
    email: string;
    phone: string;
};

export type IncomingPayload = {
    source?: string;
    formType?: string;
    previewVersion?: string;
    goal?: Goal;
    honeypot?: string;
    rawInputs?: PurchasePathInputs | RefinancePathInputs;
    lead?: LeadDetails;
    consentAccepted?: boolean;
    metadata?: {
        pagePath?: string;
        userAgent?: string;
        submittedAtClient?: string;
        turnstileToken?: string | null;
    };
    previewEstimate?: unknown;
    fullResult?: unknown;
};

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 8;

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function json(
    body: Record<string, unknown>,
    status = 200
): NextResponse<Record<string, unknown>> {
    return NextResponse.json(body, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

function normalizeNumericInput(input: string): string {
    const stripped = input.replace(/[^\d.]/g, "");
    const firstDot = stripped.indexOf(".");
    if (firstDot === -1) return stripped;
    return (
        stripped.slice(0, firstDot + 1) +
        stripped.slice(firstDot + 1).replace(/\./g, "")
    );
}

function parseMoney(input: string): number {
    const cleaned = normalizeNumericInput(input).trim();
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseDigits(input: string): string {
    return input.replace(/\D/g, "");
}

function sanitizePhone(phone: string): string {
    return phone.replace(/[^\d+ ]/g, "").replace(/\s+/g, " ").trim();
}

function sanitizeText(value: unknown, max = 500): string {
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone: string): boolean {
    const digits = parseDigits(phone);
    return digits.length >= 8 && digits.length <= 15;
}

function isValidUrl(value: string): boolean {
    if (!value.trim()) return true;
    try {
        const u = new URL(value.trim());
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

function getClientIp(request: NextRequest): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        const first = forwarded.split(",")[0]?.trim();
        if (first) return first;
    }
    const realIp = request.headers.get("x-real-ip");
    return realIp?.trim() || "unknown";
}

function enforceOrigin(request: NextRequest): boolean {
    const origin = request.headers.get("origin")?.replace(/\/$/, "");
    if (!origin) return true;

    const allowedOrigins = new Set(
        [
            process.env.APP_BASE_URL,
            "https://akshaygovil.com",
            "https://www.akshaygovil.com",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
        ]
            .filter(Boolean)
            .map((value) => String(value).replace(/\/$/, ""))
    );

    return allowedOrigins.has(origin);
}

function rateLimit(key: string): boolean {
    const now = Date.now();

    for (const [k, value] of rateLimitStore.entries()) {
        if (value.resetAt <= now) rateLimitStore.delete(k);
    }

    const existing = rateLimitStore.get(key);

    if (!existing || existing.resetAt <= now) {
        rateLimitStore.set(key, {
            count: 1,
            resetAt: now + RATE_LIMIT_WINDOW_MS,
        });
        return true;
    }

    if (existing.count >= RATE_LIMIT_MAX) {
        return false;
    }

    existing.count += 1;
    rateLimitStore.set(key, existing);
    return true;
}

const TIMELINES: BuyTimeline[] = ["asap", "1_3", "3_6", "6plus"];
const REFI_TIMELINES: RefinanceTimeline[] = ["asap", "1_3", "3plus"];
const REFI_GOALS: RefinanceGoal[] = [
    "lower_repayments",
    "better_rate",
    "access_equity",
    "consolidate_debt",
];

function validatePurchasePath(
    goal: "buy_home" | "first_home" | "invest",
    raw: PurchasePathInputs
) {
    const propertyPrice = parseMoney(String(raw.propertyPrice || ""));
    const deposit = parseMoney(String(raw.deposit || ""));
    const annualIncome = parseMoney(String(raw.annualIncome || ""));
    const secondIncome = parseMoney(String(raw.secondIncome || ""));
    const monthlyDebts = parseMoney(String(raw.monthlyDebts || ""));
    const listingUrl = sanitizeText(raw.listingUrl, 500);
    const buyTimeline = raw.buyTimeline;

    if (typeof raw.hasSecondApplicant !== "boolean") {
        return { ok: false as const, message: "Invalid second applicant selection." };
    }
    if (raw.hasSecondApplicant && (secondIncome < 1000 || secondIncome > 2000000)) {
        return { ok: false as const, message: "Enter a realistic second income." };
    }
    if (!raw.hasSecondApplicant && secondIncome > 0) {
        return { ok: false as const, message: "Second income should be empty when no second applicant." };
    }
    if (propertyPrice < 100000 || propertyPrice > 20000000) {
        return { ok: false as const, message: "Invalid property price." };
    }
    if (deposit < 5000 || deposit > 10000000) {
        return { ok: false as const, message: "Invalid deposit amount." };
    }
    if (annualIncome < 20000 || annualIncome > 2000000) {
        return { ok: false as const, message: "Invalid annual income." };
    }
    if (monthlyDebts < 0 || monthlyDebts > 50000) {
        return { ok: false as const, message: "Invalid monthly debts." };
    }
    if (!TIMELINES.includes(buyTimeline as BuyTimeline)) {
        return { ok: false as const, message: "Invalid buying timeline." };
    }
    if (!isValidUrl(listingUrl)) {
        return { ok: false as const, message: "Invalid property link." };
    }

    if (goal === "buy_home" || goal === "first_home") {
        const et = raw.employmentType;
        if (
            et !== "full_time" &&
            et !== "part_time" &&
            et !== "self_employed" &&
            et !== "casual_contractor"
        ) {
            return { ok: false as const, message: "Invalid employment type." };
        }
    }

    if (goal === "first_home") {
        const f = raw.fhbStatus;
        if (f !== "yes" && f !== "unsure") {
            return { ok: false as const, message: "Please indicate first home buyer status." };
        }
    }

    if (goal === "invest") {
        if (typeof raw.ownsProperty !== "boolean") {
            return { ok: false as const, message: "Please indicate if you currently own property." };
        }
        const weeklyRent = parseMoney(String(raw.weeklyRent || ""));
        if (raw.weeklyRent && (weeklyRent < 0 || weeklyRent > 50000)) {
            return { ok: false as const, message: "Invalid weekly rent." };
        }
    }

    const cleanedPurchase: Record<string, string | boolean | null> = {
        propertyPrice: String(propertyPrice),
        deposit: String(deposit),
        annualIncome: String(annualIncome),
        hasSecondApplicant: raw.hasSecondApplicant,
        secondIncome: String(secondIncome),
        monthlyDebts: String(monthlyDebts),
        buyTimeline: buyTimeline,
        listingUrl,
    };

    if (goal === "buy_home" || goal === "first_home") {
        cleanedPurchase.employmentType = raw.employmentType as string;
    }
    if (goal === "first_home") {
        cleanedPurchase.fhbStatus = raw.fhbStatus as string;
    }
    if (goal === "invest") {
        cleanedPurchase.ownsProperty = raw.ownsProperty as boolean;
        if (raw.weeklyRent) {
            cleanedPurchase.weeklyRent = String(parseMoney(String(raw.weeklyRent)));
        }
    }

    return { ok: true as const, cleaned: cleanedPurchase };
}

function validateRefinancePath(raw: RefinancePathInputs) {
    const loanBalance = parseMoney(String(raw.loanBalance || ""));
    const propertyValue = parseMoney(String(raw.propertyValue || ""));
    const interestRate = parseMoney(String(raw.interestRate || ""));
    const currentRepayment = parseMoney(String(raw.currentRepayment || ""));
    const annualIncome = parseMoney(String(raw.annualIncome || ""));
    const monthlyDebts = parseMoney(String(raw.monthlyDebts || ""));

    if (loanBalance < 10000 || loanBalance > 20000000) {
        return { ok: false as const, message: "Invalid loan balance." };
    }
    if (propertyValue < 50000 || propertyValue > 25000000) {
        return { ok: false as const, message: "Invalid property value." };
    }
    if (interestRate <= 0 || interestRate > 20) {
        return { ok: false as const, message: "Invalid interest rate." };
    }
    if (currentRepayment <= 0 || currentRepayment > 50000) {
        return { ok: false as const, message: "Invalid current monthly repayment." };
    }
    if (annualIncome < 20000 || annualIncome > 2000000) {
        return { ok: false as const, message: "Invalid annual household income." };
    }
    if (monthlyDebts < 0 || monthlyDebts > 50000) {
        return { ok: false as const, message: "Invalid monthly debt repayments." };
    }
    if (!REFI_GOALS.includes(raw.refinanceGoal as RefinanceGoal)) {
        return { ok: false as const, message: "Invalid refinance goal." };
    }
    if (!REFI_TIMELINES.includes(raw.refinanceTimeline as RefinanceTimeline)) {
        return { ok: false as const, message: "Invalid refinance timeline." };
    }

    return {
        ok: true as const,
        cleaned: {
            loanBalance: String(loanBalance),
            propertyValue: String(propertyValue),
            interestRate: String(interestRate),
            currentRepayment: String(currentRepayment),
            annualIncome: String(annualIncome),
            monthlyDebts: String(monthlyDebts),
            refinanceGoal: raw.refinanceGoal,
            refinanceTimeline: raw.refinanceTimeline,
        },
    };
}

function validatePayload(body: IncomingPayload) {
    const goal = body.goal;
    if (
        goal !== "buy_home" &&
        goal !== "first_home" &&
        goal !== "invest" &&
        goal !== "refinance"
    ) {
        return { ok: false as const, message: "Invalid goal." };
    }

    if (body.consentAccepted !== true) {
        return { ok: false as const, message: "Consent is required." };
    }

    const fullName = sanitizeText(body.lead?.fullName, 120);
    const email = sanitizeText(body.lead?.email, 200).toLowerCase();
    const phone = sanitizePhone(sanitizeText(body.lead?.phone, 40));

    if (fullName.length < 2) {
        return { ok: false as const, message: "Invalid full name." };
    }
    if (!isValidEmail(email)) {
        return { ok: false as const, message: "Invalid email address." };
    }
    if (!isValidPhone(phone)) {
        return { ok: false as const, message: "Invalid phone number." };
    }

    const rawInputs = body.rawInputs;
    if (!rawInputs || typeof rawInputs !== "object") {
        return { ok: false as const, message: "Missing form inputs." };
    }

    if (goal === "refinance") {
        const v = validateRefinancePath(rawInputs as RefinancePathInputs);
        if (!v.ok) return v;
        return {
            ok: true as const,
            cleaned: {
                goal,
                lead: { fullName, email, phone },
                rawInputs: v.cleaned,
            },
        };
    }

    const v = validatePurchasePath(goal, rawInputs as PurchasePathInputs);
    if (!v.ok) return v;

    return {
        ok: true as const,
        cleaned: {
            goal,
            lead: { fullName, email, phone },
            rawInputs: v.cleaned,
        },
    };
}

async function verifyTurnstileToken(token: string, ip: string) {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return true;

    const formData = new URLSearchParams();
    formData.set("secret", secret);
    formData.set("response", token);
    if (ip && ip !== "unknown") formData.set("remoteip", ip);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: formData.toString(),
                signal: controller.signal,
                cache: "no-store",
            }
        );

        const data = (await res.json().catch(() => null)) as
            | { success?: boolean }
            | null;

        return Boolean(data?.success);
    } finally {
        clearTimeout(timeout);
    }
}

export async function POST(request: NextRequest) {
    console.log("=== MORTGAGE POST HIT ===");
    console.log("origin:", request.headers.get("origin"));

    if (!enforceOrigin(request)) {
        console.log("❌ origin blocked");
        return json({ message: "Forbidden origin." }, 403);
    }

    const ip = getClientIp(request);
    console.log("ip:", ip);

    if (!rateLimit(`mortgage-lead:${ip}`)) {
        console.log("❌ rate limited");
        return json({ message: "Too many attempts. Please wait a few minutes and try again." }, 429);
    }

    let body: IncomingPayload;
    try {
        body = (await request.json()) as IncomingPayload;
    } catch {
        console.log("❌ invalid JSON");
        return json({ message: "Invalid JSON payload." }, 400);
    }

    const honeypot = sanitizeText(body.honeypot, 200);
    if (honeypot) {
        console.log("🍯 honeypot triggered");
        return json({ ok: true });
    }

    const validated = validatePayload(body);
    if (!validated.ok) {
        console.log("❌ validation failed:", validated.message);
        return json({ message: validated.message }, 400);
    }
    console.log("✅ payload validated, goal:", validated.cleaned.goal);

    const turnstileSecretConfigured = Boolean(process.env.TURNSTILE_SECRET_KEY);
    const turnstileToken = sanitizeText(body.metadata?.turnstileToken, 4000);
    console.log("turnstile configured:", turnstileSecretConfigured, "token present:", Boolean(turnstileToken));

    if (turnstileSecretConfigured) {
        if (!turnstileToken) {
            console.log("❌ turnstile token missing");
            return json({ message: "Security check required." }, 400);
        }

        const passed = await verifyTurnstileToken(turnstileToken, ip);
        console.log("turnstile passed:", passed);
        if (!passed) {
            return json({ message: "Security check failed. Please try again." }, 400);
        }
    }

    const webhookUrl = process.env.MORTGAGE_BROKER_DEMO_N8N_WEBHOOK_URL;
    console.log("webhook url:", webhookUrl);
    if (!webhookUrl) {
        console.log("❌ webhook url missing from env");
        return json({ message: "Server is missing MORTGAGE_BROKER_DEMO_N8N_WEBHOOK_URL." }, 500);
    }

    const forwardedPayload = {
        source: sanitizeText(body.source, 80) || "website",
        formType: sanitizeText(body.formType, 80) || "mortgage_lead_magnet",
        previewVersion: sanitizeText(body.previewVersion, 80) || "frontend_preview_v4",
        goal: validated.cleaned.goal,
        rawInputs: validated.cleaned.rawInputs,
        lead: validated.cleaned.lead,
        consentAccepted: true,
        previewEstimate: body.previewEstimate ?? null,
        fullResult: body.fullResult ?? null,
        metadata: {
            pagePath: sanitizeText(body.metadata?.pagePath, 300),
            clientUserAgent: sanitizeText(body.metadata?.userAgent, 500),
            submittedAtClient: sanitizeText(body.metadata?.submittedAtClient, 80),
            receivedAtServer: new Date().toISOString(),
            ip,
            serverRoute: "/api/mortgage-broker-demo",
        },
    };

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    if (process.env.MORTGAGE_WEBHOOK_SHARED_SECRET) {
        headers["x-webhook-secret"] = process.env.MORTGAGE_WEBHOOK_SHARED_SECRET;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
        console.log("📤 sending to n8n...");
        const webhookRes = await fetch(webhookUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(forwardedPayload),
            signal: controller.signal,
            cache: "no-store",
        });

        const responseText = await webhookRes.text();
        console.log("n8n status:", webhookRes.status);
        console.log("n8n response:", responseText);

        if (!webhookRes.ok) {
            console.error("❌ n8n webhook failed:", webhookRes.status, responseText);
            return json({ message: "We couldn't send your details right now. Please try again." }, 502);
        }

        console.log("✅ success");
        return json({ ok: true });
    } catch (error) {
        console.error("❌ fetch error:", error);
        return json({ message: "We couldn't send your details right now. Please try again." }, 500);
    } finally {
        clearTimeout(timeout);
    }
}