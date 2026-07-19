import type { CalendarException, CapacityModel, WorkingCalendar } from "@capacity/domain";
import { parseCsvTable } from "./csv.js";
import {
  type BaseImportControlTotals,
  type BaseImportMapping,
  type ImportDateFormat,
  type ImportIssue,
  type ImportResult,
  type MergeMode,
  mergeById,
  parseIsoDate,
  parseNumber,
  requiredHeaders,
  rowHasError,
  textValue,
  warningRowCount,
} from "./shared.js";

export interface CalendarCsvMapping extends BaseImportMapping {
  calendarIdColumn: string;
  calendarNameColumn: string;
  timezoneColumn?: string;
  defaultTimezone?: string;
  monMinutesColumn: string;
  tueMinutesColumn: string;
  wedMinutesColumn: string;
  thuMinutesColumn: string;
  friMinutesColumn: string;
  satMinutesColumn: string;
  sunMinutesColumn: string;
}

export interface CalendarExceptionCsvMapping extends BaseImportMapping {
  calendarIdColumn: string;
  exceptionDateColumn: string;
  availableMinutesColumn: string;
  reasonColumn?: string;
  dateFormat?: ImportDateFormat;
}

export interface CalendarImportControlTotals extends BaseImportControlTotals {
  calendarCount: number;
  exceptionCount: number;
  earliestExceptionDate: string | null;
  latestExceptionDate: string | null;
}

export type CalendarImportResult = ImportResult<WorkingCalendar, CalendarImportControlTotals>;

function minutesIssue(rowNumber: number, column: string, raw: string): ImportIssue | null {
  const value = parseNumber(raw);
  return value === null || value < 0 || value > 1440
    ? { rowNumber, severity: "error", code: "WEEKLY_MINUTES_INVALID", message: `Minutes must be between 0 and 1440; received '${raw}'`, column, value: raw }
    : null;
}

export function importCalendarsCsv(
  csv: string,
  exceptionsCsv: string | undefined,
  model: CapacityModel,
  mapping: CalendarCsvMapping,
  exceptionMapping: CalendarExceptionCsvMapping | undefined,
  mode: MergeMode = "replaceById",
): CalendarImportResult {
  const table = parseCsvTable(csv, mapping.delimiter ?? ",");
  const scheduleColumns = [
    mapping.calendarIdColumn,
    mapping.calendarNameColumn,
    mapping.timezoneColumn,
    mapping.monMinutesColumn,
    mapping.tueMinutesColumn,
    mapping.wedMinutesColumn,
    mapping.thuMinutesColumn,
    mapping.friMinutesColumn,
    mapping.satMinutesColumn,
    mapping.sunMinutesColumn,
  ];
  const missing = requiredHeaders(table.headers, scheduleColumns);
  if (missing.length > 0) throw new Error(`CSV is missing mapped columns: ${missing.join(", ")}`);
  if (!mapping.timezoneColumn && !mapping.defaultTimezone) throw new Error("defaultTimezone or timezoneColumn is required");

  const issues: ImportIssue[] = [];
  const issuesByRow = new Map<number, ImportIssue[]>();
  const records: WorkingCalendar[] = [];
  const seenIds = new Set<string>();

  table.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rowIssues: ImportIssue[] = [];
    const id = textValue(row, mapping.calendarIdColumn, mapping);
    const name = textValue(row, mapping.calendarNameColumn, mapping);
    const timezone = mapping.timezoneColumn ? textValue(row, mapping.timezoneColumn, mapping) : mapping.defaultTimezone ?? "";
    const dayColumns = [
      mapping.sunMinutesColumn,
      mapping.monMinutesColumn,
      mapping.tueMinutesColumn,
      mapping.wedMinutesColumn,
      mapping.thuMinutesColumn,
      mapping.friMinutesColumn,
      mapping.satMinutesColumn,
    ] as const;
    const dayValues = dayColumns.map(column => textValue(row, column, mapping));

    if (!id) rowIssues.push({ rowNumber, severity: "error", code: "CALENDAR_ID_REQUIRED", message: "Calendar ID is required", column: mapping.calendarIdColumn });
    if (!name) rowIssues.push({ rowNumber, severity: "error", code: "CALENDAR_NAME_REQUIRED", message: "Calendar name is required", column: mapping.calendarNameColumn });
    if (!timezone) rowIssues.push({ rowNumber, severity: "error", code: "CALENDAR_TIMEZONE_REQUIRED", message: "Calendar timezone is required", column: mapping.timezoneColumn });
    if (id && seenIds.has(id)) rowIssues.push({ rowNumber, entityKey: id, severity: "error", code: "CALENDAR_ID_DUPLICATE", message: `Duplicate calendar ID '${id}'`, column: mapping.calendarIdColumn, value: id });
    dayColumns.forEach((column, dayIndex) => {
      const issue = minutesIssue(rowNumber, column, dayValues[dayIndex] ?? "");
      if (issue) rowIssues.push(issue);
    });

    if (id) seenIds.add(id);
    issuesByRow.set(rowNumber, rowIssues);
    issues.push(...rowIssues);
    if (rowHasError(rowIssues) || !id || !name || !timezone) return;

    const weeklyMinutes: WorkingCalendar["weeklyMinutes"] = {};
    dayValues.forEach((raw, dayIndex) => {
      const value = parseNumber(raw);
      if (value !== null) weeklyMinutes[dayIndex as 0 | 1 | 2 | 3 | 4 | 5 | 6] = value;
    });
    records.push({ id, name, timezone, weeklyMinutes, exceptions: [] });
  });

  let exceptionCount = 0;
  let earliestExceptionDate: string | null = null;
  let latestExceptionDate: string | null = null;
  if (exceptionsCsv && exceptionsCsv.trim().length > 0) {
    if (!exceptionMapping) throw new Error("exceptionMapping is required when exceptionsCsv is supplied");
    const exceptionTable = parseCsvTable(exceptionsCsv, exceptionMapping.delimiter ?? ",");
    const exceptionMissing = requiredHeaders(exceptionTable.headers, [
      exceptionMapping.calendarIdColumn,
      exceptionMapping.exceptionDateColumn,
      exceptionMapping.availableMinutesColumn,
      exceptionMapping.reasonColumn,
    ]);
    if (exceptionMissing.length > 0) throw new Error(`Exception CSV is missing mapped columns: ${exceptionMissing.join(", ")}`);
    const byId = new Map(records.map(record => [record.id, record]));
    const seenException = new Set<string>();

    exceptionTable.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const rowIssues: ImportIssue[] = [];
      const calendarId = textValue(row, exceptionMapping.calendarIdColumn, exceptionMapping);
      const rawDate = textValue(row, exceptionMapping.exceptionDateColumn, exceptionMapping);
      const date = parseIsoDate(rawDate, exceptionMapping.dateFormat ?? "iso");
      const rawMinutes = textValue(row, exceptionMapping.availableMinutesColumn, exceptionMapping);
      const availableMinutes = parseNumber(rawMinutes);
      const reason = textValue(row, exceptionMapping.reasonColumn, exceptionMapping);
      const calendar = byId.get(calendarId) ?? model.calendars.find(item => item.id === calendarId);
      const key = `${calendarId}:${date ?? rawDate}`;

      if (!calendar) rowIssues.push({ rowNumber, entityKey: calendarId, severity: "error", code: "EXCEPTION_CALENDAR_NOT_FOUND", message: `Calendar '${calendarId}' was not found`, column: exceptionMapping.calendarIdColumn, value: calendarId });
      if (!date) rowIssues.push({ rowNumber, entityKey: calendarId, severity: "error", code: "EXCEPTION_DATE_INVALID", message: `Invalid exception date '${rawDate}'`, column: exceptionMapping.exceptionDateColumn, value: rawDate });
      if (availableMinutes === null || availableMinutes < 0 || availableMinutes > 1440) rowIssues.push({ rowNumber, entityKey: calendarId, severity: "error", code: "EXCEPTION_MINUTES_INVALID", message: `Available minutes must be between 0 and 1440; received '${rawMinutes}'`, column: exceptionMapping.availableMinutesColumn, value: rawMinutes });
      if (seenException.has(key)) rowIssues.push({ rowNumber, entityKey: calendarId, severity: "error", code: "EXCEPTION_DUPLICATE", message: `Duplicate exception '${key}'` });
      seenException.add(key);
      issues.push(...rowIssues);
      if (rowHasError(rowIssues) || !calendar || !date || availableMinutes === null) return;

      const target = byId.get(calendarId);
      if (!target) {
        issues.push({ rowNumber, entityKey: calendarId, severity: "warning", code: "EXCEPTION_EXISTING_CALENDAR", message: `Exception belongs to an existing calendar not included in this schedule import and will not be applied` });
        return;
      }
      const exception: CalendarException = { date, availableMinutes, ...(reason ? { reason } : {}) };
      target.exceptions.push(exception);
      exceptionCount += 1;
      earliestExceptionDate = earliestExceptionDate === null || date < earliestExceptionDate ? date : earliestExceptionDate;
      latestExceptionDate = latestExceptionDate === null || date > latestExceptionDate ? date : latestExceptionDate;
    });
  }

  const merged = mergeById(model.calendars, records, mode);
  return {
    records,
    issues,
    controlTotals: {
      inputRows: table.rows.length,
      acceptedRows: records.length,
      rejectedRows: table.rows.length - records.length,
      warningRows: warningRowCount(issuesByRow),
      addedRecords: merged.addedRecords,
      replacedRecords: merged.replacedRecords,
      unchangedRecords: merged.unchangedRecords,
      calendarCount: records.length,
      exceptionCount,
      earliestExceptionDate,
      latestExceptionDate,
    },
  };
}

export function mergeCalendarsImport(model: CapacityModel, records: WorkingCalendar[], mode: MergeMode = "replaceById"): CapacityModel {
  const merged = mergeById(model.calendars, records, mode);
  return { ...model, calendars: merged.records };
}
