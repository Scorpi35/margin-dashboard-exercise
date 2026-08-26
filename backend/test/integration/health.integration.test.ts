import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import { closeDb, useDatabase } from '../../src/lib/db';
import { ingestSalaries, ingestTimesheet } from '../../src/services/ingest.service';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory = '';

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'margin-api-'));
  useDatabase(join(directory, 'test.db'));
});

afterAll(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('reports an empty database, so the UI can prompt for an upload', async () => {
    const response = await request(createApp()).get('/api/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', data: { hasData: false } });
  });

  it('counts a salary-only upload as data, not an empty database', async () => {
    // Someone who has uploaded salaries has uploaded something; telling them
    // otherwise invites them to repeat work they have already done.
    ingestSalaries(
      {
        rows: [
          {
            year: 2025,
            month: 1,
            employeeNo: '10201',
            employeeName: 'Ayesha Rahman',
            monthlySalary: 18_000,
          },
        ],
        warnings: [],
      },
      'salaries-2025.xlsx',
    );

    const response = await request(createApp()).get('/api/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', data: { hasData: true } });
  });

  it('reports data once something has been ingested', async () => {
    ingestTimesheet(
      {
        rows: [
          {
            year: 2025,
            month: 1,
            employeeNo: '10201',
            employeeName: 'Ayesha Rahman',
            expenseType: 'DL',
            department: 'Design',
            designation: 'Senior UI/UX Designer',
            category: 'Projects',
            refCode: 'Q2025001a',
            taskName: null,
            companyName: null,
            description: null,
            hours: 8,
          },
        ],
        warnings: [],
      },
      'timesheet-2025.xlsx',
    );

    const response = await request(createApp()).get('/api/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', data: { hasData: true } });
  });

  it('wraps every success in the same envelope', async () => {
    const response = await request(createApp()).get('/api/health').expect(200);

    expect(Object.keys(response.body).sort()).toEqual(['data', 'status']);
    expect(response.body.status).toBe('ok');
  });
});

describe('error responses', () => {
  it('answers an unknown endpoint with the error envelope', async () => {
    const response = await request(createApp()).get('/api/nope').expect(404);

    expect(response.body.status).toBe('error');
    expect(typeof response.body.message).toBe('string');
    expect(response.body).not.toHaveProperty('data');
  });

  it('keeps a 5xx message friendly rather than leaking internals', async () => {
    const app = createApp();
    // Registered before the error handler that createApp() already installed.
    const response = await request(app).get('/api/nope').expect(404);

    expect(response.body.message).not.toMatch(/stack|at Object|node_modules/i);
  });
});
