import { JSONFilePreset } from 'lowdb/node';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, '..', 'data', 'db.json');

const defaultData = {
  users: [], applications: [], timeSessions: [], notifications: [],
  tickets: [], ticketMessages: [], ticketAttachments: [],
  assets: [], assetAssignments: [], assetLogs: [],
  // Desktop agent / activity monitoring
  devices: [], pairingCodes: [], screenshots: [], liveFrames: [], webUsageLogs: [],
  agentConfig: { screenshotIntervalMinutes: 10, liveViewFrameIntervalSeconds: 5, screenshotRetentionDays: 30 },
  idSeq: 1000, ticketSeq: 0, assetTagSeq: 0,
};

export const db = await JSONFilePreset(dbFile, defaultData);

// Backfill collections for any db.json created before these existed.
for (const key of Object.keys(defaultData)) {
  if (db.data[key] === undefined) db.data[key] = defaultData[key];
}
await db.write();

export function nextId() {
  db.data.idSeq += 1;
  return db.data.idSeq;
}

export function nextTicketNumber() {
  db.data.ticketSeq = (db.data.ticketSeq || 0) + 1;
  return `TCK-${String(db.data.ticketSeq).padStart(4, '0')}`;
}

export function nextAssetTag() {
  db.data.assetTagSeq = (db.data.assetTagSeq || 0) + 1;
  return `AST-${String(db.data.assetTagSeq).padStart(4, '0')}`;
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

  // --- Assets ---
  const asset1 = {
    id: nextId(), name: 'Dell Latitude 5440', type: 'Laptop', assetTag: nextAssetTag(), brand: 'Dell', model: 'Latitude 5440',
    serialNumber: 'DL5440-2201', purchaseDate: '2025-02-10', warrantyExpiry: '2028-02-10', status: 'In Use', remarks: '',
    specs: { Motherboard: 'Dell 0XYZ12', CPU: 'Intel Core i7-1355U', RAM: '16GB DDR5', 'Storage Size': '512GB NVMe SSD', 'Video Card': 'Intel Iris Xe (Integrated)', OS: 'Windows 11 Pro' },
    imageUrl: null,
  };
  const asset2 = {
    id: nextId(), name: 'HP LaserJet Pro', type: 'Printer', assetTag: nextAssetTag(), brand: 'HP', model: 'LaserJet Pro M404',
    serialNumber: 'HPLJ-9981', purchaseDate: '2024-11-02', warrantyExpiry: '2026-11-02', status: 'Available', remarks: 'Located at IT storage room',
    specs: { 'Print Type': 'Laser (Mono)', Connectivity: 'USB, Ethernet', 'Duty Cycle': '80,000 pages/month', 'Paper Size': 'A4, Letter, Legal' },
    imageUrl: null,
  };
  const asset3 = {
    id: nextId(), name: 'Dell UltraSharp 27"', type: 'Monitor', assetTag: nextAssetTag(), brand: 'Dell', model: 'U2723QE',
    serialNumber: 'DLU27-0451', purchaseDate: '2025-05-18', warrantyExpiry: '2028-05-18', status: 'Available', remarks: '',
    specs: { 'Display Size': '27 inch', 'Panel Type': 'IPS Black', Resolution: '3840x2160 (4K UHD)', 'Viewing Angle': '178°/178°', 'Refresh Rate': '60Hz', Inputs: 'HDMI, DisplayPort, USB-C', 'Wall Mount Compatible': 'Yes (VESA 100x100)' },
    imageUrl: null,
  };
  db.data.assets = [asset1, asset2, asset3];

  db.data.assetAssignments = [
    { id: nextId(), assetId: asset1.id, employeeId: 4, assignedBy: 1, assignedDate: '2026-06-05', returnedDate: null, status: 'Active' },
  ];
  db.data.assetLogs = [
    { id: nextId(), assetId: asset1.id, action: 'Created', performedBy: 1, message: `${asset1.name} (${asset1.assetTag}) was added to inventory by 88TH Admin.`, timestamp: '2026-06-01 10:00 AM' },
    { id: nextId(), assetId: asset1.id, action: 'Assigned', performedBy: 1, message: 'Assigned to Roshell Tecson by 88TH Admin.', timestamp: '2026-06-05 09:00 AM' },
    { id: nextId(), assetId: asset2.id, action: 'Created', performedBy: 1, message: `${asset2.name} (${asset2.assetTag}) was added to inventory by 88TH Admin.`, timestamp: '2026-06-01 10:05 AM' },
    { id: nextId(), assetId: asset3.id, action: 'Created', performedBy: 1, message: `${asset3.name} (${asset3.assetTag}) was added to inventory by 88TH Admin.`, timestamp: '2026-06-01 10:10 AM' },
  ];

  // --- Tickets ---
  const ticket1 = {
    id: nextId(), ticketNumber: nextTicketNumber(), employeeId: 5, assignedTo: null,
    subject: 'Laptop keyboard keys unresponsive', description: 'Several keys on my laptop keyboard have stopped responding since this morning.',
    type: 'Incident', priority: 'High', status: 'Open', createdAt: '2026-07-30 08:45 AM', updatedAt: '2026-07-30 08:45 AM',
  };
  const ticket2 = {
    id: nextId(), ticketNumber: nextTicketNumber(), employeeId: 6, assignedTo: null,
    subject: 'Requesting a second monitor for WFH setup', description: 'I would like to borrow a spare monitor to improve my dual-screen productivity while working from home.',
    type: 'Borrow', priority: 'Medium', status: 'Open', createdAt: '2026-07-31 01:15 PM', updatedAt: '2026-07-31 01:15 PM',
  };
  db.data.tickets = [ticket1, ticket2];
  db.data.ticketMessages = [
    { id: nextId(), ticketId: ticket1.id, sender: 5, senderRole: 'Employee', message: 'Happy to bring the unit to the IT desk if needed.', attachment: null, createdAt: '2026-07-30 08:50 AM' },
  ];
  db.data.ticketAttachments = [];

  await db.write();
}

await seedIfEmpty();
