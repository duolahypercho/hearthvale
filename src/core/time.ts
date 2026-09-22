/**
 * Calendar / clock.
 *  - 10 in-game minutes per 7 real seconds.
 *  - A day runs 6:00 -> 26:00 (2:00 am). At 26:00 the player passes out.
 *  - 28 days per season, 4 seasons per year.
 * `hour` is a continuous float (lighting reads it); `time:tick` fires every 10 minutes.
 */
import type { EventBus } from './events';

export type Season = 'spring' | 'summer' | 'fall' | 'winter';
export type Weather = 'sun' | 'rain' | 'storm' | 'snow' | 'wind';

export const SEASONS: readonly Season[] = ['spring', 'summer', 'fall', 'winter'];
export const WEATHERS: readonly Weather[] = ['sun', 'rain', 'storm', 'snow', 'wind'];
export const DAYS_PER_SEASON = 28;
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 26;
/** In-game minutes that pass per real second. */
export const GAME_MINUTES_PER_SECOND = 10 / 7;
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface CalendarState {
  hour: number;
  day: number;
  season: Season;
  year: number;
  weather: Weather;
}

export class Calendar implements CalendarState {
  hour = 6;
  day = 1;
  season: Season = 'spring';
  year = 1;
  weather: Weather = 'sun';
  /** When true the clock does not advance (menus, cutscenes, debug pause). */
  frozen = false;
  private lastTickMinute = 0;

  constructor(private events: EventBus) {}

  get minute(): number {
    return Math.floor((this.hour % 1) * 60 + 1e-6);
  }
  get totalMinutes(): number {
    return Math.floor(this.hour * 60 + 1e-6);
  }
  get seasonIndex(): number {
    return SEASONS.indexOf(this.season);
  }
  get weekday(): string {
    return WEEKDAYS[(this.day - 1) % 7]!;
  }
  /** 0 at 6:00 -> 1 at 26:00. */
  get dayProgress(): number {
    return (this.hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR);
  }

  /** "8:30 am" style clock string (10-minute granularity like classic farm sims). */
  clockString(): string {
    const tm = Math.floor(this.totalMinutes / 10) * 10;
    let h = Math.floor(tm / 60) % 24;
    const m = tm % 60;
    const pm = h >= 12;
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, '0')} ${pm ? 'pm' : 'am'}`;
  }

  advance(realDt: number): void {
    if (this.frozen) return;
    const prevHour = Math.floor(this.hour);
    this.hour = Math.min(DAY_END_HOUR, this.hour + (realDt * GAME_MINUTES_PER_SECOND) / 60);
    const tm = this.totalMinutes;
    const tick = Math.floor(tm / 10) * 10;
    if (tick !== this.lastTickMinute) {
      this.lastTickMinute = tick;
      this.events.emit('time:tick', { hour: Math.floor(tick / 60), minute: tick % 60, totalMinutes: tick });
    }
    if (Math.floor(this.hour) !== prevHour) this.events.emit('time:hour', { hour: Math.floor(this.hour) });
    if (this.hour >= DAY_END_HOUR) {
      this.endDay(true);
    }
  }

  setHour(h: number): void {
    this.hour = Math.max(0, Math.min(DAY_END_HOUR, h));
    this.lastTickMinute = Math.floor(this.totalMinutes / 10) * 10;
    this.events.emit('time:set', { hour: this.hour });
  }

  setDay(day: number): void {
    this.day = Math.max(1, Math.min(DAYS_PER_SEASON, Math.floor(day)));
    this.events.emit('day:start', { day: this.day, season: this.season, year: this.year });
  }

  setSeason(season: Season): void {
    if (season === this.season) return;
    const prev = this.season;
    this.season = season;
    this.events.emit('season:change', { season, prev });
  }

  setWeather(weather: Weather): void {
    if (weather === this.weather) return;
    const prev = this.weather;
    this.weather = weather;
    this.events.emit('weather:change', { weather, prev });
  }

  /** Ends the day, rolls the calendar, starts the next morning at 6:00. */
  endDay(passedOut = false): void {
    this.events.emit('day:end', { day: this.day, season: this.season, year: this.year, passedOut });
    this.day++;
    if (this.day > DAYS_PER_SEASON) {
      this.day = 1;
      const idx = (this.seasonIndex + 1) % 4;
      if (idx === 0) this.year++;
      this.setSeason(SEASONS[idx]!);
    }
    this.setHour(DAY_START_HOUR);
    this.events.emit('day:start', { day: this.day, season: this.season, year: this.year });
  }

  serialize(): CalendarState {
    return { hour: this.hour, day: this.day, season: this.season, year: this.year, weather: this.weather };
  }

  deserialize(s: Partial<CalendarState>): void {
    if (s.season) this.setSeason(s.season);
    if (s.weather) this.setWeather(s.weather);
    if (typeof s.year === 'number') this.year = s.year;
    if (typeof s.day === 'number') this.day = s.day;
    if (typeof s.hour === 'number') this.setHour(s.hour);
  }
}
