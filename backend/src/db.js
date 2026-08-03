import { JSONFilePreset } from 'lowdb/node';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, '..', 'data', 'db.json');

const defaultData = { users: [], applications: [], timeSessions: [], notifications: [], idSeq: 1000 };

export const db = await JSONFilePreset(dbFile, defaultData);

export function nextId() {
  db.data.idSeq += 1;
  return db.data.idSeq;
}

const hash = (plain) => bcrypt.hashSync(plain, 10);

async function seedIfEmpty() {
  if (db.data.users.length > 0) return;

  const pw = hash('password123');
  db.data.users = [
    { id: 1, name: '88TH Admin', email: 'admin@88thfloor.com', passwordHash: pw, role: 'Admin', department: 'IT', jobTitle: 'IT Administrator', managerId: null, status: 'inactive' },
    { id: 2, name: 'Daryl Garcia', email: 'darylg@88thfloor.com', passwordHash: pw, role: 'Manager', department: 'IT', jobTitle: 'IT Manager', managerId: null, status: 'inactive' },
    { id: 3, name: 'Leslie Occo', email: 'leslieo@88thfloor.com', passwordHash: pw, role: 'Manager', department: 'Order Management', jobTitle: 'OMD Manager', managerId: null, status: 'inactive' },
    { id: 4, name: 'Roshell Tecson', email: 'roshellt@88thfloor.com', passwordHash: pw, role: 'Employee', department: 'Order Management', jobTitle: 'Order Entry', managerId: 3, status: 'inactive' },
    { id: 5, name: 'Cloris Colonia', email: 'clorisc@88thfloor.com', passwordHash: pw, role: 'Employee', department: 'Order Management', jobTitle: 'Order Entry', managerId: 3, status: 'inactive' },
    { id: 6, name: 'Karen Asis', email: 'karena@88thfloor.com', passwordHash: pw, role: 'Employee', department: 'IT', jobTitle: 'Web Developer', managerId: 2, status: 'inactive' },
    { id: 7, name: 'Joshua Alvarez', email: 'joshuaa@88thfloor.com', passwordHash: pw, role: 'Employee', department: 'IT', jobTitle: 'Web Developer', managerId: 2, status: 'inactive' },
    { id: 8, name: 'Ronald Arabis', email: 'ronalda@88thfloor.com', passwordHash: pw, role: 'Manager', department: 'ART', jobTitle: 'ART Manager', managerId: null, status: 'inactive' },
    { id: 9, name: 'Karen Mirabel', email: 'karenl@88thfloor.com', passwordHash: pw, role: 'Employee', department: 'ART', jobTitle: 'Donor Wall', managerId: 8, status: 'inactive' },
  ];

  db.data.applications = [
    {
      id: nextId(), userId: 4, status: 'approved', submittedDate: '2026-06-01', location: 'Cebu City Home Office',
      startDate: '2026-06-05', defaultEndDate: '2026-09-05', temporary: false, endDate: '2026-09-05',
      days: { mon: 'WFH', tue: 'WFH', wed: 'Office', thu: 'WFH', fri: 'WFH', sat: 'Off', sun: 'Off' },
      internetType: 'Fiber', fileName: 'speedtest-roshell.png', reason: 'Focus work on primary order management processing.'
    },
    {
      id: nextId(), userId: 5, status: 'pending', submittedDate: '2026-07-20', location: 'Lapu-Lapu City Apartment',
      startDate: '2026-07-28', defaultEndDate: '2026-10-28', temporary: false, endDate: '2026-10-28',
      days: { mon: 'WFH', tue: 'Office', wed: 'WFH', thu: 'Office', fri: 'WFH', sat: 'Off', sun: 'Off' },
      internetType: 'Cable', fileName: 'speedtest-cloris.png', reason: 'Reducing daily commute hours to increase availability during order processing peaks.'
    },
  ];

  db.data.timeSessions = [
    { id: nextId(), userId: 4, date: '2026-07-27', startTime: '08:58 AM', endTime: '05:31 PM', totalHours: 8.55, status: 'Completed' },
    { id: nextId(), userId: 4, date: '2026-07-28', startTime: '09:03 AM', endTime: '05:12 PM', totalHours: 8.15, status: 'Completed' },
  ];

  db.data.notifications = [
    { id: nextId(), audience: 'role', role: 'Admin', message: 'WFH applications pending review across departments.', type: 'warning', read: false, timestamp: '2026-07-29 09:12 AM' },
  ];

  await db.write();
}

await seedIfEmpty();
