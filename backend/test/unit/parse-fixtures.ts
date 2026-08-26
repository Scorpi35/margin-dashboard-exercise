import * as XLSX from 'xlsx';

/** Builds an in-memory `.xlsx` buffer, so the failure paths need no committed fixture files. */
export function workbookBuffer(sheetName: string, rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export const TIMESHEET_HEADER = [
  'Month',
  'Employee No.',
  'Employee Name',
  'Type of Expense',
  'Department',
  'Designation',
  'Category',
  'Ref Code',
  'Project (Billable) / Task (Unbillable) Name',
  'Company Name (Billable)/ Fixed Costs (Unbillable)',
  'Description',
  'Hours',
];

/** A well-formed timesheet row, so a fixture only has to state what it breaks. */
export function timesheetRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    Month: 'January 2025',
    'Employee No.': '10201',
    'Employee Name': 'Ayesha Rahman',
    'Type of Expense': 'DL',
    Department: 'Design',
    Designation: 'Senior UI/UX Designer',
    Category: 'Projects',
    'Ref Code': 'Q2025001a',
    'Project (Billable) / Task (Unbillable) Name': 'Meridian Website',
    'Company Name (Billable)/ Fixed Costs (Unbillable)': 'Meridian',
    Description: 'design',
    Hours: 8,
  };

  return TIMESHEET_HEADER.map((column) => (column in overrides ? overrides[column] : base[column]));
}
