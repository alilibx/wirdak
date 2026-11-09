import { PageHeader } from "../components/PageHeader";
import { api } from "@convex/_generated/api";
import { toWesternDigits } from "@convex/lib/digits";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@web/lib/format";
import { useQuery } from "convex/react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { AdminPushCard } from "../components/AdminPushCard";
import { StatTile } from "../components/StatTile";
import { TrendChart } from "../components/TrendChart";
import { SettingList } from "../components/SettingField";
import { t } from "../i18n/ar";
import { useAdminToken } from "../lib/adminSession";
import { formatCount, formatDecimal } from "../lib/formatNumber";

const QUICK = ["maintenanceMode", "maintenanceMessage", "announcement"];

/** Open help requests and how long the oldest has waited (spec 6.1, first block). */
function OpenHelpCard({ adminToken }: { adminToken: string }) {
  const counts = useQuery(api.adminHelp.counts, { adminToken });
  if (!counts || counts.open === 0) return null;
  return (
    <Link
      to="/help"
      className="flex items-center justify-between rounded-lg bg-saffron-soft px-4 py-3 text-saffron-ink"
    >
      <span>
        <span className="block font-semibold">{t.help.homeCard}</span>
        {counts.oldestOpenAt !== null && (
          <span className="text-sm">
            {t.help.oldest(formatDate(counts.oldestOpenAt))}
          </span>
        )}
      </span>
      <span className="rounded-full bg-sidebar-primary px-3 py-1 font-semibold text-sidebar-primary-foreground">
        {counts.open >= 100 ? t.help.manyOpen : toWesternDigits(counts.open)}
      </span>
    </Link>
  );
}

const PERIODS = [7, 30, 365] as const;
const METRICS = [
  "ajzaFinished",
  "newMembers",
  "newKhatmas",
  "roundsCompleted",
  "signInRate",
] as const;
type Period = (typeof PERIODS)[number];
type Metric = (typeof METRICS)[number];

const percent = (rate: number) =>
  t.stats.percent(formatCount(Math.round(rate * 100)));

function signedChange(now: number, before: number): string {
  const diff = now - before;
  return `${diff >= 0 ? "+" : "−"}${formatCount(Math.abs(diff))}`;
}

/** The six numbers, the trend chart and sign-in health (spec 6.1). Group totals only. */
function Dashboard({ adminToken }: { adminToken: string }) {
  const o = useQuery(api.adminStats.overview, { adminToken });
  const [days, setDays] = useState<Period>(30);
  const [metric, setMetric] = useState<Metric>("ajzaFinished");
  const metricId = useId();
  const trend = useQuery(api.adminStats.trend, { adminToken, metric, days });
  if (!o) return null;

  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile
          label={t.stats.activeKhatmas}
          value={formatCount(o.activeKhatmas)}
          detail={
            o.activeKhatmasWeekAgo === null
              ? undefined
              : t.stats.changeWeek(
                  signedChange(o.activeKhatmas, o.activeKhatmasWeekAgo),
                )
          }
        />
        <StatTile
          label={t.stats.members}
          value={formatCount(o.members)}
          detail={t.stats.newThisWeek(formatCount(o.membersNewThisWeek))}
        />
        <StatTile
          label={t.stats.ajzaToday}
          value={formatCount(o.ajzaToday)}
          detail={t.stats.avg7(formatDecimal(o.ajzaAvg7))}
        />
        <StatTile
          label={t.stats.completedThisWeek}
          value={formatCount(o.completedThisWeek)}
        />
        <StatTile
          label={t.stats.rotaDaysCompleted}
          value={formatCount(o.rotaDaysCompletedThisWeek)}
          detail={t.stats.thisWeek}
        />
        <StatTile
          label={t.stats.stalled}
          value={
            o.stalledCapped
              ? t.stats.capped(formatCount(o.stalledKhatmas))
              : formatCount(o.stalledKhatmas)
          }
          detail={t.stats.stalledHint}
        />
        <StatTile
          label={t.stats.daysPerRound}
          value={
            o.daysPerRoundMedian === null
              ? t.stats.none
              : t.stats.days(o.daysPerRoundMedian)
          }
          detail={t.stats.medianHint}
        />
      </div>

      <section className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={metricId} className="sr-only">
            {t.stats.metric}
          </label>
          <select
            id={metricId}
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            className="rounded-lg border bg-card px-2 py-1 text-sm"
          >
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {t.stats.metrics[m]}
              </option>
            ))}
          </select>
          <div
            role="radiogroup"
            aria-label={t.stats.period}
            className="flex gap-1"
          >
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={p === days}
                onClick={() => setDays(p)}
                className={`rounded-full px-2.5 py-1 text-xs ${p === days ? "bg-primary text-primary-foreground" : "border "}`}
              >
                {t.stats.periods[p]}
              </button>
            ))}
          </div>
        </div>
        {trend && (
          <TrendChart
            points={trend}
            label={t.stats.metrics[metric]}
            period={t.stats.periods[days]}
            format={metric === "signInRate" ? percent : formatCount}
          />
        )}
      </section>

      <StatTile
        testId="signin-card"
        label={t.stats.signIn}
        value={
          o.signInSuccess7 === null ? t.stats.none : percent(o.signInSuccess7)
        }
        detail={t.stats.signInHint}
        tone={
          o.signInSuccess7 !== null && o.signInSuccess7 < 0.8
            ? "warn"
            : "normal"
        }
      />
    </>
  );
}

/** The front page: help first, then the numbers, push, and the quick switches. */
export function HomePage() {
  const adminToken = useAdminToken() ?? "";
  const rows = useQuery(api.adminSettings.list, { adminToken });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.home.title} />
      <OpenHelpCard adminToken={adminToken} />
      <Link
        to="/rota/new"
        className={`${buttonVariants({ variant: "outline" })} sm:self-start`}
      >
        {t.rota.create}
      </Link>
      <Dashboard adminToken={adminToken} />
      <AdminPushCard />
      <h2 className="text-lg font-semibold">{t.home.switches}</h2>
      <SettingList
        rows={(rows ?? []).filter((row) => QUICK.includes(row.key))}
      />
    </div>
  );
}
