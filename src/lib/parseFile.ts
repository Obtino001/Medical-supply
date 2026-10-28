// Reads CSV / XLSX / XLS into a grid of strings. Header selection happens later (see importBuild).
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export const MAX_FILE_BYTES = 25 * 1024 * 1024

export interface ParsedGrid {
  filename: string
  size: number
  hash: string
  grid: string[][] // raw rows, including any title lines above the header
  sheetName?: string
}

export class FileError extends Error {}

export function validateFile(name: string, size: number): void {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'doc', 'docx'].includes(ext)) {
    throw new FileError(`.${ext} files are not supported yet. Ask the shop for CSV or Excel, or export the list to .xlsx first. PDF/image extraction is not implemented.`)
  }
  if (!['csv', 'tsv', 'txt', 'xlsx', 'xls', 'xlsm'].includes(ext)) {
    throw new FileError(`Unsupported file type ".${ext}". Use CSV or Excel (.xlsx / .xls).`)
  }
  if (size === 0) throw new FileError('The file is empty.')
  if (size > MAX_FILE_BYTES) throw new FileError(`File is too large (${(size / 1048576).toFixed(1)} MB). Limit is ${MAX_FILE_BYTES / 1048576} MB.`)
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const cell = (v: unknown): string => (v == null ? '' : String(v).trim())

export function parseCsvText(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const res = Papa.parse<string[]>(clean, { skipEmptyLines: false, delimiter: '' })
  return res.data.map((r) => (Array.isArray(r) ? r.map(cell) : []))
}

export function parseWorkbook(buf: ArrayBuffer): { grid: string[][]; sheetName: string } {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new FileError('The workbook has no sheets.')
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true })
  return { grid: rows.map((r) => r.map(cell)), sheetName }
}

export async function readFile(file: File): Promise<ParsedGrid> {
  validateFile(file.name, file.size)
  const buf = await file.arrayBuffer()
  const hash = await sha256(buf)
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  try {
    if (['xlsx', 'xls', 'xlsm'].includes(ext)) {
      const { grid, sheetName } = parseWorkbook(buf)
      return { filename: file.name, size: file.size, hash, grid, sheetName }
    }
    const text = new TextDecoder('utf-8').decode(buf)
    return { filename: file.name, size: file.size, hash, grid: parseCsvText(text) }
  } catch (e) {
    if (e instanceof FileError) throw e
    throw new FileError(`Could not read the file: ${(e as Error).message}`)
  }
}
