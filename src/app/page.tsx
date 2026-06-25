"use client";

import {
    ChangeEvent,
    FormEvent,
    ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { usePathname } from "next/navigation";

import styles from "./mortgage-lead.module.css";

function cx(...parts: Array<string | false | undefined | null>) {
    return parts.filter(Boolean).join(" ");
}

/** Four paths — first-home is separate from other owner-occupiers */
type Goal = "buy_home" | "first_home" | "invest" | "refinance";

type EmploymentType =
    | "full_time"
    | "part_time"
    | "self_employed"
    | "casual_contractor";

type BuyTimeline = "asap" | "1_3" | "3_6" | "6plus";

type RefinanceGoal =
    | "lower_repayments"
    | "better_rate"
    | "access_equity"
    | "consolidate_debt";

type RefinanceTimeline = "asap" | "1_3" | "3plus";

type PurchaseDetails = {
    propertyPrice: string;
    deposit: string;
    annualIncome: string;
    hasSecondApplicant: boolean | null;
    secondIncome: string;
    monthlyDebts: string;
    employmentType: EmploymentType | "";
    buyTimeline: BuyTimeline | "";
    listingUrl: string;
    /** first_home only */
    fhbStatus: "yes" | "unsure" | null;
    /** invest only */
    ownsProperty: boolean | null;
    /** invest optional */
    weeklyRent: string;
};

type RefinanceDetails = {
    loanBalance: string;
    propertyValue: string;
    interestRate: string;
    currentRepayment: string;
    annualIncome: string;
    monthlyDebts: string;
    refinanceGoal: RefinanceGoal | "";
    refinanceTimeline: RefinanceTimeline | "";
};

type LeadDetails = {
    fullName: string;
    email: string;
    phone: string;
};

type SubmitStatus =
    | { type: "idle" }
    | { type: "loading" }
    | { type: "success" }
    | { type: "error"; message: string };

type FieldErrors = Record<string, string>;

type AffordabilityBand = "achievable" | "close" | "difficult";

type PurchaseEstimate = {
    kind: "purchase";
    borrowingLow: number;
    borrowingHigh: number;
    repaymentMid: number;
    repaymentLow: number;
    repaymentHigh: number;
    propertyPrice: number;
    deposit: number;
    affordability: AffordabilityBand;
    bestCaseShortfall: number;
    teaserLine: string;
};

type RefinanceEstimate = {
    kind: "refinance";
    currentRepaymentEstimate: number;
    improvedRepaymentLow: number;
    improvedRepaymentHigh: number;
    savingsLow: number;
    savingsHigh: number;
    lvr: number | null;
    worthwhile: "likely" | "maybe" | "unclear";
    remainingYears: number;
    teaserLine: string;
};

type PreviewEstimate = PurchaseEstimate | RefinanceEstimate | null;

type FullPurchaseResult = {
    kind: "purchase";
    headline: string;
    strengths: string[];
    watchouts: string[];
    nextSteps: string[];
};

type FullRefinanceResult = {
    kind: "refinance";
    headline: string;
    strengths: string[];
    watchouts: string[];
    nextSteps: string[];
};

type FullResult = FullPurchaseResult | FullRefinanceResult;

declare global {
    interface Window {
        gtag?: (...args: unknown[]) => void;
        posthog?: {
            capture?: (event: string, properties?: Record<string, unknown>) => void;
        };
        turnstile?: {
            render: (
                element: HTMLElement,
                options: {
                    sitekey: string;
                    callback: (token: string) => void;
                    "expired-callback"?: () => void;
                    "error-callback"?: () => void;
                    theme?: "light" | "dark";
                }
            ) => string;
            remove?: (widgetId: string) => void;
        };
    }
}

const STORAGE_KEY_PREFIX = "mortgage-lead-ui-v4";
const PREVIEW_VERSION = "frontend_preview_v4";
const EMBED_MESSAGE_NAMESPACE = "mortgage-lead-magnet";
const MIN_EMBED_HEIGHT = 420;
const MAX_EMBED_HEIGHT = 5000;
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const BROKER_NAME =
    process.env.NEXT_PUBLIC_MORTGAGE_BROKER_NAME || "the broker";
const BOOKING_URL =
    process.env.NEXT_PUBLIC_MORTGAGE_BROKER_BOOKING_URL || "#contact";

const DEFAULT_PURCHASE: PurchaseDetails = {
    propertyPrice: "",
    deposit: "",
    annualIncome: "",
    hasSecondApplicant: null,
    secondIncome: "",
    monthlyDebts: "",
    employmentType: "",
    buyTimeline: "",
    listingUrl: "",
    fhbStatus: null,
    ownsProperty: null,
    weeklyRent: "",
};

const DEFAULT_REFI: RefinanceDetails = {
    loanBalance: "",
    propertyValue: "",
    interestRate: "",
    currentRepayment: "",
    annualIncome: "",
    monthlyDebts: "",
    refinanceGoal: "",
    refinanceTimeline: "",
};

const DEFAULT_LEAD: LeadDetails = {
    fullName: "",
    email: "",
    phone: "",
};

function clamp(n: number, min: number, max: number) {
    return Math.min(Math.max(n, min), max);
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

/**
 * Live AUD-style display while typing: $1 234 567 or $1 234.56
 * (parseMoney still works — it strips non-numeric chars except one ".")
 */
function formatMoneyInputDisplay(raw: string): string {
    const s = normalizeNumericInput(raw.replace(/[^\d.]/g, ""));
    if (!s) return "";

    const dotIdx = s.indexOf(".");
    const hasDot = dotIdx !== -1;
    const intStr = hasDot ? s.slice(0, dotIdx) : s;
    const fracStr = hasDot
        ? s.slice(dotIdx + 1).replace(/\D/g, "").slice(0, 2)
        : "";

    const intDigits = intStr.replace(/\D/g, "");
    if (!intDigits && !hasDot) return "";

    const intGrouped =
        intDigits === ""
            ? "0"
            : intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

    if (!hasDot) {
        return `$${intGrouped}`;
    }

    // Preserve "123." while user is typing the decimal part
    const afterDot = s.slice(dotIdx + 1);
    const trailingDotOnly =
        fracStr === "" && afterDot === "" && s.endsWith(".");

    if (trailingDotOnly) {
        return `$${intGrouped}.`;
    }
    return `$${intGrouped}.${fracStr}`;
}

function countDigitsBeforeCursor(value: string, cursor: number): number {
    let n = 0;
    const end = Math.min(cursor, value.length);
    for (let i = 0; i < end; i++) {
        if (/\d/.test(value[i])) n += 1;
    }
    return n;
}

function caretIndexAfterFormat(formatted: string, digitsBefore: number): number {
    if (digitsBefore <= 0) {
        return formatted.startsWith("$") ? 1 : 0;
    }
    let seen = 0;
    for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) {
            seen += 1;
            if (seen >= digitsBefore) {
                return i + 1;
            }
        }
    }
    return formatted.length;
}

function applyMoneyInputChange(
    e: ChangeEvent<HTMLInputElement>,
    setFormatted: (value: string) => void
): void {
    const el = e.target;
    const raw = el.value;
    const start = el.selectionStart ?? raw.length;
    const digitsBefore = countDigitsBeforeCursor(raw, start);

    const formatted = formatMoneyInputDisplay(raw);
    setFormatted(formatted);

    queueMicrotask(() => {
        const pos = caretIndexAfterFormat(formatted, digitsBefore);
        try {
            el.setSelectionRange(pos, pos);
        } catch {
            /* ignore */
        }
    });
}

function parseDigits(input: string): string {
    return input.replace(/\D/g, "");
}

function calcMonthlyPayment(
    principal: number,
    annualRateDecimal: number,
    years: number
): number {
    if (principal <= 0 || years <= 0) return 0;

    const monthlyRate = annualRateDecimal / 12;
    const totalMonths = years * 12;

    if (monthlyRate <= 0) return principal / totalMonths;

    const numerator =
        principal * monthlyRate * Math.pow(1 + monthlyRate, totalMonths);
    const denominator = Math.pow(1 + monthlyRate, totalMonths) - 1;

    if (!denominator) return 0;
    return numerator / denominator;
}

function fmtAUD(value: number): string {
    return new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0,
    }).format(Math.max(0, value));
}

function fmtRange(low: number, high: number): string {
    return `${fmtAUD(low)} – ${fmtAUD(high)}`;
}

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
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

function sanitizePhone(phone: string): string {
    return phone.replace(/[^\d+ ]/g, "").replace(/\s+/g, " ").trim();
}

function isValidPhone(phone: string): boolean {
    const digits = parseDigits(phone);
    return digits.length >= 8 && digits.length <= 15;
}

function track(event: string, props?: Record<string, unknown>) {
    if (typeof window === "undefined") return;
    window.gtag?.("event", event, props || {});
    window.posthog?.capture?.(event, props || {});
}

function employmentFactor(type: EmploymentType | ""): number {
    switch (type) {
        case "full_time":
            return 1;
        case "part_time":
            return 0.94;
        case "self_employed":
            return 0.9;
        case "casual_contractor":
            return 0.9;
        default:
            return 0.94;
    }
}

/** Investment path: slightly more conservative serviceability assumption */
const INVEST_INCOME_FACTOR = 0.93;

function computePurchaseEstimate(
    input: PurchaseDetails,
    goal: "buy_home" | "first_home" | "invest"
): PurchaseEstimate {
    const propertyPrice = parseMoney(input.propertyPrice);
    const deposit = parseMoney(input.deposit);
    const annualIncome = parseMoney(input.annualIncome);
    const secondIncome = input.hasSecondApplicant
        ? parseMoney(input.secondIncome)
        : 0;
    const monthlyDebts = parseMoney(input.monthlyDebts);
    const weeklyRent = parseMoney(input.weeklyRent);
    const rentBoostAnnual = goal === "invest" && weeklyRent > 0 ? weeklyRent * 52 * 0.75 : 0;

    const totalIncome = annualIncome + secondIncome + rentBoostAnnual;

    const empFactor =
        goal === "invest" ? INVEST_INCOME_FACTOR : employmentFactor(input.employmentType);
    const annualDebtPenalty = monthlyDebts * 12 * 6;

    const rawLow = totalIncome * 3.7 * empFactor - annualDebtPenalty;
    const rawHigh = totalIncome * 4.5 * empFactor - annualDebtPenalty;

    const borrowingLow = Math.max(0, rawLow);
    const borrowingHigh = Math.max(borrowingLow, rawHigh);

    const budgetLow = borrowingLow + deposit;
    const budgetHigh = borrowingHigh + deposit;

    const repaymentLow = calcMonthlyPayment(borrowingLow, 0.064, 30);
    const repaymentHigh = calcMonthlyPayment(borrowingHigh, 0.074, 30);
    const repaymentMid = (repaymentLow + repaymentHigh) / 2;

    let affordability: AffordabilityBand = "difficult";
    if (propertyPrice > 0 && budgetLow >= propertyPrice) affordability = "achievable";
    else if (propertyPrice > 0 && budgetHigh >= propertyPrice) affordability = "close";

    const bestCaseShortfall =
        propertyPrice > 0 ? Math.max(propertyPrice - budgetHigh, 0) : 0;

    let teaserLine =
        "You may be close, but your deposit, debts, and overall setup could still affect the outcome.";
    if (affordability === "achievable") {
        teaserLine =
            "At first glance, this property may be within reach — but things like deposit, debts, and lender rules still matter.";
    } else if (affordability === "close") {
        teaserLine =
            "You may be close, but your deposit and existing debts could affect lender confidence.";
    } else {
        teaserLine =
            "At this price, things may be a bit tight right now — but a bigger deposit, less debt, or a lower price point could help.";
    }

    return {
        kind: "purchase",
        borrowingLow,
        borrowingHigh,
        repaymentMid,
        repaymentLow,
        repaymentHigh,
        propertyPrice,
        deposit,
        affordability,
        bestCaseShortfall,
        teaserLine,
    };
}

function deriveRemainingYearsFromPayment(
    balance: number,
    annualRatePercent: number,
    monthlyPayment: number
): number {
    if (balance <= 0 || monthlyPayment <= 0) return 25;
    const r = annualRatePercent / 100 / 12;
    if (r <= 0) return 25;
    const minPay = balance * r;
    if (monthlyPayment <= minPay) return 25;
    const inner = 1 - (balance * r) / monthlyPayment;
    if (inner <= 0 || inner >= 1) return 25;
    const months = -Math.log(inner) / Math.log(1 + r);
    const years = months / 12;
    return clamp(years, 1, 30);
}

function computeRefinanceEstimate(input: RefinanceDetails): RefinanceEstimate {
    const loanBalance = parseMoney(input.loanBalance);
    const rate = parseMoney(input.interestRate);
    const propertyValue = parseMoney(input.propertyValue);
    const currentRepaymentEstimate = parseMoney(input.currentRepayment);

    const remainingYears = deriveRemainingYearsFromPayment(
        loanBalance,
        rate,
        currentRepaymentEstimate
    );

    const improvedRateLow = Math.max(rate - 1.0, 4.99) / 100;
    const improvedRateHigh = Math.max(rate - 0.4, 5.49) / 100;

    const improvedRepaymentLow = calcMonthlyPayment(
        loanBalance,
        improvedRateLow,
        remainingYears
    );
    const improvedRepaymentHigh = calcMonthlyPayment(
        loanBalance,
        improvedRateHigh,
        remainingYears
    );

    const savingsLow = Math.max(currentRepaymentEstimate - improvedRepaymentHigh, 0);
    const savingsHigh = Math.max(currentRepaymentEstimate - improvedRepaymentLow, 0);

    const lvr = propertyValue > 0 ? (loanBalance / propertyValue) * 100 : null;

    let worthwhile: RefinanceEstimate["worthwhile"] = "unclear";
    if (savingsHigh >= 250) worthwhile = "likely";
    else if (savingsHigh >= 80) worthwhile = "maybe";

    let teaserLine =
        "There may be room to improve your current loan, but the result depends on your equity and current rate.";
    if (worthwhile === "likely") {
        teaserLine =
            "There may be meaningful monthly savings on the table — worth a proper comparison.";
    } else if (worthwhile === "maybe") {
        teaserLine =
            "There may be room to improve your current loan, but the result depends on your equity and current rate.";
    }

    return {
        kind: "refinance",
        currentRepaymentEstimate,
        improvedRepaymentLow,
        improvedRepaymentHigh,
        savingsLow,
        savingsHigh,
        lvr,
        worthwhile,
        remainingYears,
        teaserLine,
    };
}

function buildFullPurchaseResult(
    goal: "buy_home" | "first_home" | "invest",
    input: PurchaseDetails,
    est: PurchaseEstimate
): FullPurchaseResult {
    const deposit = est.deposit;
    const price = est.propertyPrice;
    const depositPct = price > 0 ? (deposit / price) * 100 : 0;
    const totalInc =
        parseMoney(input.annualIncome) +
        (input.hasSecondApplicant ? parseMoney(input.secondIncome) : 0);

    const strengths: string[] = [];
    const watchouts: string[] = [];
    const nextSteps: string[] = [];

    if (totalInc >= 80000) strengths.push("Strong household income relative to many scenarios.");
    if (depositPct >= 15 && price > 0) strengths.push("Good deposit relative to the price entered.");
    if (parseMoney(input.monthlyDebts) < totalInc / 12 / 8)
        strengths.push("Existing debts appear manageable at a headline level.");
    if (
        input.buyTimeline === "asap" ||
        input.buyTimeline === "1_3"
    ) {
        strengths.push("Buying timeline looks clear, which helps with next steps.");
    }
    if (!strengths.length) {
        strengths.push("You’ve provided enough detail for a useful first-pass view.");
    }

    if (depositPct > 0 && depositPct < 10 && price > 0) {
        watchouts.push("Deposit may be slightly thin for this price point.");
    }
    if (parseMoney(input.monthlyDebts) > 0) {
        watchouts.push("Existing debt commitments may reduce borrowing power.");
    }
    if (
        goal !== "invest" &&
        (input.employmentType === "self_employed" ||
            input.employmentType === "casual_contractor")
    ) {
        watchouts.push("Self-employed or non‑PAYG income may require more lender assessment.");
    }
    if (est.affordability === "close" || est.affordability === "difficult") {
        watchouts.push("Rate sensitivity may affect affordability at the upper end of your range.");
    }

    nextSteps.push("Increase deposit to improve borrowing comfort where possible.");
    nextSteps.push("Reduce existing debt to strengthen serviceability if you can.");
    if (est.affordability === "difficult") {
        nextSteps.push("Review price range slightly lower for stronger approval odds.");
    }
    nextSteps.push(`Speak to ${BROKER_NAME} to identify lenders likely to suit your scenario.`);

    let headline = "You may be close, but there are a few issues to improve";
    if (est.affordability === "achievable") {
        headline = "This property looks realistically within reach";
    } else if (est.affordability === "difficult") {
        headline = "This purchase may be difficult right now without changes";
    }

    return {
        kind: "purchase",
        headline,
        strengths: strengths.slice(0, 5),
        watchouts: watchouts.slice(0, 5),
        nextSteps: nextSteps.slice(0, 5),
    };
}

function buildFullRefinanceResult(
    input: RefinanceDetails,
    est: RefinanceEstimate
): FullRefinanceResult {
    const strengths: string[] = [];
    const watchouts: string[] = [];
    const nextSteps: string[] = [];

    if (est.savingsHigh >= 150) {
        strengths.push("There may be a meaningful gap between your current rate and market options.");
    }
    if (est.lvr !== null && est.lvr <= 80) {
        strengths.push("Equity position may support a wider set of refinance options.");
    }
    if (parseMoney(input.monthlyDebts) === 0) {
        strengths.push("Household debt commitments outside the home loan look contained.");
    }
    if (!strengths.length) {
        strengths.push("Your numbers are clear enough to compare options with a broker.");
    }

    if (est.lvr !== null && est.lvr > 85) {
        watchouts.push("Higher LVR can limit lender choice and pricing.");
    }
    if (est.worthwhile === "unclear") {
        watchouts.push("Savings after fees may be modest — a full cost comparison matters.");
    }

    nextSteps.push("Review your current rate against current lending options.");
    nextSteps.push("Check whether equity access is possible if that is your goal.");
    nextSteps.push("Assess whether refinancing costs are justified by potential savings.");

    let headline = "There could be a refinancing opportunity worth reviewing";
    if (est.worthwhile === "likely") {
        headline = "You may be in a position to improve your current loan";
    }

    return {
        kind: "refinance",
        headline,
        strengths: strengths.slice(0, 5),
        watchouts: watchouts.slice(0, 5),
        nextSteps: nextSteps.slice(0, 5),
    };
}

function validatePurchaseDetails(
    data: PurchaseDetails,
    path: "buy_home" | "first_home" | "invest"
): FieldErrors {
    const nextErrors: FieldErrors = {};
    const propertyPrice = parseMoney(data.propertyPrice);
    const deposit = parseMoney(data.deposit);
    const annualIncome = parseMoney(data.annualIncome);
    const secondIncome = parseMoney(data.secondIncome);
    const monthlyDebts = parseMoney(data.monthlyDebts);

    if (propertyPrice < 100000 || propertyPrice > 20000000) {
        nextErrors.propertyPrice = "Enter a realistic property price.";
    }
    if (deposit < 5000 || deposit > 10000000) {
        nextErrors.deposit = "Enter a realistic deposit amount.";
    }
    if (annualIncome < 20000 || annualIncome > 2000000) {
        nextErrors.annualIncome = "Enter a realistic annual income.";
    }
    if (data.hasSecondApplicant === null) {
        nextErrors.hasSecondApplicant = "Please indicate if there is a second applicant.";
    }
    if (data.hasSecondApplicant === true) {
        if (secondIncome < 1000 || secondIncome > 2000000) {
            nextErrors.secondIncome = "Enter the second applicant’s annual income.";
        }
    }
    if (monthlyDebts < 0 || monthlyDebts > 50000) {
        nextErrors.monthlyDebts = "Enter a realistic monthly debt figure.";
    }
    if (path === "buy_home" || path === "first_home") {
        if (!data.employmentType) {
            nextErrors.employmentType = "Choose your employment type.";
        }
    }
    if (path === "first_home") {
        if (data.fhbStatus !== "yes" && data.fhbStatus !== "unsure") {
            nextErrors.fhbStatus = "Please select an option.";
        }
    }
    if (path === "invest") {
        if (data.ownsProperty !== true && data.ownsProperty !== false) {
            nextErrors.ownsProperty = "Please indicate if you currently own property.";
        }
        const wr = data.weeklyRent.trim();
        if (wr && (parseMoney(wr) < 0 || parseMoney(wr) > 50000)) {
            nextErrors.weeklyRent = "Enter a realistic weekly rent, or leave blank.";
        }
    }
    if (!data.buyTimeline) {
        nextErrors.buyTimeline = "Choose when you’re looking to buy.";
    }
    if (!isValidUrl(data.listingUrl)) {
        nextErrors.listingUrl = "Enter a valid http(s) link, or leave blank.";
    }

    return nextErrors;
}

function validateRefinanceDetails(data: RefinanceDetails): FieldErrors {
    const nextErrors: FieldErrors = {};
    const loanBalance = parseMoney(data.loanBalance);
    const interestRate = parseMoney(data.interestRate);
    const propertyValue = parseMoney(data.propertyValue);
    const currentRepayment = parseMoney(data.currentRepayment);
    const annualIncome = parseMoney(data.annualIncome);
    const monthlyDebts = parseMoney(data.monthlyDebts);

    if (loanBalance < 10000 || loanBalance > 20000000) {
        nextErrors.loanBalance = "Enter a realistic loan balance.";
    }
    if (interestRate <= 0 || interestRate > 20) {
        nextErrors.interestRate = "Enter a realistic interest rate.";
    }
    if (propertyValue < 50000 || propertyValue > 25000000) {
        nextErrors.propertyValue = "Enter a realistic property value.";
    }
    if (currentRepayment <= 0 || currentRepayment > 50000) {
        nextErrors.currentRepayment = "Enter your current monthly repayment.";
    }
    if (annualIncome < 20000 || annualIncome > 2000000) {
        nextErrors.annualIncome = "Enter a realistic annual household income.";
    }
    if (monthlyDebts < 0 || monthlyDebts > 50000) {
        nextErrors.monthlyDebts = "Enter a realistic monthly debt figure.";
    }
    if (!data.refinanceGoal) {
        nextErrors.refinanceGoal = "Choose your goal.";
    }
    if (!data.refinanceTimeline) {
        nextErrors.refinanceTimeline = "Choose your timeline.";
    }

    return nextErrors;
}

function canRestoreToStep(goal: Goal | null, purchase: PurchaseDetails, refi: RefinanceDetails) {
    if (!goal) return 1;
    if (goal === "buy_home") {
        return Object.keys(validatePurchaseDetails(purchase, "buy_home")).length === 0 ? 3 : 2;
    }
    if (goal === "first_home") {
        return Object.keys(validatePurchaseDetails(purchase, "first_home")).length === 0 ? 3 : 2;
    }
    if (goal === "invest") {
        return Object.keys(validatePurchaseDetails(purchase, "invest")).length === 0 ? 3 : 2;
    }
    return Object.keys(validateRefinanceDetails(refi)).length === 0 ? 3 : 2;
}

function ProgressBar({ step, total }: { step: number; total: number }) {
    const pct = Math.min(100, Math.round((step / total) * 100));
    return (
        <div className={styles.progressWrap} aria-hidden="true">
            <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.progressLabel}>
                Step {step} of {total}
            </span>
        </div>
    );
}

function BackButton({ onClick }: { onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className={styles.back}>
            ← Back
        </button>
    );
}

function TransitionLoadingScreen({
    kind,
    onCancel,
}: {
    kind: "estimate" | "contact";
    onCancel: () => void;
}) {
    const title =
        kind === "estimate" ? "Preparing your estimate" : "Almost there";
    const sub =
        kind === "estimate"
            ? "Crunching the numbers based on your details."
            : "Getting your personalised breakdown ready.";

    return (
        <div className={styles.transitionRoot}>
            <BackButton onClick={onCancel} />
            <div className={styles.transitionBody}>
                <div className={styles.transitionSpinner} aria-hidden />
                <h2 className={styles.transitionTitle}>{title}</h2>
                <p className={styles.transitionSub}>{sub}</p>
                <div className={styles.transitionDots} aria-hidden>
                    <span />
                    <span />
                    <span />
                </div>
            </div>
        </div>
    );
}

function TrustRow() {
    const items = [
        "Takes less than 60 seconds",
        "No impact on your credit score",
        "Your details stay secure",
    ];

    return (
        <div className={styles.trust}>
            {items.map((item) => (
                <span key={item}>{item}</span>
            ))}
        </div>
    );
}

function GoalPathCard({
    selected,
    icon,
    title,
    description,
    onClick,
}: {
    selected: boolean;
    icon: string;
    title: string;
    description: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cx(styles.pathCard, selected && styles.pathCardSelected)}
            aria-pressed={selected}
        >
            <div className={styles.pathRow}>
                <span className={styles.pathIcon} aria-hidden>
                    {icon}
                </span>
                <span className={styles.pathTitle}>{title}</span>
                <span
                    className={cx(styles.pathCheck, selected && styles.pathCheckVisible)}
                    aria-hidden
                >
                    ✓
                </span>
            </div>
            <p className={styles.pathDesc}>{description}</p>
        </button>
    );
}

function StatCard({
    label,
    value,
    sub,
    emphasized = false,
}: {
    label: string;
    value: string;
    sub?: string;
    emphasized?: boolean;
}) {
    return (
        <div className={styles.stat}>
            <div className={styles.statLabel}>{label}</div>
            <div
                className={cx(styles.statValue, emphasized && styles.statValueLg)}
            >
                {value}
            </div>
            {sub ? <div className={styles.statSub}>{sub}</div> : null}
        </div>
    );
}

function Notice({
    tone,
    children,
}: {
    tone: "neutral" | "success" | "warning";
    children: ReactNode;
}) {
    const toneClass =
        tone === "success"
            ? styles.noticeSuccess
            : tone === "warning"
                ? styles.noticeWarning
                : "";

    return <div className={cx(styles.notice, toneClass)}>{children}</div>;
}

function FieldError({
    id,
    children,
}: {
    id: string;
    children?: ReactNode;
}) {
    if (!children) return null;
    return (
        <div id={id} className={styles.fieldError}>
            {children}
        </div>
    );
}

function TurnstileWidget({
    siteKey,
    onToken,
    onExpired,
}: {
    siteKey: string;
    onToken: (token: string) => void;
    onExpired: () => void;
}) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!siteKey || !containerRef.current) return;

        let cancelled = false;

        const cleanup = () => {
            if (widgetIdRef.current && window.turnstile?.remove) {
                window.turnstile.remove(widgetIdRef.current);
                widgetIdRef.current = null;
            }
        };

        const renderWidget = () => {
            if (cancelled || !containerRef.current || !window.turnstile) return;
            cleanup();
            containerRef.current.innerHTML = "";
            widgetIdRef.current = window.turnstile.render(containerRef.current, {
                sitekey: siteKey,
                callback: (token: string) => onToken(token),
                "expired-callback": onExpired,
                "error-callback": onExpired,
                theme: "light",
            });
        };

        if (window.turnstile) {
            renderWidget();
            return () => {
                cancelled = true;
                cleanup();
            };
        }

        const existing = document.querySelector<HTMLScriptElement>(
            'script[src*="challenges.cloudflare.com/turnstile"]'
        );

        if (existing) {
            existing.addEventListener("load", renderWidget, { once: true });
            return () => {
                cancelled = true;
                cleanup();
            };
        }

        const script = document.createElement("script");
        script.src =
            "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = renderWidget;
        document.head.appendChild(script);

        return () => {
            cancelled = true;
            cleanup();
        };
    }, [siteKey, onExpired, onToken]);

    if (!siteKey) return null;
    return <div ref={containerRef} className={styles.turnstile} />;
}


function postEmbedMessage(payload: Record<string, unknown>) {
    if (typeof window === "undefined") return;
    if (window.parent === window) return;

    window.parent.postMessage(
        {
            namespace: EMBED_MESSAGE_NAMESPACE,
            ...payload,
        },
        "*"
    );
}

function requestParentScrollToTop() {
    postEmbedMessage({
        type: "scroll-to-top",
    });
}

function useIframeAutoResize() {
    const lastHeightRef = useRef(0);
    const rafRef = useRef<number | null>(null);

    const sendHeight = useCallback(() => {
        if (typeof window === "undefined") return;
        if (window.parent === window) return;

        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;

            const height = Math.ceil(
                Math.max(
                    document.body.scrollHeight,
                    document.body.offsetHeight,
                    document.documentElement.clientHeight,
                    document.documentElement.scrollHeight,
                    document.documentElement.offsetHeight,
                    MIN_EMBED_HEIGHT
                )
            );

            const safeHeight = Math.min(height, MAX_EMBED_HEIGHT);

            if (Math.abs(safeHeight - lastHeightRef.current) < 2) return;

            lastHeightRef.current = safeHeight;

            postEmbedMessage({
                type: "resize",
                height: safeHeight,
            });
        });
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.parent === window) return;

        const resizeObserver =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver(sendHeight)
                : null;

        resizeObserver?.observe(document.documentElement);
        resizeObserver?.observe(document.body);

        const mutationObserver =
            typeof MutationObserver !== "undefined"
                ? new MutationObserver(sendHeight)
                : null;

        mutationObserver?.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
        });

        window.addEventListener("load", sendHeight);
        window.addEventListener("resize", sendHeight);

        sendHeight();

        const fallback = window.setInterval(sendHeight, 1000);

        return () => {
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
            window.removeEventListener("load", sendHeight);
            window.removeEventListener("resize", sendHeight);
            window.clearInterval(fallback);

            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, [sendHeight]);

    return sendHeight;
}

export default function MortgageLeadMagnetPage() {
    const pathname = usePathname();
    const storageKey = useMemo(() => {
        return `${STORAGE_KEY_PREFIX}:${pathname || "default"}`;
    }, [pathname]);

    const topRef = useRef<HTMLDivElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);

    const [step, setStep] = useState(1);
    const [goal, setGoal] = useState<Goal | null>(null);

    const [purchase, setPurchase] = useState<PurchaseDetails>(DEFAULT_PURCHASE);
    const [refi, setRefi] = useState<RefinanceDetails>(DEFAULT_REFI);
    const [lead, setLead] = useState<LeadDetails>(DEFAULT_LEAD);

    const [honeypot, setHoneypot] = useState("");
    const [submitStatus, setSubmitStatus] = useState<SubmitStatus>({ type: "idle" });
    const [errors, setErrors] = useState<FieldErrors>({});
    const [turnstileToken, setTurnstileToken] = useState("");
    const [consentAccepted, setConsentAccepted] = useState(false);
    const [resultBundle, setResultBundle] = useState<{
        lead: LeadDetails;
        full: FullResult;
        estimate: PreviewEstimate;
        /** Snapshot so step 5 doesn’t depend on form state */
        refiLoanBalance?: number;
    } | null>(null);

    const [stepTransition, setStepTransition] = useState<
        "idle" | "estimate" | "contact"
    >("idle");
    const transitionTimerRef = useRef<number | null>(null);

    const sendEmbedHeight = useIframeAutoResize();

    useEffect(() => {
        sendEmbedHeight();
    }, [
        sendEmbedHeight,
        step,
        stepTransition,
        submitStatus.type,
        errors,
        resultBundle,
        goal,
        purchase.hasSecondApplicant,
        purchase.ownsProperty,
    ]);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(storageKey);
            if (!raw) return;

            const parsed = JSON.parse(raw) as {
                step?: number;
                goal?: Goal | null;
                purchase?: Partial<PurchaseDetails>;
                refi?: Partial<RefinanceDetails>;
            };

            const restoredGoal =
                parsed.goal === "buy_home" ||
                    parsed.goal === "first_home" ||
                    parsed.goal === "invest" ||
                    parsed.goal === "refinance"
                    ? parsed.goal
                    : null;

            const restoredPurchase = { ...DEFAULT_PURCHASE, ...(parsed.purchase || {}) };
            const restoredRefi = { ...DEFAULT_REFI, ...(parsed.refi || {}) };
            const maxRestorableStep = canRestoreToStep(
                restoredGoal,
                restoredPurchase,
                restoredRefi
            );

            setGoal(restoredGoal);
            setPurchase({
                ...restoredPurchase,
                propertyPrice: formatMoneyInputDisplay(restoredPurchase.propertyPrice),
                deposit: formatMoneyInputDisplay(restoredPurchase.deposit),
                annualIncome: formatMoneyInputDisplay(restoredPurchase.annualIncome),
                secondIncome: formatMoneyInputDisplay(restoredPurchase.secondIncome),
                monthlyDebts: formatMoneyInputDisplay(restoredPurchase.monthlyDebts),
            });
            setRefi({
                ...restoredRefi,
                loanBalance: formatMoneyInputDisplay(restoredRefi.loanBalance),
                propertyValue: formatMoneyInputDisplay(restoredRefi.propertyValue),
                currentRepayment: formatMoneyInputDisplay(restoredRefi.currentRepayment),
            });

            if (parsed.step && parsed.step >= 1) {
                setStep(Math.min(parsed.step, maxRestorableStep));
            }
        } catch {
            // ignore bad storage
        }
    }, [storageKey]);

    useEffect(() => {
        try {
            if (step >= 5) {
                sessionStorage.removeItem(storageKey);
                return;
            }
            sessionStorage.setItem(
                storageKey,
                JSON.stringify({
                    step: Math.min(step, 3),
                    goal,
                    purchase,
                    refi,
                })
            );
        } catch {
            // ignore storage errors
        }
    }, [step, goal, purchase, refi, storageKey]);

    useEffect(() => {
        track("mortgage_lead_step_view", { step, goal });
    }, [step, goal]);

    useEffect(() => {
        headingRef.current?.focus();
    }, [step]);

    const previewEstimate: PreviewEstimate = useMemo(() => {
        if (!goal) return null;
        if (goal === "buy_home") return computePurchaseEstimate(purchase, "buy_home");
        if (goal === "first_home") return computePurchaseEstimate(purchase, "first_home");
        if (goal === "invest") return computePurchaseEstimate(purchase, "invest");
        return computeRefinanceEstimate(refi);
    }, [goal, purchase, refi]);

    /** Midpoint of estimated monthly savings range — same basis as StatCard range on step 3 */
    const refinanceMonthlyOverpayMid = useMemo(() => {
        if (!previewEstimate || previewEstimate.kind !== "refinance") return null;
        const { savingsLow, savingsHigh } = previewEstimate;
        return Math.round((savingsLow + savingsHigh) / 2);
    }, [previewEstimate]);

    const handleTurnstileToken = useCallback((token: string) => {
        setTurnstileToken(token);
        setErrors((prev) => {
            if (!prev.turnstile) return prev;
            const next = { ...prev };
            delete next.turnstile;
            return next;
        });
    }, []);

    const handleTurnstileExpired = useCallback(() => {
        setTurnstileToken("");
    }, []);

    const scrollTopSoft = useCallback(() => {
        window.setTimeout(() => {
            topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            requestParentScrollToTop();
        }, 40);
    }, []);

    const clearTransitionTimer = useCallback(() => {
        if (transitionTimerRef.current !== null) {
            clearTimeout(transitionTimerRef.current);
            transitionTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => clearTransitionTimer(), [clearTransitionTimer]);

    const handleCancelTransition = useCallback(() => {
        clearTransitionTimer();
        setStepTransition("idle");
        scrollTopSoft();
    }, [clearTransitionTimer, scrollTopSoft]);

    function nextStep() {
        setStep((s) => Math.min(s + 1, 5));
        scrollTopSoft();
    }

    function prevStep() {
        setSubmitStatus({ type: "idle" });
        if (stepTransition !== "idle") {
            clearTransitionTimer();
            setStepTransition("idle");
            scrollTopSoft();
            return;
        }
        setStep((s) => {
            const next = Math.max(s - 1, 1);
            if (next <= 2) setResultBundle(null);
            return next;
        });
        scrollTopSoft();
    }

    function clearFieldError(name: string) {
        setErrors((prev) => {
            if (!prev[name]) return prev;
            const next = { ...prev };
            delete next[name];
            return next;
        });
    }

    function validateStep1(): boolean {
        const nextErrors: FieldErrors = {};
        if (!goal) nextErrors.goal = "Please choose what you're trying to do.";
        setErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    }

    function validateStep2(): boolean {
        if (!goal) {
            setErrors({});
            return false;
        }
        const nextErrors =
            goal === "refinance"
                ? validateRefinanceDetails(refi)
                : validatePurchaseDetails(
                    purchase,
                    goal === "buy_home"
                        ? "buy_home"
                        : goal === "first_home"
                            ? "first_home"
                            : "invest"
                );

        setErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    }

    function validateStep4(): boolean {
        const nextErrors: FieldErrors = {};

        if (lead.fullName.trim().length < 2) {
            nextErrors.fullName = "Enter your full name.";
        }
        if (!isValidEmail(lead.email)) {
            nextErrors.email = "Enter a valid email address.";
        }
        if (!isValidPhone(lead.phone)) {
            nextErrors.phone = "Enter a valid phone number.";
        }
        if (TURNSTILE_SITE_KEY && !turnstileToken) {
            nextErrors.turnstile = "Please complete the security check.";
        }
        if (!consentAccepted) {
            nextErrors.consent = "Please confirm you agree to be contacted.";
        }

        setErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    }

    function handleContinueFromStep1() {
        if (!validateStep1()) return;
        track("mortgage_goal_selected", { goal });
        nextStep();
    }

    function handleContinueFromStep2() {
        if (!validateStep2()) return;
        track("mortgage_details_completed", { goal });
        setStepTransition("estimate");
        clearTransitionTimer();
        transitionTimerRef.current = window.setTimeout(() => {
            transitionTimerRef.current = null;
            setStepTransition("idle");
            nextStep();
        }, 2000);
    }

    function handleContinueToContact() {
        setStepTransition("contact");
        clearTransitionTimer();
        transitionTimerRef.current = window.setTimeout(() => {
            transitionTimerRef.current = null;
            setStepTransition("idle");
            nextStep();
        }, 1000);
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();

        if (submitStatus.type === "loading") return;
        if (!validateStep4()) return;

        setSubmitStatus({ type: "loading" });

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15000);

        try {
            if (!goal || !previewEstimate) {
                throw new Error("Missing goal or estimate.");
            }

            const fullResult: FullResult =
                previewEstimate.kind === "purchase"
                    ? buildFullPurchaseResult(
                        goal === "buy_home"
                            ? "buy_home"
                            : goal === "first_home"
                                ? "first_home"
                                : "invest",
                        purchase,
                        previewEstimate
                    )
                    : buildFullRefinanceResult(refi, previewEstimate);

            const rawInputs =
                goal === "refinance"
                    ? {
                        loanBalance: String(parseMoney(refi.loanBalance)),
                        propertyValue: String(parseMoney(refi.propertyValue)),
                        interestRate: String(parseMoney(refi.interestRate)),
                        currentRepayment: String(parseMoney(refi.currentRepayment)),
                        annualIncome: String(parseMoney(refi.annualIncome)),
                        monthlyDebts: String(parseMoney(refi.monthlyDebts)),
                        refinanceGoal: refi.refinanceGoal,
                        refinanceTimeline: refi.refinanceTimeline,
                    }
                    : {
                        propertyPrice: String(parseMoney(purchase.propertyPrice)),
                        deposit: String(parseMoney(purchase.deposit)),
                        annualIncome: String(parseMoney(purchase.annualIncome)),
                        hasSecondApplicant: purchase.hasSecondApplicant === true,
                        secondIncome: String(
                            purchase.hasSecondApplicant
                                ? parseMoney(purchase.secondIncome)
                                : 0
                        ),
                        monthlyDebts: String(parseMoney(purchase.monthlyDebts)),
                        buyTimeline: purchase.buyTimeline,
                        listingUrl: purchase.listingUrl.trim(),
                        ...(goal === "buy_home" || goal === "first_home"
                            ? { employmentType: purchase.employmentType }
                            : {}),
                        ...(goal === "first_home"
                            ? { fhbStatus: purchase.fhbStatus }
                            : {}),
                        ...(goal === "invest"
                            ? {
                                ownsProperty: purchase.ownsProperty === true,
                                ...(purchase.weeklyRent.trim()
                                    ? {
                                        weeklyRent: String(
                                            parseMoney(purchase.weeklyRent)
                                        ),
                                    }
                                    : {}),
                            }
                            : {}),
                    };

            const payload = {
                source: "embedded_iframe",
                formType: "mortgage_lead_magnet",
                previewVersion: PREVIEW_VERSION,
                goal,
                honeypot,
                consentAccepted: true,
                rawInputs,
                lead: {
                    fullName: lead.fullName.trim(),
                    email: lead.email.trim().toLowerCase(),
                    phone: sanitizePhone(lead.phone),
                },
                metadata: {
                    pagePath:
                        typeof window !== "undefined" ? window.location.pathname : "",
                    embedUrl:
                        typeof window !== "undefined" ? window.location.href : "",
                    embedderReferrer:
                        typeof document !== "undefined" ? document.referrer : "",
                    userAgent:
                        typeof navigator !== "undefined" ? navigator.userAgent : "",
                    submittedAtClient: new Date().toISOString(),
                    turnstileToken: turnstileToken || null,
                },
                previewEstimate,
                fullResult,
            };

            const res = await fetch("/api/mortgage-broker-demo", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                signal: controller.signal,
                body: JSON.stringify(payload),
            });

            const rawText = await res.text();
            let maybeJson: Record<string, unknown> | null = null;

            try {
                maybeJson = rawText
                    ? (JSON.parse(rawText) as Record<string, unknown>)
                    : null;
            } catch {
                maybeJson = null;
            }

            if (!res.ok) {
                const msg =
                    typeof maybeJson?.message === "string"
                        ? maybeJson.message
                        : typeof maybeJson?.error === "string"
                            ? maybeJson.error
                            : null;
                const debugMessage =
                    msg ||
                    rawText ||
                    `Request failed with status ${res.status}`;

                throw new Error(debugMessage);
            }

            setSubmitStatus({ type: "success" });
            setResultBundle({
                lead: {
                    fullName: lead.fullName.trim(),
                    email: lead.email.trim().toLowerCase(),
                    phone: sanitizePhone(lead.phone),
                },
                full: fullResult,
                estimate: previewEstimate,
                refiLoanBalance:
                    goal === "refinance" ? parseMoney(refi.loanBalance) : undefined,
            });
            setLead(DEFAULT_LEAD);
            setConsentAccepted(false);
            setTurnstileToken("");
            setHoneypot("");
            sessionStorage.removeItem(storageKey);
            track("mortgage_lead_submitted", { goal });
            nextStep();
        } catch (err) {
            console.error("handleSubmit error:", err);

            setSubmitStatus({
                type: "error",
                message:
                    err instanceof Error
                        ? err.message
                        : "Something went wrong while submitting the form.",
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    return (
        <section className={styles.root} ref={topRef}>
            <div className={styles.shell}>
                <div className={styles.card}>
                    {step <= 4 ? <ProgressBar step={step} total={4} /> : null}

                    <div className={styles.srOnly} aria-live="polite">
                        {submitStatus.type === "loading"
                            ? "Sending your details"
                            : submitStatus.type === "error"
                                ? submitStatus.message
                                : ""}
                    </div>

                    {stepTransition !== "idle" ? (
                        <div className={styles.srOnly} aria-live="assertive">
                            {stepTransition === "estimate"
                                ? "Preparing your estimate."
                                : "Preparing your breakdown."}
                        </div>
                    ) : null}

                    {stepTransition !== "idle" ? (
                        <TransitionLoadingScreen
                            kind={stepTransition}
                            onCancel={handleCancelTransition}
                        />
                    ) : (
                        <>
                            {step === 1 && (
                                <div>
                                    <div className={styles.heroCenter}>

                                        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                                            Could this property fit your budget?
                                        </h1>
                                        <p className={styles.subtitle}>
                                            Get a quick estimate based on a real property price — not just a generic borrowing number.
                                        </p>

                                        <p className={styles.lead}>
                                            Answer a few quick questions and we’ll show you whether this property may be within reach, plus what could help or hurt your position.
                                        </p>
                                    </div>

                                    <div className={styles.pathGrid}>
                                        <GoalPathCard
                                            selected={goal === "buy_home"}
                                            icon="🏡"
                                            title="Buy a Home"
                                            description="See whether a home at this price may fit your budget."
                                            onClick={() => {
                                                clearFieldError("goal");
                                                setGoal("buy_home");
                                            }}
                                        />
                                        <GoalPathCard
                                            selected={goal === "first_home"}
                                            icon="🌱"
                                            title="Buy My First Home"
                                            description="Get a quick sense of where you stand as a first-home buyer."
                                            onClick={() => {
                                                clearFieldError("goal");
                                                setGoal("first_home");
                                            }}
                                        />
                                        <GoalPathCard
                                            selected={goal === "invest"}
                                            icon="📈"
                                            title="Invest in Property"
                                            description="See whether this investment property looks doable based on your numbers."
                                            onClick={() => {
                                                clearFieldError("goal");
                                                setGoal("invest");
                                            }}
                                        />
                                        <GoalPathCard
                                            selected={goal === "refinance"}
                                            icon="🔄"
                                            title="Refinance My Loan"
                                            description="See whether you may be able to lower your repayments or improve your current loan."
                                            onClick={() => {
                                                clearFieldError("goal");
                                                setGoal("refinance");
                                            }}
                                        />
                                    </div>

                                    <FieldError id="goal-error">{errors.goal}</FieldError>

                                    <button
                                        type="button"
                                        onClick={handleContinueFromStep1}
                                        className={styles.btnPrimary}
                                    >
                                        Continue →
                                    </button>

                                    <TrustRow />
                                </div>
                            )}

                            {step === 2 && (
                                <div>
                                    <BackButton onClick={prevStep} />

                                    <div className={styles.heroCenter}>
                                        <h2 ref={headingRef} tabIndex={-1} className={styles.h2}>
                                            {goal === "refinance"
                                                ? "Tell us about your loan"
                                                : "A few quick details"}
                                        </h2>

                                        <p className={styles.lead}>
                                            This only takes a minute. We’ll show your estimate on the next screen.
                                        </p>
                                    </div>

                                    {goal === "refinance" ? (
                                        <>
                                            <div className={styles.grid2}>
                                                <div>
                                                    <label htmlFor="loanBalance" className={styles.label}>
                                                        Current loan balance *
                                                    </label>
                                                    <input
                                                        id="loanBalance"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $540 000"
                                                        value={refi.loanBalance}
                                                        onChange={(e) => {
                                                            clearFieldError("loanBalance");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setRefi((r) => ({
                                                                    ...r,
                                                                    loanBalance: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.loanBalance)}
                                                        aria-describedby={
                                                            errors.loanBalance ? "loanBalance-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="loanBalance-error">
                                                        {errors.loanBalance}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <label htmlFor="propertyValue" className={styles.label}>
                                                        Estimated property value *
                                                    </label>
                                                    <input
                                                        id="propertyValue"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $820 000"
                                                        value={refi.propertyValue}
                                                        onChange={(e) => {
                                                            clearFieldError("propertyValue");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setRefi((r) => ({
                                                                    ...r,
                                                                    propertyValue: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.propertyValue)}
                                                        aria-describedby={
                                                            errors.propertyValue ? "propertyValue-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="propertyValue-error">
                                                        {errors.propertyValue}
                                                    </FieldError>
                                                </div>
                                            </div>

                                            <div className={cx(styles.grid2, styles.stackMd)}>
                                                <div>
                                                    <label htmlFor="interestRate" className={styles.label}>
                                                        Current interest rate (%) *
                                                    </label>
                                                    <input
                                                        id="interestRate"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. 6.49"
                                                        value={refi.interestRate}
                                                        onChange={(e) => {
                                                            clearFieldError("interestRate");
                                                            setRefi((r) => ({
                                                                ...r,
                                                                interestRate: e.target.value,
                                                            }));
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.interestRate)}
                                                        aria-describedby={
                                                            errors.interestRate ? "interestRate-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="interestRate-error">
                                                        {errors.interestRate}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <label htmlFor="currentRepayment" className={styles.label}>
                                                        Current monthly repayment *
                                                    </label>
                                                    <input
                                                        id="currentRepayment"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $3 200"
                                                        value={refi.currentRepayment}
                                                        onChange={(e) => {
                                                            clearFieldError("currentRepayment");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setRefi((r) => ({
                                                                    ...r,
                                                                    currentRepayment: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.currentRepayment)}
                                                        aria-describedby={
                                                            errors.currentRepayment
                                                                ? "currentRepayment-error"
                                                                : undefined
                                                        }
                                                    />
                                                    <FieldError id="currentRepayment-error">
                                                        {errors.currentRepayment}
                                                    </FieldError>
                                                </div>
                                            </div>

                                            <div className={cx(styles.grid2, styles.stackMd)}>
                                                <div>
                                                    <label htmlFor="refiAnnualIncome" className={styles.label}>
                                                        Annual household income (before tax) *
                                                    </label>
                                                    <input
                                                        id="refiAnnualIncome"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $150 000"
                                                        value={refi.annualIncome}
                                                        onChange={(e) => {
                                                            clearFieldError("annualIncome");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setRefi((r) => ({
                                                                    ...r,
                                                                    annualIncome: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.annualIncome)}
                                                        aria-describedby={
                                                            errors.annualIncome ? "refiAnnualIncome-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="refiAnnualIncome-error">
                                                        {errors.annualIncome}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <label htmlFor="refiMonthlyDebts" className={styles.label}>
                                                        Monthly debt repayments *
                                                    </label>
                                                    <input
                                                        id="refiMonthlyDebts"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $500"
                                                        value={refi.monthlyDebts}
                                                        onChange={(e) => {
                                                            clearFieldError("monthlyDebts");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setRefi((r) => ({
                                                                    ...r,
                                                                    monthlyDebts: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.monthlyDebts)}
                                                        aria-describedby={
                                                            errors.monthlyDebts ? "refiMonthlyDebts-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="refiMonthlyDebts-error">
                                                        {errors.monthlyDebts}
                                                    </FieldError>
                                                </div>
                                            </div>

                                            <div className={cx(styles.grid2, styles.stackMd)}>
                                                <div>
                                                    <label htmlFor="refinanceGoal" className={styles.label}>
                                                        What is your goal? *
                                                    </label>
                                                    <select
                                                        id="refinanceGoal"
                                                        value={refi.refinanceGoal}
                                                        onChange={(e) => {
                                                            clearFieldError("refinanceGoal");
                                                            setRefi((r) => ({
                                                                ...r,
                                                                refinanceGoal: e.target.value as RefinanceGoal | "",
                                                            }));
                                                        }}
                                                        className={styles.select}
                                                        aria-invalid={Boolean(errors.refinanceGoal)}
                                                        aria-describedby={
                                                            errors.refinanceGoal ? "refinanceGoal-error" : undefined
                                                        }
                                                    >
                                                        <option value="">Choose…</option>
                                                        <option value="lower_repayments">Lower repayments</option>
                                                        <option value="better_rate">Better rate</option>
                                                        <option value="access_equity">Access equity</option>
                                                        <option value="consolidate_debt">Consolidate debt</option>
                                                    </select>
                                                    <FieldError id="refinanceGoal-error">
                                                        {errors.refinanceGoal}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <label htmlFor="refinanceTimeline" className={styles.label}>
                                                        When are you looking to refinance? *
                                                    </label>
                                                    <select
                                                        id="refinanceTimeline"
                                                        value={refi.refinanceTimeline}
                                                        onChange={(e) => {
                                                            clearFieldError("refinanceTimeline");
                                                            setRefi((r) => ({
                                                                ...r,
                                                                refinanceTimeline: e.target.value as
                                                                    | RefinanceTimeline
                                                                    | "",
                                                            }));
                                                        }}
                                                        className={styles.select}
                                                        aria-invalid={Boolean(errors.refinanceTimeline)}
                                                        aria-describedby={
                                                            errors.refinanceTimeline
                                                                ? "refinanceTimeline-error"
                                                                : undefined
                                                        }
                                                    >
                                                        <option value="">Choose…</option>
                                                        <option value="asap">ASAP</option>
                                                        <option value="1_3">1–3 months</option>
                                                        <option value="3plus">3+ months</option>
                                                    </select>
                                                    <FieldError id="refinanceTimeline-error">
                                                        {errors.refinanceTimeline}
                                                    </FieldError>
                                                </div>
                                            </div>
                                        </>
                                    ) : goal === "invest" ? (
                                        <>
                                            <div className={styles.grid2}>
                                                <div>
                                                    <label htmlFor="invPropertyPrice" className={styles.label}>
                                                        What&apos;s the property price? *
                                                    </label>
                                                    <input
                                                        id="invPropertyPrice"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $850 000"
                                                        value={purchase.propertyPrice}
                                                        onChange={(e) => {
                                                            clearFieldError("propertyPrice");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    propertyPrice: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.propertyPrice)}
                                                        aria-describedby={
                                                            errors.propertyPrice ? "invPropertyPrice-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="invPropertyPrice-error">
                                                        {errors.propertyPrice}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <label htmlFor="invDeposit" className={styles.label}>
                                                        How much deposit do you have available? *
                                                    </label>
                                                    <input
                                                        id="invDeposit"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $130 000"
                                                        value={purchase.deposit}
                                                        onChange={(e) => {
                                                            clearFieldError("deposit");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    deposit: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.deposit)}
                                                        aria-describedby={errors.deposit ? "invDeposit-error" : undefined}
                                                    />
                                                    <FieldError id="invDeposit-error">{errors.deposit}</FieldError>
                                                </div>
                                            </div>

                                            <div className={cx(styles.grid2, styles.stackMd)}>
                                                <div>
                                                    <label htmlFor="invAnnualIncome" className={styles.label}>
                                                        What is your annual income (before tax)? *
                                                    </label>
                                                    <input
                                                        id="invAnnualIncome"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $120 000"
                                                        value={purchase.annualIncome}
                                                        onChange={(e) => {
                                                            clearFieldError("annualIncome");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    annualIncome: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.annualIncome)}
                                                        aria-describedby={
                                                            errors.annualIncome ? "invAnnualIncome-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="invAnnualIncome-error">
                                                        {errors.annualIncome}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <div className={styles.groupLabel}>Do you have a second applicant income? *</div>
                                                    <div className={styles.grid2}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                clearFieldError("hasSecondApplicant");
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    hasSecondApplicant: false,
                                                                    secondIncome: "",
                                                                }));
                                                            }}
                                                            className={cx(styles.choiceToggle, purchase.hasSecondApplicant === false && styles.choiceToggleActive)}
                                                            aria-pressed={purchase.hasSecondApplicant === false}
                                                        >
                                                            No
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                clearFieldError("hasSecondApplicant");
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    hasSecondApplicant: true,
                                                                }));
                                                            }}
                                                            className={cx(styles.choiceToggle, purchase.hasSecondApplicant === true && styles.choiceToggleActive)}
                                                            aria-pressed={purchase.hasSecondApplicant === true}
                                                        >
                                                            Yes
                                                        </button>
                                                    </div>
                                                    <FieldError id="hasSecondApplicant-inv-error">
                                                        {errors.hasSecondApplicant}
                                                    </FieldError>
                                                </div>
                                            </div>

                                            {purchase.hasSecondApplicant === true ? (
                                                <div className={styles.stackMd}>
                                                    <label htmlFor="invSecondIncome" className={styles.label}>
                                                        Second applicant annual income (before tax) *
                                                    </label>
                                                    <input
                                                        id="invSecondIncome"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $80 000"
                                                        value={purchase.secondIncome}
                                                        onChange={(e) => {
                                                            clearFieldError("secondIncome");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    secondIncome: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.secondIncome)}
                                                        aria-describedby={
                                                            errors.secondIncome ? "invSecondIncome-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="invSecondIncome-error">
                                                        {errors.secondIncome}
                                                    </FieldError>
                                                </div>
                                            ) : null}

                                            <div className={cx(styles.grid2, styles.stackMd)}>
                                                <div>
                                                    <label htmlFor="invMonthlyDebts" className={styles.label}>
                                                        What are your monthly debt repayments? *
                                                    </label>
                                                    <input
                                                        id="invMonthlyDebts"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $800"
                                                        value={purchase.monthlyDebts}
                                                        onChange={(e) => {
                                                            clearFieldError("monthlyDebts");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    monthlyDebts: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.monthlyDebts)}
                                                        aria-describedby={
                                                            errors.monthlyDebts
                                                                ? "invMonthlyDebts-error"
                                                                : "invMonthlyDebts-help"
                                                        }
                                                    />
                                                    <div id="invMonthlyDebts-help" className={styles.help}>
                                                        Example: car loans, personal loans, credit cards
                                                    </div>
                                                    <FieldError id="invMonthlyDebts-error">
                                                        {errors.monthlyDebts}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <div className={styles.groupLabel}>Do you currently own property? *</div>
                                                    <div className={styles.grid2}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                clearFieldError("ownsProperty");
                                                                setPurchase((p) => ({ ...p, ownsProperty: true }));
                                                            }}
                                                            className={cx(styles.choiceToggle, purchase.ownsProperty === true && styles.choiceToggleActive)}
                                                            aria-pressed={purchase.ownsProperty === true}
                                                        >
                                                            Yes
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                clearFieldError("ownsProperty");
                                                                setPurchase((p) => ({ ...p, ownsProperty: false }));
                                                            }}
                                                            className={cx(styles.choiceToggle, purchase.ownsProperty === false && styles.choiceToggleActive)}
                                                            aria-pressed={purchase.ownsProperty === false}
                                                        >
                                                            No
                                                        </button>
                                                    </div>
                                                    <FieldError id="ownsProperty-error">{errors.ownsProperty}</FieldError>
                                                </div>
                                            </div>

                                            <div className={cx(styles.grid2, styles.stackMd)}>
                                                <div>
                                                    <label htmlFor="weeklyRent" className={styles.label}>
                                                        Expected weekly rent (optional)
                                                    </label>
                                                    <input
                                                        id="weeklyRent"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $650"
                                                        value={purchase.weeklyRent}
                                                        onChange={(e) => {
                                                            clearFieldError("weeklyRent");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    weeklyRent: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.weeklyRent)}
                                                        aria-describedby={
                                                            errors.weeklyRent ? "weeklyRent-error" : "weeklyRent-help"
                                                        }
                                                    />
                                                    <div id="weeklyRent-help" className={styles.help}>
                                                        Strong signal for investment scenarios if you have it.
                                                    </div>
                                                    <FieldError id="weeklyRent-error">{errors.weeklyRent}</FieldError>
                                                </div>

                                                <div>
                                                    <label htmlFor="invBuyTimeline" className={styles.label}>
                                                        When are you planning to buy? *
                                                    </label>
                                                    <select
                                                        id="invBuyTimeline"
                                                        value={purchase.buyTimeline}
                                                        onChange={(e) => {
                                                            clearFieldError("buyTimeline");
                                                            setPurchase((p) => ({
                                                                ...p,
                                                                buyTimeline: e.target.value as BuyTimeline | "",
                                                            }));
                                                        }}
                                                        className={styles.select}
                                                        aria-invalid={Boolean(errors.buyTimeline)}
                                                        aria-describedby={
                                                            errors.buyTimeline ? "invBuyTimeline-error" : undefined
                                                        }
                                                    >
                                                        <option value="">Choose…</option>
                                                        <option value="asap">ASAP</option>
                                                        <option value="1_3">1–3 months</option>
                                                        <option value="3_6">3–6 months</option>
                                                        <option value="6plus">6+ months</option>
                                                    </select>
                                                    <FieldError id="invBuyTimeline-error">
                                                        {errors.buyTimeline}
                                                    </FieldError>
                                                </div>
                                            </div>

                                            <div className={styles.stackMd}>
                                                <label htmlFor="invListingUrl" className={styles.label}>
                                                    Property link (optional)
                                                </label>
                                                <input
                                                    id="invListingUrl"
                                                    inputMode="url"
                                                    autoComplete="off"
                                                    placeholder="Paste the listing if you have it"
                                                    value={purchase.listingUrl}
                                                    onChange={(e) => {
                                                        clearFieldError("listingUrl");
                                                        setPurchase((p) => ({
                                                            ...p,
                                                            listingUrl: e.target.value,
                                                        }));
                                                    }}
                                                    className={styles.input}
                                                    aria-invalid={Boolean(errors.listingUrl)}
                                                    aria-describedby={
                                                        errors.listingUrl ? "invListingUrl-error" : "invListingUrl-help"
                                                    }
                                                />
                                                <div id="invListingUrl-help" className={styles.help}>
                                                    We won&apos;t scrape it — we may store it for follow-up.
                                                </div>
                                                <FieldError id="invListingUrl-error">{errors.listingUrl}</FieldError>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            {goal === "first_home" ? (
                                                <div className={styles.mbGroup}>
                                                    <div className={styles.groupLabel}>Are you a first home buyer? *</div>
                                                    <div className={styles.grid2}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                clearFieldError("fhbStatus");
                                                                setPurchase((p) => ({ ...p, fhbStatus: "yes" }));
                                                            }}
                                                            className={cx(
                                                                styles.choiceToggle,
                                                                purchase.fhbStatus === "yes" &&
                                                                styles.choiceToggleActive
                                                            )}
                                                            aria-pressed={purchase.fhbStatus === "yes"}
                                                        >
                                                            Yes
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                clearFieldError("fhbStatus");
                                                                setPurchase((p) => ({ ...p, fhbStatus: "unsure" }));
                                                            }}
                                                            className={cx(
                                                                styles.choiceToggle,
                                                                purchase.fhbStatus === "unsure" &&
                                                                styles.choiceToggleActive
                                                            )}
                                                            aria-pressed={purchase.fhbStatus === "unsure"}
                                                        >
                                                            Not sure
                                                        </button>
                                                    </div>
                                                    <FieldError id="fhbStatus-error">{errors.fhbStatus}</FieldError>
                                                </div>
                                            ) : null}

                                            <div className={styles.grid2}>
                                                <div>
                                                    <label htmlFor="propertyPrice" className={styles.label}>
                                                        What&apos;s the property price? *
                                                    </label>
                                                    <input
                                                        id="propertyPrice"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $850 000"
                                                        value={purchase.propertyPrice}
                                                        onChange={(e) => {
                                                            clearFieldError("propertyPrice");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    propertyPrice: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.propertyPrice)}
                                                        aria-describedby={
                                                            errors.propertyPrice ? "propertyPrice-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="propertyPrice-error">
                                                        {errors.propertyPrice}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <label htmlFor="deposit" className={styles.label}>
                                                        How much deposit do you have saved? *
                                                    </label>
                                                    <input
                                                        id="deposit"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $130 000"
                                                        value={purchase.deposit}
                                                        onChange={(e) => {
                                                            clearFieldError("deposit");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    deposit: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.deposit)}
                                                        aria-describedby={errors.deposit ? "deposit-error" : undefined}
                                                    />
                                                    <FieldError id="deposit-error">{errors.deposit}</FieldError>
                                                </div>
                                            </div>

                                            <div className={cx(styles.grid2, styles.stackMd)}>
                                                <div>
                                                    <label htmlFor="annualIncome" className={styles.label}>
                                                        What is your annual income (before tax)? *
                                                    </label>
                                                    <input
                                                        id="annualIncome"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $120 000"
                                                        value={purchase.annualIncome}
                                                        onChange={(e) => {
                                                            clearFieldError("annualIncome");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    annualIncome: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.annualIncome)}
                                                        aria-describedby={
                                                            errors.annualIncome ? "annualIncome-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="annualIncome-error">
                                                        {errors.annualIncome}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <div className={styles.groupLabel}>
                                                        Do you have a second applicant or partner income? *
                                                    </div>
                                                    <div className={styles.grid2}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                clearFieldError("hasSecondApplicant");
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    hasSecondApplicant: false,
                                                                    secondIncome: "",
                                                                }));
                                                            }}
                                                            className={cx(styles.choiceToggle, purchase.hasSecondApplicant === false && styles.choiceToggleActive)}
                                                            aria-pressed={purchase.hasSecondApplicant === false}
                                                        >
                                                            No
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                clearFieldError("hasSecondApplicant");
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    hasSecondApplicant: true,
                                                                }));
                                                            }}
                                                            className={cx(styles.choiceToggle, purchase.hasSecondApplicant === true && styles.choiceToggleActive)}
                                                            aria-pressed={purchase.hasSecondApplicant === true}
                                                        >
                                                            Yes
                                                        </button>
                                                    </div>
                                                    <FieldError id="hasSecondApplicant-error">
                                                        {errors.hasSecondApplicant}
                                                    </FieldError>
                                                </div>
                                            </div>

                                            {purchase.hasSecondApplicant === true ? (
                                                <div className={styles.stackMd}>
                                                    <label htmlFor="secondIncome" className={styles.label}>
                                                        Second annual income (before tax) *
                                                    </label>
                                                    <input
                                                        id="secondIncome"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $80 000"
                                                        value={purchase.secondIncome}
                                                        onChange={(e) => {
                                                            clearFieldError("secondIncome");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    secondIncome: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.secondIncome)}
                                                        aria-describedby={
                                                            errors.secondIncome ? "secondIncome-error" : undefined
                                                        }
                                                    />
                                                    <FieldError id="secondIncome-error">
                                                        {errors.secondIncome}
                                                    </FieldError>
                                                </div>
                                            ) : null}

                                            <div className={cx(styles.grid2, styles.stackMd)}>
                                                <div>
                                                    <label htmlFor="monthlyDebts" className={styles.label}>
                                                        What are your monthly debt repayments? *
                                                    </label>
                                                    <input
                                                        id="monthlyDebts"
                                                        inputMode="decimal"
                                                        autoComplete="off"
                                                        placeholder="e.g. $800"
                                                        value={purchase.monthlyDebts}
                                                        onChange={(e) => {
                                                            clearFieldError("monthlyDebts");
                                                            applyMoneyInputChange(e, (v) =>
                                                                setPurchase((p) => ({
                                                                    ...p,
                                                                    monthlyDebts: v,
                                                                }))
                                                            );
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.monthlyDebts)}
                                                        aria-describedby={
                                                            errors.monthlyDebts ? "monthlyDebts-error" : "monthlyDebts-help"
                                                        }
                                                    />
                                                    <div id="monthlyDebts-help" className={styles.help}>
                                                        Example: car loans, personal loans, credit cards
                                                    </div>
                                                    <FieldError id="monthlyDebts-error">
                                                        {errors.monthlyDebts}
                                                    </FieldError>
                                                </div>

                                                <div>
                                                    <label htmlFor="employmentType" className={styles.label}>
                                                        Employment type *
                                                    </label>
                                                    <select
                                                        id="employmentType"
                                                        value={purchase.employmentType}
                                                        onChange={(e) => {
                                                            clearFieldError("employmentType");
                                                            setPurchase((p) => ({
                                                                ...p,
                                                                employmentType: e.target.value as EmploymentType | "",
                                                            }));
                                                        }}
                                                        className={styles.select}
                                                        aria-invalid={Boolean(errors.employmentType)}
                                                        aria-describedby={
                                                            errors.employmentType ? "employmentType-error" : undefined
                                                        }
                                                    >
                                                        <option value="">Choose…</option>
                                                        <option value="full_time">Full-time</option>
                                                        <option value="part_time">Part-time</option>
                                                        <option value="self_employed">Self-employed</option>
                                                        <option value="casual_contractor">Casual / contractor</option>
                                                    </select>
                                                    <FieldError id="employmentType-error">
                                                        {errors.employmentType}
                                                    </FieldError>
                                                </div>
                                            </div>

                                            <div className={cx(styles.grid2, styles.stackMd)}>
                                                <div>
                                                    <label htmlFor="buyTimeline" className={styles.label}>
                                                        When are you looking to buy? *
                                                    </label>
                                                    <select
                                                        id="buyTimeline"
                                                        value={purchase.buyTimeline}
                                                        onChange={(e) => {
                                                            clearFieldError("buyTimeline");
                                                            setPurchase((p) => ({
                                                                ...p,
                                                                buyTimeline: e.target.value as BuyTimeline | "",
                                                            }));
                                                        }}
                                                        className={styles.select}
                                                        aria-invalid={Boolean(errors.buyTimeline)}
                                                        aria-describedby={
                                                            errors.buyTimeline ? "buyTimeline-error" : undefined
                                                        }
                                                    >
                                                        <option value="">Choose…</option>
                                                        <option value="asap">ASAP</option>
                                                        <option value="1_3">1–3 months</option>
                                                        <option value="3_6">3–6 months</option>
                                                        <option value="6plus">6+ months</option>
                                                    </select>
                                                    <FieldError id="buyTimeline-error">{errors.buyTimeline}</FieldError>
                                                </div>

                                                <div>
                                                    <label htmlFor="listingUrl" className={styles.label}>
                                                        Property link (optional)
                                                    </label>
                                                    <input
                                                        id="listingUrl"
                                                        inputMode="url"
                                                        autoComplete="off"
                                                        placeholder="Paste the listing if you have it"
                                                        value={purchase.listingUrl}
                                                        onChange={(e) => {
                                                            clearFieldError("listingUrl");
                                                            setPurchase((p) => ({
                                                                ...p,
                                                                listingUrl: e.target.value,
                                                            }));
                                                        }}
                                                        className={styles.input}
                                                        aria-invalid={Boolean(errors.listingUrl)}
                                                        aria-describedby={
                                                            errors.listingUrl ? "listingUrl-error" : "listingUrl-help"
                                                        }
                                                    />
                                                    <div id="listingUrl-help" className={styles.help}>
                                                        We won&apos;t scrape it — we may store it for follow-up.
                                                    </div>
                                                    <FieldError id="listingUrl-error">{errors.listingUrl}</FieldError>
                                                </div>
                                            </div>
                                        </>
                                    )}


                                    <button
                                        type="button"
                                        onClick={handleContinueFromStep2}
                                        className={styles.btnPrimary}
                                    >
                                        See My Estimate →
                                    </button>
                                </div>
                            )}

                            {step === 3 && previewEstimate && (
                                <div>
                                    <BackButton onClick={prevStep} />

                                    <div className={styles.heroCenter}>
                                        <h2 ref={headingRef} tabIndex={-1} className={styles.h2}>
                                            {previewEstimate.kind === "purchase"
                                                ? "Your property estimate"
                                                : "Your refinance estimate"}
                                        </h2>

                                        <p className={styles.lead}>
                                            This is a guide only, not lender approval or financial advice. Final outcomes depend on a full assessment.
                                        </p>
                                    </div>

                                    {previewEstimate.kind === "purchase" ? (
                                        <>
                                            <div className={styles.grid3}>
                                                <StatCard
                                                    label="Estimated affordability status"
                                                    value={
                                                        previewEstimate.affordability === "achievable"
                                                            ? "Looks achievable"
                                                            : previewEstimate.affordability === "close"
                                                                ? "Close, but may need work"
                                                                : "May be difficult right now"
                                                    }
                                                    emphasized
                                                />
                                                <StatCard
                                                    label="Estimated borrowing range"
                                                    value={fmtRange(
                                                        previewEstimate.borrowingLow,
                                                        previewEstimate.borrowingHigh
                                                    )}
                                                />
                                                <StatCard
                                                    label="Estimated repayments"
                                                    value={`around ${fmtAUD(previewEstimate.repaymentMid)}/month`}
                                                    sub={`Range about ${fmtRange(
                                                        previewEstimate.repaymentLow,
                                                        previewEstimate.repaymentHigh
                                                    )} on the borrowing estimate.`}
                                                />
                                            </div>

                                            <div className={styles.stackLg}>
                                                <Notice tone="neutral">
                                                    <strong>At a glance: </strong>
                                                    {previewEstimate.teaserLine}
                                                </Notice>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            {refinanceMonthlyOverpayMid !== null ? (
                                                <div className={styles.overpayBanner}>
                                                    <p className={styles.overpayBannerText}>
                                                        {refinanceMonthlyOverpayMid > 0 ? (
                                                            <>
                                                                You may be overpaying by roughly{" "}
                                                                <strong>
                                                                    {fmtAUD(refinanceMonthlyOverpayMid)}
                                                                </strong>
                                                                /month
                                                            </>
                                                        ) : (
                                                            <>
                                                                From these inputs, a clear monthly savings gap
                                                                isn&apos;t showing yet — a broker can still compare
                                                                your rate and fees.
                                                            </>
                                                        )}
                                                    </p>
                                                    {refinanceMonthlyOverpayMid > 0 ? (
                                                        <p className={styles.overpayBannerSub}>
                                                            Figure is the midpoint of the estimated monthly saving
                                                            range (
                                                            {fmtRange(
                                                                previewEstimate.savingsLow,
                                                                previewEstimate.savingsHigh
                                                            )}
                                                            ). General estimate only, not a loan offer.
                                                        </p>
                                                    ) : null}
                                                </div>
                                            ) : null}

                                            <div className={styles.grid3}>
                                                <StatCard
                                                    label="Estimated potential monthly saving range"
                                                    value={fmtRange(
                                                        previewEstimate.savingsLow,
                                                        previewEstimate.savingsHigh
                                                    )}
                                                    emphasized
                                                />
                                                <StatCard
                                                    label="Refinancing may be worthwhile?"
                                                    value={
                                                        previewEstimate.worthwhile === "likely"
                                                            ? "Looks worth a closer look"
                                                            : previewEstimate.worthwhile === "maybe"
                                                                ? "May be worth comparing"
                                                                : "Hard to tell without a proper comparison"
                                                    }
                                                />
                                                <StatCard
                                                    label="Current repayment"
                                                    value={fmtAUD(previewEstimate.currentRepaymentEstimate)}
                                                    sub={
                                                        previewEstimate.lvr !== null
                                                            ? `Approx. LVR ${previewEstimate.lvr.toFixed(1)}%`
                                                            : undefined
                                                    }
                                                />
                                            </div>

                                            <div className={styles.stackLg}>
                                                <Notice tone="neutral">
                                                    <strong>Teaser: </strong>
                                                    {previewEstimate.teaserLine}
                                                </Notice>
                                            </div>
                                        </>
                                    )}

                                    <div className={cx(styles.panel, styles.stackLg)}>
                                        <div className={styles.panelLock}>Full breakdown</div>

                                        <h3 className={styles.h3}>See your full breakdown</h3>

                                        <p className={styles.panelBlurb}>
                                            See what’s helping your position, what may be holding you back, and what to do next — shown instantly after you enter your details.
                                        </p>

                                        <ul className={styles.panelList}>
                                            <li>What looks positive</li>
                                            <li>What may need attention</li>
                                            <li>Simple next steps you can take</li>
                                        </ul>

                                        <button
                                            type="button"
                                            onClick={handleContinueToContact}
                                            className={styles.btnPrimary}
                                        >
                                            See my full breakdown →
                                        </button>
                                    </div>
                                </div>
                            )}

                            {step === 4 && (
                                <div>
                                    <BackButton onClick={prevStep} />

                                    <div className={styles.heroCenter}>
                                        <h2 ref={headingRef} tabIndex={-1} className={styles.h2}>
                                            See your full breakdown
                                        </h2>

                                        <p className={styles.lead}>
                                            Enter your details to see the full breakdown on this page. You may also receive a short summary by SMS or email.
                                        </p>
                                    </div>

                                    <form onSubmit={handleSubmit} noValidate>
                                        <input
                                            tabIndex={-1}
                                            aria-hidden="true"
                                            autoComplete="new-password"
                                            value={honeypot}
                                            onChange={(e) => setHoneypot(e.target.value)}
                                            name="company_website"
                                            className={styles.honeypot}
                                        />

                                        <div className={styles.grid2}>
                                            <div>
                                                <label htmlFor="fullName" className={styles.label}>
                                                    Full name *
                                                </label>
                                                <input
                                                    id="fullName"
                                                    autoComplete="name"
                                                    placeholder="Alex Smith"
                                                    value={lead.fullName}
                                                    onChange={(e) => {
                                                        clearFieldError("fullName");
                                                        setLead((l) => ({ ...l, fullName: e.target.value }));
                                                    }}
                                                    className={styles.input}
                                                    aria-invalid={Boolean(errors.fullName)}
                                                    aria-describedby={errors.fullName ? "fullName-error" : undefined}
                                                />
                                                <FieldError id="fullName-error">{errors.fullName}</FieldError>
                                            </div>

                                            <div>
                                                <label htmlFor="phone" className={styles.label}>
                                                    Mobile number *
                                                </label>
                                                <input
                                                    id="phone"
                                                    type="tel"
                                                    autoComplete="tel"
                                                    inputMode="tel"
                                                    placeholder="04XX XXX XXX"
                                                    value={lead.phone}
                                                    onChange={(e) => {
                                                        clearFieldError("phone");
                                                        setLead((l) => ({ ...l, phone: e.target.value }));
                                                    }}
                                                    className={styles.input}
                                                    aria-invalid={Boolean(errors.phone)}
                                                    aria-describedby={errors.phone ? "phone-error" : undefined}
                                                />
                                                <FieldError id="phone-error">{errors.phone}</FieldError>
                                            </div>
                                        </div>

                                        <div className={styles.stackMd}>
                                            <label htmlFor="email" className={styles.label}>
                                                Email address *
                                            </label>
                                            <input
                                                id="email"
                                                type="email"
                                                autoComplete="email"
                                                inputMode="email"
                                                placeholder="alex@email.com"
                                                value={lead.email}
                                                onChange={(e) => {
                                                    clearFieldError("email");
                                                    setLead((l) => ({ ...l, email: e.target.value }));
                                                }}
                                                className={styles.input}
                                                aria-invalid={Boolean(errors.email)}
                                                aria-describedby={errors.email ? "email-error" : undefined}
                                            />
                                            <FieldError id="email-error">{errors.email}</FieldError>
                                        </div>

                                        <TurnstileWidget
                                            siteKey={TURNSTILE_SITE_KEY}
                                            onToken={handleTurnstileToken}
                                            onExpired={handleTurnstileExpired}
                                        />

                                        <FieldError id="turnstile-error">{errors.turnstile}</FieldError>

                                        <label className={styles.checkLabel}>
                                            <input
                                                type="checkbox"
                                                checked={consentAccepted}
                                                onChange={(e) => {
                                                    clearFieldError("consent");
                                                    setConsentAccepted(e.target.checked);
                                                }}
                                            />
                                            <span>
                                                I’m happy to be contacted by {BROKER_NAME} by SMS, phone, or email about this enquiry. I understand this is a guide only and not financial advice.
                                            </span>
                                        </label>
                                        <FieldError id="consent-error">{errors.consent}</FieldError>

                                        <button
                                            type="submit"
                                            disabled={submitStatus.type === "loading"}
                                            className={cx(styles.btnPrimary, styles.stackLg)}
                                        >
                                            {submitStatus.type === "loading"
                                                ? "Submitting…"
                                                : "Show my full breakdown →"}
                                        </button>

                                        {submitStatus.type === "error" ? (
                                            <div role="alert" className={styles.alertError}>
                                                {submitStatus.message}
                                            </div>
                                        ) : null}

                                        <p className={styles.consentFoot}>
                                            By submitting, you agree to be contacted by {BROKER_NAME} by SMS, phone, or email about this enquiry. This is a guide only and not financial advice.
                                        </p>
                                    </form>
                                </div>
                            )}

                            {step === 5 && resultBundle && (
                                <div className={styles.resultWrap}>
                                    <div className={styles.heroCenter}>
                                        <h2 ref={headingRef} tabIndex={-1} className={styles.resultHeadline}>
                                            {resultBundle.full.headline}
                                        </h2>

                                        <p className={styles.resultIntro}>
                                            Thanks{", "}
                                            {resultBundle.lead.fullName.split(" ")[0] || "there"} — here&apos;s your
                                            on-page summary. {BROKER_NAME} may also follow up by SMS and email.
                                        </p>
                                    </div>

                                    {resultBundle.estimate?.kind === "purchase" ? (
                                        <div className={cx(styles.grid3, styles.mbSection)}>
                                            <StatCard
                                                label="Property price"
                                                value={fmtAUD(resultBundle.estimate.propertyPrice)}
                                            />
                                            <StatCard
                                                label="Deposit entered"
                                                value={fmtAUD(resultBundle.estimate.deposit)}
                                            />
                                            <StatCard
                                                label="Estimated borrowing range"
                                                value={fmtRange(
                                                    resultBundle.estimate.borrowingLow,
                                                    resultBundle.estimate.borrowingHigh
                                                )}
                                            />
                                            <StatCard
                                                label="Estimated repayments"
                                                value={`around ${fmtAUD(resultBundle.estimate.repaymentMid)}/month`}
                                                sub={fmtRange(
                                                    resultBundle.estimate.repaymentLow,
                                                    resultBundle.estimate.repaymentHigh
                                                )}
                                            />
                                            <StatCard
                                                label="Affordability (headline)"
                                                value={
                                                    resultBundle.estimate.affordability === "achievable"
                                                        ? "Looks achievable"
                                                        : resultBundle.estimate.affordability === "close"
                                                            ? "Close, but a few things may need work"
                                                            : "May be difficult right now"
                                                }
                                            />
                                        </div>
                                    ) : resultBundle.estimate?.kind === "refinance" ? (
                                        <div className={cx(styles.grid3, styles.mbSection)}>
                                            <StatCard
                                                label="Current loan balance"
                                                value={fmtAUD(resultBundle.refiLoanBalance ?? 0)}
                                            />
                                            <StatCard
                                                label="Estimated LVR"
                                                value={
                                                    resultBundle.estimate.lvr !== null
                                                        ? `${resultBundle.estimate.lvr.toFixed(1)}%`
                                                        : "—"
                                                }
                                            />
                                            <StatCard
                                                label="Current repayment"
                                                value={fmtAUD(resultBundle.estimate.currentRepaymentEstimate)}
                                            />
                                            <StatCard
                                                label="Possible repayment range"
                                                value={fmtRange(
                                                    resultBundle.estimate.improvedRepaymentLow,
                                                    resultBundle.estimate.improvedRepaymentHigh
                                                )}
                                            />
                                            <StatCard
                                                label="Potential monthly savings (range)"
                                                value={fmtRange(
                                                    resultBundle.estimate.savingsLow,
                                                    resultBundle.estimate.savingsHigh
                                                )}
                                            />
                                        </div>
                                    ) : null}

                                    <h3 className={styles.sectionHeading}>Strengths</h3>
                                    <ul className={styles.list}>
                                        {resultBundle.full.strengths.map((s) => (
                                            <li key={s}>{s}</li>
                                        ))}
                                    </ul>

                                    <h3 className={styles.sectionHeading}>Watchouts</h3>
                                    <ul className={styles.list}>
                                        {resultBundle.full.watchouts.map((s) => (
                                            <li key={s}>{s}</li>
                                        ))}
                                    </ul>

                                    <h3 className={styles.sectionHeading}>What to do next</h3>
                                    <ul className={styles.list}>
                                        {resultBundle.full.nextSteps.map((s) => (
                                            <li key={s}>{s}</li>
                                        ))}
                                    </ul>

                                    <div className={styles.ctaBox}>
                                        <div className={styles.ctaTitle}>
                                            Want a broker to review this properly?
                                        </div>
                                        <div className={styles.grid2}>
                                            <a
                                                href={BOOKING_URL}
                                                className={cx(styles.btnPrimary, styles.btnLink)}
                                            >
                                                Book a call
                                            </a>
                                            <a
                                                href={BOOKING_URL}
                                                className={cx(styles.btnGhost, styles.btnLink)}
                                            >
                                                Request a callback today
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}