import { useState } from 'react';
import type { DailyStats, PrompterSettings } from '../../../src/shared/models';
import { getLocaleText } from '../i18n';

// ─── helpers ────────────────────────────────────────────────────────────────

function getIntensity(totalCount: number): 0 | 1 | 2 | 3 | 4 {
  if (totalCount < 10) return 0;
  if (totalCount < 30) return 1;
  if (totalCount < 60) return 2;
  if (totalCount < 100) return 3;
  return 4;
}

/** Returns YYYY-MM-DD using LOCAL time (avoids UTC offset shifting the date) */
function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build a calendar-month grid (Mon–Sun columns). */
function buildMonthGrid(year: number, month: number): (Date | null)[][] {
  const rows: (Date | null)[][] = [];
  const first = new Date(year, month, 1);
  // Mon-based: Mon=0 … Sun=6
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let dayNum = 1 - startDow;
  for (let row = 0; row < 6; row++) {
    const week: (Date | null)[] = [];
    for (let col = 0; col < 7; col++) {
      week.push(dayNum > 0 && dayNum <= daysInMonth ? new Date(year, month, dayNum) : null);
      dayNum++;
    }
    rows.push(week);
    if (dayNum > daysInMonth) break;
  }
  return rows;
}

/**
 * Always show the 12 months ending with the current month,
 * regardless of whether there is any data.
 */
/** Returns all 12 months (Jan–Dec) for the given year */
function getYearMonths(year: number): { year: number; month: number }[] {
  return Array.from({ length: 12 }, (_, m) => ({ year, month: m }));
}

const DOW_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES_FULL  = ['January','February','March','April','May','June',
                           'July','August','September','October','November','December'];

// ─── Tooltip ────────────────────────────────────────────────────────────────

interface TooltipInfo {
  date: string;
  total: number;
  unused: number;
  completed: number;
  x: number;
  y: number;
}

// ─── Year-overview: one tiny cell per day ───────────────────────────────────

function MonthMini({
  language,
  year,
  month,
  statsByDate,
  todayKey,
  selectedDate,
  onClickMonth
}: {
  language: PrompterSettings['language'];
  year: number;
  month: number;
  statsByDate: Map<string, DailyStats>;
  todayKey: string;
  selectedDate?: string;
  onClickMonth: (year: number, month: number) => void;
}) {
  const localeText = getLocaleText(language);
  const grid = buildMonthGrid(year, month);
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const isSelectedMonth = selectedDate?.startsWith(monthKey);

  return (
    <button
      type="button"
      className={`heatmap-month-mini${isSelectedMonth ? ' heatmap-month-mini--selected' : ''}`}
      onClick={() => onClickMonth(year, month)}
      title={localeText.history.activityDrilldown(MONTH_NAMES_FULL[month]!, year)}
    >
      <div className="heatmap-month-mini-title">
        {MONTH_NAMES_SHORT[month]}
      </div>
      <div className="heatmap-mini-grid">
        {/* DOW header */}
        {DOW_LABELS.map((l, i) => (
          <span key={i} className="heatmap-mini-dow">{l}</span>
        ))}
        {/* Day cells */}
        {grid.map((week, wi) =>
          week.map((day, di) => {
            if (!day) return <span key={`${wi}-${di}`} className="heatmap-mini-cell heatmap-mini-empty" />;
            const key = toKey(day);
            const s = statsByDate.get(key);
            return (
              <span
                key={`${wi}-${di}`}
                className="heatmap-mini-cell"
                data-intensity={getIntensity(s?.totalCount ?? 0)}
                data-today={key === todayKey ? 'true' : undefined}
                data-selected={key === selectedDate ? 'true' : undefined}
              />
            );
          })
        )}
      </div>
    </button>
  );
}

// ─── Month-detail: large calendar with clickable days ───────────────────────

function MonthDetail({
  language,
  year,
  month,
  statsByDate,
  todayKey,
  selectedDate,
  onSelectDate,
  onBack,
  tooltip,
  setTooltip
}: {
  language: PrompterSettings['language'];
  year: number;
  month: number;
  statsByDate: Map<string, DailyStats>;
  todayKey: string;
  selectedDate?: string;
  onSelectDate: (date: string) => void;
  onBack: () => void;
  tooltip: TooltipInfo | null;
  setTooltip: (t: TooltipInfo | null) => void;
}) {
  const localeText = getLocaleText(language);
  const grid = buildMonthGrid(year, month);

  return (
    <div className="heatmap-detail">
      <div className="heatmap-detail-header">
        <button type="button" className="heatmap-back-btn" onClick={onBack}>
          {`← ${localeText.history.backToYearView}`}
        </button>
        <span className="heatmap-detail-title">
          {localeText.history.activityDrilldown(MONTH_NAMES_FULL[month]!, year)}
        </span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="heatmap-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          aria-hidden="true"
        >
          <strong>{tooltip.date}</strong>
          <span>{localeText.history.tooltipTotal(tooltip.total)}</span>
          <span className="heatmap-tooltip-row">
            <span className="heatmap-dot unused" />{localeText.history.tooltipUnused(tooltip.unused)}
          </span>
          <span className="heatmap-tooltip-row">
            <span className="heatmap-dot completed" />{localeText.history.tooltipCompleted(tooltip.completed)}
          </span>
        </div>
      )}

      <div className="heatmap-detail-grid-wrap">
        {/* DOW header */}
        <div className="heatmap-detail-dow-row">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <span key={d} className="heatmap-dow">{d}</span>
          ))}
        </div>
        {/* Weeks */}
        {grid.map((week, wi) => (
          <div key={wi} className="heatmap-week">
            {week.map((day, di) => {
              if (!day) return <span key={di} className="heatmap-day heatmap-day-empty" />;
              const key = toKey(day);
              const s = statsByDate.get(key);
              return (
                <button
                  key={di}
                  type="button"
                  className="heatmap-day"
                  data-intensity={getIntensity(s?.totalCount ?? 0)}
                  aria-pressed={key === selectedDate}
                  data-today={key === todayKey ? 'true' : undefined}
                  onClick={() => onSelectDate(key)}
                  onMouseEnter={(e) => {
                    const wrap = (e.currentTarget as HTMLElement).closest('.heatmap-detail-grid-wrap')!;
                    const wrapRect = wrap.getBoundingClientRect();
                    const btnRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setTooltip({
                      date: key,
                      total: s?.totalCount ?? 0,
                      unused: s?.unusedCount ?? 0,
                      completed: s?.completedCount ?? 0,
                      x: btnRect.left - wrapRect.left + btnRect.width / 2,
                      y: btnRect.top - wrapRect.top + btnRect.height + 6
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <span className="heatmap-day-label">{day.getDate()}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Heatmap component ──────────────────────────────────────────────────

export function Heatmap({
  language = 'zh-CN',
  stats,
  selectedDate,
  onSelectDate
}: {
  language?: PrompterSettings['language'];
  stats: DailyStats[];
  selectedDate?: string;
  onSelectDate: (date: string) => void;
}) {
  const thisYear = new Date().getFullYear();
  const localeText = getLocaleText(language);
  const [currentYear, setCurrentYear] = useState(thisYear);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  // null = year overview; {year,month} = drill-down into that month
  const [drillDown, setDrillDown] = useState<{ year: number; month: number } | null>(null);

  const statsByDate = new Map(stats.map((s) => [s.date, s]));
  const months = getYearMonths(currentYear);
  const todayKey = toKey(new Date());

  const handleClickMonth = (year: number, month: number) => {
    setDrillDown({ year, month });
    setTooltip(null);
    onSelectDate(''); // clear selected date when entering a month
  };

  // When switching year, exit drill-down back to year overview
  const handlePrevYear = () => {
    setCurrentYear((y) => y - 1);
    setDrillDown(null);
    onSelectDate(''); // clear selected date when switching year
  };
  const handleNextYear = () => {
    setCurrentYear((y) => y + 1);
    setDrillDown(null);
    onSelectDate(''); // clear selected date when switching year
  };

  return (
    <section className="history-heatmap" aria-label={localeText.history.heatmapAriaLabel}>
      <div className="panel-header">
        <h2>
          {localeText.history.activityHeading}
          {drillDown && (
            <span className="heatmap-drilldown-hint">
              {' — '}{localeText.history.activityDrilldown(MONTH_NAMES_FULL[drillDown.month]!, drillDown.year)}
            </span>
          )}
        </h2>

        <div className="heatmap-header-right">
          {/* Year switcher */}
          {!drillDown && (
            <div className="heatmap-year-switcher">
              <button
                type="button"
                className="heatmap-year-btn"
                onClick={handlePrevYear}
                aria-label={localeText.history.previousYear}
              >
                ◀
              </button>
              <span className="heatmap-year-label">{currentYear}</span>
              <button
                type="button"
                className="heatmap-year-btn"
                onClick={handleNextYear}
                disabled={currentYear >= thisYear}
                aria-label={localeText.history.nextYear}
              >
                ▶
              </button>
            </div>
          )}
          {/* Legend */}
          <div className="heatmap-legend">
            <span>{localeText.history.less}</span>
            {([0, 1, 2, 3, 4] as const).map((lvl) => (
              <span key={lvl} className="heatmap-legend-cell" data-intensity={lvl} />
            ))}
            <span>{localeText.history.more}</span>
          </div>
        </div>
      </div>

      {drillDown ? (
        <MonthDetail
          language={language}
          year={drillDown.year}
          month={drillDown.month}
          statsByDate={statsByDate}
          todayKey={todayKey}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onBack={() => { setDrillDown(null); onSelectDate(''); }}
          tooltip={tooltip}
          setTooltip={setTooltip}
        />
      ) : (
        /* Year overview: 12 mini-month blocks */
        <div className="heatmap-year-grid">
          {months.map(({ year, month }: { year: number; month: number }) => (
            <MonthMini
              key={`${year}-${month}`}
              language={language}
              year={year}
              month={month}
              statsByDate={statsByDate}
              todayKey={todayKey}
              selectedDate={selectedDate}
              onClickMonth={handleClickMonth}
            />
          ))}
        </div>
      )}
    </section>
  );
}
