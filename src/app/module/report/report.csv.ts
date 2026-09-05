import { Response } from "express";

/**
 * CSV generation for report exports. Hand-written rather than a dependency:
 * the whole of RFC 4180 escaping that matters here is "wrap in quotes and
 * double any quote", which is the `escapeCell` function below.
 */

/** Byte-order mark. Without it Excel opens a UTF-8 file as the system codepage and Bangla text arrives as mojibake. */
const BOM = "﻿";

/** CRLF, which is what RFC 4180 specifies and what Excel is least surprised by. */
const EOL = "\r\n";

export type CsvValue = string | number | boolean | Date | null | undefined;

/**
 * Amounts are emitted as bare decimals — no currency symbol, no thousands
 * separator — so a spreadsheet reads the column as numbers rather than text
 * (`admin-reporting/report-shell`, "export column values match the screen").
 */
const formatCell = (value: CsvValue): string => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return value;
};

const escapeCell = (value: CsvValue): string => {
    const text = formatCell(value);
    // A comma, a quote, a newline or leading/trailing space all need quoting;
    // without it a purchase order note containing a comma splits into two
    // columns and shifts every column after it on that row.
    if (/[",\r\n]/.test(text) || text !== text.trim()) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};

export const toCsvRow = (cells: CsvValue[]): string => cells.map(escapeCell).join(",") + EOL;

export interface ICsvColumn<TRow> {
    header: string;
    value: (row: TRow) => CsvValue;
}

/** Filenames like `sales-report_2026-03-01_to_2026-03-31.csv`, so several exports do not collide in a downloads folder. */
export const exportFilename = (report: string, from?: string, to?: string) =>
    from && to ? `${report}_${from}_to_${to}.csv` : `${report}_${new Date().toISOString().slice(0, 10)}.csv`;

/**
 * Streams a full result set as CSV, in batches, straight to the response.
 *
 * Why streaming (design decision 7): it caps server memory at one batch no
 * matter how many rows match, which is what lets the spec's "every matching
 * row" hold with no row limit bolted on top.
 *
 * The headers and the header row are written only AFTER the first batch query
 * succeeds. That is where connection, permission and query errors surface, so
 * a failure at that point can still be turned into a normal JSON error
 * response by the caller's error handler rather than a truncated download.
 * Once the first byte is out the status code is committed; a later mid-stream
 * failure is logged and the response destroyed, which the browser surfaces as
 * a failed download rather than a silently short file.
 */
export const streamCsv = async <TRow>(
    res: Response,
    options: {
        filename: string;
        columns: ICsvColumn<TRow>[];
        /** Returns the next batch. Resolve an empty array to finish. */
        fetchBatch: (offset: number, limit: number) => Promise<TRow[]>;
        batchSize?: number;
    },
): Promise<void> => {
    const batchSize = options.batchSize ?? 1_000;

    let offset = 0;
    let firstBatch = await options.fetchBatch(offset, batchSize);
    let started = false;

    try {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${options.filename}"`);
        // The browser must not serve a stale export for a changed filter set.
        res.setHeader("Cache-Control", "no-store");

        res.write(BOM + toCsvRow(options.columns.map((column) => column.header)));
        started = true;

        // An empty result still produces the header row above — a file, not an
        // error and not an empty download.
        while (firstBatch.length > 0) {
            for (const row of firstBatch) {
                res.write(toCsvRow(options.columns.map((column) => column.value(row))));
            }

            if (firstBatch.length < batchSize) break;

            offset += batchSize;
            firstBatch = await options.fetchBatch(offset, batchSize);
        }

        res.end();
    } catch (error) {
        if (started) {
            console.error(`CSV export failed part-way through ${options.filename}:`, error);
            res.destroy();
            return;
        }
        throw error;
    }
};
